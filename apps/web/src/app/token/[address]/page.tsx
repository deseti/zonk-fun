"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Token } from "@zonk/types";
import { TokenTrading, TokenTradeHistory } from "@/components/token-trading";
import { TokenActivity } from "@/components/token-activity";
import { TokenChart } from "@/components/token-chart";
import { api, apiAssetURL } from "@/lib/api";
import { validAddress } from "@/lib/chain";
import { readCurveOnchain, readTokenOnchain } from "@/lib/contracts";
import { formatCount, formatNative, formatTokenAmount, formatWeiUsd, graduationProgress, type EthUsdReference } from "@/lib/format";
import { useOraclePrice } from "@/providers/oracle-price-provider";

export default function TokenDetailPage() {
  const { reference } = useOraclePrice();
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

  if (!valid) return <PageState title="Invalid token address" copy="Check the address and try opening the token again." />;
  if (query.isPending) return <main className="container page-shell flex-1" aria-label="Loading indexed token"><div className="skeleton h-6 w-28 rounded" /><div className="mt-5 flex gap-5"><div className="skeleton h-20 w-20 flex-none rounded-2xl" /><div className="min-w-0 flex-1"><div className="skeleton h-9 w-64 max-w-full rounded" /><div className="skeleton mt-4 h-4 w-full max-w-xl rounded" /></div></div><div className="skeleton mt-8 h-[34rem] rounded-2xl" /></main>;
  if (query.isError) return <PageState title="Token could not be loaded" copy={query.error.message} action={() => void query.refetch()} />;
  const token = query.data;
  const lifecycle = lifecycleBadge(token.graduation?.phase, Boolean(token.curve));

  return <main className="container page-shell flex-1">
    <Link href="/" className="inline-flex min-h-10 items-center text-sm text-zinc-500 transition-colors hover:text-cyan-200"><span aria-hidden>←</span>&nbsp; Markets</Link>
    <section className="mt-3 border-b border-white/8 pb-6">
      <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-center">
        {token.image_url ? <div role="img" aria-label={`${token.name} token image`} className="h-20 w-20 flex-none rounded-2xl border border-white/10 bg-cover bg-center shadow-xl shadow-black/25" style={{ backgroundImage: `url(${apiAssetURL(token.image_url)})` }} /> : <div aria-hidden className="flex h-20 w-20 flex-none items-center justify-center rounded-2xl border border-cyan-300/15 bg-cyan-300/7 text-2xl font-semibold text-cyan-200">{token.symbol.slice(0, 1)}</div>}
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold tracking-[-0.035em] text-white sm:text-3xl">{token.name}</h1><span className="font-semibold uppercase tracking-[0.14em] text-cyan-300">{token.symbol}</span>{lifecycle && <span className={lifecycle.className}>{lifecycle.label}</span>}</div><p className="address mt-2">{token.address}</p></div>
        <div className="min-w-0 sm:text-right"><p className="text-xs text-zinc-600">Indexed price</p><p className="mt-1 text-2xl font-semibold tracking-tight text-white">{formatWeiUsd(token.metrics.current_price, reference)}</p><p className="mt-1 text-xs text-zinc-500">{token.metrics.current_price ? formatNative(token.metrics.current_price) : "Not indexed"} per token</p></div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:hidden"><TopMetric label="FDV" value={formatWeiUsd(token.metrics.fully_diluted_value, reference)} /><TopMetric label="Volume" value={formatWeiUsd(token.metrics.volume, reference)} /><TopMetric label="Liquidity" value={formatWeiUsd(token.curve?.reserve_balance, reference)} /><TopMetric label="Holders" value={formatCount(token.metrics.holder_count)} /></div>
    </section>

    <div className="terminal-layout mt-5">
      <div className="terminal-history"><TokenTradeHistory tokenAddress={address} symbol={token.symbol} /></div>
      <div className="terminal-center">
        <div className="terminal-chart"><TokenChart tokenAddress={address} initialSupply={token.initial_supply} className="" /></div>
        <div className="terminal-trade"><TokenTrading tokenAddress={address} symbol={token.symbol} creator={token.creator as `0x${string}`} tokenPriceWei={token.metrics.current_price} /></div>
      </div>
      <div className="terminal-right">
        <aside className="terminal-market"><MarketOverview token={token} onchain={onchain} reference={reference} /></aside>
        <aside className="terminal-graduation"><GraduationPanel token={token} /></aside>
      </div>
    </div>

    <section className="mt-10 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]">
      <article className="terminal-panel p-5"><p className="eyebrow">About &amp; socials</p><h2 className="mt-2 text-xl font-semibold text-white">{token.name}</h2>{token.description ? <p className="mt-4 text-sm leading-7 text-zinc-300">{token.description}</p> : <p className="mt-4 text-sm text-zinc-500">No about text has been provided.</p>}<div className="mt-5 flex flex-wrap gap-2">{token.website_url && <SocialLink href={token.website_url} label="Website" />}{token.x_url && <SocialLink href={token.x_url} label="X / Twitter" />}{token.telegram_url && <SocialLink href={token.telegram_url} label="Telegram" />}{token.discord_url && <SocialLink href={token.discord_url} label="Discord" />}{!token.website_url && !token.x_url && !token.telegram_url && !token.discord_url && <span className="text-xs text-zinc-600">No social links provided.</span>}</div><div className="mt-6 border-t border-white/8 pt-4"><p className="text-xs text-zinc-600">Creator</p><Link className="address mt-1 block text-cyan-300 hover:text-cyan-200" href={`/creator/${token.creator}`}>{token.creator}</Link></div></article>
      <article className="terminal-panel p-5"><p className="eyebrow">Holders</p><p className="mt-3 text-3xl font-semibold text-white">{formatCount(token.metrics.holder_count)}</p><p className="mt-2 text-sm leading-6 text-zinc-500">Canonical holder count from indexed ERC-20 transfers.</p><div className="status-box mt-5 text-xs text-zinc-500">Holder distribution is unavailable in the current API.</div></article>
    </section>

    <TokenActivity tokenAddress={address} />
    <section className="terminal-panel mt-10 p-5"><div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Provenance</p><h2 className="section-heading mt-2">Canonical launch record</h2></div><span className="badge-neutral">Base Sepolia · 84532</span></div><dl className="mt-6 grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2 lg:grid-cols-3"><Detail label="Token contract" value={token.address} link={`https://sepolia.basescan.org/address/${token.address}`} /><Detail label="Curve contract" value={token.curve?.address ?? "Not indexed"} link={token.curve?.address ? `https://sepolia.basescan.org/address/${token.curve.address}` : undefined} /><Detail label="Created at block" value={String(token.created_at.block_number)} /><Detail label="Initial supply" value={formatTokenAmount(token.initial_supply, 18, token.symbol)} /><Detail label="Onchain read" value={onchain ?? "Checking…"} /><Detail label="Launch transaction" value={token.created_at.transaction_hash} link={`https://sepolia.basescan.org/tx/${token.created_at.transaction_hash}`} /></dl></section>
    <p className="mt-6 text-center text-xs text-zinc-600">Base Sepolia assets have no real-world value. USD figures are reference conversions only.</p>
  </main>;
}

