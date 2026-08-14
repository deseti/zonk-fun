package api

type Token struct {
	Address       string      `json:"address"`
	Creator       string      `json:"creator"`
	Name          string      `json:"name"`
	Symbol        string      `json:"symbol"`
	InitialSupply string      `json:"initial_supply"`
	Description   string      `json:"description,omitempty"`
	ImageURL      string      `json:"image_url,omitempty"`
	MetadataURL   string      `json:"metadata_url,omitempty"`
	CreatedAt     BlockRef    `json:"created_at"`
	Curve         *Curve      `json:"curve,omitempty"`
	Metrics       Metrics     `json:"metrics"`
	Graduation    *Graduation `json:"graduation,omitempty"`
}
type MetadataDraft struct {
	ID            string `json:"draft_id"`
	Name          string `json:"name"`
	Symbol        string `json:"symbol"`
	InitialSupply string `json:"initial_supply"`
	Description   string `json:"description"`
	ImageURL      string `json:"image_url"`
	MetadataURL   string `json:"metadata_url"`
}
type BlockRef struct {
	BlockNumber     int64  `json:"block_number"`
	TransactionHash string `json:"transaction_hash"`
	LogIndex        int64  `json:"log_index"`
}
type Curve struct {
	Address             string `json:"address"`
	Supply              string `json:"supply,omitempty"`
	SoldSupply          string `json:"sold_supply"`
	ReserveBalance      string `json:"reserve_balance"`
	StartingPrice       string `json:"starting_price,omitempty"`
	Slope               string `json:"slope,omitempty"`
	GraduationThreshold string `json:"graduation_threshold,omitempty"`
	Lifecycle           string `json:"lifecycle,omitempty"`
}
type Metrics struct {
	TradeCount           int64   `json:"trade_count"`
	BuyCount             int64   `json:"buy_count"`
	SellCount            int64   `json:"sell_count"`
	Volume               string  `json:"volume"`
	Fees                 string  `json:"fees"`
	UniqueTraderCount    int64   `json:"unique_trader_count"`
	LatestTradeTimestamp *int64  `json:"latest_trade_timestamp"`
	CurrentPrice         *string `json:"current_price"`
	MarketCap            *string `json:"market_cap"`
	HolderCount          *int64  `json:"holder_count"`
}
type Graduation struct {
	Phase           string `json:"phase"`
	LiquidityToken  string `json:"liquidity_token,omitempty"`
	TokenAmount     string `json:"token_amount,omitempty"`
	QuoteAmount     string `json:"quote_amount,omitempty"`
	LiquidityAmount string `json:"liquidity_amount,omitempty"`
	LockID          string `json:"lock_id,omitempty"`
	UnlockTimestamp *int64 `json:"unlock_timestamp,omitempty"`
}
type Page struct {
	Items      []Token `json:"items"`
	NextCursor string  `json:"next_cursor,omitempty"`
}
type TradePage struct {
	Items      []Trade `json:"items"`
	NextCursor string  `json:"next_cursor,omitempty"`
}
type ActivityPage struct {
	Items      []Activity `json:"items"`
	NextCursor string     `json:"next_cursor,omitempty"`
}
type Trade struct {
	TokenAddress    string `json:"token_address"`
	Trader          string `json:"trader"`
	Side            string `json:"side"`
	TokenAmount     string `json:"token_amount"`
	ReserveAmount   string `json:"reserve_amount"`
	CurveValue      string `json:"curve_value"`
	ProtocolFee     string `json:"protocol_fee"`
	CreatorFee      string `json:"creator_fee"`
	BlockNumber     int64  `json:"block_number"`
	TransactionHash string `json:"transaction_hash"`
	LogIndex        int64  `json:"log_index"`
}
type Activity struct {
	EventName       string         `json:"event_name"`
	Decoded         map[string]any `json:"decoded"`
	BlockNumber     int64          `json:"block_number"`
	TransactionHash string         `json:"transaction_hash"`
	LogIndex        int64          `json:"log_index"`
}
type CreatorProfile struct {
	Address    string  `json:"address"`
	TokenCount int64   `json:"token_count"`
	Volume     string  `json:"volume"`
	Tokens     []Token `json:"tokens"`
	NextCursor string  `json:"next_cursor,omitempty"`
}
