package main

import (
	"testing"

	indexer "github.com/deseti/zonk-fun/apps/indexer"
)

func TestConfiguredContractsUsesOnlyV3FactoryWhenNoExplicitList(t *testing.T) {
	addresses, err := configuredContracts("", "0x0000000000000000000000000000000000000001")
	if err != nil || len(addresses) != 1 || addresses[0].Hex() != "0x0000000000000000000000000000000000000001" {
		t.Fatalf("addresses=%v err=%v", addresses, err)
	}
	if _, err := configuredContracts("", ""); err == nil {
		t.Fatal("expected V3 factory configuration error")
	}
}

func TestResolveChainRuntimeSelectsSupportedRPCAndName(t *testing.T) {
	sepolia, err := indexer.ResolveChainRuntime("", "https://sepolia.invalid", "https://mainnet.invalid")
	if err != nil || sepolia.ChainID != indexer.BaseSepoliaChainID || sepolia.RPCURL != "https://sepolia.invalid" || sepolia.Name != "zonk-base-sepolia" {
		t.Fatalf("sepolia=%+v err=%v", sepolia, err)
	}
	mainnet, err := indexer.ResolveChainRuntime("8453", "https://sepolia.invalid", "https://mainnet.invalid")
	if err != nil || mainnet.ChainID != indexer.BaseMainnetChainID || mainnet.RPCURL != "https://mainnet.invalid" || mainnet.Name != "zonk-base-mainnet" || mainnet.RPCEnvName != "BASE_MAINNET_RPC_URL" {
		t.Fatalf("mainnet=%+v err=%v", mainnet, err)
	}
}

func TestResolveChainRuntimeRejectsUnsupportedOrInvalidChain(t *testing.T) {
	for _, value := range []string{"1", "84531", "not-a-chain"} {
		if _, err := indexer.ResolveChainRuntime(value, "sepolia", "mainnet"); err == nil {
			t.Fatalf("expected %q to fail", value)
		}
	}
}

func TestConfiguredContractsAcceptsExplicitV3ContractList(t *testing.T) {
	addresses, err := configuredContracts("0x0000000000000000000000000000000000000001,0x0000000000000000000000000000000000000002", "")
	if err != nil || len(addresses) != 2 {
		t.Fatalf("addresses=%v err=%v", addresses, err)
	}
	if _, err := configuredContracts("not-an-address", ""); err == nil {
		t.Fatal("expected invalid configured contract error")
	}
}
