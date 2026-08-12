"use client";

import { useExportWallet, usePrivy, useWallets, type BaseConnectedEthereumWallet } from "@privy-io/react-auth";
import { useState } from "react";

export function findEmbeddedEvmWallet(wallets: readonly BaseConnectedEthereumWallet[]) {
  return wallets.find((wallet) => wallet.type === "ethereum" && wallet.walletClientType === "privy" && wallet.connectorType === "embedded" && !wallet.imported);
}

export function EmbeddedWalletExport({ smartWalletAddress }: { smartWalletAddress?: string }) {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { exportWallet } = useExportWallet();
  const [confirming, setConfirming] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const embeddedWallet = findEmbeddedEvmWallet(wallets);

  if (!authenticated) return null;

  const closeConfirmation = () => {
    if (pending) return;
    setConfirming(false);
    setAcknowledged(false);
    setMessage(null);
  };

  const beginExport = () => {
    setMessage(null);
    setAcknowledged(false);
    setConfirming(true);
  };

  const confirmExport = async () => {
    if (!embeddedWallet || !acknowledged || pending) return;
    setPending(true);
    setMessage(null);
    try {
      await exportWallet({ address: embeddedWallet.address });
      setMessage("Privy’s secure export flow was closed.");
    } catch {
      setMessage("Privy could not start the wallet export. No key was exposed to this app.");
    } finally {
      setPending(false);
      setConfirming(false);
      setAcknowledged(false);
    }
  };

  return <section className="panel mt-10 max-w-2xl" aria-labelledby="embedded-wallet-export-title">
    <h2 id="embedded-wallet-export-title" className="text-xl font-semibold text-white">Export Embedded Wallet</h2>
    <p className="mt-3 text-sm text-zinc-300">The Embedded Wallet is your Privy-managed EOA signer. The Smart Wallet is a contract account and does not have its own exportable private key.</p>
    <dl className="mt-5 grid gap-3 text-sm">
      <div><dt className="text-zinc-500">Embedded Wallet / EOA address</dt><dd className="mt-1 break-all text-zinc-200">{embeddedWallet?.address ?? "Unavailable"}</dd></div>
      <div><dt className="text-zinc-500">Smart Wallet address used for indexed activity</dt><dd className="mt-1 break-all text-zinc-200">{smartWalletAddress ?? "Unavailable"}</dd></div>
    </dl>
    <p className="mt-5 text-sm text-amber-200">Exporting the Embedded Wallet key gives full control of that account and any assets it holds. Never share it or paste it into an untrusted site. Smart Wallet assets remain controlled through the Smart Wallet contract and are not exported by this action.</p>
    {!embeddedWallet && <p className="mt-4 text-sm text-zinc-400">An exportable Privy Embedded Wallet is not available. Smart Wallet-only accounts cannot export a Smart Wallet key.</p>}
    {embeddedWallet && !confirming && <button className="button-secondary mt-5" type="button" onClick={beginExport}>Export Embedded Wallet</button>}
    {message && <p className="mt-4 text-sm text-zinc-300" role="status">{message}</p>}
    {confirming && embeddedWallet && <div className="mt-5 rounded-xl border border-red-400/40 bg-red-950/20 p-4" role="alertdialog" aria-labelledby="export-warning-title" aria-describedby="export-warning-description">
      <h3 id="export-warning-title" className="font-semibold text-red-200">Confirm sensitive wallet export</h3>
      <p id="export-warning-description" className="mt-2 text-sm text-zinc-200">Privy will open its secure export modal for the Embedded Wallet signer. Anyone who obtains the exported key can control every asset held by this EOA.</p>
      <label className="mt-4 flex gap-3 text-sm text-zinc-200"><input type="checkbox" checked={acknowledged} disabled={pending} onChange={(event) => setAcknowledged(event.target.checked)} />I understand that the exported key gives full control of the Embedded Wallet.</label>
      <div className="mt-4 flex gap-3"><button className="button-secondary" type="button" disabled={pending} onClick={closeConfirmation}>Cancel</button><button className="button-primary" type="button" disabled={!acknowledged || pending} onClick={() => void confirmExport()}>{pending ? "Opening secure export…" : "Continue to Privy export"}</button></div>
    </div>}
  </section>;
}
