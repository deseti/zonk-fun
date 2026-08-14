package indexer

import (
	"context"
	"math/big"
	"os"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

func eventLog(t *testing.T, abiEvents map[string]abi.Event, name string, indexed []common.Hash, args ...any) types.Log {
	t.Helper()
	e := abiEvents[name]
	data, err := e.Inputs.NonIndexed().Pack(args...)
	if err != nil {
		t.Fatal(err)
	}
	return types.Log{Address: common.HexToAddress("0x00000000000000000000000000000000000000aa"), Topics: append([]common.Hash{e.ID}, indexed...), Data: data}
}

func integrationStore(t *testing.T) *Store {
	t.Helper()
	url := os.Getenv("INDEXER_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set INDEXER_TEST_DATABASE_URL to run PostgreSQL integration tests")
	}
	if !strings.Contains(strings.ToLower(url), "test") {
		t.Fatal("integration database must be explicitly named test")
	}
	s, err := NewStore(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	for _, table := range []string{"token_trade_buckets", "token_holder_balances", "token_metrics", "liquidity_events", "graduations", "fees", "trades", "curves", "tokens", "chain_events", "chain_blocks", "indexer_checkpoints"} {
		if _, err = s.pool.Exec(context.Background(), "TRUNCATE "+table+" CASCADE"); err != nil {
			t.Fatal(err)
		}
	}
	return s
}

func v3Launch(t *testing.T, token, creator, curve common.Hash) types.Log {
	return eventLog(t, contractABI.Events, "TokenLaunchedV3", []common.Hash{creator, token, curve}, "endpoint-cp-v3", big.NewInt(1000), big.NewInt(800), big.NewInt(200), common.Address{}, common.Address{}, [32]byte{}, [32]byte{}, uint16(0))
}

func stamp(b *types.Header, logs ...types.Log) []types.Log {
	for i := range logs {
		// Transaction hashes must be distinct across competing blocks so a reorg
		// fixture cannot overwrite an unrelated canonical event before rewind.
		txID := new(big.Int).SetUint64(b.Number.Uint64()*1000 + uint64(i) + 1)
		logs[i].BlockNumber, logs[i].BlockHash, logs[i].TxHash, logs[i].Index = b.Number.Uint64(), b.Hash(), common.BigToHash(txID), uint(i+1)
	}
	return logs
}

func TestV3TransferAnalyticsAndIdempotency(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	token, creator, buyer, curve := common.HexToHash("0x101"), common.HexToHash("0x102"), common.HexToHash("0x103"), common.HexToHash("0x104")
	b := &types.Header{Number: big.NewInt(10), Time: 3601}
	zero := common.Hash{}
	launch := v3Launch(t, token, creator, curve)
	mint := eventLog(t, contractABI.Events, "Transfer", []common.Hash{zero, creator}, big.NewInt(1000))
	mint.Address = common.BytesToAddress(token.Bytes())
	move := eventLog(t, contractABI.Events, "Transfer", []common.Hash{creator, buyer}, big.NewInt(100))
	move.Address = common.BytesToAddress(token.Bytes())
	buy := eventLog(t, v3TradeABI.Events, "TokensBought", []common.Hash{token, buyer}, big.NewInt(12), big.NewInt(12), big.NewInt(10), big.NewInt(10), big.NewInt(1), big.NewInt(1), big.NewInt(0))
	buy.Address = common.BytesToAddress(curve.Bytes())
	logs := stamp(b, launch, mint, move, buy)
	metadata := map[string]TokenMetadata{common.BytesToAddress(token.Bytes()).Hex(): {Name: "Analytics", Symbol: "AN", Decimals: 18}}
	if err := s.ApplyWithMetadata(ctx, BaseSepoliaChainID, "v3", b, logs, metadata); err != nil {
		t.Fatal(err)
	}
	if err := s.ApplyWithMetadata(ctx, BaseSepoliaChainID, "v3", b, logs, metadata); err != nil {
		t.Fatal(err)
	}
	var holders, traders, trades, buckets int64
	if err := s.pool.QueryRow(ctx, `SELECT holder_count,unique_trader_count,trade_count FROM token_metrics WHERE chain_id=$1 AND token_address=$2`, BaseSepoliaChainID, common.BytesToAddress(token.Bytes()).Hex()).Scan(&holders, &traders, &trades); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM token_trade_buckets WHERE chain_id=$1`, BaseSepoliaChainID).Scan(&buckets); err != nil {
		t.Fatal(err)
	}
	if holders != 2 || traders != 1 || trades != 1 || buckets != 1 {
		t.Fatalf("metrics=%d/%d/%d buckets=%d", holders, traders, trades, buckets)
	}
}

func TestV3AnalyticsReorgRemovesOrphanedState(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	token, creator, oldBuyer, newBuyer, curve := common.HexToHash("0x201"), common.HexToHash("0x202"), common.HexToHash("0x203"), common.HexToHash("0x204"), common.HexToHash("0x205")
	b1 := &types.Header{Number: big.NewInt(1), Time: 3601}
	b2 := &types.Header{Number: big.NewInt(2), ParentHash: b1.Hash(), Time: 3610}
	replacement := &types.Header{Number: big.NewInt(2), ParentHash: b1.Hash(), Time: 3620, Nonce: types.EncodeNonce(9)}
	launch := v3Launch(t, token, creator, curve)
	mint := eventLog(t, contractABI.Events, "Transfer", []common.Hash{common.Hash{}, creator}, big.NewInt(1000))
	mint.Address = common.BytesToAddress(token.Bytes())
	metadata := map[string]TokenMetadata{common.BytesToAddress(token.Bytes()).Hex(): {Name: "Reorg", Symbol: "RGR", Decimals: 18}}
	if err := s.ApplyWithMetadata(ctx, BaseSepoliaChainID, "v3-reorg", b1, stamp(b1, launch, mint), metadata); err != nil {
		t.Fatal(err)
	}
	oldTransfer := eventLog(t, contractABI.Events, "Transfer", []common.Hash{creator, oldBuyer}, big.NewInt(100))
	oldTransfer.Address = common.BytesToAddress(token.Bytes())
	oldTrade := eventLog(t, v3TradeABI.Events, "TokensBought", []common.Hash{token, oldBuyer}, big.NewInt(10), big.NewInt(10), big.NewInt(8), big.NewInt(8), big.NewInt(1), big.NewInt(1), big.NewInt(0))
	oldTrade.Address = common.BytesToAddress(curve.Bytes())
	oldLogs := stamp(b2, oldTransfer, oldTrade)
	if err := s.Apply(ctx, BaseSepoliaChainID, "v3-reorg", b2, oldLogs); err != nil {
		t.Fatal(err)
	}
	if err := s.Rewind(ctx, BaseSepoliaChainID, "v3-reorg", 2); err != nil {
		t.Fatal(err)
	}
	newTransfer := eventLog(t, contractABI.Events, "Transfer", []common.Hash{creator, newBuyer}, big.NewInt(50))
	newTransfer.Address = common.BytesToAddress(token.Bytes())
	newTrade := eventLog(t, v3TradeABI.Events, "TokensBought", []common.Hash{token, newBuyer}, big.NewInt(20), big.NewInt(20), big.NewInt(17), big.NewInt(17), big.NewInt(2), big.NewInt(1), big.NewInt(0))
	newTrade.Address = common.BytesToAddress(curve.Bytes())
	if err := s.Apply(ctx, BaseSepoliaChainID, "v3-reorg", replacement, stamp(replacement, newTransfer, newTrade)); err != nil {
		t.Fatal(err)
	}
	address := common.BytesToAddress(token.Bytes()).Hex()
	var holders, traders, trades int64
	var volume string
	var oldBalance int
	if err := s.pool.QueryRow(ctx, `SELECT holder_count,unique_trader_count,trade_count,volume::text FROM token_metrics WHERE chain_id=$1 AND token_address=$2`, BaseSepoliaChainID, address).Scan(&holders, &traders, &trades, &volume); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM token_holder_balances WHERE chain_id=$1 AND token_address=$2 AND holder_address=$3`, BaseSepoliaChainID, address, common.BytesToAddress(oldBuyer.Bytes()).Hex()).Scan(&oldBalance); err != nil {
		t.Fatal(err)
	}
	if holders != 2 || traders != 1 || trades != 1 || volume != "17" || oldBalance != 0 {
		t.Fatalf("canonical metrics=%d/%d/%d/%s old=%d", holders, traders, trades, volume, oldBalance)
	}
}

