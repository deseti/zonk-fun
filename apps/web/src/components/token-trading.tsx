"use client";

import { usePrivy, type BaseConnectedEthereumWallet } from "@privy-io/react-auth";
import { useSmartWallets, type SmartWalletClientType } from "@privy-io/react-auth/smart-wallets";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatEther, formatUnits, type Address } from "viem";
import { TokenTradePanel, type TradeExecution, type TradeResume } from "@/components/token-trade-panel";
import { api } from "@/lib/api";
import { captureTradeRecovery, checkTrade, confirmTrade, createExternalWalletClient, quoteBuyByBudget, quoteSellAmount, readCurveAvailability, readTradeState, submitBuy, submitExternalBuy, submitExternalSell, submitSell } from "@/lib/contracts";
import type { TradeRecovery } from "@/lib/transactions";
import { hasPrivyAppId } from "@/lib/wallet";
import { useActiveWallet } from "@/providers/active-wallet-provider";

export function TokenTrading({ tokenAddress, symbol }: { tokenAddress: Address; symbol: string; creator: Address }) {
  if (!hasPrivyAppId) return <div className="mt-10 panel text-amber-200">Set NEXT_PUBLIC_PRIVY_APP_ID to enable Privy trading.</div>;
  return <PrivyTokenTrading tokenAddress={tokenAddress} symbol={symbol} />;
}

