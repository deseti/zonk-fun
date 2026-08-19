package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	api "github.com/deseti/zonk-fun/apps/api/internal/api"
)

var ethereumAddressPattern = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)

const (
	baseSepoliaChainID int64 = 84532
	baseMainnetChainID int64 = 8453
	zeroAddress              = "0x0000000000000000000000000000000000000000"
)

type apiChainConfig struct {
	ChainID int64
	Name    string
	RPCURL  string
	Feed    string
}

func resolveAPIChainConfig(rawChainID, sepoliaRPC, mainnetRPC, sepoliaFeed, mainnetFeed string) (apiChainConfig, error) {
	value := strings.TrimSpace(rawChainID)
	if value == "" {
		value = strconv.FormatInt(baseSepoliaChainID, 10)
	}
	chainID, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return apiChainConfig{}, fmt.Errorf("invalid ZONK_CHAIN_ID %q", rawChainID)
	}
	switch chainID {
	case baseSepoliaChainID:
		selectedFeed := strings.TrimSpace(sepoliaFeed)
		if selectedFeed == "" {
			selectedFeed = api.BaseSepoliaETHUSDFeed
		}
		return apiChainConfig{ChainID: chainID, Name: "base_sepolia", RPCURL: strings.TrimSpace(sepoliaRPC), Feed: selectedFeed}, nil
	case baseMainnetChainID:
		if strings.TrimSpace(mainnetRPC) == "" {
			return apiChainConfig{}, fmt.Errorf("BASE_MAINNET_RPC_URL is required for ZONK_CHAIN_ID=%d", chainID)
		}
		if strings.TrimSpace(mainnetFeed) == "" {
			return apiChainConfig{}, fmt.Errorf("BASE_MAINNET_CHAINLINK_ETH_USD_FEED is required for ZONK_CHAIN_ID=%d", chainID)
		}
		if !ethereumAddressPattern.MatchString(strings.TrimSpace(mainnetFeed)) || strings.EqualFold(strings.TrimSpace(mainnetFeed), zeroAddress) {
			return apiChainConfig{}, fmt.Errorf("BASE_MAINNET_CHAINLINK_ETH_USD_FEED must be a valid address for ZONK_CHAIN_ID=%d", chainID)
		}
		return apiChainConfig{ChainID: chainID, Name: "base_mainnet", RPCURL: strings.TrimSpace(mainnetRPC), Feed: strings.TrimSpace(mainnetFeed)}, nil
	default:
		return apiChainConfig{}, fmt.Errorf("unsupported chain id %d", chainID)
	}
}
