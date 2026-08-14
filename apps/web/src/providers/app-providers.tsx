"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/react-auth";
import { SmartWalletsProvider } from "@privy-io/react-auth/smart-wallets";
import { useState, type ReactNode } from "react";
import { hasPrivyAppId, privyAppId, privyConfig } from "@/lib/wallet";
import { ActiveWalletProvider } from "@/providers/active-wallet-provider";

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1 } } }));
  const content = <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  if (!hasPrivyAppId) return content;
  return <PrivyProvider appId={privyAppId} config={privyConfig}><SmartWalletsProvider><ActiveWalletProvider>{content}</ActiveWalletProvider></SmartWalletsProvider></PrivyProvider>;
}
