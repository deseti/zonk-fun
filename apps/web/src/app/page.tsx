import Link from "next/link";
import { DiscoveryMarketplace } from "@/components/discovery-marketplace";

export default function Home() {
  return <main className="market-container market-page flex-1">
    <section className="market-hero relative overflow-hidden" aria-labelledby="home-heading">
      <div className="pointer-events-none absolute -right-12 -top-24 h-56 w-56 rounded-full bg-cyan-300/10 blur-3xl" />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge-success"><span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-emerald-300" />Live testnet</span>
            <span className="badge-neutral">Base Sepolia · 84532</span>
          </div>
          <h1 id="home-heading" className="mt-3 text-[1.7rem] font-semibold leading-tight tracking-[-0.045em] text-white sm:mt-4 sm:text-4xl lg:text-[2.75rem]">Discover what&apos;s launching on Zonk.</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400 sm:mt-3 sm:text-base">Explore community tokens, follow live indexed markets, and trade transparent bonding curves on Base.</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Link href="#all-launches" className="button-primary">Explore tokens <span aria-hidden>↓</span></Link>
          <Link href="/create" className="button-secondary">Create token <span aria-hidden>↗</span></Link>
        </div>
      </div>
    </section>

    <DiscoveryMarketplace />
  </main>;
}
