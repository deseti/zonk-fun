import Link from "next/link";
import type { Token } from "@zonk/types";

export function TokenCard({ token }: { token: Token }) {
  return <Link href={`/token/${token.address}`} className="panel block transition hover:-translate-y-0.5 hover:border-cyan-300/50"><div className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[0.2em] text-cyan-300">{token.symbol}</p><h3 className="mt-1 text-lg font-semibold text-white">{token.name}</h3></div><span className="text-xs text-zinc-500">{token.address.slice(0, 8)}…</span></div><div className="mt-6 grid grid-cols-2 gap-3 text-sm"><div><p className="text-zinc-500">Volume</p><p className="mt-1 text-zinc-200">{token.metrics.volume}</p></div><div><p className="text-zinc-500">Trades</p><p className="mt-1 text-zinc-200">{token.metrics.trade_count}</p></div></div></Link>;
}
