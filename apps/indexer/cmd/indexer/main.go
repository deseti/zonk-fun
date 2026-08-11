package main

import (
	"context"
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
	rpcURL := os.Getenv("BASE_SEPOLIA_RPC_URL")
	if mode != "idle" && rpcURL == "" {
		fmt.Fprintln(os.Stderr, "zonk-indexer: BASE_SEPOLIA_RPC_URL is required unless INDEXER_MODE=idle")
		os.Exit(1)
	}

	if mode == "idle" {
		fmt.Println("zonk-indexer started in idle development mode (no RPC connection)")
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
		addresses := []common.Address{}
		contractEnv := os.Getenv("ZONK_INDEXER_CONTRACTS")
		if contractEnv == "" {
			contractEnv = strings.Join([]string{os.Getenv("ZONK_FACTORY_ADDRESS"), os.Getenv("ZONK_CURVE_ADDRESS"), os.Getenv("FEE_MANAGER_ADDRESS"), os.Getenv("LIQUIDITY_MANAGER_ADDRESS"), os.Getenv("LP_LOCKER_ADDRESS")}, ",")
		}
		for _, v := range strings.Split(contractEnv, ",") {
			if common.IsHexAddress(strings.TrimSpace(v)) {
				addresses = append(addresses, common.HexToAddress(strings.TrimSpace(v)))
			}
		}
		cfg := indexer.Config{RPCURL: rpcURL, DatabaseURL: dbURL, Mode: mode, ChainID: indexer.BaseSepoliaChainID, StartBlock: start, StopBlock: stopBlock, Confirmations: confirm, BatchSize: batch, Contracts: addresses}
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
		fmt.Printf("zonk-indexer started in %s mode\n", mode)
	}

	<-ctx.Done()

	fmt.Println("zonk-indexer shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	<-shutdownCtx.Done()
}
