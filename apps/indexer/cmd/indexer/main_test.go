package main

import "testing"

func TestConfiguredContractsUsesOnlyV3FactoryWhenNoExplicitList(t *testing.T) {
	addresses, err := configuredContracts("", "0x0000000000000000000000000000000000000001")
	if err != nil || len(addresses) != 1 || addresses[0].Hex() != "0x0000000000000000000000000000000000000001" {
		t.Fatalf("addresses=%v err=%v", addresses, err)
	}
	if _, err := configuredContracts("", ""); err == nil {
		t.Fatal("expected V3 factory configuration error")
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
