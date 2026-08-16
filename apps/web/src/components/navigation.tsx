"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { hasPrivyAppId } from "@/lib/wallet";
import { HeaderTokenSearch } from "./header-token-search";
import { PrivyWalletUnavailable, WalletStatus } from "./wallet-status";

const links = [
  { href: "/", label: "Explore" },
  { href: "/create", label: "Create" },
  { href: "/profile", label: "Profile" },
] as const;

export function Navigation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return <header className="sticky top-0 z-50 border-b border-white/8 bg-[#05090f]/94 backdrop-blur-xl">
    <div className="market-container">
      <div className="grid min-h-16 grid-cols-[auto_1fr_auto] items-center gap-3">
        <Link href="/" className="flex min-h-11 items-center gap-2 rounded-lg text-xl font-semibold tracking-[-0.04em] text-white" onClick={() => setOpen(false)} aria-label="Zonk.fun home">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-sm font-bold text-cyan-200">Z</span>
          <span>zonk<span className="text-cyan-300">.fun</span></span>
        </Link>
        <div className="mx-auto hidden w-full max-w-xl px-2 md:block"><HeaderTokenSearch id="desktop-token-search" /></div>
        <div className="hidden items-center justify-end gap-2 xl:flex">
          <nav className="flex items-center gap-0.5 text-sm" aria-label="Primary navigation">
            {links.map((link) => <NavLink key={link.href} {...link} active={isActive(pathname, link.href)} />)}
          </nav>
          <div className="hidden min-w-0 xl:flex">{hasPrivyAppId ? <WalletStatus /> : <PrivyWalletUnavailable />}</div>
        </div>
        <div className="xl:hidden"><button className="button-secondary h-11 w-11 p-0" type="button" aria-expanded={open} aria-controls="mobile-navigation" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((current) => !current)}>
          <span aria-hidden className="text-xl leading-none">{open ? "×" : "≡"}</span>
        </button></div>
      </div>
      <div className="pb-2.5 md:hidden"><HeaderTokenSearch id="mobile-token-search" /></div>
      {open && <div id="mobile-navigation" className="border-t border-white/8 py-3 xl:hidden">
        <nav className="grid grid-cols-3 gap-2" aria-label="Mobile navigation">
          {links.map((link) => <NavLink key={link.href} {...link} active={isActive(pathname, link.href)} onClick={() => setOpen(false)} />)}
        </nav>
        <div className="mt-3 border-t border-white/8 pt-3">{hasPrivyAppId ? <WalletStatus compact /> : <PrivyWalletUnavailable />}</div>
      </div>}
    </div>
  </header>;
}

function NavLink({ href, label, active, onClick }: { href: string; label: string; active: boolean; onClick?: () => void }) {
  return <Link href={href} onClick={onClick} aria-current={active ? "page" : undefined} className={`flex min-h-10 items-center justify-center rounded-lg px-3 font-medium transition-colors ${active ? "bg-cyan-300/10 text-cyan-200" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`}>{label}</Link>;
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
