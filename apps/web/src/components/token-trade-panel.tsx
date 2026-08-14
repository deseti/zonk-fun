"use client";

import { useEffect, useRef, useState } from "react";
import { formatEther, formatUnits, parseEther, parseUnits, type Address, type Hash } from "viem";
import type { BudgetBuyQuote, CurveTradeState, ProtectedSellQuote, TradeConfirmation } from "@/lib/contracts";
import {
  clearPendingTrade,
  persistPendingTrade,
  readPendingTrade,
  type TradeSide,
  type TradeRecovery,
  type TradeTransactionStatus,
} from "@/lib/transactions";

type Quote = ({ side: "buy" } & BudgetBuyQuote) | ({ side: "sell" } & ProtectedSellQuote);
type QuoteRecord = {
  quote: Quote;
  createdAt: number;
  identity: string;
  stateFingerprint: string;
  chainId?: number;
};
type Report = (status: TradeTransactionStatus, hash?: Hash, recovery?: TradeRecovery) => void;

export type TradeExecution = (quote: Quote, report: Report, assertSubmissionReady: () => void) => Promise<TradeConfirmation>;
export type TradeResume = (side: TradeSide, hash: Hash, recovery: TradeRecovery | undefined, report: Report) => Promise<TradeConfirmation>;
export type TradeCheck = (side: TradeSide, hash: Hash, recovery?: TradeRecovery) => Promise<TradeConfirmation>;

type Props = {
  authenticated: boolean;
  walletMode: "embedded" | "external";
  chainId?: number;
  walletAddress?: Address;
  tokenAddress: Address;
  symbol: string;
  state?: CurveTradeState;
  statePending: boolean;
  stateError?: string;
  quoteBuy: (budget: bigint, slippageBps: number) => Promise<BudgetBuyQuote>;
  quoteSell: (tokenAmount: bigint, slippageBps: number) => Promise<ProtectedSellQuote>;
  execute: TradeExecution;
  resume: TradeResume;
  check: TradeCheck;
  onConfirmed: () => void;
};

const QUOTE_TTL_MS = 60_000;
const blockingStatuses: TradeTransactionStatus[] = ["preparing", "awaiting_approval", "approval_confirming", "awaiting_wallet", "submitted", "confirming", "confirmation_unknown"];