function MarketOverview({ token, onchain, reference }: { token: Token; onchain: string | null; reference: EthUsdReference | null }) { return <section className="terminal-panel"><div className="border-b border-white/8 p-4"><div className="flex items-center justify-between"><h2 className="font-semibold text-white">Market overview</h2><span className={reference ? "badge-success" : "badge-warning"}>{reference ? "Chainlink USD" : "USD unavailable"}</span></div>{reference && <p className="mt-1 text-[0.65rem] text-zinc-600">Updated {new Date(reference.asOf).toLocaleString()}</p>}</div><dl className="grid grid-cols-2 gap-px bg-white/6"><MarketStat label="Price" value={formatWeiUsd(token.metrics.current_price, reference)} secondary={formatNative(token.metrics.current_price)} /><MarketStat label="FDV" value={formatWeiUsd(token.metrics.fully_diluted_value, reference)} secondary={formatNative(token.metrics.fully_diluted_value)} /><MarketStat label="Volume" value={formatWeiUsd(token.metrics.volume, reference)} secondary={formatNative(token.metrics.volume)} /><MarketStat label="Liquidity" value={formatWeiUsd(token.curve?.reserve_balance, reference)} secondary={formatNative(token.curve?.reserve_balance)} /><MarketStat label="Trades" value={formatCount(token.metrics.trade_count)} secondary={`${formatCount(token.metrics.unique_trader_count)} traders`} /><MarketStat label="Holders" value={formatCount(token.metrics.holder_count)} secondary={onchain ?? "Checking onchain"} /></dl></section>; }
function MarketStat({ label, value, secondary }: { label: string; value: string; secondary: string }) { return <div className="min-w-0 bg-[#0a131d] p-3"><dt className="text-[0.68rem] text-zinc-600">{label}</dt><dd className="mt-1 truncate text-sm font-semibold text-zinc-100" title={value}>{value}</dd><dd className="mt-0.5 truncate text-[0.65rem] text-zinc-600" title={secondary}>{secondary}</dd></div>; }
function TopMetric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3"><p className="text-[0.65rem] text-zinc-600">{label}</p><p className="mt-1 truncate text-sm font-semibold text-zinc-100">{value}</p></div>; }

