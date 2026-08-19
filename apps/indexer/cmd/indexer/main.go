package main

import (
	"context"
	"errors"
	"fmt"
	indexer "github.com/deseti/zonk-fun/apps/indexer"
	"github.com/ethereum/go-ethereum/common"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func main() {
	ctx, stop := signal.NotifyContext(
		context.Background(),
		os.Interrupt,
		syscall.SIGTERM,
	)
	defer stop()

	mode := os.Getenv("INDEXER_MODE")
	if mode == "" {
		mode = "idle"
	}
	chain, err := indexer.ResolveChainRuntime(os.Getenv("ZONK_CHAIN_ID"), os.Getenv("BASE_SEPOLIA_RPC_URL"), os.Getenv("BASE_MAINNET_RPC_URL"))
	if err != nil {
		fmt.Fprintf(os.Stderr, "zonk-indexer: %v\n", err)
		os.Exit(1)
	}
	rpcURL := chain.RPCURL
	if mode != "idle" && rpcURL == "" {
		fmt.Fprintf(os.Stderr, "zonk-indexer: %s is required unless INDEXER_MODE=idle\n", chain.RPCEnvName)
		os.Exit(1)
	}

	if mode == "idle" {
		fmt.Printf("%s started in idle development mode (no RPC connection)\n", chain.Name)
	} else {
		dbURL := os.Getenv("DATABASE_URL")
		if dbURL == "" {
			fmt.Fprintln(os.Stderr, "zonk-indexer: DATABASE_URL is required in active mode")
			os.Exit(1)
		}
		store, err := indexer.NewStore(ctx, dbURL)
		if err != nil {
			panic(err)
		}
		defer store.Close()
		start, _ := strconv.ParseUint(os.Getenv("INDEXER_START_BLOCK"), 10, 64)
		stopBlock, _ := strconv.ParseUint(os.Getenv("INDEXER_STOP_BLOCK"), 10, 64)
		confirm, _ := strconv.ParseUint(os.Getenv("INDEXER_CONFIRMATIONS"), 10, 64)
		if os.Getenv("INDEXER_CONFIRMATIONS") == "" {
			confirm = 6
		}
		batch, _ := strconv.ParseUint(os.Getenv("INDEXER_BATCH_SIZE"), 10, 64)
		maxAttempts, _ := strconv.Atoi(os.Getenv("INDEXER_RPC_MAX_ATTEMPTS"))
		initialMS, _ := strconv.Atoi(os.Getenv("INDEXER_RPC_INITIAL_DELAY_MS"))
		maxMS, _ := strconv.Atoi(os.Getenv("INDEXER_RPC_MAX_DELAY_MS"))
		rpc, err := indexer.NewRPCWithRetry(rpcURL, indexer.RetryConfig{MaxAttempts: maxAttempts, InitialDelay: time.Duration(initialMS) * time.Millisecond, MaxDelay: time.Duration(maxMS) * time.Millisecond})
		if err != nil {
			panic(err)
		}
		addresses, err := configuredContracts(os.Getenv("ZONK_INDEXER_CONTRACTS"), os.Getenv("ZONK_FACTORY_V3_ADDRESS"))
		if err != nil {
			fmt.Fprintf(os.Stderr, "zonk-indexer: %v\n", err)
			os.Exit(1)
		}
		cfg := indexer.Config{RPCURL: rpcURL, DatabaseURL: dbURL, Mode: mode, ChainID: chain.ChainID, IndexerName: chain.Name, StartBlock: start, StopBlock: stopBlock, Confirmations: confirm, BatchSize: batch, Contracts: addresses}
		if err := cfg.Validate(); err != nil {
			panic(err)
		}
		x := indexer.New(cfg, rpc, store)
		go func() {
			if err := x.Run(ctx); err != nil && ctx.Err() == nil {
				fmt.Fprintf(os.Stderr, "zonk-indexer: %v\n", err)
			}
			stop()
		}()
		fmt.Printf("%s started in %s mode\n", chain.Name, mode)
	}

	<-ctx.Done()

	fmt.Println("zonk-indexer shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	<-shutdownCtx.Done()
}

func configuredContracts(contractEnv, factoryAddress string) ([]common.Address, error) {
	contractEnv = strings.TrimSpace(contractEnv)
	if contractEnv == "" {
		if !common.IsHexAddress(strings.TrimSpace(factoryAddress)) {
			return nil, errors.New("ZONK_FACTORY_V3_ADDRESS is required when ZONK_INDEXER_CONTRACTS is not set")
		}
		contractEnv = factoryAddress
	}
	addresses := []common.Address{}
	for _, raw := range strings.Split(contractEnv, ",") {
		value := strings.TrimSpace(raw)
		if !common.IsHexAddress(value) {
			return nil, fmt.Errorf("ZONK_INDEXER_CONTRACTS contains an invalid contract address: %q", value)
		}
		addresses = append(addresses, common.HexToAddress(value))
	}
	if len(addresses) == 0 {
		return nil, errors.New("ZONK_FACTORY_V3_ADDRESS or ZONK_INDEXER_CONTRACTS is required in active mode")
	}
	return addresses, nil
}
