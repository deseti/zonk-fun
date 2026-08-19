"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatEther, formatUnits, parseEther, parseUnits, type Address, type Hash } from "viem";
import { createExternalWalletClient, erc20TradeAbi, publicClient, sendSmartWalletTransaction } from "@/lib/contracts";
import { explorerTransactionURL, selectedZonkChain, selectedZonkChainId, selectedZonkChainName } from "@/lib/chain";
import { selectActiveSigner, tradeInvalidationKeys } from "@/components/token-trading";
import { TradeAmountPresets } from "@/components/trade-amount-presets";
import { useActiveWallet } from "@/providers/active-wallet-provider";
import { approvalCall, buildGraduatedSwapTransaction, configuredUniswapV3, orchestrateGraduatedSwap, quoteGraduatedSwap, quoteIsFresh, simulateGraduatedSwapTransaction, validateCanonicalPool, type GraduatedQuote, type GraduatedSwapTransaction } from "@/lib/uniswap-v3";

type State = { eth: bigint; token: bigint; allowance: bigint; decimals: number };
type SwapStatus = "idle" | "quoting" | "awaiting_approval" | "approval_confirming" | "awaiting_wallet" | "submitted" | "confirming" | "confirmed" | "error";

const statusText: Record<SwapStatus, string> = {
  idle: "Ready", quoting: "Quoting", awaiting_approval: "Awaiting approval", approval_confirming: "Approval confirming", awaiting_wallet: "Awaiting wallet", submitted: "Submitted", confirming: "Confirming", confirmed: "Confirmed", error: "Error",
};

