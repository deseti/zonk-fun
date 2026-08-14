"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Address, Hash } from "viem";
import { canCreateToken, idleTransaction, validateCreateToken, type CreateTokenInput, type TransactionState } from "@/lib/transactions";
import type { ActiveWalletMode } from "@/providers/active-wallet-provider";

export type CreateResult = { tokenAddress: Address; hash: Hash };
export type CreateExecution = (input: CreateTokenInput, report: (state: TransactionState) => void) => Promise<CreateResult>;
type Props = { authenticated: boolean; chainId: number | undefined; walletAddress: Address | undefined; walletMode?: ActiveWalletMode; execute: CreateExecution; onSuccess: (address: Address) => void };

export function CreateTokenForm({ authenticated, chainId, walletAddress, walletMode = "embedded", execute, onSuccess }: Props) {
  const [input, setInput] = useState<CreateTokenInput>({ name: "", symbol: "", description: "", image: null });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState(false);
  const [tx, setTx] = useState<TransactionState>(idleTransaction);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [preview, setPreview] = useState("");
  const submissionRef = useRef(false);
  const pending = ["preparing", "awaiting_wallet", "submitted", "confirming"].includes(tx.status);

  useEffect(() => {
    if (!input.image) return;
    const reader = new FileReader();
    reader.onload = () => setPreview(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(input.image);
    return () => reader.abort();
  }, [input.image]);

  const update = (key: keyof CreateTokenInput, value: string | File | null) => {
    setInput((current) => ({ ...current, [key]: value }));
    if (key === "image" && !value) setPreview("");
    setErrors((current) => ({ ...current, [key]: "" }));
  };
  const openReview = () => { const next = validateCreateToken(input); setErrors(next); if (Object.keys(next).length === 0) setReview(true); };
  const submit = async () => {
    if (submissionRef.current) return;
    const next = validateCreateToken(input);
    if (Object.keys(next).length) { setErrors(next); setReview(false); return; }
    if (!canCreateToken(chainId, authenticated, false)) { setErrors({ network: `Connect the ${walletMode} wallet on Base Sepolia before submitting.` }); return; }
    submissionRef.current = true;
    setErrors({});
    setResult(null);
    try {
      const created = await execute(input, setTx);
      setResult(created);
      setTx({ status: "confirmed", hash: created.hash });
      onSuccess(created.tokenAddress);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Token creation failed.";
      setTx((current) => ({ status: /reject|denied/i.test(message) ? "rejected" : "failed", hash: current.hash, error: message }));
    } finally { submissionRef.current = false; }
  };

  return <section className="panel mt-8 max-w-2xl" aria-label="Create token form">
    {!authenticated && <p className="text-sm text-amber-200">Log in with Privy to create a token.</p>}
    {authenticated && chainId !== 84532 && <p className="text-sm text-amber-200">Wrong network. Use Base Sepolia (84532).</p>}
    {walletAddress && <p className="mb-4 break-all text-xs text-zinc-500">Creator: {walletAddress}</p>}
    {errors.network && <p className="mb-3 text-sm text-red-300">{errors.network}</p>}
    {!review ? <div className="grid gap-4">
      <Field label="Name" error={errors.name}><input aria-label="Name" value={input.name} disabled={pending} onChange={(event) => update("name", event.target.value)} maxLength={64} /></Field>
      <Field label="Symbol" error={errors.symbol}><input aria-label="Symbol" value={input.symbol} disabled={pending} onChange={(event) => update("symbol", event.target.value.toUpperCase())} maxLength={16} /></Field>
      <Field label="Description" error={errors.description}><textarea aria-label="Description" value={input.description} disabled={pending} onChange={(event) => update("description", event.target.value)} maxLength={1000} /></Field>
      <p className="text-sm text-zinc-400">Fixed supply: 1,000,000,000 tokens · creator allocation: 0 · full inventory assigned atomically to the curve.</p>
      <Field label="Image" error={errors.image}><input aria-label="Image" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={pending} onChange={(event) => update("image", event.target.files?.[0] ?? null)} /></Field>
      {preview && <div role="img" aria-label="Token image preview" className="h-40 w-40 rounded-xl bg-cover bg-center" style={{ backgroundImage: `url(${preview})` }} />}
      <button className="button-primary w-fit" type="button" disabled={pending} onClick={openReview}>Review metadata</button>
    </div> : <div className="grid gap-3">
      <h2 className="text-xl font-semibold text-white">Review metadata</h2>
      {preview && <div role="img" aria-label="Token image preview" className="h-40 w-40 rounded-xl bg-cover bg-center" style={{ backgroundImage: `url(${preview})` }} />}
      <dl className="grid gap-2 text-sm"><div><dt className="text-zinc-500">Name</dt><dd>{input.name}</dd></div><div><dt className="text-zinc-500">Symbol</dt><dd>{input.symbol}</dd></div><div><dt className="text-zinc-500">Description</dt><dd>{input.description}</dd></div><div><dt className="text-zinc-500">Fixed supply</dt><dd>1,000,000,000</dd></div><div><dt className="text-zinc-500">Creator allocation</dt><dd>0</dd></div></dl>
      <div className="flex gap-3"><button className="button-secondary" disabled={pending} onClick={() => setReview(false)}>Edit</button><button className="button-primary" disabled={pending || !canCreateToken(chainId, authenticated, pending)} onClick={() => void submit()}>{pending ? "Creation pending…" : "Submit factory transaction"}</button></div>
    </div>}
    {tx.status !== "idle" && <div className="mt-5 text-sm" aria-live="polite"><p>{statusLabel(tx.status, walletMode)}</p>{tx.hash && <a className="text-cyan-300" href={`https://sepolia.basescan.org/tx/${tx.hash}`} target="_blank" rel="noreferrer">Transaction {tx.hash}</a>}{tx.error && <p className="mt-2 text-red-300">{tx.error}</p>}</div>}
    {result && <div className="mt-5 text-sm text-emerald-300">Token confirmed and indexed. <Link href={`/token/${result.tokenAddress}`}>Open token</Link></div>}
  </section>;
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) { return <label className="grid gap-1 text-sm text-zinc-300"><span>{label}</span>{children}{error && <span className="text-red-300">{error}</span>}</label>; }
function statusLabel(status: TransactionState["status"], walletMode: ActiveWalletMode) { return ({ preparing: "Validating metadata and simulating transaction…", awaiting_wallet: walletMode === "external" ? "Confirm the transaction in your external wallet…" : "Confirm the transaction in Privy…", submitted: "Transaction submitted.", confirming: "Waiting for Base Sepolia confirmation and indexing…", confirmed: "Token creation confirmed.", failed: "Token creation failed.", rejected: "Transaction rejected.", idle: "" })[status]; }
