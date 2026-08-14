package indexer

import (
	"context"
	"fmt"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
	"math/big"
	"sort"
	"strings"
	"time"
)

type Indexer struct {
	cfg   Config
	rpc   RPC
	store *Store
}

func New(cfg Config, rpc RPC, store *Store) *Indexer {
	cfg.defaults()
	return &Indexer{cfg: cfg, rpc: rpc, store: store}
}
func (x *Indexer) Run(ctx context.Context) error {
	last, lastHash, e := x.store.Checkpoint(ctx, x.cfg.ChainID, x.cfg.IndexerName)
	if e != nil {
		return e
	}
	// StartBlock seeds a new indexer. It must never rewind a durable checkpoint
	// on process restart, otherwise every Compose rebuild replays the entire
	// deployment history and can remain hours behind new launches.
	last, lastHash = initialCheckpoint(last, lastHash, x.cfg.StartBlock)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		head, e := x.rpc.HeaderByNumber(ctx, nil)
		if e != nil {
			return e
		}
		target := uint64(0)
		if head.Number.Uint64() > x.cfg.Confirmations {
			target = head.Number.Uint64() - x.cfg.Confirmations
		}
		if x.cfg.StopBlock > 0 && target > x.cfg.StopBlock {
			target = x.cfg.StopBlock
		}
		if lastHash != "" {
			h, e := x.rpc.HeaderByNumber(ctx, new(big.Int).SetUint64(last))
			if e != nil {
				return e
			}
			if h.Hash().Hex() != lastHash {
				last, lastHash, e = x.recover(ctx, last)
				if e != nil {
					return e
				}
			}
		}
		for last < target {
			end := last + x.cfg.BatchSize
			if end > target {
				end = target
			}
			from := last + 1
			contracts, e := x.store.ScanContracts(ctx, x.cfg.ChainID, x.cfg.Contracts)
			if e != nil {
				return e
			}
			logs, e := x.rpc.FilterLogs(ctx, ethereum.FilterQuery{FromBlock: new(big.Int).SetUint64(from), ToBlock: new(big.Int).SetUint64(end), Addresses: contracts})
			if e != nil {
				return e
			}
			by := map[uint64][]types.Log{}
			for _, l := range logs {
				by[l.BlockNumber] = append(by[l.BlockNumber], l)
			}
			// Persist the range boundaries and every event-bearing block. Empty
			// blocks contain no projections, so writing and rebuilding metrics for
			// each one only makes catch-up linearly slower without adding event
			// provenance. Boundary hashes retain a durable canonical checkpoint.
			blocks := map[uint64]struct{}{from: {}, end: {}}
			for n := range by {
				blocks[n] = struct{}{}
			}
			numbers := make([]uint64, 0, len(blocks))
			for n := range blocks {
				numbers = append(numbers, n)
			}
			sort.Slice(numbers, func(i, j int) bool { return numbers[i] < numbers[j] })
			for _, n := range numbers {
				b, e := x.rpc.HeaderByNumber(ctx, new(big.Int).SetUint64(n))
				if e != nil {
					return e
				}
				if n == last+1 && b.ParentHash.Hex() != lastHash && last > 0 && lastHash != "" {
					return fmt.Errorf("parent mismatch at block %d", n)
				}
				extraTransfers, e := x.launchTransfers(ctx, n, by[n])
				if e != nil {
					return e
				}
				by[n] = append(by[n], extraTransfers...)
				sort.Slice(by[n], func(i, j int) bool {
					if by[n][i].TxIndex != by[n][j].TxIndex {
						return by[n][i].TxIndex < by[n][j].TxIndex
					}
					return by[n][i].Index < by[n][j].Index
				})
				metadata, e := x.v3Metadata(ctx, by[n])
				if e != nil {
					return e
				}
				if e = x.store.ApplyWithMetadata(ctx, x.cfg.ChainID, x.cfg.IndexerName, b, by[n], metadata); e != nil {
					return e
				}
				last = n
				lastHash = b.Hash().Hex()
			}
		}
		if x.cfg.StopBlock > 0 && last >= target {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(3 * time.Second):
		}
	}
}

// launchTransfers closes the address-discovery gap for a token's launch block.
// The normal bounded address filter includes all previously indexed tokens. A
// newly created token cannot be known before its factory event, so we make one
// Transfer-topic-only query per discovered token for that exact block. More than
// 32 launches in a block fails closed instead of silently producing balances.
func (x *Indexer) launchTransfers(ctx context.Context, block uint64, logs []types.Log) ([]types.Log, error) {
	seen := map[common.Address]struct{}{}
	for _, l := range logs {
		if len(l.Topics) == 0 {
			continue
		}
		var event string
		switch l.Topics[0] {
		case contractABI.Events["TokenLaunchedV3"].ID:
			event = "TokenLaunchedV3"
		default:
			continue
		}
		values := map[string]any{}
		if err := abi.ParseTopicsIntoMap(values, indexedArguments(contractABI.Events[event].Inputs), l.Topics[1:]); err != nil {
			return nil, fmt.Errorf("decode launch token: %w", err)
		}
		token, ok := values["token"].(common.Address)
		if !ok {
			return nil, fmt.Errorf("decode launch token: token is not an address")
		}
		seen[token] = struct{}{}
	}
	if len(seen) > 32 {
		return nil, fmt.Errorf("too many token launches in block %d for bounded Transfer discovery", block)
	}
	out := []types.Log{}
	for token := range seen {
		logs, err := x.rpc.FilterLogs(ctx, ethereum.FilterQuery{
			FromBlock: new(big.Int).SetUint64(block), ToBlock: new(big.Int).SetUint64(block),
			Addresses: []common.Address{token}, Topics: [][]common.Hash{{contractABI.Events["Transfer"].ID}},
		})
		if err != nil {
			return nil, err
		}
		out = append(out, logs...)
	}
	return out, nil
}

