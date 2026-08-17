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
  const [input, setInput] = useState<CreateTokenInput>({ name: "", symbol: "", description: "", websiteUrl: "", xUrl: "", telegramUrl: "", discordUrl: "", image: null });
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

  return <section className="panel mt-8 max-w-3xl" aria-label="Create token form">
    <div className="mb-6 flex items-start justify-between gap-4 border-b border-white/8 pb-5"><div><h2 className="text-lg font-semibold text-white">{review ? "Review your launch" : "Token details"}</h2><p className="mt-1 text-sm text-zinc-500">{review ? "These metadata details will define the launch." : "Give people enough context to recognize and understand the token."}</p></div><span className="badge-violet">{review ? "Step 2 of 2" : "Step 1 of 2"}</span></div>
    {!authenticated && <p className="status-box status-warning mb-5">Log in with Wallet to create a token.</p>}
    {authenticated && chainId !== 84532 && <p className="status-box status-warning mb-5">Wrong network. Use Base Sepolia (84532).</p>}
    {walletAddress && <div className="mb-5 rounded-xl border border-white/8 bg-black/15 px-3 py-2"><p className="text-xs text-zinc-500">Creator wallet · {walletMode === "external" ? "External" : "Privy embedded"}</p><p className="address mt-1">{walletAddress}</p></div>}
    {errors.network && <p className="status-box status-error mb-4" role="alert">{errors.network}</p>}
    {!review ? <div className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Token name" hint="Up to 64 characters." error={errors.name}><input aria-label="Name" aria-invalid={Boolean(errors.name)} value={input.name} disabled={pending} onChange={(event) => update("name", event.target.value)} maxLength={64} placeholder="e.g. Zonk Community" /></Field>
        <Field label="Symbol" hint="Shown in uppercase, up to 16 characters." error={errors.symbol}><input aria-label="Symbol" aria-invalid={Boolean(errors.symbol)} value={input.symbol} disabled={pending} onChange={(event) => update("symbol", event.target.value.toUpperCase())} maxLength={16} placeholder="e.g. ZONK" /></Field>
      </div>
      <Field label="About (optional)" hint={`${input.description.length}/1000 characters. Explain the idea clearly; this appears on the public token page.`} error={errors.description}><textarea aria-label="About" aria-invalid={Boolean(errors.description)} value={input.description} disabled={pending} onChange={(event) => update("description", event.target.value)} maxLength={1000} placeholder="What is this token and who is it for?" /></Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Website URL (optional)" error={errors.websiteUrl}><input aria-label="Website URL" aria-invalid={Boolean(errors.websiteUrl)} type="url" value={input.websiteUrl} disabled={pending} onChange={(event) => update("websiteUrl", event.target.value)} placeholder="https://example.com" /></Field>
        <Field label="X / Twitter URL (optional)" error={errors.xUrl}><input aria-label="X / Twitter URL" aria-invalid={Boolean(errors.xUrl)} type="url" value={input.xUrl} disabled={pending} onChange={(event) => update("xUrl", event.target.value)} placeholder="https://x.com/project" /></Field>
        <Field label="Telegram URL (optional)" error={errors.telegramUrl}><input aria-label="Telegram URL" aria-invalid={Boolean(errors.telegramUrl)} type="url" value={input.telegramUrl} disabled={pending} onChange={(event) => update("telegramUrl", event.target.value)} placeholder="https://t.me/project" /></Field>
        <Field label="Discord URL (optional)" error={errors.discordUrl}><input aria-label="Discord URL" aria-invalid={Boolean(errors.discordUrl)} type="url" value={input.discordUrl} disabled={pending} onChange={(event) => update("discordUrl", event.target.value)} placeholder="https://discord.gg/invite" /></Field>
      </div>
      <Field label="Token image" hint="PNG, JPEG, WebP, or GIF. This becomes the public token identity." error={errors.image}><input aria-label="Image" aria-invalid={Boolean(errors.image)} type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={pending} onChange={(event) => update("image", event.target.files?.[0] ?? null)} /></Field>
      {preview && <div className="flex items-center gap-4 rounded-xl border border-white/8 bg-black/15 p-3"><div role="img" aria-label="Token image preview" className="h-20 w-20 flex-none rounded-xl border border-white/10 bg-cover bg-center" style={{ backgroundImage: `url(${preview})` }} /><div><p className="text-sm font-medium text-white">Image preview</p><p className="mt-1 break-all text-xs text-zinc-500">{input.image?.name}</p></div></div>}
      <button className="button-primary w-full sm:w-fit" type="button" disabled={pending} onClick={openReview}>Review metadata</button>
    </div> : <div className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-[8rem_minmax(0,1fr)]">{preview && <div role="img" aria-label="Token image preview" className="aspect-square w-full max-w-32 rounded-2xl border border-white/10 bg-cover bg-center" style={{ backgroundImage: `url(${preview})` }} />}<dl className="grid min-w-0 gap-3 text-sm"><Summary label="Name" value={input.name} /><Summary label="Symbol" value={input.symbol} /><Summary label="About" value={input.description || "Not provided"} /><Summary label="Website" value={input.websiteUrl || "Not provided"} /><Summary label="X / Twitter" value={input.xUrl || "Not provided"} /><Summary label="Community" value={[input.telegramUrl, input.discordUrl].filter(Boolean).join(" · ") || "Not provided"} /></dl></div>
      <p className="text-sm leading-6 text-zinc-400">Submitting uploads the metadata draft, asks your active wallet to create the token, then waits for confirmation and indexing. Only Base Sepolia network gas is required for the nonpayable factory transaction.</p>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button className="button-secondary" disabled={pending} onClick={() => setReview(false)}>Edit</button><button className="button-primary" disabled={pending || !canCreateToken(chainId, authenticated, pending)} onClick={() => void submit()}>{pending ? "Creation pending…" : "Confirm factory transaction"}</button></div>
    </div>}
    {tx.status !== "idle" && <div className={`status-box mt-6 ${tx.status === "confirmed" ? "status-success" : tx.status === "failed" || tx.status === "rejected" ? "status-error" : ""}`} aria-live="polite" role="status"><div className="flex items-start gap-3"><span className={`mt-0.5 h-2.5 w-2.5 flex-none rounded-full ${pending ? "animate-pulse bg-cyan-300" : tx.status === "confirmed" ? "bg-emerald-300" : "bg-rose-300"}`} /><div className="min-w-0"><p className="font-medium">{statusLabel(tx.status, walletMode)}</p>{tx.hash && <a className="mt-2 block break-all text-cyan-300" href={`https://sepolia.basescan.org/tx/${tx.hash}`} target="_blank" rel="noreferrer">View transaction on BaseScan ↗</a>}{tx.error && <p className="mt-2 text-red-200">{tx.error}</p>}</div></div></div>}
    {result && <div className="status-box status-success mt-5">Token confirmed and indexed. <Link className="font-semibold underline" href={`/token/${result.tokenAddress}`}>Open token</Link></div>}
  </section>;
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) { return <label className="grid gap-2 text-sm text-zinc-300"><span className="font-medium text-zinc-200">{label}</span>{children}<span className={error ? "text-red-300" : "text-xs leading-5 text-zinc-500"} role={error ? "alert" : undefined}>{error || hint}</span></label>; }
function Summary({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><dt className="text-xs text-zinc-500">{label}</dt><dd className="mt-1 break-words font-medium text-zinc-100">{value}</dd></div>; }
function statusLabel(status: TransactionState["status"], walletMode: ActiveWalletMode) { return ({ preparing: "Validating metadata and simulating transaction…", awaiting_wallet: walletMode === "external" ? "Confirm the transaction in your external wallet…" : "Confirm the transaction in Privy…", submitted: "Transaction submitted.", confirming: "Waiting for Base Sepolia confirmation and indexing…", confirmed: "Token creation confirmed.", failed: "Token creation failed.", rejected: "Transaction rejected.", idle: "" })[status]; }
