package api

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("not found")
var ErrInvalidCursor = errors.New("invalid cursor")

type Repository interface {
	Ping(context.Context) error
	ListTokens(context.Context, int64, int, string) (Page, error)
	TrendingTokens(context.Context, int64, int, string) (Page, error)
	Token(context.Context, int64, string) (Token, error)
	CreatorTokens(context.Context, int64, string, int, string) (Page, error)
	Creator(context.Context, int64, string, int, string) (CreatorProfile, error)
	Trades(context.Context, int64, string, int, string) (TradePage, error)
	Activity(context.Context, int64, string, int, string) (ActivityPage, error)
}
type PostgresRepository struct{ pool *pgxpool.Pool }

func NewPostgresRepository(ctx context.Context, url string) (*PostgresRepository, error) {
	p, e := pgxpool.New(ctx, url)
	if e != nil {
		return nil, e
	}
	return &PostgresRepository{pool: p}, nil
}
func (r *PostgresRepository) Close()                         { r.pool.Close() }
func (r *PostgresRepository) Ping(ctx context.Context) error { return r.pool.Ping(ctx) }

const tokenSelect = `SELECT t.token_address,t.creator_address,t.name,t.symbol,t.initial_supply,t.block_number,t.transaction_hash,t.log_index,
 c.curve_address,c.curve_supply,c.sold_supply,c.reserve_balance,c.starting_price,c.slope,c.graduation_threshold,c.lifecycle,
 m.trade_count,m.buy_count,m.sell_count,m.volume,m.fees,
 g.phase,g.liquidity_token_address,g.token_amount,g.quote_amount,g.liquidity_amount,g.lock_id,g.unlock_timestamp
 FROM (SELECT DISTINCT ON (token_address) * FROM tokens WHERE chain_id=$1 AND is_canonical ORDER BY token_address,block_number DESC,log_index DESC) t
 LEFT JOIN LATERAL (SELECT * FROM curves c WHERE c.chain_id=$1 AND c.token_address=t.token_address AND c.is_canonical ORDER BY c.block_number DESC,c.log_index DESC LIMIT 1)c ON true
 LEFT JOIN token_metrics m ON m.chain_id=t.chain_id AND m.token_address=t.token_address
 LEFT JOIN LATERAL (SELECT * FROM graduations g WHERE g.chain_id=$1 AND g.token_address=t.token_address AND g.is_canonical ORDER BY g.block_number DESC,g.log_index DESC LIMIT 1)g ON true`

func scanToken(row pgx.Row) (Token, error) {
	var t Token
	var caddr, csupply, sold, reserve, start, slope, threshold, life *string
	var phase, liq, ta, qa, la, lid *string
	var tc, bc, sc *int64
	var vol, fees *string
	var unlock *int64
	e := row.Scan(&t.Address, &t.Creator, &t.Name, &t.Symbol, &t.InitialSupply, &t.CreatedAt.BlockNumber, &t.CreatedAt.TransactionHash, &t.CreatedAt.LogIndex, &caddr, &csupply, &sold, &reserve, &start, &slope, &threshold, &life, &tc, &bc, &sc, &vol, &fees, &phase, &liq, &ta, &qa, &la, &lid, &unlock)
	if e != nil {
		return t, e
	}
	if caddr != nil {
		t.Curve = &Curve{Address: *caddr, SoldSupply: value(sold), ReserveBalance: value(reserve), Supply: value(csupply), StartingPrice: value(start), Slope: value(slope), GraduationThreshold: value(threshold), Lifecycle: value(life)}
	}
	t.Metrics = Metrics{TradeCount: valueInt(tc), BuyCount: valueInt(bc), SellCount: valueInt(sc), Volume: value(vol), Fees: value(fees)}
	if phase != nil {
		t.Graduation = &Graduation{Phase: *phase, LiquidityToken: value(liq), TokenAmount: value(ta), QuoteAmount: value(qa), LiquidityAmount: value(la), LockID: value(lid), UnlockTimestamp: unlock}
	}
	return t, nil
}
func value(v *string) string {
	if v == nil {
		return "0"
	}
	return *v
}
func valueInt(v *int64) int64 {
	if v == nil {
		return 0
	}
	return *v
}

