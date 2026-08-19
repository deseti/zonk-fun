package main

import (
	"context"
	"fmt"
	api "github.com/deseti/zonk-fun/apps/api/internal/api"
	"log/slog"
	"net/http"
	"os"
	"time"
)

func main() {
	host := os.Getenv("API_HOST")
	if host == "" {
		host = "0.0.0.0"
	}
	port := os.Getenv("API_PORT")
	if port == "" {
		port = "4000"
	}
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		panic("DATABASE_URL is required")
	}
	sepoliaFeed := os.Getenv("BASE_SEPOLIA_CHAINLINK_ETH_USD_FEED")
	if sepoliaFeed == "" {
		// Preserve the existing Sepolia-only environment variable as a compatibility alias.
		sepoliaFeed = os.Getenv("CHAINLINK_ETH_USD_FEED")
	}
	chain, e := resolveAPIChainConfig(
		os.Getenv("ZONK_CHAIN_ID"),
		os.Getenv("BASE_SEPOLIA_RPC_URL"),
		os.Getenv("BASE_MAINNET_RPC_URL"),
		sepoliaFeed,
		os.Getenv("BASE_MAINNET_CHAINLINK_ETH_USD_FEED"),
	)
	if e != nil {
		panic(e)
	}
	requestTimeout := 5 * time.Second
	if s := os.Getenv("API_REQUEST_TIMEOUT"); s != "" {
		if d, e := time.ParseDuration(s); e == nil && d > 0 {
			requestTimeout = d
		}
	}
	startupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	repo, e := api.NewPostgresRepository(startupCtx, databaseURL)
	if e != nil {
		panic(e)
	}
	defer repo.Close()
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	objects, e := api.NewLocalObjectStore(os.Getenv("STORAGE_LOCAL_DIR"))
	if e != nil {
		panic(e)
	}
	maxAge := time.Hour
	if s := os.Getenv("CHAINLINK_ETH_USD_MAX_AGE"); s != "" {
		parsed, err := time.ParseDuration(s)
		if err != nil || parsed <= 0 {
			panic("CHAINLINK_ETH_USD_MAX_AGE must be a positive duration")
		}
		maxAge = parsed
	}
	priceReader, e := api.NewChainlinkETHUSDReader(chain.RPCURL, chain.Feed, maxAge, &http.Client{Timeout: requestTimeout})
	if e != nil {
		logger.Warn("ETH/USD oracle disabled", "error", e)
	}
	handler := api.NewHandlerWithDependencies(repo, chain.ChainID, requestTimeout, logger, objects, priceReader)
	addr := fmt.Sprintf("%s:%s", host, port)
	fmt.Printf("zonk-api (%s) listening on %s\n", chain.Name, addr)

	server := &http.Server{Addr: addr, Handler: handler, ReadHeaderTimeout: requestTimeout, ReadTimeout: requestTimeout, WriteTimeout: requestTimeout, IdleTimeout: requestTimeout}
	if err := server.ListenAndServe(); err != nil {
		panic(err)
	}
}
