package main

import (
	"fmt"
	"net/http"
	"os"
)

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok","service":"zonk-api"}`))
	})

	host := os.Getenv("API_HOST")
	if host == "" {
		host = "0.0.0.0"
	}
	port := os.Getenv("API_PORT")
	if port == "" {
		port = "4000"
	}
	addr := fmt.Sprintf("%s:%s", host, port)
	fmt.Printf("zonk-api listening on %s\n", addr)

	if err := http.ListenAndServe(addr, mux); err != nil {
		panic(err)
	}
}
