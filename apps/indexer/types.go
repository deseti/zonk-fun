package indexer

import (
	"context"
	"fmt"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"math/big"
	"strconv"
	"strings"
)

const (
	BaseSepoliaChainID int64 = 84532
	BaseMainnetChainID int64 = 8453
)

type ChainRuntime struct {
	ChainID    int64
	Name       string
	RPCURL     string
	RPCEnvName string
}

func ResolveChainRuntime(rawChainID, sepoliaRPC, mainnetRPC string) (ChainRuntime, error) {
	value := strings.TrimSpace(rawChainID)
	if value == "" {
		value = strconv.FormatInt(BaseSepoliaChainID, 10)
	}
	chainID, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return ChainRuntime{}, fmt.Errorf("invalid ZONK_CHAIN_ID %q", rawChainID)
	}
	switch chainID {
	case BaseSepoliaChainID:
		return ChainRuntime{ChainID: chainID, Name: "zonk-base-sepolia", RPCURL: strings.TrimSpace(sepoliaRPC), RPCEnvName: "BASE_SEPOLIA_RPC_URL"}, nil
	case BaseMainnetChainID:
		return ChainRuntime{ChainID: chainID, Name: "zonk-base-mainnet", RPCURL: strings.TrimSpace(mainnetRPC), RPCEnvName: "BASE_MAINNET_RPC_URL"}, nil
	default:
		return ChainRuntime{}, fmt.Errorf("unsupported chain id %d", chainID)
	}
}

type RPC interface {
	HeaderByNumber(context.Context, *big.Int) (*types.Header, error)
	FilterLogs(context.Context, ethereum.FilterQuery) ([]types.Log, error)
	CallContract(context.Context, ethereum.CallMsg, *big.Int) ([]byte, error)
}

// transactionSenderRPC is optional so existing deterministic projection tests
// can continue to use a minimal RPC fake. The production ethclient implements
// it and supplies the wallet sender for router-emitted pool Swap events.
type transactionSenderRPC interface {
	TransactionByHash(context.Context, common.Hash) (*types.Transaction, bool, error)
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
		if c.ChainID == BaseMainnetChainID {
			c.IndexerName = "zonk-base-mainnet"
		} else {
			c.IndexerName = "zonk-base-sepolia"
		}
	}
	if c.BatchSize == 0 {
		c.BatchSize = 500
	}
}
func (c Config) Validate() error {
	if c.ChainID != BaseSepoliaChainID && c.ChainID != BaseMainnetChainID {
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
