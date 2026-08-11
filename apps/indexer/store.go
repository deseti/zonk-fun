package indexer

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"log"
	"math/big"
)

type Store struct{ pool *pgxpool.Pool }

func NewStore(ctx context.Context, url string) (*Store, error) {
	p, e := pgxpool.New(ctx, url)
	if e != nil {
		return nil, e
	}
	if e = p.Ping(ctx); e != nil {
		p.Close()
		return nil, e
	}
	return &Store{p}, nil
}
func (s *Store) Close() { s.pool.Close() }
func (s *Store) Checkpoint(ctx context.Context, chain int64, name string) (uint64, string, error) {
	var n uint64
	var h string
	e := s.pool.QueryRow(ctx, `SELECT last_block_number,last_block_hash FROM indexer_checkpoints WHERE chain_id=$1 AND indexer_name=$2`, chain, name).Scan(&n, &h)
	if e == pgx.ErrNoRows {
		return 0, "", nil
	}
	return n, h, e
}
func (s *Store) CanonicalBlockHash(ctx context.Context, chain int64, number uint64) (string, error) {
	var h string
	e := s.pool.QueryRow(ctx, `SELECT block_hash FROM chain_blocks WHERE chain_id=$1 AND block_number=$2 AND is_canonical`, chain, number).Scan(&h)
	if e == pgx.ErrNoRows {
		return "", nil
	}
	return h, e
}
func (s *Store) Rewind(ctx context.Context, chain int64, name string, from uint64) error {
	_, e := s.pool.Exec(ctx, `UPDATE chain_blocks SET is_canonical=false,orphaned_at=now() WHERE chain_id=$1 AND block_number >= $2 AND is_canonical`, chain, from)
	if e != nil {
		return e
	}
	for _, table := range []string{"tokens", "curves", "trades", "fees", "graduations", "liquidity_events"} {
		if _, e = s.pool.Exec(ctx, `UPDATE `+table+` SET is_canonical=false WHERE chain_id=$1 AND block_number >= $2 AND is_canonical`, chain, from); e != nil {
			return e
		}
	}
	if _, e = s.pool.Exec(ctx, `UPDATE token_metrics SET trade_count=0,buy_count=0,sell_count=0,volume=0,fees=0,updated_at=now() WHERE chain_id=$1`, chain); e != nil {
		return e
	}
	_, e = s.pool.Exec(ctx, `UPDATE token_metrics m SET trade_count=q.trade_count,buy_count=q.buy_count,sell_count=q.sell_count,volume=q.volume,fees=q.fees,updated_at=now() FROM (SELECT chain_id,token_address,count(*) trade_count,count(*) FILTER (WHERE side='buy') buy_count,count(*) FILTER (WHERE side='sell') sell_count,coalesce(sum(curve_value),0) volume,coalesce(sum(protocol_fee+creator_fee),0) fees FROM trades WHERE chain_id=$1 AND is_canonical GROUP BY chain_id,token_address) q WHERE m.chain_id=q.chain_id AND m.token_address=q.token_address`, chain)
	if e != nil {
		return e
	}
	_, e = s.pool.Exec(ctx, `UPDATE chain_events SET is_canonical=false,orphaned_at=now() WHERE chain_id=$1 AND block_number >= $2 AND is_canonical`, chain, from)
	if e != nil {
		return e
	}
	_, e = s.pool.Exec(ctx, `UPDATE indexer_checkpoints SET last_block_number=$3,last_block_hash='',updated_at=now() WHERE chain_id=$1 AND indexer_name=$2`, chain, name, from-1)
	return e
}
func (s *Store) Apply(ctx context.Context, chain int64, name string, b *types.Header, logs []types.Log) error {
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	hash := b.Hash().Hex()
	parent := b.ParentHash.Hex()
	// A replacement block at the same height must first orphan the old
	// canonical row, otherwise the partial unique height index rejects it.
	if _, e = tx.Exec(ctx, `UPDATE chain_blocks SET is_canonical=false,orphaned_at=now() WHERE chain_id=$1 AND block_number=$2 AND block_hash<>$3 AND is_canonical`, chain, b.Number.Uint64(), hash); e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO chain_blocks(chain_id,block_number,block_hash,parent_hash,block_timestamp) VALUES($1,$2,$3,$4,$5) ON CONFLICT(chain_id,block_hash) DO UPDATE SET is_canonical=true,orphaned_at=NULL`, chain, b.Number.Uint64(), hash, parent, b.Time)
	if e != nil {
		return e
	}
	for _, l := range logs {
		if e = insertEvent(ctx, tx, chain, l); e != nil {
			return e
		}
	}
	if e = rebuildMetricsTx(ctx, tx, chain); e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO indexer_checkpoints(chain_id,indexer_name,last_block_number,last_block_hash) VALUES($1,$2,$3,$4) ON CONFLICT(chain_id,indexer_name) DO UPDATE SET last_block_number=excluded.last_block_number,last_block_hash=excluded.last_block_hash,updated_at=now()`, chain, name, b.Number.Uint64(), hash)
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func rebuildMetricsTx(ctx context.Context, tx pgx.Tx, chain int64) error {
	if _, e := tx.Exec(ctx, `UPDATE token_metrics SET trade_count=0,buy_count=0,sell_count=0,volume=0,fees=0,updated_at=now() WHERE chain_id=$1`, chain); e != nil {
		return e
	}
	_, e := tx.Exec(ctx, `INSERT INTO token_metrics(chain_id,token_address,trade_count,buy_count,sell_count,volume,fees,updated_at) SELECT chain_id,token_address,count(*),count(*) FILTER (WHERE side='buy'),count(*) FILTER (WHERE side='sell'),coalesce(sum(curve_value),0),coalesce(sum(protocol_fee+creator_fee),0),now() FROM trades WHERE chain_id=$1 AND is_canonical GROUP BY chain_id,token_address ON CONFLICT(chain_id,token_address) DO UPDATE SET trade_count=excluded.trade_count,buy_count=excluded.buy_count,sell_count=excluded.sell_count,volume=excluded.volume,fees=excluded.fees,updated_at=now()`, chain)
	return e
}
func insertEvent(ctx context.Context, tx pgx.Tx, chain int64, l types.Log) error {
	if len(l.Topics) == 0 {
		return nil
	}
	ev, ok := eventByTopic[l.Topics[0]]
	if !ok {
		log.Printf("zonk-indexer: unknown event chain_id=%d contract=%s tx=%s block=%d log_index=%d topic=%s", chain, l.Address.Hex(), l.TxHash.Hex(), l.BlockNumber, l.Index, l.Topics[0].Hex())
		return nil
	}
	vals := map[string]any{}
	if e := contractABI.UnpackIntoMap(vals, ev, l.Data); e != nil {
		return fmt.Errorf("decode %s: %w", ev, e)
	}
	if e := abi.ParseTopicsIntoMap(vals, indexedArguments(contractABI.Events[ev].Inputs), l.Topics[1:]); e != nil {
		return fmt.Errorf("decode indexed %s: %w", ev, e)
	}
	raw, _ := json.Marshal(vals)
	topics := make([]string, len(l.Topics))
	for i, t := range l.Topics {
		topics[i] = t.Hex()
	}
	tb, _ := json.Marshal(topics)
	_, e := tx.Exec(ctx, `INSERT INTO chain_events(chain_id,block_number,block_hash,transaction_hash,log_index,contract_address,topic0,topics,data,event_name,decoded) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(chain_id,transaction_hash,log_index) DO UPDATE SET is_canonical=true,orphaned_at=NULL,block_hash=excluded.block_hash,decoded=excluded.decoded`, chain, l.BlockNumber, l.BlockHash.Hex(), l.TxHash.Hex(), l.Index, l.Address.Hex(), l.Topics[0].Hex(), tb, l.Data, ev, raw)
	if e != nil {
		return e
	}
	return projection(ctx, tx, chain, l, ev, vals)
}

