"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { TokenTrading } from "@/components/token-trading";
import { api, apiAssetURL } from "@/lib/api";
import { validAddress } from "@/lib/chain";
import { readCurveOnchain, readTokenOnchain } from "@/lib/contracts";

export default function TokenDetailPage() {
  const { address } = useParams<{ address: string }>();
  const valid = validAddress(address);
  const query = useQuery({ queryKey: ["token", address], queryFn: () => api.token(address), enabled: valid });
  const [onchain, setOnchain] = useState<string | null>(null);
  useEffect(() => {
    if (!valid) return;
    void Promise.all([readTokenOnchain(address), readCurveOnchain(address)])
      .then(([info, curve]) => setOnchain(info || curve ? "Available" : "Not configured"))
      .catch(() => setOnchain("Unavailable"));
  }, [address, valid]);

  if (!valid) return <main className="container flex-1 py-12"><div className="panel text-red-300">Invalid token address.</div></main>;
  if (query.isPending) return <main className="container flex-1 py-12"><div className="panel text-zinc-400">Loading indexed token…</div></main>;
  if (query.isError) return <main className="container flex-1 py-12"><div className="panel text-red-300">{query.error.message}</div></main>;
  const token = query.data;
  return <main className="container flex-1 py-12">
    <p className="eyebrow">Token detail</p>
    <div className="mt-3 flex flex-wrap items-start justify-between gap-6">
      {token.image_url && <div role="img" aria-label={`${token.name} token image`} className="h-32 w-32 rounded-2xl bg-cover bg-center" style={{ backgroundImage: `url(${apiAssetURL(token.image_url)})` }} />}
      <div className="flex-1"><h1 className="text-3xl font-semibold text-white">{token.name}</h1><p className="mt-2 text-cyan-300">{token.symbol}</p>{token.description ? <p className="mt-4 max-w-2xl text-zinc-300">{token.description}</p> : <p className="mt-4 text-sm text-zinc-500">No off-chain description has been finalized.</p>}</div>
      <code className="text-xs text-zinc-500">{token.address}</code>
    </div>
    <div className="mt-8 grid gap-4 sm:grid-cols-3"><Metric label="Indexed volume" value={token.metrics.volume} /><Metric label="Trades" value={String(token.metrics.trade_count)} /><Metric label="Onchain read" value={onchain ?? "Checking…"} /></div>
    <TokenTrading tokenAddress={address} symbol={token.symbol} creator={token.creator as `0x${string}`} />
    <section className="mt-10 panel"><h2 className="text-lg font-semibold text-white">Canonical indexed state</h2><dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
      <Detail label="Creator" value={token.creator} />
      <Detail label="Created at block" value={String(token.created_at.block_number)} />
      <Detail label="Initial supply" value={token.initial_supply} />
      <Detail label="Market cap" value={token.metrics.market_cap ?? "Not indexed"} />
      <Detail label="Holder count" value={String(token.metrics.holder_count ?? "Not indexed")} />
      <div><dt className="text-zinc-500">Transaction</dt><dd className="mt-1 break-all text-zinc-200"><a href={`https://sepolia.basescan.org/tx/${token.created_at.transaction_hash}`} target="_blank" rel="noreferrer">{token.created_at.transaction_hash}</a></dd></div>
    </dl></section>
  </main>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="panel"><p className="text-sm text-zinc-500">{label}</p><p className="mt-2 text-xl text-white">{value}</p></div>; }
function Detail({ label, value }: { label: string; value: string }) { return <div><dt className="text-zinc-500">{label}</dt><dd className="mt-1 break-all text-zinc-200">{value}</dd></div>; }