function GraduationPanel({ token }: { token: Token }) {
  const progress = graduationProgress(token.curve?.sold_supply, token.curve?.graduation_threshold);
  return <section className="terminal-panel p-4"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-white">Graduation progress</h2><span className={progress === 100 ? "badge-violet" : "badge-neutral"}>{progress === null ? "Unavailable" : `${progress.toFixed(2)}%`}</span></div>{progress === null ? <p className="mt-4 text-sm leading-6 text-zinc-500">The current API has not indexed a graduation threshold for this token.</p> : <><div className="mt-4 h-2 overflow-hidden rounded-full bg-white/6"><div className="h-full rounded-full bg-violet-400" style={{ width: `${progress}%` }} /></div><div className="mt-3 flex justify-between gap-4 text-xs text-zinc-600"><span>Sold {formatTokenAmount(token.curve?.sold_supply, 18)}</span><span>Target {formatTokenAmount(token.curve?.graduation_threshold, 18)}</span></div></>}</section>;
}

function Detail({ label, value, link }: { label: string; value: string; link?: string }) { return <div className="min-w-0"><dt className="text-zinc-500">{label}</dt><dd className="address mt-1 text-zinc-200">{link ? <a className="text-cyan-300 hover:text-cyan-200" href={link} target="_blank" rel="noreferrer">{value} ↗</a> : value}</dd></div>; }
function SocialLink({ href, label }: { href: string; label: string }) { return <a className="button-secondary min-h-9 px-3 text-xs" href={href} target="_blank" rel="noreferrer">{label} ↗</a>; }
function PageState({ title, copy, action }: { title: string; copy: string; action?: () => void }) { return <main className="container page-shell flex-1"><div className="status-box status-error max-w-2xl py-8"><h1 className="text-lg font-semibold">{title}</h1><p className="mt-2 text-sm opacity-80">{copy}</p>{action && <button className="button-secondary mt-5" type="button" onClick={action}>Try again</button>}</div></main>; }
function lifecycleBadge(phase?: string, hasCurve?: boolean) { const value = phase?.toLowerCase(); if (value && /graduated|settled|complete/.test(value)) return { label: "Graduated", className: "badge-violet" }; if (value && /pending|graduat|settling/.test(value)) return { label: "Graduating", className: "badge-warning" }; return hasCurve ? { label: "Active curve", className: "badge-success" } : null; }