function PrivyTokenTrading({ tokenAddress, symbol }: { tokenAddress: Address; symbol: string }) {
  const { authenticated } = usePrivy();
  const { getClientForChain } = useSmartWallets();
  const { mode, activeAddress: walletAddress, activeChainId: chainId, externalWallet } = useActiveWallet();
  const queryClient = useQueryClient();
  const stateQuery = useQuery({
    queryKey: activeTradeStateQueryKey(tokenAddress, walletAddress),
    queryFn: () => loadActiveTradeState(tokenAddress, walletAddress!),
    enabled: Boolean(walletAddress),
    refetchInterval: 15_000,
  });
  const availabilityQuery = useQuery({
    queryKey: ["curve-availability", tokenAddress],
    queryFn: () => readCurveAvailability(tokenAddress),
    refetchInterval: 15_000,
  });
  const quoteBuy = async (budget: bigint, slippageBps: number) => {
    if (!stateQuery.data) throw new Error("Curve state is not available yet.");
    return quoteBuyByBudget(tokenAddress, budget, stateQuery.data, slippageBps);
  };
  const quoteSell = (tokenAmount: bigint, slippageBps: number) => quoteSellAmount(tokenAddress, tokenAmount, slippageBps);

  const execute: TradeExecution = async (quote, report, assertSubmissionReady) => {
    if (chainId !== 84532 || !walletAddress) throw new Error(`Switch the ${mode} wallet to Base Sepolia before trading.`);
    report("preparing");
    assertSubmissionReady();
    let hash;
    if (mode === "external") {
      const signer = selectActiveSigner(mode, { external: externalWallet });
      if (signer.wallet.address.toLowerCase() !== walletAddress.toLowerCase()) throw new Error("The selected external wallet does not match the active account.");
      const provider = await signer.wallet.getEthereumProvider();
      assertSubmissionReady();
      const client = createExternalWalletClient(provider, walletAddress);
      if (quote.side === "buy") {
        report("awaiting_wallet");
        hash = await submitExternalBuy(client, walletAddress, tokenAddress, quote, assertSubmissionReady);
      } else {
        hash = await submitExternalSell(client, walletAddress, tokenAddress, quote, {
          onApprovalRequested: () => report("awaiting_approval"),
          onApprovalSubmitted: (approvalHash) => report("approval_confirming", approvalHash),
          onApprovalConfirmed: () => report("preparing"),
          onSellRequested: () => report("awaiting_wallet"),
        }, assertSubmissionReady);
      }
    } else {
      const client = await getClientForChain({ id: 84532 });
      assertSubmissionReady();
      const signer = selectActiveSigner(mode, { embedded: client });
      report("awaiting_wallet");
      hash = quote.side === "buy"
        ? await submitBuy(signer.client, walletAddress, tokenAddress, quote, assertSubmissionReady)
        : await submitSell(signer.client, walletAddress, tokenAddress, quote, stateQuery.data?.allowance ?? BigInt(0), assertSubmissionReady);
    }
    report("submitted", hash);
    const recovery = await captureTradeRecovery(hash);
    report("confirming", hash, recovery);
    return confirmTrade(hash, quote.side, tokenAddress, walletAddress, recovery);
  };

  const resume: TradeResume = async (side, hash, recovery, report) => {
    if (!walletAddress) throw new Error("The active wallet is unavailable.");
    report("confirming", hash);
    return confirmTrade(hash, side, tokenAddress, walletAddress, recovery);
  };

  const check = (side: "buy" | "sell", hash: `0x${string}`, recovery?: TradeRecovery) => {
    if (!walletAddress) throw new Error("The active wallet is unavailable.");
    return checkTrade(hash, side, tokenAddress, walletAddress, recovery);
  };

  const onConfirmed = () => {
    void Promise.all(tradeInvalidationKeys(tokenAddress).map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  };

  if (availabilityQuery.isError) return <div className="mt-10 panel text-red-300">The deployed curve could not be read from Base Sepolia.</div>;
  if (availabilityQuery.isPending) return <div className="mt-10 panel text-zinc-400">Checking the token’s Base Sepolia curve…</div>;
	if (availabilityQuery.data === null) return <div className="mt-10 panel text-amber-200">The canonical endpoint curve is not available for this token.</div>;
  return <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <TokenTradePanel
      key={`${walletAddress?.toLowerCase() ?? "no-wallet"}:${tokenAddress.toLowerCase()}`}
      authenticated={authenticated}
      walletMode={mode}
      chainId={chainId}
      walletAddress={walletAddress}
      tokenAddress={tokenAddress}
      symbol={symbol}
      state={stateQuery.data}
      statePending={stateQuery.isPending && Boolean(walletAddress)}
      stateError={stateQuery.isError ? "Trading is unavailable because balances or an active Zonk curve could not be loaded." : undefined}
      quoteBuy={quoteBuy}
      quoteSell={quoteSell}
      execute={execute}
      resume={resume}
      check={check}
      onConfirmed={onConfirmed}
    />
    <TradeHistory tokenAddress={tokenAddress} symbol={symbol} />
  </div>;
}

export function selectActiveSigner(
  mode: "external",
  input: { embedded?: SmartWalletClientType; external?: BaseConnectedEthereumWallet },
): { mode: "external"; wallet: BaseConnectedEthereumWallet };
export function selectActiveSigner(
  mode: "embedded",
  input: { embedded?: SmartWalletClientType; external?: BaseConnectedEthereumWallet },
): { mode: "embedded"; client: SmartWalletClientType };
export function selectActiveSigner(
  mode: "embedded" | "external",
  input: { embedded?: SmartWalletClientType; external?: BaseConnectedEthereumWallet },
): { mode: "external"; wallet: BaseConnectedEthereumWallet } | { mode: "embedded"; client: SmartWalletClientType } {
  if (mode === "external") {
    if (!input.external) throw new Error("The selected external wallet is unavailable.");
    return { mode, wallet: input.external } as const;
  }
  if (!input.embedded) throw new Error("The Privy embedded smart-wallet client is unavailable.");
  return { mode, client: input.embedded } as const;
}

export function tradeInvalidationKeys(tokenAddress: Address) {
  return [
    ["trade-state", tokenAddress],
    ["curve-availability", tokenAddress],
    ["trades", tokenAddress],
    ["activity", tokenAddress],
    ["token", tokenAddress],
    ["tokens"],
    ["trending"],
  ] as const;
}

export function activeTradeStateQueryKey(tokenAddress: Address, walletAddress?: Address) {
  return ["trade-state", tokenAddress, walletAddress] as const;
}

export function loadActiveTradeState(tokenAddress: Address, walletAddress: Address) {
  return readTradeState(tokenAddress, walletAddress);
}

function TradeHistory({ tokenAddress, symbol }: { tokenAddress: Address; symbol: string }) {
  const trades = useQuery({
    queryKey: ["trades", tokenAddress],
    queryFn: () => api.trades(tokenAddress, "?limit=20"),
    refetchInterval: 15_000,
  });
  return <section className="panel" aria-label="Indexed trade history">
    <h2 className="text-xl font-semibold text-white">Indexed trades</h2>
    <p className="mt-2 text-sm text-zinc-500">Confirmed curve events appear after the indexer reaches their finalized block.</p>
    {trades.isPending && <p className="mt-5 text-sm text-zinc-400">Loading trade history…</p>}
    {trades.isError && <p className="mt-5 text-sm text-red-300">Trade history could not be loaded.</p>}
    {trades.data?.items.length === 0 && <p className="mt-5 text-sm text-zinc-400">No indexed trades yet.</p>}
    {trades.data && trades.data.items.length > 0 && <ul className="mt-5 grid gap-3">
      {trades.data.items.map((trade) => <li className="rounded-xl border border-zinc-800 p-3 text-sm" key={`${trade.transaction_hash}:${trade.log_index}`}>
        <div className="flex items-center justify-between gap-3"><span className={trade.side === "buy" ? "text-emerald-300" : "text-amber-200"}>{trade.side.toUpperCase()}</span><span className="text-zinc-500">Block {trade.block_number}</span></div>
        <p className="mt-2 text-zinc-300">{formatToken(trade.token_amount)} {symbol} · {formatNative(trade.reserve_amount)} ETH</p>
        <a className="mt-2 block text-cyan-300" href={`https://sepolia.basescan.org/tx/${trade.transaction_hash}`} target="_blank" rel="noreferrer">View on BaseScan</a>
      </li>)}
    </ul>}
  </section>;
}

function formatToken(value: string) {
  try { return Number(formatUnits(BigInt(value), 18)).toLocaleString(undefined, { maximumFractionDigits: 6 }); } catch { return value; }
}

function formatNative(value: string) {
  try { return Number(formatEther(BigInt(value))).toLocaleString(undefined, { maximumFractionDigits: 6 }); } catch { return value; }
}
