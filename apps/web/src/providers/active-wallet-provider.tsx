"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAccount, useWalletClient } from "wagmi";
import type { Address, WalletClient } from "viem";

type ActiveWalletContextValue = {
  connected: boolean;
  activeAddress?: Address;
  activeChainId?: number;
  walletClient?: WalletClient;
};

const ActiveWalletContext = createContext<ActiveWalletContextValue | null>(null);

export function ActiveWalletProvider({ children }: { children: ReactNode }) {
  const { address, chainId, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const value = useMemo(() => ({ connected: isConnected, activeAddress: address, activeChainId: chainId, walletClient }), [address, chainId, isConnected, walletClient]);
  return <ActiveWalletContext.Provider value={value}>{children}</ActiveWalletContext.Provider>;
}

export function useActiveWallet() {
  const value = useContext(ActiveWalletContext);
  if (!value) throw new Error("useActiveWallet must be used within ActiveWalletProvider");
  return value;
}
