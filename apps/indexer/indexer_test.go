package indexer

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

func TestSupportedEventsMatchCurrentArtifacts(t *testing.T) {
	files := []string{"IZonkFactory.sol/IZonkFactory.json", "IZonkCurve.sol/IZonkCurve.json", "IFeeManager.sol/IFeeManager.json", "ILiquidityManager.sol/ILiquidityManager.json", "ILPLocker.sol/ILPLocker.json"}
	for _, name := range files {
		path := filepath.Join("..", "..", "contracts", "out", name)
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var artifact struct {
			ABI json.RawMessage `json:"abi"`
		}
		if err = json.Unmarshal(data, &artifact); err != nil {
			t.Fatal(err)
		}
		a, err := abi.JSON(strings.NewReader(string(artifact.ABI)))
		if err != nil {
			t.Fatal(err)
		}
		for event, expected := range a.Events {
			got, ok := contractABI.Events[event]
			if !ok {
				t.Errorf("artifact event %s missing from decoder", event)
				continue
			}
			if got.ID != expected.ID {
				t.Errorf("event %s topic mismatch", event)
			}
		}
	}
}

func TestConfigValidation(t *testing.T) {
	if err := (Config{ChainID: 1, Mode: "active", RPCURL: "x", DatabaseURL: "x", BatchSize: 1}).Validate(); err == nil {
		t.Fatal("expected chain validation error")
	}
	if err := (Config{ChainID: BaseSepoliaChainID, Mode: "active", BatchSize: 1}).Validate(); err == nil {
		t.Fatal("expected endpoint validation error")
	}
	if err := (Config{ChainID: BaseSepoliaChainID, Mode: "active", RPCURL: "x", DatabaseURL: "x", BatchSize: 1}).Validate(); err != nil {
		t.Fatal(err)
	}
}

type retryRPC struct {
	headers int
	logs    int
	fail    int
}