type pageCursor struct {
	Kind         string `json:"k"`
	BlockNumber  int64  `json:"b"`
	TokenAddress string `json:"a,omitempty"`
	Transaction  string `json:"t,omitempty"`
	LogIndex     int64  `json:"l,omitempty"`
	TradeCount   int64  `json:"n,omitempty"`
	Volume       string `json:"v,omitempty"`
}

func encodeCursor(c pageCursor) string {
	b, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(b)
}
func decodeCursor(raw, kind string) (pageCursor, error) {
	var c pageCursor
	if raw == "" {
		return c, nil
	}
	b, e := base64.RawURLEncoding.DecodeString(raw)
	if e != nil || json.Unmarshal(b, &c) != nil || c.Kind != kind || c.BlockNumber < 0 {
		return pageCursor{}, ErrInvalidCursor
	}
	if (kind == "tokens" || kind == "creator") && !validCursorHex(c.TokenAddress, 40) {
		return pageCursor{}, ErrInvalidCursor
	}
	if kind == "trending" && (!validCursorHex(c.TokenAddress, 40) || c.Volume == "") {
		return pageCursor{}, ErrInvalidCursor
	}
	if (kind == "trades" || kind == "activity") && (!validCursorHex(c.Transaction, 64) || c.LogIndex < 0) {
		return pageCursor{}, ErrInvalidCursor
	}
	return c, nil
}
func validCursorHex(value string, bytes int) bool {
	if len(value) != bytes+2 || value[:2] != "0x" {
		return false
	}
	_, e := hex.DecodeString(value[2:])
	return e == nil
}

