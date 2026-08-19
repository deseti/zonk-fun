package main

import "testing"

func TestResolveAPIChainConfigDefaultsToSepolia(t *testing.T) {
	config, err := resolveAPIChainConfig("", "https://sepolia.invalid", "https://mainnet.invalid", "", "")
	if err != nil || config.ChainID != baseSepoliaChainID || config.RPCURL != "https://sepolia.invalid" || config.Feed == "" {
		t.Fatalf("config=%+v err=%v", config, err)
	}
}

func TestResolveAPIChainConfigRequiresExplicitMainnetRPCAndFeed(t *testing.T) {
	if _, err := resolveAPIChainConfig("8453", "sepolia", "", "sepolia-feed", "mainnet-feed"); err == nil {
		t.Fatal("expected missing Mainnet RPC error")
	}
	if _, err := resolveAPIChainConfig("8453", "sepolia", "mainnet", "sepolia-feed", ""); err == nil {
		t.Fatal("expected missing Mainnet feed error")
	}
	if _, err := resolveAPIChainConfig("8453", "sepolia", "mainnet", "sepolia-feed", "sepolia-feed"); err == nil {
		t.Fatal("expected invalid Mainnet feed error")
	}
	if _, err := resolveAPIChainConfig("8453", "sepolia", "mainnet", "sepolia-feed", zeroAddress); err == nil {
		t.Fatal("expected zero Mainnet feed error")
	}
	config, err := resolveAPIChainConfig("8453", "sepolia", "mainnet", "sepolia-feed", "0x0000000000000000000000000000000000000001")
	if err != nil || config.ChainID != baseMainnetChainID || config.RPCURL != "mainnet" || config.Name != "base_mainnet" || config.Feed != "0x0000000000000000000000000000000000000001" {
		t.Fatalf("config=%+v err=%v", config, err)
	}
}

func TestResolveAPIChainConfigRejectsUnsupportedChains(t *testing.T) {
	for _, value := range []string{"1", "84531", "invalid"} {
		if _, err := resolveAPIChainConfig(value, "sepolia", "mainnet", "sepolia-feed", "mainnet-feed"); err == nil {
			t.Fatalf("expected %q to fail", value)
		}
	}
}
