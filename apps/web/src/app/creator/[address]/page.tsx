"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { TokenCard } from "@/components/token-card";
import { api } from "@/lib/api";
import { validAddress } from "@/lib/chain";

export default function CreatorPage() {
  const { address } = useParams<{ address: string }>();
  const valid = validAddress(address);
  const query = useQuery({ queryKey: ["public-creator", address], queryFn: () => api.creator(address, "?limit=24"), enabled: valid });
  if (!valid) return <main className="container flex-1 py-12"><div className="panel text-red-300">Invalid creator address.</div></main>;
  if (query.isPending) return <main className="container flex-1 py-12"><div className="panel text-zinc-400">Loading public creator profile…</div></main>;
  if (query.isError) return <main className="container flex-1 py-12"><div className="panel text-red-300">Creator profile could not be loaded.</div></main>;
  const creator = query.data;
  return <main className="container flex-1 py-12"><p className="eyebrow">Public creator profile</p><h1 className="mt-3 break-all text-2xl font-semibold text-white">{creator.address}</h1><div className="mt-8 grid max-w-xl grid-cols-2 gap-4"><div className="panel"><p className="text-sm text-zinc-500">Tokens</p><p className="mt-2 text-2xl text-white">{creator.token_count}</p></div><div className="panel"><p className="text-sm text-zinc-500">Indexed volume</p><p className="mt-2 text-2xl text-white">{creator.volume}</p></div></div><section className="mt-10"><h2 className="mb-5 text-xl font-semibold text-white">Created tokens</h2>{creator.tokens.length === 0 ? <div className="panel text-sm text-zinc-400">No tokens indexed for this creator.</div> : <div className="grid gap-4 sm:grid-cols-2">{creator.tokens.map((token) => <TokenCard key={token.address} token={token} />)}</div>}</section></main>;
}