export function TokenTradePanel(props: Props) {
  const [initialRecovery] = useState(() => props.walletAddress ? readPendingTrade(props.tokenAddress, props.walletAddress) : null);
  const [side, setSide] = useState<TradeSide>(initialRecovery?.side ?? "buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("1.00");
  const [quoteRecord, setQuoteRecord] = useState<QuoteRecord | null>(null);
  const [quoteStale, setQuoteStale] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [status, setStatus] = useState<TradeTransactionStatus>(initialRecovery ? "confirmation_unknown" : "idle");
  const [hash, setHash] = useState<Hash | undefined>(initialRecovery?.hash);
  const recoveryRef = useRef<TradeRecovery | undefined>(initialRecovery?.recovery);
  const [error, setError] = useState(initialRecovery ? "A submitted transaction still needs a definitive receipt before another trade is allowed." : "");
  const operationRef = useRef(false);
  const walletInteractionRef = useRef(false);
  const approvalHashRef = useRef<Hash | undefined>(undefined);
  const submittedHashRef = useRef<Hash | undefined>(initialRecovery?.hash);
  const submittedAtRef = useRef<number | undefined>(initialRecovery?.submittedAt);
  const generationRef = useRef(0);
  const identity = tradeIdentity(props.tokenAddress, props.walletAddress);
  const stateFingerprint = tradeStateFingerprint(props.state, side);
  const latestRef = useRef({ identity, chainId: props.chainId, stateFingerprint });
  useEffect(() => {
    latestRef.current = { identity, chainId: props.chainId, stateFingerprint };
  }, [identity, props.chainId, stateFingerprint]);
  const quoteStateChanged = Boolean(quoteRecord && quoteRecord.stateFingerprint !== stateFingerprint);
  const quote = quoteStateChanged ? null : quoteRecord?.quote ?? null;
  const locked = blockingStatuses.includes(status);
  const canBuy = props.state?.lifecycle === 0;
  const canSell = props.state?.lifecycle === 0 || props.state?.lifecycle === 1;
  const sideAllowed = side === "buy" ? canBuy : canSell;

  useEffect(() => {
    if (!quoteRecord) return;
    const remaining = QUOTE_TTL_MS - (Date.now() - quoteRecord.createdAt);
    if (remaining <= 0) {
      const timeout = window.setTimeout(() => setQuoteStale(true), 0);
      return () => window.clearTimeout(timeout);
    }
    const timeout = window.setTimeout(() => setQuoteStale(true), remaining);
    return () => window.clearTimeout(timeout);
  }, [quoteRecord]);

  const persist = (tradeSide: TradeSide, nextHash: Hash, nextStatus: "submitted" | "confirming" | "confirmation_unknown", wallet: Address, token: Address, nextRecovery: TradeRecovery | undefined = recoveryRef.current) => {
    const submittedAt = submittedAtRef.current ?? Date.now();
    submittedAtRef.current = submittedAt;
    persistPendingTrade({ version: 1, walletAddress: wallet, tokenAddress: token, side: tradeSide, hash: nextHash, status: nextStatus, submittedAt, recovery: nextRecovery });
  };

  const persistHashlessUnknown = (tradeSide: TradeSide, wallet: Address, token: Address) => {
    const submittedAt = submittedAtRef.current ?? Date.now();
    submittedAtRef.current = submittedAt;
    persistPendingTrade({ version: 1, walletAddress: wallet, tokenAddress: token, side: tradeSide, status: "confirmation_unknown", submittedAt });
  };

  const applyResolution = (resolution: TradeConfirmation, tradeSide: TradeSide, wallet: Address, token: Address, operationIdentity: string) => {
    if (latestRef.current.identity !== operationIdentity) return;
    setHash(resolution.hash);
    if (resolution.status === "pending") {
      submittedHashRef.current = resolution.hash;
      recoveryRef.current = resolution.recovery;
      persist(tradeSide, resolution.hash, "confirmation_unknown", wallet, token, resolution.recovery);
      setStatus("confirmation_unknown");
      setError("No final receipt is available yet. New submissions remain blocked.");
      return;
    }
    clearPendingTrade(token, wallet);
    submittedHashRef.current = undefined;
    submittedAtRef.current = undefined;
    recoveryRef.current = undefined;
    setQuoteRecord(null);
    setQuoteStale(false);
    if (resolution.status === "confirmed") {
      setStatus("confirmed");
      setError("");
      props.onConfirmed();
    } else if (resolution.status === "reverted") {
      setStatus("reverted");
      setError("The transaction reverted on Base Sepolia. No trade was applied.");
    } else {
      setStatus("replaced");
      setError(`The original transaction was ${resolution.replacementReason ?? "replaced"}. Review the replacement before trading again.`);
    }
  };

  const getQuote = async () => {
    setError("");
    setQuoteRecord(null);
    setQuoteStale(false);
    let slippageBps: number;
    try {
      slippageBps = parseSlippageBps(slippage);
    } catch (reason) {
      setError(safeMessage(reason));
      return;
    }
    if (!sideAllowed) {
      setError(side === "buy" && props.state?.lifecycle === 1 ? "New buys are paused while graduation is pending. Selling remains available." : "This trade is unavailable for the current curve lifecycle.");
      return;
    }
    const requestedIdentity = identity;
    const requestedState = stateFingerprint;
    const requestedChain = props.chainId;
    setQuoteLoading(true);
    try {
      const next = side === "buy"
        ? { side, ...await props.quoteBuy(parsePositiveAmount(amount, 18, "ETH"), slippageBps) } as Quote
        : { side, ...await props.quoteSell(parsePositiveAmount(amount, props.state?.decimals ?? 18, props.symbol), slippageBps) } as Quote;
      if (latestRef.current.identity !== requestedIdentity || latestRef.current.stateFingerprint !== requestedState || latestRef.current.chainId !== requestedChain || requestedChain !== 84532) {
        throw new Error("Wallet, network, token, or curve state changed while quoting. Request a fresh quote.");
      }
      setQuoteRecord({ quote: next, createdAt: Date.now(), identity: requestedIdentity, stateFingerprint: requestedState, chainId: requestedChain });
    } catch (reason) {
      setStatus("failed");
      setError(safeMessage(reason));
    } finally {
      setQuoteLoading(false);
    }
  };

  const submit = async () => {
    if (operationRef.current || locked || !quoteRecord) return;
    const currentQuote = quoteRecord.quote;
    setError("");
    if (!props.authenticated || !props.walletAddress) {
      setStatus("failed");
      setError(props.walletMode === "external" ? "Connect and select an external wallet before trading." : "Log in with Privy and wait for the smart wallet before trading.");
      return;
    }
    if (props.chainId !== 84532) {
      setStatus("failed");
      setError(`Switch the ${props.walletMode} wallet to Base Sepolia before trading.`);
      return;
    }
    const existingRecovery = readPendingTrade(props.tokenAddress, props.walletAddress);
    if (existingRecovery) {
      setSide(existingRecovery.side);
      setHash(existingRecovery.hash);
      submittedHashRef.current = existingRecovery.hash;
      submittedAtRef.current = existingRecovery.submittedAt;
      setStatus("confirmation_unknown");
      setError("Another tab or prior session has an unresolved transaction for this wallet and token. New trades remain blocked.");
      return;
    }
    if (quoteStale || Date.now() - quoteRecord.createdAt >= QUOTE_TTL_MS) {
      setStatus("failed");
      setQuoteRecord(null);
      setQuoteStale(true);
      setError("This quote expired. Request a fresh quote before submitting.");
      return;
    }
    if (quoteRecord.identity !== identity || quoteRecord.stateFingerprint !== stateFingerprint || quoteRecord.chainId !== props.chainId || !sideAllowed) {
      setStatus("failed");
      setQuoteRecord(null);
      setError("Wallet, token, network, or curve state changed. Request a fresh quote.");
      return;
    }
    if (currentQuote.side === "buy" && props.state && currentQuote.maxReserveIn > props.state.nativeBalance) {
      setStatus("failed");
      setError("Insufficient ETH balance for the maximum input.");
      return;
    }
    if (currentQuote.side === "sell" && props.state && currentQuote.tokenAmount > props.state.tokenBalance) {
      setStatus("failed");
      setError(`Insufficient ${props.symbol} balance.`);
      return;
    }
    const wallet = props.walletAddress;
    const token = props.tokenAddress;
    const tradeSide = currentQuote.side;
    const operationIdentity = identity;
    const generation = generationRef.current;
    operationRef.current = true;
    walletInteractionRef.current = false;
    approvalHashRef.current = undefined;
    setStatus("preparing");
    persistHashlessUnknown(tradeSide, wallet, token);
    const report: Report = (nextStatus, nextHash, nextRecovery) => {
      if (nextStatus === "awaiting_wallet" || nextStatus === "awaiting_approval") walletInteractionRef.current = true;
      if (nextStatus === "approval_confirming" && nextHash) approvalHashRef.current = nextHash;
      if (nextStatus === "preparing" && approvalHashRef.current) {
        approvalHashRef.current = undefined;
        if (latestRef.current.identity === operationIdentity && generationRef.current === generation) setHash(undefined);
      }
      if (nextStatus === "awaiting_wallet" && approvalHashRef.current) approvalHashRef.current = undefined;
      if (nextRecovery) {
        recoveryRef.current = nextRecovery;
      }
      if (nextHash && (nextStatus === "submitted" || nextStatus === "confirming" || nextStatus === "confirmation_unknown")) {
        submittedHashRef.current = nextHash;
        const persistedStatus = nextStatus === "submitted" ? "submitted" : nextStatus === "confirmation_unknown" ? "confirmation_unknown" : "confirming";
        persist(tradeSide, nextHash, persistedStatus, wallet, token, nextRecovery);
      }
      if (latestRef.current.identity === operationIdentity && generationRef.current === generation) {
        setStatus(nextStatus);
        if (nextHash) setHash(nextHash);
      }
    };
    const assertSubmissionReady = () => {
      if (Date.now() - quoteRecord.createdAt >= QUOTE_TTL_MS || BigInt(Math.floor(Date.now() / 1000)) >= currentQuote.deadline) {
        throw new Error("This quote expired during wallet approval. Request a fresh quote before submitting.");
      }
      if (latestRef.current.identity !== operationIdentity || latestRef.current.chainId !== 84532 || latestRef.current.stateFingerprint !== quoteRecord.stateFingerprint) {
        throw new Error("Wallet, token, network, or curve state changed before submission. Request a fresh quote.");
      }
    };
    try {
      const resolution = await props.execute(currentQuote, report, assertSubmissionReady);
      applyResolution(resolution, tradeSide, wallet, token, operationIdentity);
    } catch (reason) {
      if (latestRef.current.identity !== operationIdentity || generationRef.current !== generation) return;
      const submittedHash = submittedHashRef.current;
      if (submittedHash) {
        persist(tradeSide, submittedHash, "confirmation_unknown", wallet, token);
        setHash(submittedHash);
        setStatus("confirmation_unknown");
        setError("Confirmation is uncertain. Check again or resume confirmation before making another trade.");
      } else if (approvalHashRef.current && !isDefinitivePreSubmissionFailure(reason)) {
        persistHashlessUnknown(tradeSide, wallet, token);
        setHash(approvalHashRef.current);
        setStatus("confirmation_unknown");
        setError("The external token approval receipt is uncertain. New trades remain blocked; inspect the approval transaction before explicitly abandoning recovery.");
      } else if (walletInteractionRef.current && !isDefinitivePreSubmissionFailure(reason)) {
        persistHashlessUnknown(tradeSide, wallet, token);
        setStatus("confirmation_unknown");
        setError("The wallet result is uncertain and no transaction hash was returned. New trades remain blocked; inspect your wallet activity before explicitly abandoning recovery.");
      } else {
        clearPendingTrade(token, wallet);
        submittedAtRef.current = undefined;
        setStatus("failed");
        setError(safeMessage(reason));
      }
    } finally {
      if (latestRef.current.identity === operationIdentity && generationRef.current === generation) operationRef.current = false;
    }
  };

  const recover = async (mode: "check" | "resume") => {
    if (operationRef.current || !props.walletAddress || !hash) return;
    const wallet = props.walletAddress;
    const token = props.tokenAddress;
    const tradeSide = side;
    const operationIdentity = identity;
    const generation = generationRef.current;
    operationRef.current = true;
    setStatus("confirming");
    setError("");
    persist(tradeSide, hash, "confirming", wallet, token);
    const report: Report = (nextStatus, nextHash, nextRecovery) => {
      const currentHash = nextHash ?? hash;
      if (nextRecovery) {
        recoveryRef.current = nextRecovery;
      }
      if (nextStatus === "submitted" || nextStatus === "confirming" || nextStatus === "confirmation_unknown") {
        persist(tradeSide, currentHash, nextStatus === "submitted" ? "submitted" : nextStatus === "confirming" ? "confirming" : "confirmation_unknown", wallet, token, nextRecovery);
      }
      if (latestRef.current.identity === operationIdentity && generationRef.current === generation) {
        setStatus(nextStatus);
        if (nextHash) setHash(nextHash);
      }
    };
    try {
      const resolution = mode === "check" ? await props.check(tradeSide, hash, recoveryRef.current) : await props.resume(tradeSide, hash, recoveryRef.current, report);
      applyResolution(resolution, tradeSide, wallet, token, operationIdentity);
    } catch {
      if (latestRef.current.identity !== operationIdentity || generationRef.current !== generation) return;
      persist(tradeSide, hash, "confirmation_unknown", wallet, token);
      setStatus("confirmation_unknown");
      setError("Confirmation remains uncertain. New submissions are still blocked.");
    } finally {
      if (latestRef.current.identity === operationIdentity && generationRef.current === generation) operationRef.current = false;
    }
  };

  const abandon = () => {
    if (!props.walletAddress || !window.confirm("This transaction may still confirm. Abandoning recovery can cause a duplicate trade or additional loss if you submit again. Abandon anyway?")) return;
    clearPendingTrade(props.tokenAddress, props.walletAddress);
    operationRef.current = false;
    walletInteractionRef.current = false;
    approvalHashRef.current = undefined;
    submittedHashRef.current = undefined;
    submittedAtRef.current = undefined;
    recoveryRef.current = undefined;
    setStatus("idle");
    setHash(undefined);
    setError("");
    setQuoteRecord(null);
  };

  const changeAmount = (value: string) => { setAmount(value); setQuoteRecord(null); setQuoteStale(false); setError(""); };
  const changeSlippage = (value: string) => { setSlippage(value); setQuoteRecord(null); setQuoteStale(false); setError(""); };
  const changeSide = (value: TradeSide) => { if (locked) return; setSide(value); setQuoteRecord(null); setQuoteStale(false); setError(""); setStatus("idle"); setHash(undefined); };

  const unavailable = Boolean(props.walletAddress) && !props.statePending && !props.stateError && (!props.state || !sideAllowed);
  const controlsUnavailable = unavailable || props.statePending || Boolean(props.stateError) || locked;
  const guard = !props.authenticated
    ? "Log in with Privy to trade."
    : !props.walletAddress
      ? props.walletMode === "external" ? "The selected external wallet is not connected." : "Waiting for the Privy smart wallet."
      : props.chainId !== 84532
        ? "Wrong network. Use Base Sepolia (84532)."
        : null;

  return <section className="panel" aria-label="Buy and sell">
    <p className="text-xs text-zinc-400">Active signer: <span className="text-white">{props.walletMode === "external" ? "External wallet" : "Privy embedded smart wallet"}</span>{props.walletAddress ? ` · ${props.walletAddress}` : ""}</p>
    <div className="flex gap-2">
      <button className={side === "buy" ? "button-primary" : "button-secondary"} type="button" disabled={locked || quoteLoading} onClick={() => changeSide("buy")}>Buy</button>
      <button className={side === "sell" ? "button-primary" : "button-secondary"} type="button" disabled={locked || quoteLoading} onClick={() => changeSide("sell")}>Sell</button>
    </div>
    <h2 className="mt-5 text-xl font-semibold text-white">{side === "buy" ? `Buy ${props.symbol}` : `Sell ${props.symbol}`}</h2>
    {guard && <p className="mt-3 text-sm text-amber-200">{guard}</p>}
    {props.statePending && <p className="mt-3 text-sm text-zinc-400">Loading balances and curve state…</p>}
    {props.stateError && <p className="mt-3 text-sm text-red-300">{props.stateError}</p>}
    {props.state?.lifecycle === 1 && <p className="mt-3 text-sm text-amber-200">Graduation is pending. New buys are paused, but holders may still sell.</p>}
    {quoteStateChanged && status === "idle" && <p className="mt-3 text-sm text-red-300">Curve state or balances changed. Request a fresh quote.</p>}
    {unavailable && <p className="mt-3 text-sm text-amber-200">{side === "buy" && props.state?.lifecycle === 1 ? "Buying is unavailable while graduation is pending. Select Sell to exit." : "This trade is unavailable for the current Zonk curve lifecycle."}</p>}
    {props.state && <div className="mt-4 grid gap-2 text-sm text-zinc-400 sm:grid-cols-2">
      <p>ETH balance: <span className="text-zinc-200">{formatAmount(props.state.nativeBalance, 18)}</span></p>
      <p>{props.symbol} balance: <span className="text-zinc-200">{formatAmount(props.state.tokenBalance, props.state.decimals)}</span></p>
    </div>}
    <div className="mt-5 grid gap-4">
      <label className="grid gap-1 text-sm text-zinc-300">
        <span>{side === "buy" ? "ETH amount" : `${props.symbol} amount`}</span>
        <input aria-label={side === "buy" ? "ETH amount" : `${props.symbol} amount`} inputMode="decimal" value={amount} disabled={quoteLoading || controlsUnavailable} onChange={(event) => changeAmount(event.target.value)} />
      </label>
      <label className="grid gap-1 text-sm text-zinc-300">
        <span>Slippage tolerance (%)</span>
        <input aria-label="Slippage tolerance" inputMode="decimal" value={slippage} disabled={quoteLoading || controlsUnavailable} onChange={(event) => changeSlippage(event.target.value)} />
      </label>
      <button className="button-secondary w-fit" type="button" disabled={quoteLoading || controlsUnavailable || Boolean(guard)} onClick={() => void getQuote()}>{quoteLoading ? "Requesting contract quote…" : "Get quote"}</button>
    </div>
    {quote && <div className="mt-5 rounded-xl border border-zinc-700 p-4 text-sm">
      {quote.side === "buy" ? <>
        <p>Exact token output: <span className="text-white">{formatAmount(quote.tokenAmount, props.state?.decimals ?? 18)} {props.symbol}</span></p>
        <p className="mt-2">Current contract quote: <span className="text-white">{formatAmount(quote.reserveIn, 18)} ETH</span></p>
        <p className="mt-2">Maximum ETH input: <span className="text-white">{formatAmount(quote.maxReserveIn, 18)} ETH</span></p>
        <p className="mt-2 text-zinc-500">This contract buys an exact token output; any unused maximum ETH is refunded.</p>
      </> : <>
        <p>Expected ETH output: <span className="text-white">{formatAmount(quote.reserveOut, 18)} ETH</span></p>
        <p className="mt-2">Minimum ETH output: <span className="text-white">{formatAmount(quote.minReserveOut, 18)} ETH</span></p>
        {props.state && props.state.allowance < quote.tokenAmount && <p className="mt-2 text-zinc-500">{props.walletMode === "embedded" ? "Token approval and sale will be submitted atomically by the smart wallet." : "Your external wallet will request an approval transaction first. Zonk.fun waits for its receipt before requesting the sell transaction."}</p>}
      </>}
      <p className="mt-2">Protocol fee: {formatAmount(quote.protocolFee, 18)} ETH · Creator fee: {formatAmount(quote.creatorFee, 18)} ETH</p>
      <p className="mt-2">Slippage protection: {(quote.slippageBps / 100).toFixed(2)}% · Deadline: {formatDeadline(quote.deadline)}</p>
      <p className="mt-2 text-zinc-500">Quote expires after 60 seconds. Execution uses the exact displayed maximum input or minimum output and deadline.</p>
      <button className="button-primary mt-4" type="button" disabled={locked || Boolean(guard)} onClick={() => void submit()}>{locked ? "Trade locked…" : `Confirm ${quote.side}`}</button>
    </div>}
    {status !== "idle" && <div className="mt-5 text-sm" aria-live="polite">
      <p>{tradeStatusLabel(status)}</p>
      {hash && <a className="mt-2 block break-all text-cyan-300" href={`https://sepolia.basescan.org/tx/${hash}`} target="_blank" rel="noreferrer">View Explorer</a>}
      {(error || quoteStateChanged) && <p className="mt-2 text-red-300">{error || "Curve state or balances changed. Request a fresh quote."}</p>}
      {status === "confirmed" && <p className="mt-2 text-zinc-400">The trade is confirmed. Balances and indexed views are being refreshed.</p>}
      {status === "confirmation_unknown" && <div className="mt-3 flex flex-wrap gap-2">
        {hash && <button className="button-secondary" type="button" onClick={() => void recover("check")}>Check Again</button>}
        {hash && <button className="button-secondary" type="button" onClick={() => void recover("resume")}>Resume Confirmation</button>}
        <button className="button-secondary border-red-400/40 text-red-200" type="button" onClick={abandon}>Abandon Pending Trade</button>
      </div>}
    </div>}
  </section>;
}

function parsePositiveAmount(value: string, decimals: number, symbol: string) {
  if (!/^\d+(\.\d+)?$/.test(value.trim())) throw new Error(`Enter a valid ${symbol} amount.`);
  const parsed = decimals === 18 ? parseEther(value.trim()) : parseUnits(value.trim(), decimals);
  if (parsed <= BigInt(0)) throw new Error(`Enter a ${symbol} amount greater than zero.`);
  return parsed;
}

function parseSlippageBps(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) throw new Error("Enter slippage with at most two decimal places.");
  const bps = Math.round(Number(value) * 100);
  if (!Number.isInteger(bps) || bps < 0 || bps > 5_000) throw new Error("Slippage must be between 0% and 50%.");
  return bps;
}

