"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

export function WalletStatus({ compact = false }: { compact?: boolean; short?: boolean }) {
  return <div className={compact ? "w-full" : ""} aria-label="Browser wallet controls"><ConnectButton accountStatus={compact ? "avatar" : "address"} chainStatus="full" showBalance={false} /></div>;
}
