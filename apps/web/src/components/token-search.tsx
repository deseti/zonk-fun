"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { TokenCard } from "@/components/token-card";

export function TokenSearch() {
  const [search, setSearch] = useState("");
  const query = useQuery({ queryKey: ["token-search", search], queryFn: () => api.listTokens(`?search=${encodeURIComponent(search)}&limit=12`), enabled: search.trim().length > 0 });
  return <section className="mt-14" aria-label="Token search">
    <label className="block text-sm font-medium text-zinc-200" htmlFor="token-search">Search tokens</label>
    <p className="mt-1 text-sm text-zinc-500">Search indexed token name, symbol, or address prefix.</p>
    <input id="token-search" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={64} className="mt-3 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-cyan-300" placeholder="Name, symbol, or 0x address" />
    {search.trim() && <div className="mt-4">
      {query.isPending && <p className="panel text-sm text-zinc-400">Searching indexed tokens…</p>}
      {query.isError && <p className="panel text-sm text-red-300">Search results could not be loaded.</p>}
      {query.data?.items.length === 0 && <p className="panel text-sm text-zinc-400">No indexed tokens match that prefix.</p>}
      {query.data && query.data.items.length > 0 && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{query.data.items.map((token) => <TokenCard key={token.address} token={token} />)}</div>}
    </div>}
  </section>;
}