func (r *retryRPC) HeaderByNumber(context.Context, *big.Int) (*types.Header, error) {
	r.headers++
	if r.headers <= r.fail {
		return nil, errors.New("temporary upstream unavailable")
	}
	return &types.Header{Number: big.NewInt(1)}, nil
}
func (r *retryRPC) FilterLogs(context.Context, ethereum.FilterQuery) ([]types.Log, error) {
	r.logs++
	if r.logs <= r.fail {
		return nil, errors.New("temporary upstream unavailable")
	}
	return nil, nil
}
func TestRetryBoundedAndRecovers(t *testing.T) {
	inner := &retryRPC{fail: 2}
	r := NewRetryingRPC(inner, RetryConfig{MaxAttempts: 3, InitialDelay: time.Millisecond, MaxDelay: time.Millisecond * 2})
	if _, err := r.HeaderByNumber(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	if inner.headers != 3 {
		t.Fatalf("attempts=%d", inner.headers)
	}
	if _, err := r.FilterLogs(context.Background(), ethereum.FilterQuery{}); err != nil {
		t.Fatal(err)
	}
	if inner.logs != 3 {
		t.Fatalf("attempts=%d", inner.logs)
	}
}
func TestRetryExhaustionAndCancellation(t *testing.T) {
	inner := &retryRPC{fail: 9}
	r := NewRetryingRPC(inner, RetryConfig{MaxAttempts: 3, InitialDelay: time.Millisecond, MaxDelay: time.Millisecond})
	if _, err := r.HeaderByNumber(context.Background(), nil); err == nil {
		t.Fatal("expected exhaustion")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := r.FilterLogs(ctx, ethereum.FilterQuery{}); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func eventLog(t *testing.T, name string, indexed []common.Hash, args ...interface{}) types.Log {
	t.Helper()
	e := contractABI.Events[name]
	data, err := e.Inputs.NonIndexed().Pack(args...)
	if err != nil {
		t.Fatal(err)
	}
	topics := []common.Hash{e.ID}
	topics = append(topics, indexed...)
	return types.Log{Address: common.HexToAddress("0x00000000000000000000000000000000000000aa"), Topics: topics, Data: data, BlockNumber: 10, BlockHash: common.HexToHash("0x10"), TxHash: common.HexToHash("0x20"), Index: 1}
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
	for _, table := range []string{"token_metrics", "liquidity_events", "graduations", "fees", "trades", "curves", "tokens", "chain_events", "chain_blocks", "indexer_checkpoints"} {
		if _, err = s.pool.Exec(context.Background(), "TRUNCATE "+table+" CASCADE"); err != nil {
			t.Fatal(err)
		}
	}
	return s
}

func testHeader() *types.Header {
	return &types.Header{Number: big.NewInt(10), Time: 100, ParentHash: common.HexToHash("0x09")}
}
func TestPostgresProjectionsIdempotencyAndCheckpoint(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	token := common.HexToHash("0x01")
	creator := common.HexToHash("0x02")
	l := eventLog(t, "TokenCreated", []common.Hash{token, creator}, "Zonk", "ZK", big.NewInt(1000))
	b := testHeader()
	l.BlockHash = b.Hash()
	if err := s.Apply(ctx, BaseSepoliaChainID, "test", b, []types.Log{l}); err != nil {
		t.Fatal(err)
	}
	if err := s.Apply(ctx, BaseSepoliaChainID, "test", b, []types.Log{l}); err != nil {
		t.Fatal(err)
	}
	var n int
	var cp uint64
	if err := s.pool.QueryRow(ctx, "SELECT count(*) FROM tokens WHERE is_canonical").Scan(&n); err != nil || n != 1 {
		t.Fatalf("tokens=%d err=%v", n, err)
	}
	if err := s.pool.QueryRow(ctx, "SELECT last_block_number FROM indexer_checkpoints WHERE chain_id=$1", BaseSepoliaChainID).Scan(&cp); err != nil || cp != 10 {
		t.Fatalf("checkpoint=%d err=%v", cp, err)
	}
}

func TestPostgresRollbackLeavesNoCheckpoint(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	l := types.Log{Address: common.HexToAddress("0xaa"), Topics: []common.Hash{contractABI.Events["TokenCreated"].ID}, Data: []byte{1}, BlockNumber: 11, BlockHash: common.HexToHash("0x11"), TxHash: common.HexToHash("0x21"), Index: 1}
	if err := s.Apply(ctx, BaseSepoliaChainID, "test", testHeader(), []types.Log{l}); err == nil {
		t.Fatal("expected decode failure")
	}
	var n int
	if err := s.pool.QueryRow(ctx, "SELECT count(*) FROM chain_events").Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("rollback left %d events", n)
	}
	if err := s.pool.QueryRow(ctx, "SELECT count(*) FROM indexer_checkpoints").Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("rollback left checkpoint")
	}
}

func TestPostgresTradeFeeGraduationAndLiquidityProjections(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	token := common.HexToHash("0x31")
	trader := common.HexToHash("0x32")
	creator := common.HexToHash("0x33")
	curve := common.HexToHash("0x34")
	lt := common.HexToHash("0x35")
	beneficiary := common.HexToHash("0x36")
	logs := []types.Log{
		eventLog(t, "TokensBought", []common.Hash{token, trader}, big.NewInt(10), big.NewInt(11), big.NewInt(12), big.NewInt(1), big.NewInt(2)),
		eventLog(t, "TokensSold", []common.Hash{token, trader}, big.NewInt(3), big.NewInt(4), big.NewInt(5), big.NewInt(1), big.NewInt(2)),
		eventLog(t, "FeesAccrued", []common.Hash{token, curve, creator}, true, big.NewInt(1), big.NewInt(2)),
		eventLog(t, "GraduationPending", []common.Hash{token}, big.NewInt(8), big.NewInt(9), big.NewInt(10)),
		eventLog(t, "Graduated", []common.Hash{token, lt}, big.NewInt(1), big.NewInt(2), big.NewInt(3), big.NewInt(4), uint64(99)),
		eventLog(t, "LiquidityCreated", []common.Hash{token, curve, lt}, big.NewInt(1), big.NewInt(2), big.NewInt(3), big.NewInt(4), uint64(99)),
		eventLog(t, "LiquidityLocked", []common.Hash{common.BigToHash(big.NewInt(4)), lt, beneficiary}, big.NewInt(3), uint64(99)),
	}
	b := testHeader()
	for i := range logs {
		logs[i].BlockHash = b.Hash()
		logs[i].Index = uint(i + 1)
		logs[i].TxHash = common.BigToHash(big.NewInt(int64(i + 20)))
	}
	if err := s.Apply(ctx, BaseSepoliaChainID, "test", b, logs); err != nil {
		t.Fatal(err)
	}
	var trades, fees, grads, liquidity, tradeCount, buyCount, sellCount int
	if err := s.pool.QueryRow(ctx, "SELECT count(*) FROM trades WHERE is_canonical").Scan(&trades); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, "SELECT count(*) FROM fees WHERE is_canonical").Scan(&fees); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, "SELECT count(*) FROM graduations WHERE is_canonical").Scan(&grads); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, "SELECT count(*) FROM liquidity_events WHERE is_canonical").Scan(&liquidity); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, "SELECT trade_count,buy_count,sell_count FROM token_metrics WHERE token_address=$1", common.BytesToAddress(token.Bytes()).Hex()).Scan(&tradeCount, &buyCount, &sellCount); err != nil {
		t.Fatal(err)
	}
	if trades != 2 || fees != 1 || grads != 2 || liquidity != 2 || tradeCount != 2 || buyCount != 1 || sellCount != 1 {
		t.Fatalf("projection counts trades=%d fees=%d graduations=%d liquidity=%d metrics=%d/%d/%d", trades, fees, grads, liquidity, tradeCount, buyCount, sellCount)
	}
}

type fakeChain struct {
	headers map[uint64]*types.Header
	logs    map[uint64][]types.Log
	head    uint64
}

