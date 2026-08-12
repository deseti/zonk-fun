"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { TokenCard } from "./token-card";

export function TokenList({ trending = false }: { trending?: boolean }) {
  const query = useQuery({ queryKey: [trending ? "trending" : "tokens"], queryFn: () => trending ? api.trending("?limit=12") : api.listTokens("?limit=12") });
  if (query.isPending) return <div className="panel text-sm text-zinc-400">Loading indexed tokens…</div>;
  if (query.isError) return <div className="panel text-sm text-red-300">{query.error.message}</div>;
  if (query.data.items.length === 0) return <div className="panel text-sm text-zinc-400">No indexed tokens yet.</div>;
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{query.data.items.map((token) => <TokenCard key={token.address} token={token} />)}</div>;
}