export function GraduatedTokenSwap({ tokenAddress, canonicalPoolAddress, symbol }: { tokenAddress: Address; canonicalPoolAddress?: Address; symbol: string }) {
  const { authenticated } = usePrivy();
  const { getClientForChain } = useSmartWallets();
  const { mode, activeAddress: wallet, activeChainId: chainId, externalWallet } = useActiveWallet();
  const queryClient = useQueryClient();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("0.50");
  const [quote, setQuote] = useState<GraduatedQuote>();
  const [status, setStatus] = useState<SwapStatus>("idle");
  const [error, setError] = useState("");
  const [hash, setHash] = useState<Hash>();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const executionContext = useRef({ wallet, chainId, mode });
  useEffect(() => { executionContext.current = { wallet, chainId, mode }; }, [chainId, mode, wallet]);
  const poolQuery = useQuery({ queryKey: ["graduated-pool", tokenAddress, canonicalPoolAddress], queryFn: () => validateCanonicalPool(canonicalPoolAddress!, tokenAddress), enabled: Boolean(canonicalPoolAddress && configuredUniswapV3()), staleTime: 30_000 });
  const stateQuery = useQuery({ queryKey: ["graduated-swap-state", tokenAddress, wallet, poolQuery.data?.router], queryFn: () => readState(tokenAddress, wallet!, poolQuery.data!.router), enabled: Boolean(wallet && poolQuery.data), refetchInterval: 15_000 });
  const config = configuredUniswapV3();
  const guard = !config ? `Swap configuration unavailable: verified ${selectedZonkChainName} QuoterV2, SwapRouter02, and factory addresses are required.` : !canonicalPoolAddress ? "No indexed canonical graduation pool is available for this token." : !authenticated ? "Log in with Privy to swap." : !wallet ? "Connect the active wallet to swap." : chainId !== selectedZonkChainId ? `Switch the active wallet to ${selectedZonkChainName} (${selectedZonkChainId}).` : poolQuery.isError ? poolQuery.error.message : null;

  const requestQuote = useCallback(async () => {
    if (guard || !poolQuery.data || !wallet) return;
    try {
      setStatus("quoting");
      setError("");
      const decimals = side === "buy" ? 18 : stateQuery.data?.decimals;
      if (decimals === undefined) throw new Error("Token decimals are unavailable.");
      const bps = Math.round(Number(slippage) * 100);
      const parsed = side === "buy" ? parseEther(amount) : parseUnits(amount, decimals);
      if (side === "buy" && stateQuery.data && parsed > stateQuery.data.eth) throw new Error("Insufficient ETH balance.");
      if (side === "sell" && stateQuery.data && parsed > stateQuery.data.token) throw new Error(`Insufficient ${symbol} balance.`);
      setQuote(await quoteGraduatedSwap(poolQuery.data, side, parsed, bps, wallet));
      setStatus("idle");
    } catch (reason) {
      setStatus("error");
      setError(errorMessage(reason));
    }
  }, [amount, guard, poolQuery.data, side, slippage, stateQuery.data, symbol, wallet]);

  useEffect(() => {
    if (guard || !amount || busy.current) return;
    const id = window.setTimeout(() => void requestQuote(), 500);
    return () => window.clearTimeout(id);
  }, [amount, guard, requestQuote, side, slippage]);

  const changeAmount = (value: string) => {
    setAmount(value);
    setQuote(undefined);
  };

  const submit = async () => {
    if (busy.current || !quote || !poolQuery.data || !wallet || !stateQuery.data) return;
    const assertContext = () => {
      const current = executionContext.current;
      if (current.wallet?.toLowerCase() !== wallet.toLowerCase() || current.chainId !== chainId || current.mode !== mode || !quoteIsFresh(quote, wallet, poolQuery.data!.pool, chainId ?? 0)) throw new Error("This quote is stale or the wallet/network changed. Request a fresh quote.");
    };
    try { assertContext(); } catch { return rejectStaleQuote(setQuote, setStatus, setError); }
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const send = await walletTransport(mode, wallet, externalWallet, getClientForChain, symbol);
      const swapHash = await orchestrateGraduatedSwap({
        side,
        amountIn: quote.amountIn,
        initialState: stateQuery.data,
        readState: () => readState(tokenAddress, wallet, poolQuery.data!.router),
        approve: () => approveExactly(send, tokenAddress, poolQuery.data!.router, quote.amountIn, wallet, setHash, setStatus),
        assertContext,
        buildTransaction: () => buildGraduatedSwapTransaction(poolQuery.data!, quote, wallet),
        simulate: (transaction) => simulateGraduatedSwapTransaction(transaction, wallet),
        send: (transaction) => { setStatus("awaiting_wallet"); return send(transaction, "Swap"); },
      });
      setHash(swapHash);
      setStatus("submitted");
      setStatus("confirming");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: swapHash, confirmations: 1, timeout: 120_000 });
      if (receipt.status !== "success") throw new Error(`The swap reverted on ${selectedZonkChainName}.`);
      setStatus("confirmed");
      await Promise.all([["graduated-swap-state", tokenAddress], ...tradeInvalidationKeys(tokenAddress)].map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    } catch (reason) {
      setStatus("error");
      setError(errorMessage(reason));
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  return <section className="terminal-panel p-5" aria-label="Graduated token swap">
    <div className="flex items-center justify-between"><h2 className="text-lg font-semibold text-white">Swap</h2><span className="badge-violet">Graduated · V3</span></div>
    <div className="mt-4 grid grid-cols-2 gap-2" role="group" aria-label="Swap side">
      <button className={side === "buy" ? "button-primary" : "button-secondary"} type="button" onClick={() => { setSide("buy"); setQuote(undefined); }} disabled={pending}>Buy {symbol}</button>
      <button className={side === "sell" ? "button-primary" : "button-secondary"} type="button" onClick={() => { setSide("sell"); setQuote(undefined); }} disabled={pending}>Sell {symbol}</button>
    </div>
    {guard ? <p className="status-box status-warning mt-4 text-sm">{guard}</p> : <>
      <label className="mt-5 block text-xs text-zinc-500">Pay <span className="float-right">{side === "buy" ? "ETH" : symbol}</span><input className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 p-3 text-white" aria-label={side === "buy" ? "ETH amount" : `${symbol} amount`} inputMode="decimal" value={amount} onChange={(event) => changeAmount(event.target.value)} placeholder="0.0" /></label>
      <TradeAmountPresets side={side} nativeBalance={stateQuery.data?.eth} tokenBalance={stateQuery.data?.token} tokenDecimals={stateQuery.data?.decimals ?? 18} disabled={pending || Boolean(guard)} onSelect={changeAmount} />
      <p className="mt-1 text-xs text-zinc-600">Balance {stateQuery.data ? (side === "buy" ? formatEther(stateQuery.data.eth) : formatUnits(stateQuery.data.token, stateQuery.data.decimals)) : "…"}</p>
      <label className="mt-4 block text-xs text-zinc-500">Slippage (%)<input className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 p-3 text-white" inputMode="decimal" value={slippage} onChange={(event) => { setSlippage(event.target.value); setQuote(undefined); }} /></label>
      {quote && <div className="mt-4 rounded-lg border border-white/8 p-3 text-sm"><p>Receive ~ {formatUnits(quote.amountOut, side === "buy" ? stateQuery.data?.decimals ?? 18 : 18)} {side === "buy" ? symbol : "ETH"}</p><p className="mt-1 text-zinc-500">Minimum received {formatUnits(quote.minimumOut, side === "buy" ? stateQuery.data?.decimals ?? 18 : 18)} · Pool fee 1%</p></div>}
      <button className="button-primary mt-5 w-full" type="button" disabled={!quote || pending || status === "quoting"} onClick={() => void submit()}>{status === "quoting" ? "Quoting…" : "Confirm swap"}</button>
      <p className="mt-3 text-xs text-zinc-500">{statusText[status]}{hash && <> · <a className="text-cyan-300" href={explorerTransactionURL(hash)} target="_blank" rel="noreferrer">View transaction ↗</a></>}</p>
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      <details className="mt-4 text-xs text-zinc-600"><summary>Execution details</summary><p className="mt-2 break-all">Pool {canonicalPoolAddress}<br />SwapRouter02 {poolQuery.data?.router}<br />{selectedZonkChainName} · quote deadline 5 minutes</p></details>
    </>}
  </section>;
}

