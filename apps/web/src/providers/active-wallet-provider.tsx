"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePrivy, useWallets, type BaseConnectedEthereumWallet } from "@privy-io/react-auth";
import { getAddress, type Address } from "viem";
import { isExternalWallet, isPrivyEmbeddedWallet, parsePrivyChainId } from "@/lib/wallet";
import { validAddress } from "@/lib/chain";

export type ActiveWalletMode = "embedded" | "external";

type ActiveWalletContextValue = {
  mode: ActiveWalletMode;
  selectMode: (mode: ActiveWalletMode) => void;
  activeAddress?: Address;
  activeChainId?: number;
  activeWallet?: BaseConnectedEthereumWallet;
  embeddedAddress?: Address;
  embeddedWallet?: BaseConnectedEthereumWallet;
  externalAddress?: Address;
  externalWallet?: BaseConnectedEthereumWallet;
};

const ActiveWalletContext = createContext<ActiveWalletContextValue | null>(null);

export function ActiveWalletProvider({ children }: { children: ReactNode }) {
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const embeddedWallet = wallets.find(isPrivyEmbeddedWallet);
  const externalWallet = wallets.find(isExternalWallet);
  const smartAddress = user?.smartWallet?.address;
  const embeddedAddress = smartAddress && validAddress(smartAddress) ? getAddress(smartAddress) : undefined;
  const externalAddress = externalWallet?.address && validAddress(externalWallet.address) ? getAddress(externalWallet.address) : undefined;
  const [mode, setMode] = useState<ActiveWalletMode>(externalWallet ? "external" : "embedded");
  const observedExternalRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const next = externalAddress?.toLowerCase();
    if (!next) {
      observedExternalRef.current = undefined;
      setMode((current) => current === "external" ? "embedded" : current);
      return;
    }
    if (next !== observedExternalRef.current) setMode("external");
    observedExternalRef.current = next;
  }, [externalAddress]);

  const value = useMemo<ActiveWalletContextValue>(() => {
    const activeWallet = mode === "external" ? externalWallet : embeddedWallet;
    return {
      mode,
      selectMode: setMode,
      activeAddress: mode === "external" ? externalAddress : embeddedAddress,
      activeChainId: parsePrivyChainId(activeWallet?.chainId),
      activeWallet,
      embeddedAddress,
      embeddedWallet,
      externalAddress,
      externalWallet,
    };
  }, [embeddedAddress, embeddedWallet, externalAddress, externalWallet, mode]);

  return <ActiveWalletContext.Provider value={value}>{children}</ActiveWalletContext.Provider>;
}

export function useActiveWallet() {
  const value = useContext(ActiveWalletContext);
  if (!value) throw new Error("useActiveWallet must be used within ActiveWalletProvider");
  return value;
}

export function walletModeLabel(mode: ActiveWalletMode) {
  return mode === "external" ? "External wallet" : "Privy embedded wallet";
}
