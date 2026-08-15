"use client";

import { useConnectWallet, useCreateWallet, useLogin, usePrivy, useWallets, type BaseConnectedEthereumWallet } from "@privy-io/react-auth";
import { useSmartWallets, type SmartWalletClientType } from "@privy-io/react-auth/smart-wallets";
import { baseSepolia } from "@zonk/contracts-sdk";
import { useState, type ReactNode } from "react";
import { isBaseSepolia, validAddress } from "@/lib/chain";
import { derivePrivyWalletState, isExternalWallet, isPrivyEmbeddedWallet, parsePrivyChainId, privyExternalWalletList, privyLoginMethods } from "@/lib/wallet";
import { useActiveWallet, walletModeLabel } from "@/providers/active-wallet-provider";

const short = (value?: string) => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "";

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
  await embeddedWallet.switchChain(baseSepolia.id);
  return getClientForChain({ id: baseSepolia.id });
}

export function WalletStatus({ compact = false }: { compact?: boolean }) {
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
  const switchNetwork = async () => { const wallet = mode === "external" ? external : embedded; if (!wallet) return; setActionError(null); setSwitchPending(true); try { await wallet.switchChain(baseSepolia.id); if (mode === "embedded") { const nextClient = await getClientForChain({ id: baseSepolia.id }); setChainClient(nextClient ?? null); } } catch { if (mode === "embedded") setChainClient(null); setActionError("Network switching is unavailable right now."); } finally { setSwitchPending(false); } };
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

  if (!authenticated) return <div className={`flex items-center gap-2 ${compact ? "flex-wrap" : ""}`} aria-live="polite">{(state === "logging_in" || loginPending) && <span className="text-sm text-zinc-400">Privy loading…</span>}{(state === "error" || actionError) && <span className="text-sm text-red-300">Privy is unavailable</span>}<button className={`button-primary ${compact ? "w-full" : ""}`} disabled={loginPending} onClick={runLogin}>{loginPending ? "Opening Privy…" : "Log in: wallet, email, or social"}</button></div>;

  const activeChainId = mode === "external" ? parsePrivyChainId(external?.chainId) : chainId;

  return <div className={`flex min-w-0 flex-wrap items-center gap-2 ${compact ? "w-full" : "justify-end"}`} aria-label="Privy account controls" aria-live="polite">
    <span className={`min-w-0 text-xs text-white ${compact ? "w-full rounded-lg border border-white/8 bg-white/[0.025] px-3 py-2" : ""}`}><span className="text-zinc-500">Active:</span> {walletModeLabel(mode)} <span className="font-mono text-cyan-200">{short(activeAddress)}</span></span>
    {embeddedAddress && <button className={mode === "embedded" ? "button-primary" : "button-secondary"} aria-pressed={mode === "embedded"} onClick={() => selectMode("embedded")}>Embedded {short(embeddedAddress)}</button>}
    {externalAddress ? <button className={mode === "external" ? "button-primary" : "button-secondary"} aria-pressed={mode === "external"} onClick={() => selectMode("external")}>External {short(externalAddress)}</button> : <button className="button-secondary" onClick={runConnectExternal}>Connect external wallet</button>}
    {actionError && <span className={`${compact ? "w-full" : ""} text-xs text-red-300`}>{actionError}</span>}
    {!ready && <span className="text-sm text-zinc-400">Privy loading…</span>}
    {ready && error && <span className="text-sm text-red-300">Privy is unavailable</span>}
    {ready && !error && activeChainId !== baseSepolia.id && <><span className="badge-warning">Wrong network</span><button className="button-secondary" disabled={!(mode === "external" ? external : embedded) || switchPending} onClick={() => void switchNetwork()}>{switchPending ? "Switching…" : "Use Base Sepolia"}</button></>}
    {ready && !error && (state === "logged_in_without_embedded_wallet" || state === "embedded_wallet_creating") && <button className="button-secondary" disabled={createPending} onClick={() => void runCreateWallet()}>{createPending ? "Creating wallet…" : "Create embedded wallet"}</button>}
    {ready && !error && activeChainId === baseSepolia.id && <span className="badge-success">Base Sepolia</span>}
    <button className={compact ? "button-ghost" : "button-secondary"} onClick={() => void runLogout()}>Log out</button>
  </div>;
}

export function PrivyWalletUnavailable() {
  return <span className="text-xs text-amber-200">Set NEXT_PUBLIC_PRIVY_APP_ID</span>;
}

export function NetworkGuard({ children }: { children: ReactNode }) {
  const { ready, authenticated } = usePrivy();
  const { activeChainId: chainId, mode, activeAddress } = useActiveWallet();
  if (ready && authenticated && !isBaseSepolia(chainId)) return <div className="panel border-amber-400/40"><h2 className="text-lg font-semibold text-amber-200">Unsupported network</h2><p className="mt-2 text-sm text-zinc-300">{walletModeLabel(mode)} actions are limited to Base Sepolia.</p><p className="mt-2 break-all text-xs text-zinc-500">Active wallet: {activeAddress ?? "not connected"}</p></div>;
  return <>{children}</>;
}
