package indexer

import (
	"context"
	"fmt"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
	"math/big"
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
	if x.cfg.StartBlock > 0 && last >= x.cfg.StartBlock {
		if e = x.store.Rewind(ctx, x.cfg.ChainID, x.cfg.IndexerName, x.cfg.StartBlock); e != nil {
			return e
		}
		last = x.cfg.StartBlock - 1
		lastHash = ""
	}
	if last == 0 && lastHash == "" && x.cfg.StartBlock > 0 {
		last = x.cfg.StartBlock - 1
	}
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
			logs, e := x.rpc.FilterLogs(ctx, ethereum.FilterQuery{FromBlock: new(big.Int).SetUint64(from), ToBlock: new(big.Int).SetUint64(end), Addresses: x.cfg.Contracts})
			if e != nil {
				return e
			}
			by := map[uint64][]types.Log{}
			for _, l := range logs {
				by[l.BlockNumber] = append(by[l.BlockNumber], l)
			}
			for n := from; n <= end; n++ {
				b, e := x.rpc.HeaderByNumber(ctx, new(big.Int).SetUint64(n))
				if e != nil {
					return e
				}
				if b.ParentHash.Hex() != lastHash && last > 0 && lastHash != "" {
					return fmt.Errorf("parent mismatch at block %d", n)
				}
				if e = x.store.Apply(ctx, x.cfg.ChainID, x.cfg.IndexerName, b, by[n]); e != nil {
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