func TestV3PriceAndFDVProjection(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	b := &types.Header{Number: big.NewInt(1), Time: 1}
	if _, err := s.pool.Exec(ctx, `INSERT INTO chain_blocks(chain_id,block_number,block_hash,parent_hash,block_timestamp) VALUES($1,1,$2,'0x',1)`, BaseSepoliaChainID, b.Hash().Hex()); err != nil {
		t.Fatal(err)
	}
	wad := big.NewInt(1_000_000_000_000_000_000)
	supply := new(big.Int).Mul(big.NewInt(1_000_000_000), wad)
	sold := new(big.Int).Mul(big.NewInt(400_000_000), wad)
	reserve := big.NewInt(2_000_000_000_000_000_000)
	token := common.HexToAddress("0x0000000000000000000000000000000000000a01")
	if _, err := s.pool.Exec(ctx, `INSERT INTO tokens(chain_id,token_address,creator_address,name,symbol,initial_supply,protocol_version,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,'Price','P',$4,'endpoint-cp-v3',1,$5,$6,0)`, BaseSepoliaChainID, token.Hex(), common.HexToAddress("0x1").Hex(), supply.String(), b.Hash().Hex(), common.HexToHash("0x11").Hex()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO curves(chain_id,token_address,curve_address,curve_supply,sold_supply,reserve_balance,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,0)`, BaseSepoliaChainID, token.Hex(), common.HexToAddress("0x2").Hex(), supply.String(), sold.String(), reserve.String(), b.Hash().Hex(), common.HexToHash("0x12").Hex()); err != nil {
		t.Fatal(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = rebuildAnalyticsTx(ctx, tx, BaseSepoliaChainID); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	virtual, ok := new(big.Int).SetString("1066666666666666666666666667", 10)
	if !ok {
		t.Fatal("invalid virtual reserve")
	}
	denominator := new(big.Int).Sub(virtual, sold)
	numerator := new(big.Int).Mul(new(big.Int).Add(wad, reserve), wad)
	price, rem := new(big.Int), new(big.Int)
	price.QuoRem(numerator, denominator, rem)
	if rem.Sign() > 0 {
		price.Add(price, big.NewInt(1))
	}
	fdv := new(big.Int).Quo(new(big.Int).Mul(price, supply), wad)
	var gotPrice, gotFDV string
	if err := s.pool.QueryRow(ctx, `SELECT current_price::text,market_cap::text FROM token_metrics WHERE chain_id=$1 AND token_address=$2`, BaseSepoliaChainID, token.Hex()).Scan(&gotPrice, &gotFDV); err != nil {
		t.Fatal(err)
	}
	if gotPrice != price.String() || gotFDV != fdv.String() {
		t.Fatalf("price/fdv=%s/%s want=%s/%s", gotPrice, gotFDV, price, fdv)
	}
}