var eventByTopic = func() map[common.Hash]string {
	m := map[common.Hash]string{}
	for n, e := range contractABI.Events {
		m[e.ID] = n
	}
	return m
}()

func indexedArguments(args abi.Arguments) abi.Arguments {
	out := make(abi.Arguments, 0, len(args))
	for _, arg := range args {
		if arg.Indexed {
			out = append(out, arg)
		}
	}
	return out
}

func str(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case common.Address:
		return x.Hex()
	case *big.Int:
		return x.String()
	case bool:
		if x {
			return "true"
		}
		return "false"
	}
	return fmt.Sprint(v)
}
func u(v any) string {
	if v == nil {
		return "0"
	}
	return str(v)
}
func projection(ctx context.Context, tx pgx.Tx, c int64, l types.Log, n string, v map[string]any) error {
	b := l.BlockHash.Hex()
	t := l.TxHash.Hex()
	i := l.Index
	switch n {
	case "TokenCreated":
		_, e := tx.Exec(ctx, `INSERT INTO tokens(chain_id,token_address,creator_address,name,symbol,initial_supply,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (chain_id,token_address,transaction_hash,log_index) DO UPDATE SET is_canonical=true`, c, u(v["token"]), u(v["creator"]), u(v["name"]), u(v["symbol"]), u(v["initialSupply"]), l.BlockNumber, b, t, i)
		return e
	case "CurveCreated":
		_, e := tx.Exec(ctx, `INSERT INTO curves(chain_id,token_address,curve_address,creator_address,curve_supply,starting_price,slope,graduation_threshold,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (chain_id,token_address,transaction_hash,log_index) DO UPDATE SET is_canonical=true`, c, u(v["token"]), l.Address.Hex(), u(v["creator"]), u(v["curveSupply"]), u(v["startingPrice"]), u(v["slope"]), u(v["graduationThreshold"]), l.BlockNumber, b, t, i)
		return e
	case "TokensBought", "TokensSold":
		side := "buy"
		trader := v["buyer"]
		reserve := v["reserveIn"]
		value := v["curveCost"]
		if n == "TokensSold" {
			side = "sell"
			trader = v["seller"]
			reserve = v["reserveOut"]
			value = v["curveValue"]
		}
		_, e := tx.Exec(ctx, `INSERT INTO trades(chain_id,token_address,trader_address,side,token_amount,reserve_amount,curve_value,protocol_fee,creator_fee,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (chain_id,transaction_hash,log_index) DO UPDATE SET is_canonical=true`, c, u(v["token"]), u(trader), side, u(v["tokenAmount"]), u(reserve), u(value), u(v["protocolFee"]), u(v["creatorFee"]), l.BlockNumber, b, t, i)
		if e != nil {
			return e
		}
		return nil
	case "GraduationPending":
		_, e := tx.Exec(ctx, `INSERT INTO graduations(chain_id,token_address,phase,sold_supply,reserve_balance,token_amount,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,'pending',$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (chain_id,transaction_hash,log_index) DO UPDATE SET is_canonical=true`, c, u(v["token"]), u(v["soldSupply"]), u(v["reserveBalance"]), u(v["tokenLiquidityAmount"]), l.BlockNumber, b, t, i)
		return e
	case "Graduated":
		_, e := tx.Exec(ctx, `INSERT INTO graduations(chain_id,token_address,liquidity_token_address,phase,token_amount,quote_amount,liquidity_amount,lock_id,unlock_timestamp,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,'graduated',$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (chain_id,transaction_hash,log_index) DO UPDATE SET is_canonical=true`, c, u(v["token"]), u(v["liquidityToken"]), u(v["tokenAmount"]), u(v["quoteAmount"]), u(v["liquidityAmount"]), u(v["lockId"]), u(v["unlockTimestamp"]), l.BlockNumber, b, t, i)
		return e
	case "LiquidityCreated":
		_, e := tx.Exec(ctx, `INSERT INTO liquidity_events(chain_id,token_address,liquidity_token_address,event_name,amount,lock_id,unlock_timestamp,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (chain_id,transaction_hash,log_index) DO UPDATE SET is_canonical=true`, c, u(v["token"]), u(v["liquidityToken"]), n, u(v["liquidityAmount"]), u(v["lockId"]), u(v["unlockTimestamp"]), l.BlockNumber, b, t, i)
		return e
	case "LiquidityLocked", "LiquidityClaimed":
		_, e := tx.Exec(ctx, `INSERT INTO liquidity_events(chain_id,liquidity_token_address,event_name,amount,lock_id,beneficiary_address,unlock_timestamp,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (chain_id,transaction_hash,log_index) DO UPDATE SET is_canonical=true`, c, u(v["liquidityToken"]), n, u(v["amount"]), u(v["lockId"]), u(v["beneficiary"]), u(v["unlockTimestamp"]), l.BlockNumber, b, t, i)
		return e
	case "FeesAccrued":
		_, e := tx.Exec(ctx, `INSERT INTO fees(chain_id,token_address,creator_address,fee_kind,protocol_fee,creator_fee,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (chain_id,transaction_hash,log_index) DO UPDATE SET is_canonical=true`, c, u(v["token"]), u(v["creator"]), u(v["isBuy"]), u(v["protocolFee"]), u(v["creatorFee"]), l.BlockNumber, b, t, i)
		return e
	case "ProtocolFeesClaimed", "CreatorFeesClaimed":
		_, e := tx.Exec(ctx, `INSERT INTO fees(chain_id,token_address,creator_address,fee_kind,amount,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (chain_id,transaction_hash,log_index) DO UPDATE SET is_canonical=true`, c, u(v["token"]), u(v["creator"]), n, u(v["amount"]), l.BlockNumber, b, t, i)
		return e
	}
	return nil
}
