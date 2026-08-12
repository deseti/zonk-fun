package main

import (
	"context"
	"fmt"
	api "github.com/deseti/zonk-fun/apps/api/internal/api"
	"log/slog"
	"net/http"
	"os"
	"strconv"
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
	chainID := int64(84532)
	if s := os.Getenv("BASE_SEPOLIA_CHAIN_ID"); s != "" {
		if n, e := strconv.ParseInt(s, 10, 64); e == nil {
			chainID = n
		}
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
	handler := api.NewHandlerWithObjectStore(repo, chainID, requestTimeout, logger, objects)
	addr := fmt.Sprintf("%s:%s", host, port)
	fmt.Printf("zonk-api listening on %s\n", addr)

	server := &http.Server{Addr: addr, Handler: handler, ReadHeaderTimeout: requestTimeout, ReadTimeout: requestTimeout, WriteTimeout: requestTimeout, IdleTimeout: requestTimeout}
	if err := server.ListenAndServe(); err != nil {
		panic(err)
	}
}