func (f *fakeChain) HeaderByNumber(_ context.Context, n *big.Int) (*types.Header, error) {
	if n == nil {
		return f.headers[f.head], nil
	}
	h, ok := f.headers[n.Uint64()]
	if !ok {
		return nil, errors.New("header not found")
	}
	return h, nil
}
func (f *fakeChain) FilterLogs(_ context.Context, q ethereum.FilterQuery) ([]types.Log, error) {
	var out []types.Log
	for n := q.FromBlock.Uint64(); n <= q.ToBlock.Uint64(); n++ {
		out = append(out, f.logs[n]...)
	}
	return out, nil
}
func waitForCheckpoint(t *testing.T, s *Store, want uint64) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		n, _, err := s.Checkpoint(context.Background(), BaseSepoliaChainID, "reorg-test")
		if err != nil {
			t.Fatal(err)
		}
		if n >= want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("checkpoint did not reach %d", want)
}
func TestPostgresReorgRecoveryRebuildsCanonicalState(t *testing.T) {
	s := integrationStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	mk := func(n uint64, parent common.Hash, nonce uint64) *types.Header {
		return &types.Header{Number: new(big.Int).SetUint64(n), ParentHash: parent, Nonce: types.EncodeNonce(nonce), Time: n}
	}
	b1 := mk(1, common.Hash{}, 1)
	a2 := mk(2, b1.Hash(), 2)
	a3 := mk(3, a2.Hash(), 3)
	b2 := mk(2, b1.Hash(), 20)
	b3 := mk(3, b2.Hash(), 30)
	old := eventLog(t, "TokenCreated", []common.Hash{common.HexToHash("0xa1"), common.HexToHash("0xa2")}, "Old", "OLD", big.NewInt(1))
	old.BlockNumber = 2
	old.BlockHash = a2.Hash()
	old.TxHash = common.HexToHash("0xaa")
	newLog := eventLog(t, "TokenCreated", []common.Hash{common.HexToHash("0xb1"), common.HexToHash("0xb2")}, "New", "NEW", big.NewInt(2))
	newLog.BlockNumber = 2
	newLog.BlockHash = b2.Hash()
	newLog.TxHash = common.HexToHash("0xbb")
	f := &fakeChain{headers: map[uint64]*types.Header{1: b1, 2: a2, 3: a3}, logs: map[uint64][]types.Log{2: {old}}, head: 3}
	errs := make(chan error, 2)
	x := New(Config{ChainID: BaseSepoliaChainID, IndexerName: "reorg-test", Mode: "test", BatchSize: 10, Confirmations: 0}, f, s)
	go func() { errs <- x.Run(ctx) }()
	waitForCheckpoint(t, s, 3)
	cancel()
	select {
	case err := <-errs:
		if err != nil && !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("initial indexer did not stop")
	}
	f2 := &fakeChain{headers: map[uint64]*types.Header{1: b1, 2: b2, 3: b3}, logs: map[uint64][]types.Log{2: {newLog}}, head: 3}
	ctx2, cancel2 := context.WithCancel(context.Background())
	defer cancel2()
	x2 := New(Config{ChainID: BaseSepoliaChainID, IndexerName: "reorg-test", Mode: "test", BatchSize: 10, Confirmations: 0}, f2, s)
	go func() { errs <- x2.Run(ctx2) }()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var n int
		if err := s.pool.QueryRow(context.Background(), "SELECT count(*) FROM tokens WHERE token_address=$1 AND is_canonical", common.HexToAddress("0xb1").Hex()).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n == 1 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	waitForCheckpoint(t, s, 3)
	cancel2()
	select {
	case err := <-errs:
		if err != nil && !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("reorg indexer did not stop")
	}
	var oldCanonical, newCanonical int
	if err := s.pool.QueryRow(context.Background(), "SELECT count(*) FILTER (WHERE token_address=$1 AND is_canonical),count(*) FILTER (WHERE token_address=$2 AND is_canonical) FROM tokens", common.HexToAddress("0xa1").Hex(), common.HexToAddress("0xb1").Hex()).Scan(&oldCanonical, &newCanonical); err != nil {
		t.Fatal(err)
	}
	if oldCanonical != 0 || newCanonical != 1 {
		t.Fatalf("reorg projection old=%d new=%d", oldCanonical, newCanonical)
	}
	var checkpointHash string
	if _, checkpointHash, _ = s.Checkpoint(context.Background(), BaseSepoliaChainID, "reorg-test"); checkpointHash != b3.Hash().Hex() {
		t.Fatalf("checkpoint hash=%s want=%s a3=%s b3=%s", checkpointHash, b3.Hash().Hex(), a3.Hash().Hex(), b3.Hash().Hex())
	}
	var canonicalBlocks int
	if err := s.pool.QueryRow(context.Background(), "SELECT count(*) FROM chain_blocks WHERE chain_id=$1 AND is_canonical", BaseSepoliaChainID).Scan(&canonicalBlocks); err != nil {
		t.Fatal(err)
	}
	if canonicalBlocks != 3 {
		t.Fatalf("canonical blocks=%d", canonicalBlocks)
	}
}

var _ = json.Valid
