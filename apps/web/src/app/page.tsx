import Link from "next/link";
import { TokenList } from "@/components/token-list";
import { TokenSearch } from "@/components/token-search";
import { MarketActivity } from "@/components/market-activity";

export default function Home() {
  return <main className="container page-shell flex-1">
    <section className="relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#09121c]/85 px-5 py-9 shadow-2xl shadow-black/25 sm:px-9 sm:py-12 lg:px-12 lg:py-14">
      <div className="pointer-events-none absolute -right-20 -top-36 h-80 w-80 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 left-1/4 h-72 w-72 rounded-full bg-violet-500/8 blur-3xl" />
      <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end">
        <div>
        <div className="flex flex-wrap items-center gap-2"><span className="badge-success">Live testnet</span><span className="badge-violet">Base Sepolia · 84532</span></div>
        <h1 className="mt-6 max-w-3xl text-[2.55rem] font-semibold leading-[1.02] tracking-[-0.055em] text-white sm:text-5xl lg:text-6xl">Launch tokens.<br /><span className="text-cyan-300">Trade the curve.</span></h1>
        <p className="mt-6 max-w-2xl text-base leading-7 text-zinc-300 sm:text-lg sm:leading-8">Zonk.fun is a non-custodial launchpad for creating and trading community tokens on a transparent bonding curve.</p>
        <div className="mt-8 flex flex-col gap-3 min-[420px]:flex-row">
          <Link href="#discover" className="button-primary px-5">Explore tokens <span aria-hidden>↓</span></Link>
          <Link href="/create" className="button-secondary px-5">Create a token <span aria-hidden>→</span></Link>
        </div>
        <p className="mt-5 text-xs leading-5 text-zinc-500">Testnet only. Base Sepolia assets have no real-world value. Wallet transactions remain under your control.</p>
        </div>
        <div className="grid gap-2 rounded-xl border border-white/8 bg-black/20 p-4 text-sm"><p className="eyebrow">Terminal status</p><div className="mt-2 flex items-center justify-between"><span className="text-zinc-500">Network</span><span className="text-zinc-200">Base Sepolia</span></div><div className="flex items-center justify-between"><span className="text-zinc-500">Market source</span><span className="text-zinc-200">Canonical index</span></div><div className="flex items-center justify-between"><span className="text-zinc-500">Settlement</span><span className="text-zinc-200">Non-custodial</span></div></div>
      </div>
    </section>

    <section className="mt-6 grid gap-3 sm:grid-cols-3" aria-label="How Zonk works">
      <Value icon="01" title="Permissionless launch" copy="Publish metadata and launch a fixed-supply token directly to its curve." />
      <Value icon="02" title="Onchain price discovery" copy="Buy and sell against deterministic curve liquidity with protected quotes." />
      <Value icon="03" title="Canonical discovery" copy="Explore indexed launches, market activity, creators, and graduation progress." />
    </section>

    <div id="discover" className="scroll-mt-24"><TokenSearch /></div>

    <section className="mt-16 sm:mt-20">
      <div className="mb-6"><p className="eyebrow">Market leaders</p><h2 className="section-heading mt-2">Trending</h2><p className="section-copy">Activity-weighted canonical launches ranked by trailing 24-hour volume, trades, and unique traders.</p></div>
      <TokenList trending />
    </section>

    <section className="mt-16 sm:mt-20">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="eyebrow">Fresh launches</p><h2 className="section-heading mt-2">Newest tokens</h2><p className="section-copy">The latest launches confirmed and indexed from Base Sepolia.</p></div>
        <Link href="/profile" className="text-sm font-medium text-cyan-300 transition-colors hover:text-cyan-200">View your creator profile <span aria-hidden>→</span></Link>
      </div>
      <TokenList />
    </section>

    <section className="mt-16 sm:mt-20">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Tape</p><h2 className="section-heading mt-2">Recent indexed trades</h2><p className="section-copy">The latest trades sampled from the visible indexed launches; this is not a chain-wide global feed.</p></div><span className="badge-neutral w-fit">Refreshes every 15s</span></div>
      <MarketActivity />
    </section>
  </main>;
}

function Value({ icon, title, copy }: { icon: string; title: string; copy: string }) {
  return <div className="panel-subtle p-4 sm:p-5"><span className="font-mono text-xs text-cyan-300">{icon}</span><h2 className="mt-3 font-semibold text-white">{title}</h2><p className="mt-2 text-sm leading-6 text-zinc-500">{copy}</p></div>;
}
