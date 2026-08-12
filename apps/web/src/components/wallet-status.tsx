"use client";

import { useCreateWallet, useLogin, usePrivy, useWallets, type BaseConnectedEthereumWallet } from "@privy-io/react-auth";
import { useSmartWallets, type SmartWalletClientType } from "@privy-io/react-auth/smart-wallets";
import { baseSepolia } from "@zonk/contracts-sdk";
import { useState, type ReactNode } from "react";
import { isBaseSepolia, validAddress } from "@/lib/chain";
import { derivePrivyWalletState, parsePrivyChainId, privyLoginMethods } from "@/lib/wallet";

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

export function WalletStatus() {
  const { ready, authenticated, user, logout, error } = usePrivy();
  const { wallets } = useWallets();
  const { client, getClientForChain } = useSmartWallets();
  const { createWallet } = useCreateWallet();
  const [loginPending, setLoginPending] = useState(false);
  const [createPending, setCreatePending] = useState(false);
  const [switchPending, setSwitchPending] = useState(false);
  const [chainClient, setChainClient] = useState<SmartWalletClientType | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { login } = useLogin({
    onComplete: () => setLoginPending(false),
    onError: () => setLoginPending(false),
  });
  const embedded = wallets.find((wallet) => wallet.walletClientType === "privy");
  const smartAddress = user?.smartWallet?.address;
  const walletAddress = smartAddress && validAddress(smartAddress) ? smartAddress : undefined;
  const accountAddress = walletAddress ?? (embedded?.address && validAddress(embedded.address) ? embedded.address : undefined);
  const chainId = parsePrivyChainId(embedded?.chainId);
  const activeSmartWalletClient = chainClient ?? client;
  const runLogin = () => { setActionError(null); setLoginPending(true); login({ loginMethods: [...privyLoginMethods] }); };
  const runCreateWallet = async () => { setActionError(null); setCreatePending(true); try { await createWallet(); } catch { setActionError("Wallet creation is unavailable right now."); } finally { setCreatePending(false); } };
  const switchNetwork = async () => { if (!embedded) return; setActionError(null); setSwitchPending(true); try { const nextClient = await switchPrivyEmbeddedWallet(embedded, getClientForChain); setChainClient(nextClient ?? null); } catch { setChainClient(null); setActionError("Network switching is unavailable right now."); } finally { setSwitchPending(false); } };
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

  if (!authenticated) return <div className="flex items-center gap-2">{(state === "logging_in" || loginPending) && <span className="text-sm text-zinc-400">Privy loading…</span>}{(state === "error" || actionError) && <span className="text-sm text-red-300">Privy is unavailable</span>}<button className="button-primary" onClick={runLogin}>Log in with Privy</button></div>;

  return <div className="flex items-center gap-2" aria-label="Privy account controls">
    <span className="text-xs text-zinc-400">{short(accountAddress) || short(user?.id) || "Privy account"}</span>
    {actionError && <span className="text-xs text-red-300">{actionError}</span>}
    {!ready && <span className="text-sm text-zinc-400">Privy loading…</span>}
    {ready && error && <span className="text-sm text-red-300">Privy is unavailable</span>}
    {ready && !error && state === "wrong_network" && <><span className="badge-warning">Wrong network</span><button className="button-secondary" disabled={!embedded || switchPending} onClick={() => void switchNetwork()}>{switchPending ? "Switching…" : "Use Base Sepolia"}</button></>}
    {ready && !error && (state === "logged_in_without_embedded_wallet" || state === "embedded_wallet_creating") && <button className="button-secondary" disabled={createPending} onClick={() => void runCreateWallet()}>{createPending ? "Creating wallet…" : "Create embedded wallet"}</button>}
    {ready && !error && state === "smart_wallet_ready" && <span className="badge-success">Base Sepolia</span>}
    <button className="button-secondary" onClick={() => void runLogout()}>Log out</button>
  </div>;
}

export function PrivyWalletUnavailable() {
  return <span className="text-xs text-amber-200">Set NEXT_PUBLIC_PRIVY_APP_ID</span>;
}

export function NetworkGuard({ children }: { children: ReactNode }) {
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const embedded = wallets.find((wallet) => wallet.walletClientType === "privy");
  const chainId = parsePrivyChainId(embedded?.chainId);
  if (ready && authenticated && !isBaseSepolia(chainId)) return <div className="panel border-amber-400/40"><h2 className="text-lg font-semibold text-amber-200">Unsupported network</h2><p className="mt-2 text-sm text-zinc-300">Privy smart-wallet actions are limited to Base Sepolia.</p><p className="mt-2 break-all text-xs text-zinc-500">Smart wallet: {user?.smartWallet?.address ?? "not ready"}</p></div>;
  return <>{children}</>;
}