func (r *PostgresRepository) ListTokens(ctx context.Context, chain int64, limit int, rawCursor string) (Page, error) {
	c, e := decodeCursor(rawCursor, "tokens")
	if e != nil {
		return Page{}, e
	}
	args := []any{chain}
	where := ""
	if rawCursor != "" {
		args = append(args, c.BlockNumber, c.TokenAddress)
		where = " AND (t.block_number < $2 OR (t.block_number = $2 AND t.token_address > $3))"
	}
	args = append(args, limit+1)
	rows, e := r.pool.Query(ctx, tokenSelect+" WHERE 1=1"+where+" ORDER BY t.block_number DESC,t.token_address ASC LIMIT $"+strconv.Itoa(len(args)), args...)
	if e != nil {
		return Page{}, e
	}
	defer rows.Close()
	out := Page{Items: []Token{}}
	for rows.Next() {
		t, e := scanToken(rows)
		if e != nil {
			return Page{}, e
		}
		out.Items = append(out.Items, t)
	}
	if e = rows.Err(); e != nil {
		return Page{}, e
	}
	if len(out.Items) > limit {
		out.Items = out.Items[:limit]
		last := out.Items[len(out.Items)-1]
		out.NextCursor = encodeCursor(pageCursor{Kind: "tokens", BlockNumber: last.CreatedAt.BlockNumber, TokenAddress: last.Address})
	}
	return out, nil
}
func (r *PostgresRepository) TrendingTokens(ctx context.Context, chain int64, limit int, rawCursor string) (Page, error) {
	c, e := decodeCursor(rawCursor, "trending")
	if e != nil {
		return Page{}, e
	}
	args := []any{chain}
	where := ""
	if rawCursor != "" {
		args = append(args, c.TradeCount, c.Volume, c.BlockNumber, c.TokenAddress)
		where = " AND (COALESCE(m.trade_count,0) < $2 OR (COALESCE(m.trade_count,0) = $2 AND COALESCE(m.volume,0) < $3) OR (COALESCE(m.trade_count,0) = $2 AND COALESCE(m.volume,0) = $3 AND t.block_number < $4) OR (COALESCE(m.trade_count,0) = $2 AND COALESCE(m.volume,0) = $3 AND t.block_number = $4 AND t.token_address > $5))"
	}
	args = append(args, limit+1)
	order := " ORDER BY COALESCE(m.trade_count,0) DESC,COALESCE(m.volume,0) DESC,t.block_number DESC,t.token_address ASC LIMIT $" + strconv.Itoa(len(args))
	rows, e := r.pool.Query(ctx, tokenSelect+" WHERE 1=1"+where+order, args...)
	if e != nil {
		return Page{}, e
	}
	defer rows.Close()
	out := Page{Items: []Token{}}
	for rows.Next() {
		t, e := scanToken(rows)
		if e != nil {
			return Page{}, e
		}
		out.Items = append(out.Items, t)
	}
	if e = rows.Err(); e != nil {
		return Page{}, e
	}
	if len(out.Items) > limit {
		out.Items = out.Items[:limit]
		last := out.Items[len(out.Items)-1]
		out.NextCursor = encodeCursor(pageCursor{Kind: "trending", TradeCount: last.Metrics.TradeCount, Volume: last.Metrics.Volume, BlockNumber: last.CreatedAt.BlockNumber, TokenAddress: last.Address})
	}
	return out, nil
}
func (r *PostgresRepository) Token(ctx context.Context, chain int64, address string) (Token, error) {
	t, e := scanToken(r.pool.QueryRow(ctx, tokenSelect+" WHERE lower(t.token_address)=lower($2)", chain, address))
	if errors.Is(e, pgx.ErrNoRows) {
		return t, ErrNotFound
	}
	return t, e
}
func (r *PostgresRepository) CreatorTokens(ctx context.Context, chain int64, creator string, limit int, rawCursor string) (Page, error) {
	c, e := decodeCursor(rawCursor, "creator")
	if e != nil {
		return Page{}, e
	}
	args := []any{chain, creator}
	where := ""
	if rawCursor != "" {
		args = append(args, c.BlockNumber, c.TokenAddress)
		where = " AND (t.block_number < $3 OR (t.block_number = $3 AND t.token_address > $4))"
	}
	args = append(args, limit+1)
	rows, e := r.pool.Query(ctx, tokenSelect+" WHERE lower(t.creator_address)=lower($2)"+where+" ORDER BY t.block_number DESC,t.token_address ASC LIMIT $"+strconv.Itoa(len(args)), args...)
	if e != nil {
		return Page{}, e
	}
	defer rows.Close()
	out := Page{Items: []Token{}}
	for rows.Next() {
		t, e := scanToken(rows)
		if e != nil {
			return Page{}, e
		}
		out.Items = append(out.Items, t)
	}
	if e = rows.Err(); e != nil {
		return Page{}, e
	}
	if len(out.Items) > limit {
		out.Items = out.Items[:limit]
		last := out.Items[len(out.Items)-1]
		out.NextCursor = encodeCursor(pageCursor{Kind: "creator", BlockNumber: last.CreatedAt.BlockNumber, TokenAddress: last.Address})
	}
	return out, nil
}
func (r *PostgresRepository) Creator(ctx context.Context, chain int64, creator string, limit int, cursor string) (CreatorProfile, error) {
	tokens, e := r.CreatorTokens(ctx, chain, creator, limit, cursor)
	if e != nil {
		return CreatorProfile{}, e
	}
	var count int64
	var volume string
	e = r.pool.QueryRow(ctx, `SELECT count(*),coalesce((SELECT sum(tr.curve_value) FROM trades tr JOIN tokens tk ON tk.chain_id=tr.chain_id AND lower(tk.token_address)=lower(tr.token_address) AND tk.is_canonical WHERE tr.chain_id=$1 AND tr.is_canonical AND lower(tk.creator_address)=lower($2)),'0') FROM tokens WHERE chain_id=$1 AND lower(creator_address)=lower($2) AND is_canonical`, chain, creator).Scan(&count, &volume)
	if e != nil {
		return CreatorProfile{}, e
	}
	return CreatorProfile{Address: creator, TokenCount: count, Volume: volume, Tokens: tokens.Items, NextCursor: tokens.NextCursor}, nil
}
func (r *PostgresRepository) Trades(ctx context.Context, chain int64, token string, limit int, rawCursor string) (TradePage, error) {
	c, e := decodeCursor(rawCursor, "trades")
	if e != nil {
		return TradePage{}, e
	}
	args := []any{chain, token}
	where := ""
	if rawCursor != "" {
		args = append(args, c.BlockNumber, c.Transaction, c.LogIndex)
		where = " AND (block_number < $3 OR (block_number = $3 AND (transaction_hash < $4 OR (transaction_hash = $4 AND log_index < $5))))"
	}
	args = append(args, limit+1)
	rows, e := r.pool.Query(ctx, `SELECT token_address,trader_address,side,token_amount,reserve_amount,curve_value,protocol_fee,creator_fee,block_number,transaction_hash,log_index FROM trades WHERE chain_id=$1 AND lower(token_address)=lower($2) AND is_canonical`+where+` ORDER BY block_number DESC,transaction_hash DESC,log_index DESC LIMIT $`+strconv.Itoa(len(args)), args...)
	if e != nil {
		return TradePage{}, e
	}
	defer rows.Close()
	out := TradePage{Items: []Trade{}}
	for rows.Next() {
		var t Trade
		e = rows.Scan(&t.TokenAddress, &t.Trader, &t.Side, &t.TokenAmount, &t.ReserveAmount, &t.CurveValue, &t.ProtocolFee, &t.CreatorFee, &t.BlockNumber, &t.TransactionHash, &t.LogIndex)
		if e != nil {
			return TradePage{}, e
		}
		out.Items = append(out.Items, t)
	}
	if e = rows.Err(); e != nil {
		return TradePage{}, e
	}
	if len(out.Items) > limit {
		out.Items = out.Items[:limit]
		last := out.Items[len(out.Items)-1]
		out.NextCursor = encodeCursor(pageCursor{Kind: "trades", BlockNumber: last.BlockNumber, Transaction: last.TransactionHash, LogIndex: last.LogIndex})
	}
	return out, nil
}
func (r *PostgresRepository) Activity(ctx context.Context, chain int64, token string, limit int, rawCursor string) (ActivityPage, error) {
	c, e := decodeCursor(rawCursor, "activity")
	if e != nil {
		return ActivityPage{}, e
	}
	args := []any{chain, token}
	where := ""
	if rawCursor != "" {
		args = append(args, c.BlockNumber, c.Transaction, c.LogIndex)
		where = " AND (block_number < $3 OR (block_number = $3 AND (transaction_hash < $4 OR (transaction_hash = $4 AND log_index < $5))))"
	}
	args = append(args, limit+1)
	rows, e := r.pool.Query(ctx, `SELECT event_name,decoded,block_number,transaction_hash,log_index FROM chain_events WHERE chain_id=$1 AND is_canonical AND lower(decoded->>'token')=lower($2)`+where+` ORDER BY block_number DESC,transaction_hash DESC,log_index DESC LIMIT $`+strconv.Itoa(len(args)), args...)
	if e != nil {
		return ActivityPage{}, e
	}
	defer rows.Close()
	out := ActivityPage{Items: []Activity{}}
	for rows.Next() {
		var a Activity
		var raw []byte
		e = rows.Scan(&a.EventName, &raw, &a.BlockNumber, &a.TransactionHash, &a.LogIndex)
		if e != nil {
			return ActivityPage{}, e
		}
		_ = json.Unmarshal(raw, &a.Decoded)
		out.Items = append(out.Items, a)
	}
	if e = rows.Err(); e != nil {
		return ActivityPage{}, e
	}
	if len(out.Items) > limit {
		out.Items = out.Items[:limit]
		last := out.Items[len(out.Items)-1]
		out.NextCursor = encodeCursor(pageCursor{Kind: "activity", BlockNumber: last.BlockNumber, Transaction: last.TransactionHash, LogIndex: last.LogIndex})
	}
	return out, nil
}
