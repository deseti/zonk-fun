import Link from "next/link";
import { hasPrivyAppId } from "@/lib/wallet";
import { PrivyWalletUnavailable, WalletStatus } from "./wallet-status";

export function Navigation() {
  return <header className="border-b border-white/10 bg-black/30"><div className="container flex min-h-16 items-center justify-between gap-4"><Link href="/" className="text-xl font-semibold tracking-tight text-white">zonk<span className="text-cyan-300">.fun</span></Link><nav className="hidden items-center gap-5 text-sm text-zinc-300 sm:flex"><Link href="/" className="hover:text-white">Explore</Link><Link href="/create" className="hover:text-white">Create</Link><Link href="/profile" className="hover:text-white">Profile</Link></nav>{hasPrivyAppId ? <WalletStatus /> : <PrivyWalletUnavailable />}</div></header>;
}
