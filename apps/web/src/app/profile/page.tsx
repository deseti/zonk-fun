"use client";

import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { hasPrivyAppId } from "@/lib/wallet";
import { api } from "@/lib/api";
import { TokenCard } from "@/components/token-card";

export default function ProfilePage() {
  return <main className="container flex-1 py-12"><p className="eyebrow">Creator profile</p><h1 className="mt-3 text-3xl font-semibold text-white">Your indexed activity</h1>{!hasPrivyAppId ? <div className="panel mt-8 max-w-xl text-sm text-amber-200">Set NEXT_PUBLIC_PRIVY_APP_ID to enable Privy profiles.</div> : <PrivyProfile />}</main>;
}

function PrivyProfile() {
  const { user, authenticated } = usePrivy();
  const address = user?.smartWallet?.address;
  const query = useQuery({ queryKey: ["creator", address], queryFn: () => api.creator(address!, "?limit=12"), enabled: authenticated && Boolean(address) });
  if (!authenticated || !address) return <div className="panel mt-8 max-w-xl text-sm text-zinc-400">Log in with Privy and wait for the smart wallet to view its creator profile.</div>;
  if (query.isPending) return <div className="panel mt-8 text-sm text-zinc-400">Loading indexed profile…</div>;
  if (query.isError) return <div className="panel mt-8 text-sm text-red-300">{query.error.message}</div>;
  return <><div className="mt-8 grid max-w-xl grid-cols-2 gap-4"><div className="panel"><p className="text-sm text-zinc-500">Tokens</p><p className="mt-2 text-2xl text-white">{query.data.token_count}</p></div><div className="panel"><p className="text-sm text-zinc-500">Indexed volume</p><p className="mt-2 text-2xl text-white">{query.data.volume}</p></div></div><section className="mt-10"><h2 className="mb-5 text-xl font-semibold text-white">Created tokens</h2>{query.data.tokens.length === 0 ? <div className="panel text-sm text-zinc-400">No tokens indexed for this smart wallet address.</div> : <div className="grid gap-4 sm:grid-cols-2">{query.data.tokens.map((token) => <TokenCard key={token.address} token={token} />)}</div>}</section></>;
}
