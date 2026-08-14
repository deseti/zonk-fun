"use client";

import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { hasPrivyAppId } from "@/lib/wallet";
import { api } from "@/lib/api";
import { TokenCard } from "@/components/token-card";
import { EmbeddedWalletExport } from "@/components/embedded-wallet-export";
import { useActiveWallet, walletModeLabel, type ActiveWalletMode } from "@/providers/active-wallet-provider";
import type { Address } from "viem";

export default function ProfilePage() {
  return <main className="container flex-1 py-12"><p className="eyebrow">Creator profile</p><h1 className="mt-3 text-3xl font-semibold text-white">Your indexed activity</h1>{!hasPrivyAppId ? <div className="panel mt-8 max-w-xl text-sm text-amber-200">Set NEXT_PUBLIC_PRIVY_APP_ID to enable Privy profiles.</div> : <PrivyProfile />}</main>;
}

function PrivyProfile() {
  const { authenticated } = usePrivy();
  const { mode, activeAddress: address, embeddedAddress } = useActiveWallet();
  const creatorAddress = profileAddressForMode(mode, address, embeddedAddress);
  const query = useQuery({ queryKey: activeProfileQueryKey(creatorAddress), queryFn: () => loadActiveProfile(creatorAddress!), enabled: authenticated && Boolean(creatorAddress) });
  if (!authenticated || !address) return <div className="panel mt-8 max-w-xl text-sm text-zinc-400">The selected {walletModeLabel(mode).toLowerCase()} is not available.</div>;
  return <><div className="mt-8"><p className="mb-4 break-all text-sm text-zinc-300">Creator profile: {walletModeLabel(mode)} · {creatorAddress}</p><div className="mb-8">{query.isPending ? <div className="panel text-sm text-zinc-400">Loading indexed profile…</div> : query.isError ? <div className="panel text-sm text-red-300">{query.error.message}</div> : <><div className="grid max-w-xl grid-cols-2 gap-4"><div className="panel"><p className="text-sm text-zinc-500">Tokens</p><p className="mt-2 text-2xl text-white">{query.data.token_count}</p></div><div className="panel"><p className="text-sm text-zinc-500">Indexed volume</p><p className="mt-2 text-2xl text-white">{query.data.volume}</p></div></div><section className="mt-10"><h2 className="mb-5 text-xl font-semibold text-white">Created tokens</h2>{query.data.tokens.length === 0 ? <div className="panel text-sm text-zinc-400">No tokens indexed for this creator wallet address.</div> : <div className="grid gap-4 sm:grid-cols-2">{query.data.tokens.map((token) => <TokenCard key={token.address} token={token} />)}</div>}</section></>}</div>{mode === "embedded" && embeddedAddress && <EmbeddedWalletExport smartWalletAddress={embeddedAddress} />}</div></>;
}

export function activeProfileQueryKey(address?: string) {
  return ["creator", address] as const;
}

export function profileAddressForMode(mode: ActiveWalletMode, activeAddress?: Address, embeddedAddress?: Address) {
  return mode === "external" ? activeAddress : embeddedAddress;
}

export function loadActiveProfile(address: string) {
  return api.creator(address, "?limit=12");
}