type Sender = (transaction: GraduatedSwapTransaction, label: string) => Promise<Hash>;

async function walletTransport(mode: "embedded" | "external" | null, wallet: Address, externalWallet: ReturnType<typeof useActiveWallet>["externalWallet"], getClientForChain: ReturnType<typeof useSmartWallets>["getClientForChain"], symbol: string): Promise<Sender> {
  if (mode === "external") {
    const signer = selectActiveSigner(mode, { external: externalWallet });
    if (signer.wallet.address.toLowerCase() !== wallet.toLowerCase()) throw new Error("The selected external wallet no longer matches the active address.");
    const provider = await signer.wallet.getEthereumProvider();
    const external = createExternalWalletClient(provider, wallet);
    return (transaction) => external.sendTransaction({ account: wallet, chain: selectedZonkChain, ...transaction });
  }
  if (mode === "embedded") {
    const embedded = await getClientForChain({ id: selectedZonkChainId });
    const signer = selectActiveSigner(mode, { embedded });
    return (transaction, label) => sendSmartWalletTransaction(signer.client, { calls: [transaction] }, { action: label, description: `${label} ${symbol} on ${selectedZonkChainName}.` });
  }
  throw new Error("No active wallet mode is selected.");
}

async function approveExactly(send: Sender, token: Address, router: Address, amount: bigint, wallet: Address, setHash: (hash: Hash) => void, setStatus: (status: SwapStatus) => void) {
  setStatus("awaiting_approval");
  const approvalHash = await send(approvalCall(token, router, amount), "Approve token");
  setHash(approvalHash);
  setStatus("approval_confirming");
  const receipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash, confirmations: 1, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error("The token approval transaction reverted.");
  // The caller rereads allowance after confirmation before building a swap payload.
  void wallet;
}

function rejectStaleQuote(setQuote: (quote: undefined) => void, setStatus: (status: SwapStatus) => void, setError: (error: string) => void) {
  setQuote(undefined);
  setStatus("error");
  setError("This quote is stale or the wallet/network changed. Request a fresh quote.");
}

function errorMessage(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }

async function readState(token: Address, wallet: Address, router: Address): Promise<State> {
  const [eth, tokenBalance, allowance, decimals] = await Promise.all([
    publicClient.getBalance({ address: wallet }), publicClient.readContract({ address: token, abi: erc20TradeAbi, functionName: "balanceOf", args: [wallet] }), publicClient.readContract({ address: token, abi: erc20TradeAbi, functionName: "allowance", args: [wallet, router] }), publicClient.readContract({ address: token, abi: erc20TradeAbi, functionName: "decimals" }),
  ]);
  return { eth, token: tokenBalance, allowance, decimals };
}
