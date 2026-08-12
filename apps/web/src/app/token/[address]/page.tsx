"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { api, apiAssetURL } from "@/lib/api";
import { validAddress } from "@/lib/chain";
import { readCurveOnchain, readTokenOnchain } from "@/lib/contracts";
import { useEffect, useState } from "react";

export default function TokenDetailPage() {
  const params = useParams<{ address: string }>();
  const address = params.address;
  const valid = validAddress(address);
  const query = useQuery({ queryKey: ["token", address], queryFn: () => api.token(address), enabled: valid });
  const [onchain, setOnchain] = useState<string | null>(null);
  useEffect(() => { if (!valid) return; void Promise.all([readTokenOnchain(address), readCurveOnchain(address)]).then(([info, curve]) => setOnchain(info || curve ? "Available" : "Not configured" )).catch(() => setOnchain("Unavailable")); }, [address, valid]);
  if (!valid) return <main className="container flex-1 py-12"><div className="panel text-red-300">Invalid token address.</div></main>;
  if (query.isPending) return <main className="container flex-1 py-12"><div className="panel text-zinc-400">Loading indexed token…</div></main>;
  if (query.isError) return <main className="container flex-1 py-12"><div className="panel text-red-300">{query.error.message}</div></main>;
  const token = query.data;
  return <main className="container flex-1 py-12"><p className="eyebrow">Token detail</p><div className="mt-3 flex flex-wrap items-start justify-between gap-6">{token.image_url&&<div role="img" aria-label={`${token.name} token image`} className="h-32 w-32 rounded-2xl bg-cover bg-center" style={{backgroundImage:`url(${apiAssetURL(token.image_url)})`}}/>}<div className="flex-1"><h1 className="text-3xl font-semibold text-white">{token.name}</h1><p className="mt-2 text-cyan-300">{token.symbol}</p>{token.description?<p className="mt-4 max-w-2xl text-zinc-300">{token.description}</p>:<p className="mt-4 text-sm text-zinc-500">No off-chain description has been finalized.</p>}</div><code className="text-xs text-zinc-500">{token.address}</code></div><div className="mt-8 grid gap-4 sm:grid-cols-3"><div className="panel"><p className="text-sm text-zinc-500">Indexed volume</p><p className="mt-2 text-xl text-white">{token.metrics.volume}</p></div><div className="panel"><p className="text-sm text-zinc-500">Trades</p><p className="mt-2 text-xl text-white">{token.metrics.trade_count}</p></div><div className="panel"><p className="text-sm text-zinc-500">Onchain read</p><p className="mt-2 text-xl text-white">{onchain ?? "Checking…"}</p></div></div><section className="mt-10 panel"><h2 className="text-lg font-semibold text-white">Canonical indexed state</h2><dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-zinc-500">Creator</dt><dd className="mt-1 break-all text-zinc-200">{token.creator}</dd></div><div><dt className="text-zinc-500">Created at block</dt><dd className="mt-1 text-zinc-200">{token.created_at.block_number}</dd></div><div><dt className="text-zinc-500">Transaction</dt><dd className="mt-1 break-all text-zinc-200"><a href={`https://sepolia.basescan.org/tx/${token.created_at.transaction_hash}`} target="_blank" rel="noreferrer">{token.created_at.transaction_hash}</a></dd></div><div><dt className="text-zinc-500">Initial supply</dt><dd className="mt-1 text-zinc-200">{token.initial_supply}</dd></div><div><dt className="text-zinc-500">Market cap</dt><dd className="mt-1 text-zinc-200">{token.metrics.market_cap ?? "Not indexed"}</dd></div><div><dt className="text-zinc-500">Holder count</dt><dd className="mt-1 text-zinc-200">{token.metrics.holder_count ?? "Not indexed"}</dd></div></dl></section></main>;
}