function safeMessage(reason: unknown) {
  const message = reason instanceof Error ? reason.message : "The trade could not be completed.";
  if (/private key|seed phrase|authorization/i.test(message)) return "The wallet operation failed safely.";
  if (/reject|denied|cancelled/i.test(message)) return "The wallet request was rejected. No transaction hash was submitted.";
  return message;
}

function isDefinitivePreSubmissionFailure(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason);
  return /reject|denied|cancelled|revert|simulation|insufficient|quote expired/i.test(message);
}

function formatAmount(amount: bigint, decimals: number) {
  const value = decimals === 18 ? formatEther(amount) : formatUnits(amount, decimals);
  const [whole, fraction = ""] = value.split(".");
  return fraction ? `${whole}.${fraction.slice(0, 6).replace(/0+$/, "")}`.replace(/\.$/, "") : whole;
}

function formatDeadline(deadline: bigint) {
  return `${new Date(Number(deadline) * 1000).toLocaleTimeString()} (${deadline.toString()})`;
}

function tradeStatusLabel(status: TradeTransactionStatus) {
  return {
    idle: "",
    preparing: "Preparing and simulating the protected trade…",
    awaiting_approval: "Confirm token approval in your external wallet…",
    approval_confirming: "Waiting for the approval receipt on Base Sepolia…",
    awaiting_wallet: "Confirm the transaction in your active wallet.",
    submitted: "Transaction submitted.",
    confirming: "Waiting for Base Sepolia confirmation…",
    confirmation_unknown: "Transaction confirmation is unknown. New trades are blocked.",
    confirmed: "Trade confirmed.",
    reverted: "Transaction reverted.",
    replaced: "Transaction replaced.",
    failed: "Trade failed.",
  }[status];
}

function tradeIdentity(token: Address, wallet?: Address) {
  return `${wallet?.toLowerCase() ?? "no-wallet"}:${token.toLowerCase()}`;
}

function tradeStateFingerprint(state: CurveTradeState | undefined, side: TradeSide) {
  if (!state) return "unavailable";
  // Allowance and approval gas spend are expected to change during an external
  // sell. Track only the balance relevant to the quoted side; the sell helper
  // also re-reads token balance and allowance on-chain before submission.
  const relevantBalance = side === "buy" ? state.nativeBalance : state.tokenBalance;
  return [state.curveSupply, state.soldSupply, state.reserveBalance, state.graduationThreshold, state.lifecycle, relevantBalance, state.decimals].join(":");
}
