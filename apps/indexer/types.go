package indexer

import (
	"context"
	"fmt"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"math/big"
)

const BaseSepoliaChainID int64 = 84532

type RPC interface {
	HeaderByNumber(context.Context, *big.Int) (*types.Header, error)
	FilterLogs(context.Context, ethereum.FilterQuery) ([]types.Log, error)
	CallContract(context.Context, ethereum.CallMsg, *big.Int) ([]byte, error)
}
type TokenMetadata struct {
	Name, Symbol string
	Decimals     uint8
}
type Config struct {
	RPCURL, DatabaseURL, Mode, IndexerName          string
	ChainID                                         int64
	StartBlock, StopBlock, Confirmations, BatchSize uint64
	Contracts                                       []common.Address
}

func (c *Config) defaults() {
	if c.ChainID == 0 {
		c.ChainID = BaseSepoliaChainID
	}
	if c.IndexerName == "" {
		c.IndexerName = "zonk-base-sepolia"
	}
	if c.BatchSize == 0 {
		c.BatchSize = 500
	}
}
func (c Config) Validate() error {
	if c.ChainID != BaseSepoliaChainID {
		return fmt.Errorf("unsupported chain id %d", c.ChainID)
	}
	if c.Mode != "idle" && c.RPCURL == "" {
		return fmt.Errorf("rpc url is required in active mode")
	}
	if c.Mode != "idle" && c.DatabaseURL == "" {
		return fmt.Errorf("database url is required in active mode")
	}
	if c.BatchSize == 0 {
		return fmt.Errorf("batch size must be positive")
	}
	return nil
}
