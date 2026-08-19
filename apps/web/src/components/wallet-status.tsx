"use client";

import { useConnectWallet, useCreateWallet, useLogin, usePrivy, useWallets, type BaseConnectedEthereumWallet } from "@privy-io/react-auth";
import { useSmartWallets, type SmartWalletClientType } from "@privy-io/react-auth/smart-wallets";
import { useState, type ReactNode } from "react";
import { isSelectedZonkChain, selectedZonkChain, selectedZonkChainId, selectedZonkChainName, validAddress } from "@/lib/chain";
import { derivePrivyWalletState, isExternalWallet, isPrivyEmbeddedWallet, parsePrivyChainId, privyExternalWalletList, privyLoginMethods } from "@/lib/wallet";
import { useActiveWallet, walletModeLabel } from "@/providers/active-wallet-provider";

const shorten = (value?: string) => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "";

export async function logoutPrivy(logout: () => Promise<void>, setError: (message: string | null) => void) {
  setError(null);
  try {
    await logout();
  } catch {
    setError("Logout is unavailable right now.");
  }
}

export async function switchPrivyEmbeddedWallet(
  embeddedWallet: Pick<BaseConnectedEthereumWallet, "switchChain">,
  getClientForChain: ({ id }: { id: number }) => Promise<SmartWalletClientType | undefined>,
) {
  await embeddedWallet.switchChain(selectedZonkChainId);
  return getClientForChain({ id: selectedZonkChainId });
}

