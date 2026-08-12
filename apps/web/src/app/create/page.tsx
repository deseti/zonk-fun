"use client";

import { NetworkGuard } from "@/components/wallet-status";
import { hasPrivyAppId } from "@/lib/wallet";
import { usePrivy } from "@privy-io/react-auth";

export default function CreatePage() {
  return <main className="container flex-1 py-12"><p className="eyebrow">Phase 6 foundation</p><h1 className="mt-3 text-3xl font-semibold text-white">Create a token</h1><p className="mt-3 max-w-2xl text-zinc-300">The launch form will arrive in the next phase. This foundation confirms Privy wallet and network readiness without preparing or sending a transaction.</p><div className="mt-8">{hasPrivyAppId ? <CreateReadiness /> : <div className="panel max-w-xl text-sm text-amber-200">Set NEXT_PUBLIC_PRIVY_APP_ID to enable Privy wallet readiness.</div>}</div></main>;
}

function CreateReadiness() {
  const { authenticated } = usePrivy();
  return <NetworkGuard><div className="panel max-w-xl"><h2 className="text-lg font-semibold text-white">Ready when you are</h2><p className="mt-2 text-sm text-zinc-400">{authenticated ? "Privy is connected. No transaction is requested in this phase." : "Log in with Privy to check readiness for future transaction flows."}</p></div></NetworkGuard>;
}
