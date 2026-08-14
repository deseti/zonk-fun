"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
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
  const effectiveMode = mode === "external" && externalAddress ? "external" : "embedded";

  const value = useMemo<ActiveWalletContextValue>(() => {
    const activeWallet = effectiveMode === "external" ? externalWallet : embeddedWallet;
    return {
      mode: effectiveMode,
      selectMode: setMode,
      activeAddress: effectiveMode === "external" ? externalAddress : embeddedAddress,
      activeChainId: parsePrivyChainId(activeWallet?.chainId),
      activeWallet,
      embeddedAddress,
      embeddedWallet,
      externalAddress,
      externalWallet,
    };
  }, [embeddedAddress, embeddedWallet, externalAddress, externalWallet, effectiveMode]);

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
