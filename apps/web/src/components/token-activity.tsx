"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function TokenActivity({ tokenAddress }: { tokenAddress: string }) {
  const query = useQuery({ queryKey: ["token-activity", tokenAddress], queryFn: () => api.activity(tokenAddress, "?limit=20"), refetchInterval: 15_000 });
  return <section className="panel mt-10" aria-label="Token activity"><h2 className="text-xl font-semibold text-white">Token activity</h2><p className="mt-2 text-sm text-zinc-500">Canonical launch, trade, and ERC-20 transfer events.</p>{query.isPending && <p className="mt-5 text-sm text-zinc-400">Loading token activity…</p>}{query.isError && <p className="mt-5 text-sm text-red-300">Token activity could not be loaded.</p>}{query.data?.items.length === 0 && <p className="mt-5 text-sm text-zinc-400">No canonical activity yet.</p>}{query.data && query.data.items.length > 0 && <ul className="mt-5 grid gap-3">{query.data.items.map((event) => <li key={`${event.transaction_hash}:${event.log_index}`} className="rounded-xl border border-zinc-800 p-3 text-sm"><div className="flex justify-between gap-3"><span className="text-zinc-200">{event.event_name}</span><span className="text-zinc-500">Block {event.block_number}</span></div><a className="mt-2 block break-all text-cyan-300" href={`https://sepolia.basescan.org/tx/${event.transaction_hash}`} target="_blank" rel="noreferrer">View on BaseScan</a></li>)}</ul>}</section>;
}
