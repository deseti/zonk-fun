"use client";

import Link from "next/link";
import type { Token } from "@zonk/types";
import { apiAssetURL } from "@/lib/api";
import { formatCount, formatNative, formatWeiUsd, graduationProgress } from "@/lib/format";
import { useOraclePrice } from "@/providers/oracle-price-provider";

export function TokenCard({ token }: { token: Token }) {
  const { reference } = useOraclePrice();
  const status = tokenStatus(token);
  const progress = graduationProgress(token.curve?.sold_supply, token.curve?.graduation_threshold);
  return <article className="group panel relative block h-full p-4 transition duration-150 hover:-translate-y-0.5 hover:border-cyan-300/35 hover:bg-[#0e1925] sm:p-5">
    <Link href={`/token/${token.address}`} aria-label={`Open ${token.name}`} className="absolute inset-0 rounded-[inherit] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" />
    <div className="flex min-w-0 items-start gap-3">
      {token.image_url ? <div role="img" aria-label="" className="h-12 w-12 flex-none rounded-xl border border-white/10 bg-cover bg-center" style={{ backgroundImage: `url(${apiAssetURL(token.image_url)})` }} /> : <div aria-hidden className="flex h-12 w-12 flex-none items-center justify-center rounded-xl border border-cyan-300/15 bg-cyan-300/7 text-lg font-semibold text-cyan-200">{token.symbol.slice(0, 1)}</div>}
      <div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-2"><h3 className="truncate font-semibold text-white transition-colors group-hover:text-cyan-100">{token.name}</h3>{status && <span className={status.className}>{status.label}</span>}</div><p className="mt-1 truncate text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">{token.symbol}</p></div>
      <span aria-hidden className="text-zinc-600 transition-transform group-hover:translate-x-0.5 group-hover:text-cyan-300">→</span>
    </div>
    <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
      <Metric label="Price" value={formatWeiUsd(token.metrics.current_price, reference)} secondary={token.metrics.current_price ? formatNative(token.metrics.current_price) : "Not indexed"} />
      <Metric label="FDV" value={formatWeiUsd(token.metrics.fully_diluted_value, reference)} secondary={token.metrics.fully_diluted_value ? formatNative(token.metrics.fully_diluted_value) : "Not indexed"} />
      <Metric label="Volume" value={formatWeiUsd(token.metrics.volume, reference)} secondary={formatNative(token.metrics.volume)} />
      <Metric label="Trades" value={formatCount(token.metrics.trade_count)} secondary={`${formatCount(token.metrics.holder_count)} holders`} />
    </dl>
    {progress !== null && <div className="mt-5"><div className="flex items-center justify-between gap-3 text-xs"><span className="text-zinc-600">Graduation</span><span className="font-medium text-zinc-300">{progress.toFixed(2)}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/6"><div className="h-full rounded-full bg-violet-400" style={{ width: `${progress}%` }} /></div></div>}
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-3"><p className="truncate text-xs text-zinc-600">Creator <span className="font-mono text-zinc-400">{shortAddress(token.creator)}</span></p><div className="flex items-center gap-3">{token.website_url && <a href={token.website_url} target="_blank" rel="noreferrer" className="relative z-10 text-xs text-cyan-300 hover:text-cyan-200">Website ↗</a>}{token.x_url && <a href={token.x_url} target="_blank" rel="noreferrer" className="relative z-10 text-xs text-cyan-300 hover:text-cyan-200">X ↗</a>}{!reference && <span className="text-[0.65rem] text-zinc-600">USD unavailable</span>}</div></div>
  </article>;
}

function Metric({ label, value, secondary }: { label: string; value: string; secondary?: string }) {
  return <div className="min-w-0"><dt className="text-xs text-zinc-600">{label}</dt><dd className="mt-1 truncate font-medium text-zinc-100" title={value}>{value}</dd>{secondary && <dd className="mt-0.5 truncate text-[0.68rem] text-zinc-600" title={secondary}>{secondary}</dd>}</div>;
}

function shortAddress(value: string) {
  return value.length > 13 ? `${value.slice(0, 7)}…${value.slice(-4)}` : value;
}

function tokenStatus(token: Token): { label: string; className: string } | null {
  const phase = token.graduation?.phase?.toLowerCase();
  if (phase) {
    if (/graduated|settled|complete/.test(phase)) return { label: "Graduated", className: "badge-violet" };
    if (/pending|graduat|settling/.test(phase)) return { label: "Graduating", className: "badge-warning" };
  }
  return token.curve ? { label: "Active", className: "badge-success" } : null;
}
