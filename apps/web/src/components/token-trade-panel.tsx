"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseEther, parseUnits, type Address, type Hash } from "viem";
import type { BudgetBuyQuote, CurveTradeState, ProtectedSellQuote, TradeConfirmation } from "@/lib/contracts";
import { formatNative, formatTokenAmount, formatWeiUsd, type EthUsdReference } from "@/lib/format";
import { useOraclePrice } from "@/providers/oracle-price-provider";
import { TradeAmountPresets } from "@/components/trade-amount-presets";
import { explorerTransactionURL, selectedZonkChainId, selectedZonkChainName } from "@/lib/chain";
import {
  clearPendingTrade,
  DEFAULT_BUY_SLIPPAGE_BPS,
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
  tokenPriceWei?: string | null;
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
const QUOTE_DEBOUNCE_MS = 500;
const blockingStatuses: TradeTransactionStatus[] = ["preparing", "awaiting_approval", "approval_confirming", "awaiting_wallet", "submitted", "confirming", "confirmation_unknown"];

export function TokenTradePanel(props: Props) {
  const { reference } = useOraclePrice();
  const [initialRecovery] = useState(() => props.walletAddress ? readPendingTrade(props.tokenAddress, props.walletAddress) : null);
  const [side, setSide] = useState<TradeSide>(initialRecovery?.side ?? "buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState((DEFAULT_BUY_SLIPPAGE_BPS / 100).toFixed(2));
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
  const quoteRequestRef = useRef(0);
  const quoteDebounceRef = useRef(0);
  const identity = tradeIdentity(props.tokenAddress, props.walletAddress);
  const stateFingerprint = tradeStateFingerprint(props.state, side);
  const latestRef = useRef({ identity, chainId: props.chainId, stateFingerprint });
  useEffect(() => {
    latestRef.current = { identity, chainId: props.chainId, stateFingerprint };
  }, [identity, props.chainId, stateFingerprint]);
  const quoteStateChanged = Boolean(quoteRecord && quoteRecord.stateFingerprint !== stateFingerprint);
  const quote = quoteStateChanged || quoteStale ? null : quoteRecord?.quote ?? null;
  const locked = blockingStatuses.includes(status);
  const canBuy = props.state?.lifecycle === 0;
  const canSell = props.state?.lifecycle === 0 || props.state?.lifecycle === 1;
  const sideAllowed = side === "buy" ? canBuy : canSell;
  const chainID = props.chainId;
  const quoteBuy = props.quoteBuy;
  const quoteSell = props.quoteSell;
  const tokenDecimals = props.state?.decimals ?? 18;
  const tokenLifecycle = props.state?.lifecycle;
  const tokenSymbol = props.symbol;
  const unavailable = Boolean(props.walletAddress) && !props.statePending && !props.stateError && (!props.state || !sideAllowed);
  const controlsUnavailable = unavailable || props.statePending || Boolean(props.stateError) || locked;
  const guard = !props.authenticated
    ? "Log in with Privy to trade."
    : !props.walletAddress
      ? props.walletMode === "external" ? "The selected external wallet is not connected." : "Waiting for the Privy smart wallet."
      : props.chainId !== selectedZonkChainId
        ? `Wrong network. Use ${selectedZonkChainName} (${selectedZonkChainId}).`
        : null;

  const previousIdentityRef = useRef(identity);
  useEffect(() => {
    if (previousIdentityRef.current === identity) return;
    previousIdentityRef.current = identity;
    generationRef.current += 1;
    quoteRequestRef.current += 1;
    quoteDebounceRef.current += 1;
    operationRef.current = false;
    walletInteractionRef.current = false;
    approvalHashRef.current = undefined;
    submittedHashRef.current = undefined;
    submittedAtRef.current = undefined;
    const pending = props.walletAddress ? readPendingTrade(props.tokenAddress, props.walletAddress) : null;
    recoveryRef.current = pending?.recovery;
    submittedHashRef.current = pending?.hash;
    submittedAtRef.current = pending?.submittedAt;
    setSide(pending?.side ?? "buy");
    setQuoteRecord(null);
    setQuoteStale(false);
    setQuoteLoading(false);
    setStatus(pending ? "confirmation_unknown" : "idle");
    setHash(pending?.hash);
    setError(pending ? "A submitted transaction still needs a definitive receipt before another trade is allowed." : "");
  }, [identity, props.tokenAddress, props.walletAddress]);

  useEffect(() => {
    if (!quoteRecord) return;
    const remaining = quoteExpiresAt(quoteRecord) - Date.now();
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
      setError(`The transaction reverted on ${selectedZonkChainName}. No trade was applied.`);
    } else {
      setStatus("replaced");
      setError(`The original transaction was ${resolution.replacementReason ?? "replaced"}. Review the replacement before trading again.`);
    }
  };

  const getQuote = useCallback(async () => {
    const requestID = ++quoteRequestRef.current;
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
      setError(side === "buy" && tokenLifecycle === 1 ? "New buys are paused while graduation is pending. Selling remains available." : "This trade is unavailable for the current curve lifecycle.");
      return;
    }
    const requestedIdentity = identity;
    const requestedState = stateFingerprint;
    const requestedChain = chainID;
    setStatus("idle");
    setQuoteLoading(true);
    try {
      const next = side === "buy"
        ? { side, ...await quoteBuy(parsePositiveAmount(amount, 18, "ETH"), slippageBps) } as Quote
        : { side, ...await quoteSell(parsePositiveAmount(amount, tokenDecimals, tokenSymbol), slippageBps) } as Quote;
      if (quoteRequestRef.current !== requestID) return;
      if (latestRef.current.identity !== requestedIdentity || latestRef.current.stateFingerprint !== requestedState || latestRef.current.chainId !== requestedChain || requestedChain !== selectedZonkChainId) {
        return;
      }
      setQuoteRecord({ quote: next, createdAt: Date.now(), identity: requestedIdentity, stateFingerprint: requestedState, chainId: requestedChain });
    } catch (reason) {
      if (quoteRequestRef.current !== requestID) return;
      setStatus("failed");
      setError(safeMessage(reason));
    } finally {
      if (quoteRequestRef.current === requestID) setQuoteLoading(false);
    }
  }, [amount, chainID, identity, quoteBuy, quoteSell, side, sideAllowed, slippage, stateFingerprint, tokenDecimals, tokenLifecycle, tokenSymbol]);

  useEffect(() => {
    const debounceID = ++quoteDebounceRef.current;
    if (status !== "idle" || controlsUnavailable || guard || !sideAllowed || !quoteInputIsValid(amount, side === "buy" ? 18 : props.state?.decimals ?? 18, side === "buy" ? "ETH" : props.symbol, slippage)) return;
    const timeout = window.setTimeout(() => {
      if (quoteDebounceRef.current === debounceID) void getQuote();
    }, QUOTE_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [amount, controlsUnavailable, getQuote, guard, identity, props.state?.decimals, props.symbol, side, sideAllowed, slippage, stateFingerprint, status]);

  const submit = async () => {
    if (operationRef.current || locked || !quoteRecord) return;
    const currentQuote = quoteRecord.quote;
    setError("");
    if (!props.authenticated || !props.walletAddress) {
      setStatus("failed");
      setError(props.walletMode === "external" ? "Connect and select an external wallet before trading." : "Log in with Privy and wait for the smart wallet before trading.");
      return;
    }
    if (props.chainId !== selectedZonkChainId) {
      setStatus("failed");
      setError(`Switch the ${props.walletMode} wallet to ${selectedZonkChainName} before trading.`);
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
    if (quoteStale || Date.now() >= quoteExpiresAt(quoteRecord)) {
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
      if (Date.now() >= quoteExpiresAt(quoteRecord)) {
        throw new Error("This quote expired during wallet approval. Request a fresh quote before submitting.");
      }
      if (latestRef.current.identity !== operationIdentity || latestRef.current.chainId !== selectedZonkChainId || latestRef.current.stateFingerprint !== quoteRecord.stateFingerprint) {
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

  const invalidateQuote = () => {
    quoteRequestRef.current += 1;
    quoteDebounceRef.current += 1;
    setQuoteRecord(null);
    setQuoteStale(false);
    setQuoteLoading(false);
    setError("");
    setStatus("idle");
  };
  const changeAmount = (value: string) => { setAmount(value); invalidateQuote(); };
  const changeSlippage = (value: string) => { setSlippage(value); invalidateQuote(); };
  const changeSide = (value: TradeSide) => { if (locked) return; setSide(value); invalidateQuote(); setHash(undefined); };
  const refreshQuote = () => { quoteDebounceRef.current += 1; void getQuote(); };
  const tokenBalanceValue = props.state && props.tokenPriceWei ? tokenValueWei(props.state.tokenBalance, props.state.decimals, props.tokenPriceWei) : null;
  const quotedTokenValue = quote && props.tokenPriceWei ? tokenValueWei(quote.tokenAmount, props.state?.decimals ?? 18, props.tokenPriceWei) : null;
  const quotedTokenEstimate = tokenUsdEstimate(quotedTokenValue, reference);
  const inputUsd = side === "buy" ? inputEthUsd(amount, reference) : "—";

  return <section className="terminal-panel p-4" aria-label="Buy and sell">
    <div className="trade-panel-grid grid min-w-0 gap-5">
      <div className="min-w-0" aria-label="Trade inputs and wallet">
        <div className="flex rounded-xl border border-white/8 bg-black/20 p-1" role="group" aria-label="Trade side">
          <button className={`min-h-11 flex-1 rounded-lg px-4 text-sm font-semibold transition-colors ${side === "buy" ? "bg-emerald-400 text-[#03251a] shadow-lg shadow-emerald-950/20" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`} aria-pressed={side === "buy"} type="button" disabled={locked} onClick={() => changeSide("buy")}>Buy</button>
          <button className={`min-h-11 flex-1 rounded-lg px-4 text-sm font-semibold transition-colors ${side === "sell" ? "bg-red-500 text-white shadow-lg shadow-red-950/25" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`} aria-pressed={side === "sell"} type="button" disabled={locked} onClick={() => changeSide("sell")}>Sell</button>
        </div>
        <div className="mt-5 flex items-start justify-between gap-3"><div><p className="text-xs text-zinc-500">Protected curve order</p><h3 className="mt-1 text-xl font-semibold text-white">{side === "buy" ? `Buy ${props.symbol}` : `Sell ${props.symbol}`}</h3></div><span className="badge-neutral">60s quote</span></div>
        <div className="mt-4 min-w-0 rounded-xl border border-white/8 bg-black/15 p-3"><p className="text-xs text-zinc-500">Active signer · <span className="text-zinc-200">{props.walletMode === "external" ? "External wallet" : "Privy embedded smart wallet"}</span></p>{props.walletAddress && <p className="address mt-1 truncate" title={props.walletAddress}>{props.walletAddress}</p>}</div>
        {guard && <p className="status-box status-warning mt-4">{guard}</p>}
        {props.statePending && <p className="status-box mt-4 text-zinc-400">Loading balances and curve state…</p>}
        {props.stateError && <p className="status-box status-error mt-4">{props.stateError}</p>}
        {props.state?.lifecycle === 1 && <p className="status-box status-warning mt-4">Graduation is pending. New buys are paused, but holders may still sell.</p>}
        {unavailable && <p className="status-box status-warning mt-4">{side === "buy" && props.state?.lifecycle === 1 ? "Buying is unavailable while graduation is pending. Select Sell to exit." : "This trade is unavailable for the current Zonk curve lifecycle."}</p>}
        {props.state && <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="panel-subtle p-3"><dt className="text-xs text-zinc-500">ETH balance</dt><dd className="mt-1 truncate font-medium text-zinc-100">{formatWeiUsd(props.state.nativeBalance, reference)}</dd><dd className="mt-0.5 truncate text-[0.68rem] text-zinc-600" title={formatNative(props.state.nativeBalance)}>{formatNative(props.state.nativeBalance)}</dd></div>
          <div className="panel-subtle p-3"><dt className="truncate text-xs text-zinc-500">{props.symbol} balance</dt><dd className="mt-1 truncate font-medium text-zinc-100">{formatWeiUsd(tokenBalanceValue, reference)}</dd><dd className="mt-0.5 truncate text-[0.68rem] text-zinc-600" title={formatTokenAmount(props.state.tokenBalance, props.state.decimals, props.symbol)}>{formatTokenAmount(props.state.tokenBalance, props.state.decimals, props.symbol)}</dd></div>
        </dl>}
        <div className="mt-5 grid gap-4">
          <div className="grid gap-2 text-sm text-zinc-300"><label className="grid gap-2"><span className="flex items-center justify-between gap-3"><span className="font-medium text-zinc-200">{side === "buy" ? "Pay amount" : "Sell amount"}</span><span className="text-xs text-zinc-600">{side === "buy" ? inputUsd : quotedTokenEstimate}</span></span><div className="relative"><input className="pr-16" aria-label={side === "buy" ? "ETH amount" : `${props.symbol} amount`} inputMode="decimal" value={amount} placeholder="0.0" disabled={controlsUnavailable} onChange={(event) => changeAmount(event.target.value)} /><span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-zinc-500">{side === "buy" ? "ETH" : props.symbol}</span></div></label><TradeAmountPresets side={side} nativeBalance={props.state?.nativeBalance} tokenBalance={props.state?.tokenBalance} tokenDecimals={props.state?.decimals ?? 18} disabled={controlsUnavailable} onSelect={changeAmount} /></div>
          <label className="grid gap-2 text-sm text-zinc-300"><span className="flex items-center justify-between gap-3"><span className="font-medium text-zinc-200">Slippage tolerance</span><span className="text-xs text-zinc-500">0–50%</span></span><div className="relative"><input className="pr-12" aria-label="Slippage tolerance" inputMode="decimal" value={slippage} disabled={controlsUnavailable} onChange={(event) => changeSlippage(event.target.value)} /><span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500">%</span></div></label>
          <button className={`${quote ? "button-ghost text-xs" : "button-secondary"} w-full`} type="button" aria-label="Get quote" disabled={quoteLoading || controlsUnavailable || Boolean(guard)} onClick={refreshQuote}>{quoteLoading ? "Refreshing protected quote…" : quoteRecord ? "Refresh protected quote" : "Get protected quote"}</button>
          {quoteLoading && <p className="text-center text-xs text-zinc-500" aria-live="polite">Reading a protected quote from the curve…</p>}
        </div>
      </div>
      <div className="min-w-0 border-t border-white/8 pt-5" aria-label="Quote and confirmation">
        {quote ? <div className="text-sm" aria-label="Ready protected quote">
          <div className="mb-2 flex items-center justify-between gap-3"><p className="eyebrow">Protected quote</p><span className="badge-success">Ready</span></div>
          {quote.side === "buy" ? <>
            <QuoteRow label="You receive" value={formatTokenAmount(quote.tokenAmount, props.state?.decimals ?? 18, props.symbol)} strong />
            <QuoteRow label="Maximum input" value={formatWeiUsd(quote.maxReserveIn, reference)} secondary={formatNative(quote.maxReserveIn)} />
          </> : <>
            <QuoteRow label="Token input" value={formatTokenAmount(quote.tokenAmount, props.state?.decimals ?? 18, props.symbol)} secondary={quotedTokenEstimate} strong />
            <QuoteRow label="You receive" value={formatWeiUsd(quote.reserveOut, reference)} secondary={formatNative(quote.reserveOut)} strong />
            <QuoteRow label="Minimum ETH output" value={formatWeiUsd(quote.minReserveOut, reference)} secondary={formatNative(quote.minReserveOut)} />
          </>}
          <QuoteRow label="Fees" value="Protocol + creator" />
          <QuoteRow label="Slippage protection" value={`${(quote.slippageBps / 100).toFixed(2)}%`} />
          <QuoteRow label="Quote expiry" value={formatDeadline(quote.deadline)} />
          {quote.side === "sell" && props.state && props.state.allowance < quote.tokenAmount && <p className="mt-3 rounded-lg border border-violet-400/15 bg-violet-400/[0.035] p-3 text-xs leading-5 text-zinc-400">{props.walletMode === "embedded" ? "Token approval and sale will be submitted atomically by the smart wallet." : "Your external wallet will request an approval transaction first. Zonk.fun waits for its receipt before requesting the sell transaction."}</p>}
          <button className="button-primary mt-4 w-full" type="button" disabled={locked || Boolean(guard)} onClick={() => void submit()}>{locked ? "Trade locked…" : `Confirm ${quote.side}`}</button>
          <details className="mt-3 border-t border-white/8 pt-3 text-xs text-zinc-500">
            <summary className="cursor-pointer font-medium text-zinc-300 hover:text-white">Quote details</summary>
            <div className="mt-3">
              <p className="leading-5">{reference ? `Chainlink USD · updated ${new Date(reference.asOf).toLocaleString()}` : "USD unavailable · execution remains ETH-denominated"}</p>
              {quote.side === "buy" && <QuoteRow label="Pay" value={formatWeiUsd(quote.reserveIn, reference)} secondary={formatNative(quote.reserveIn)} />}
              <QuoteRow label="Reference token value" value={quotedTokenEstimate} />
              <QuoteRow label="Protocol fee" value={formatWeiUsd(quote.protocolFee, reference)} secondary={formatNative(quote.protocolFee)} />
              <QuoteRow label="Creator fee" value={formatWeiUsd(quote.creatorFee, reference)} secondary={formatNative(quote.creatorFee)} />
              <QuoteRow label="Price impact" value="Unavailable" />
              {quote.side === "buy" && <p className="mt-3 leading-5">This contract buys an exact token output; any unused maximum ETH is refunded.</p>}
              <p className="mt-3 leading-5">Quote expires after 60 seconds. Execution uses the exact displayed maximum input or minimum output and deadline.</p>
            </div>
          </details>
        </div> : <div className={`panel-subtle p-4 text-sm leading-6 ${quoteStale || quoteStateChanged ? "text-amber-200" : "text-zinc-500"}`}><p className="font-medium text-zinc-200">Protected quote</p><p className="mt-2">{quoteLoading ? "Refreshing from the active Zonk curve…" : quoteStale ? "This quote expired. Refresh it before submitting." : quoteStateChanged ? "Curve state or balances changed. Waiting for a fresh quote." : "Enter an amount to load contract-backed output, fees, protection, and expiry."}</p></div>}
        {status !== "idle" && <div className={`status-box mt-5 ${status === "confirmed" ? "status-success" : ["failed", "reverted", "replaced"].includes(status) ? "status-error" : status === "confirmation_unknown" ? "status-warning" : ""}`} aria-live="polite" role="status">
          <div className="flex items-start gap-3"><span className={`mt-1 h-2.5 w-2.5 flex-none rounded-full ${locked && status !== "confirmation_unknown" ? "animate-pulse bg-cyan-300" : status === "confirmed" ? "bg-emerald-300" : ["failed", "reverted", "replaced"].includes(status) ? "bg-rose-300" : "bg-amber-300"}`} /><p className="font-medium">{tradeStatusLabel(status)}</p></div>
          {hash && <a className="mt-2 block break-all text-cyan-300" href={explorerTransactionURL(hash)} target="_blank" rel="noreferrer">View Explorer</a>}
          {(error || quoteStateChanged) && <p className="mt-2 text-sm text-red-200">{error || "Curve state or balances changed. Request a fresh quote."}</p>}
          {status === "confirmed" && <p className="mt-2 text-zinc-400">The trade is confirmed. Balances and indexed views are being refreshed.</p>}
          {status === "confirmation_unknown" && <div className="mt-3 flex flex-wrap gap-2">{hash && <button className="button-secondary" type="button" onClick={() => void recover("check")}>Check Again</button>}{hash && <button className="button-secondary" type="button" onClick={() => void recover("resume")}>Resume Confirmation</button>}<button className="button-secondary border-red-400/40 text-red-200" type="button" onClick={abandon}>Abandon Pending Trade</button></div>}
        </div>}
      </div>
    </div>
  </section>;
}

function QuoteRow({ label, value, secondary, strong = false }: { label: string; value: string; secondary?: string; strong?: boolean }) {
  return <div className="mt-2 flex min-w-0 items-start justify-between gap-4"><span className="text-zinc-500">{label}</span><span className="min-w-0 text-right"><span className={`block break-words ${strong ? "font-semibold text-cyan-100" : "text-zinc-200"}`}>{value}</span>{secondary && <span className="mt-0.5 block text-[0.68rem] text-zinc-600">{secondary}</span>}</span></div>;
}

function tokenValueWei(amount: bigint, decimals: number, priceWei: string) {
  try { return amount * BigInt(priceWei) / (BigInt(10) ** BigInt(decimals)); } catch { return null; }
}

function inputEthUsd(value: string, reference: EthUsdReference | null) {
  try { return /^\d+(\.\d+)?$/.test(value.trim()) ? formatWeiUsd(parseEther(value.trim()), reference) : "—"; } catch { return "—"; }
}

function tokenUsdEstimate(value: bigint | null, reference: EthUsdReference | null) {
  if (value === null) return "USD estimate unavailable";
  const formatted = formatWeiUsd(value, reference);
  return formatted === "USD unavailable" ? formatted : `Estimated ${formatted}`;
}

function quoteExpiresAt(record: QuoteRecord) {
  const deadline = Number(record.quote.deadline) * 1000;
  return Math.min(record.createdAt + QUOTE_TTL_MS, Number.isSafeInteger(deadline) ? deadline : record.createdAt + QUOTE_TTL_MS);
}

function quoteInputIsValid(value: string, decimals: number, symbol: string, slippage: string) {
  try {
    parsePositiveAmount(value, decimals, symbol);
    parseSlippageBps(slippage);
    return true;
  } catch {
    return false;
  }
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

function formatDeadline(deadline: bigint) {
  return `${new Date(Number(deadline) * 1000).toLocaleTimeString()} (${deadline.toString()})`;
}

function tradeStatusLabel(status: TradeTransactionStatus) {
  return {
    idle: "",
    preparing: "Preparing and simulating the protected trade…",
    awaiting_approval: "Confirm token approval in your external wallet…",
    approval_confirming: `Waiting for the approval receipt on ${selectedZonkChainName}…`,
    awaiting_wallet: "Confirm the transaction in your active wallet.",
    submitted: "Transaction submitted.",
    confirming: `Waiting for ${selectedZonkChainName} confirmation…`,
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