export function WalletStatus({ compact = false, short = false }: { compact?: boolean; short?: boolean }) {
  const { ready, authenticated, user, logout, error } = usePrivy();
  const { wallets } = useWallets();
  const { client, getClientForChain } = useSmartWallets();
  const { createWallet } = useCreateWallet();
  const { mode, selectMode, activeAddress, embeddedAddress, externalAddress } = useActiveWallet();
  const [loginPending, setLoginPending] = useState(false);
  const [createPending, setCreatePending] = useState(false);
  const [switchPending, setSwitchPending] = useState(false);
  const [chainClient, setChainClient] = useState<SmartWalletClientType | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const { login } = useLogin({
    onComplete: () => setLoginPending(false),
    onError: () => setLoginPending(false),
  });
  const { connectWallet } = useConnectWallet({
    onSuccess: () => { setActionError(null); selectMode("external"); },
    onError: () => setActionError("External wallet connection was not completed."),
  });
  const embedded = wallets.find(isPrivyEmbeddedWallet);
  const external = wallets.find(isExternalWallet);
  const smartAddress = user?.smartWallet?.address;
  const walletAddress = smartAddress && validAddress(smartAddress) ? smartAddress : undefined;
  const chainId = parsePrivyChainId(embedded?.chainId);
  const activeSmartWalletClient = chainClient ?? client;
  const runLogin = () => { setActionError(null); setLoginPending(true); login({ loginMethods: [...privyLoginMethods] }); };
  const runConnectExternal = () => {
    setActionError(null);
    connectWallet({
      description: "Connect an external EVM wallet. Zonk.fun keeps it separate from the Privy embedded smart wallet used for create and trade transactions.",
      walletChainType: "ethereum-only",
      walletList: [...privyExternalWalletList],
    });
  };
  const runCreateWallet = async () => { setActionError(null); setCreatePending(true); try { await createWallet(); } catch { setActionError("Wallet creation is unavailable right now."); } finally { setCreatePending(false); } };
  const switchNetwork = async () => { const wallet = mode === "external" ? external : embedded; if (!wallet) return; setActionError(null); setSwitchPending(true); try { await wallet.switchChain(selectedZonkChain.id); if (mode === "embedded") { const nextClient = await getClientForChain({ id: selectedZonkChain.id }); setChainClient(nextClient ?? null); } } catch { if (mode === "embedded") setChainClient(null); setActionError("Network switching is unavailable right now."); } finally { setSwitchPending(false); } };
  const runLogout = async () => { setLoginPending(false); await logoutPrivy(logout, setActionError); };

  const state = derivePrivyWalletState({
    ready,
    authenticated,
    loginPending: loginPending && !authenticated && !error,
    createPending,
    hasEmbeddedWallet: Boolean(embedded),
    hasSmartWalletAddress: Boolean(walletAddress),
    hasSmartWalletClient: Boolean(activeSmartWalletClient),
    chainId,
    error,
  });

  if (!authenticated) return <div className={`flex items-center gap-2 ${compact ? "flex-wrap" : ""}`} aria-live="polite">{(state === "logging_in" || loginPending) && <span className="text-sm text-zinc-400">Privy loading…</span>}{(state === "error" || actionError) && <span className="text-sm text-red-300">Privy is unavailable</span>}<button className={`button-primary ${compact ? "w-full" : ""} ${short ? "min-h-11 px-3 text-sm" : ""}`} disabled={loginPending} onClick={runLogin}>{loginPending ? "Opening Privy…" : short ? "Log in" : "Log in: wallet, email, or social"}</button></div>;

  const activeChainId = mode === "external" ? parsePrivyChainId(external?.chainId) : chainId;

  if (short && !accountOpen) {
    return <div className="flex items-center" aria-label="Privy account controls">
      <button type="button" className="button-secondary min-h-11 max-w-[9.5rem] px-3 text-xs" aria-expanded={false} aria-label="Open account" onClick={() => setAccountOpen(true)}>
        <span className="truncate">{shorten(activeAddress) || "Account"}</span>
      </button>
    </div>;
  }

  const controls = <div className={`flex min-w-0 flex-wrap items-center gap-2 ${compact || short ? "w-full" : "justify-end"}`} aria-label="Privy account controls" aria-live="polite">
    {short && <button type="button" className="button-ghost min-h-11 px-2 text-xs" aria-expanded={true} onClick={() => setAccountOpen(false)}>Close</button>}
    <span className={`min-w-0 text-xs text-white ${compact ? "w-full rounded-lg border border-white/8 bg-white/[0.025] px-3 py-2" : ""}`}><span className="text-zinc-500">Active:</span> {walletModeLabel(mode)} <span className="font-mono text-cyan-200">{shorten(activeAddress)}</span></span>
    {embeddedAddress && <button className={mode === "embedded" ? "button-primary" : "button-secondary"} aria-pressed={mode === "embedded"} onClick={() => selectMode("embedded")}>Embedded {shorten(embeddedAddress)}</button>}
    {externalAddress ? <button className={mode === "external" ? "button-primary" : "button-secondary"} aria-pressed={mode === "external"} onClick={() => selectMode("external")}>External {shorten(externalAddress)}</button> : <button className="button-secondary" onClick={runConnectExternal}>Connect external wallet</button>}
    {actionError && <span className={`${compact ? "w-full" : ""} text-xs text-red-300`}>{actionError}</span>}
    {!ready && <span className="text-sm text-zinc-400">Privy loading…</span>}
    {ready && error && <span className="text-sm text-red-300">Privy is unavailable</span>}
    {ready && !error && activeChainId !== selectedZonkChainId && <><span className="badge-warning">Wrong network</span><button className="button-secondary" disabled={!(mode === "external" ? external : embedded) || switchPending} onClick={() => void switchNetwork()}>{switchPending ? "Switching…" : `Use ${selectedZonkChainName}`}</button></>}
    {ready && !error && (state === "logged_in_without_embedded_wallet" || state === "embedded_wallet_creating") && <button className="button-secondary" disabled={createPending} onClick={() => void runCreateWallet()}>{createPending ? "Creating wallet…" : "Create embedded wallet"}</button>}
    {ready && !error && activeChainId === selectedZonkChainId && <span className="badge-success">{selectedZonkChainName}</span>}
    <button className={compact ? "button-ghost" : "button-secondary"} onClick={() => void runLogout()}>Log out</button>
  </div>;

  if (short) {
    return <div className="relative">
      <button type="button" className="button-secondary min-h-11 max-w-[9.5rem] px-3 text-xs" aria-expanded={true} aria-label="Close account" onClick={() => setAccountOpen(false)}>
        <span className="truncate">{shorten(activeAddress) || "Account"}</span>
      </button>
      <div className="absolute right-0 top-[calc(100%+0.4rem)] z-50 w-[min(calc(100vw-2rem),20rem)] rounded-xl border border-white/10 bg-[#09111a] p-3 shadow-2xl shadow-black/50">
        {controls}
      </div>
    </div>;
  }

  return controls;
}

export function PrivyWalletUnavailable() {
  return <span className="text-xs text-amber-200">Set NEXT_PUBLIC_PRIVY_APP_ID</span>;
}

export function NetworkGuard({ children }: { children: ReactNode }) {
  const { ready, authenticated } = usePrivy();
  const { activeChainId: chainId, mode, activeAddress } = useActiveWallet();
  if (ready && authenticated && !isSelectedZonkChain(chainId)) return <div className="panel border-amber-400/40"><h2 className="text-lg font-semibold text-amber-200">Unsupported network</h2><p className="mt-2 text-sm text-zinc-300">{walletModeLabel(mode)} actions are limited to {selectedZonkChainName}.</p><p className="mt-2 break-all text-xs text-zinc-500">Active wallet: {activeAddress ?? "not connected"}</p></div>;
  return <>{children}</>;
}
