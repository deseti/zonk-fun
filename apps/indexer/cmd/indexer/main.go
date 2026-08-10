package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
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
		fmt.Printf("zonk-indexer started in %s mode\n", mode)
	}

	<-ctx.Done()

	fmt.Println("zonk-indexer shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	<-shutdownCtx.Done()
}
