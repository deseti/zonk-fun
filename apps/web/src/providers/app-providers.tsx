"use client";

import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wallet";
import { ActiveWalletProvider } from "@/providers/active-wallet-provider";
import { OraclePriceProvider } from "@/providers/oracle-price-provider";

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1 } } }));
  return <WagmiProvider config={wagmiConfig}><QueryClientProvider client={queryClient}><RainbowKitProvider theme={darkTheme()}><ActiveWalletProvider><OraclePriceProvider>{children}</OraclePriceProvider></ActiveWalletProvider></RainbowKitProvider></QueryClientProvider></WagmiProvider>;
}