var erc20MetadataABI = func() abi.ABI {
	a, err := abi.JSON(strings.NewReader(`[
{"type":"function","name":"name","stateMutability":"view","inputs":[],"outputs":[{"type":"string"}]},
{"type":"function","name":"symbol","stateMutability":"view","inputs":[],"outputs":[{"type":"string"}]},
{"type":"function","name":"decimals","stateMutability":"view","inputs":[],"outputs":[{"type":"uint8"}]}
]`))
	if err != nil {
		panic(err)
	}
	return a
}()

func (x *Indexer) v3Metadata(ctx context.Context, logs []types.Log) (map[string]TokenMetadata, error) {
	out := map[string]TokenMetadata{}
	for _, l := range logs {
		if len(l.Topics) == 0 || l.Topics[0] != contractABI.Events["TokenLaunchedV3"].ID {
			continue
		}
		values := map[string]any{}
		if err := contractABI.UnpackIntoMap(values, "TokenLaunchedV3", l.Data); err != nil {
			return nil, err
		}
		if err := abi.ParseTopicsIntoMap(values, indexedArguments(contractABI.Events["TokenLaunchedV3"].Inputs), l.Topics[1:]); err != nil {
			return nil, err
		}
		token, ok := values["token"].(common.Address)
		if !ok {
			return nil, fmt.Errorf("TokenLaunchedV3 token has unexpected type %T", values["token"])
		}
		metadata := TokenMetadata{}
		for _, name := range []string{"name", "symbol"} {
			method := erc20MetadataABI.Methods[name]
			data, err := x.rpc.CallContract(ctx, ethereum.CallMsg{To: &token, Data: method.ID}, new(big.Int).SetUint64(l.BlockNumber))
			if err != nil {
				return nil, fmt.Errorf("read %s for %s: %w", name, token.Hex(), err)
			}
			decoded, err := method.Outputs.Unpack(data)
			if err != nil || len(decoded) != 1 {
				return nil, fmt.Errorf("decode %s for %s: %w", name, token.Hex(), err)
			}
			value, ok := decoded[0].(string)
			if !ok {
				return nil, fmt.Errorf("%s for %s has unexpected type %T", name, token.Hex(), decoded[0])
			}
			if name == "name" {
				metadata.Name = value
			} else {
				metadata.Symbol = value
			}
		}
		method := erc20MetadataABI.Methods["decimals"]
		data, err := x.rpc.CallContract(ctx, ethereum.CallMsg{To: &token, Data: method.ID}, new(big.Int).SetUint64(l.BlockNumber))
		if err != nil {
			return nil, fmt.Errorf("read decimals for %s: %w", token.Hex(), err)
		}
		decoded, err := method.Outputs.Unpack(data)
		if err != nil || len(decoded) != 1 {
			return nil, fmt.Errorf("decode decimals for %s: %w", token.Hex(), err)
		}
		var okDecimals bool
		metadata.Decimals, okDecimals = decoded[0].(uint8)
		if !okDecimals {
			return nil, fmt.Errorf("decimals for %s has unexpected type %T", token.Hex(), decoded[0])
		}
		out[token.Hex()] = metadata
	}
	return out, nil
}

func initialCheckpoint(last uint64, lastHash string, start uint64) (uint64, string) {
	if start > 0 && last < start {
		return start - 1, ""
	}
	return last, lastHash
}
func (x *Indexer) recover(ctx context.Context, last uint64) (uint64, string, error) {
	for {
		stored, e := x.store.CanonicalBlockHash(ctx, x.cfg.ChainID, last)
		if e != nil {
			return 0, "", e
		}
		h, e := x.rpc.HeaderByNumber(ctx, new(big.Int).SetUint64(last))
		if e != nil {
			return 0, "", e
		}
		if stored == h.Hash().Hex() {
			if e = x.store.Rewind(ctx, x.cfg.ChainID, x.cfg.IndexerName, last+1); e != nil {
				return 0, "", e
			}
			return last, stored, nil
		}
		if last == 0 {
			if e = x.store.Rewind(ctx, x.cfg.ChainID, x.cfg.IndexerName, 1); e != nil {
				return 0, "", e
			}
			return 0, "", nil
		}
		last--
	}
}

// NewRPC exists separately from the database so the API process never owns an
// RPC client or an indexer checkpoint.
func NewRPC(url string) (RPC, error) {
	return NewRPCWithRetry(url, RetryConfig{})
}
func NewRPCWithRetry(url string, cfg RetryConfig) (RPC, error) {
	c, err := ethclient.Dial(url)
	if err != nil {
		return nil, err
	}
	return NewRetryingRPC(c, cfg), nil
}
