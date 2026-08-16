"use client";

import { usePrivy, type BaseConnectedEthereumWallet } from "@privy-io/react-auth";
import { useSmartWallets, type SmartWalletClientType } from "@privy-io/react-auth/smart-wallets";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Address } from "viem";
import { TokenTradePanel, type TradeExecution, type TradeResume } from "@/components/token-trade-panel";
import { api } from "@/lib/api";
import { formatNative, formatTokenAmount, formatWeiUsd } from "@/lib/format";
import { captureTradeRecovery, checkTrade, confirmTrade, createExternalWalletClient, quoteBuyByBudget, quoteSellAmount, readCurveAvailability, readTradeState, submitBuy, submitExternalBuy, submitExternalSell, submitSell } from "@/lib/contracts";
import type { TradeRecovery } from "@/lib/transactions";
import { hasPrivyAppId } from "@/lib/wallet";
import { useActiveWallet } from "@/providers/active-wallet-provider";
import { useOraclePrice } from "@/providers/oracle-price-provider";

export function TokenTrading({ tokenAddress, symbol, tokenPriceWei, graduated = false }: { tokenAddress: Address; symbol: string; creator: Address; tokenPriceWei?: string | null; graduated?: boolean }) {
  if (graduated) return <section className="terminal-panel p-5" aria-label="Bonding-curve trading closed"><span className="badge-violet">Graduated</span><h2 className="mt-3 text-lg font-semibold text-white">External liquidity active</h2><p className="mt-2 text-sm leading-6 text-zinc-400">Bonding-curve trading has ended. This token now trades through external liquidity.</p><p className="mt-3 text-xs leading-5 text-zinc-600">Zonk.fun does not route Uniswap swaps in this phase. Indexed trade history remains available.</p></section>;
  if (!hasPrivyAppId) return <div className="status-box status-warning">Set NEXT_PUBLIC_PRIVY_APP_ID to enable Privy trading.</div>;
  return <PrivyTokenTrading tokenAddress={tokenAddress} symbol={symbol} tokenPriceWei={tokenPriceWei} />;
}

function PrivyTokenTrading({ tokenAddress, symbol, tokenPriceWei }: { tokenAddress: Address; symbol: string; tokenPriceWei?: string | null }) {
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

  if (availabilityQuery.isError) return <div className="status-box status-error">The deployed curve could not be read from Base Sepolia.</div>;
  if (availabilityQuery.isPending) return <div className="status-box text-zinc-400">Checking the token’s Base Sepolia curve…</div>;
	if (availabilityQuery.data === null) return <div className="status-box status-warning">The canonical endpoint curve is not available for this token.</div>;
  return <TokenTradePanel
      authenticated={authenticated}
      walletMode={mode}
      chainId={chainId}
      walletAddress={walletAddress}
      tokenAddress={tokenAddress}
      symbol={symbol}
      tokenPriceWei={tokenPriceWei}
      state={stateQuery.data}
      statePending={stateQuery.isPending && Boolean(walletAddress)}
      stateError={stateQuery.isError ? "Trading is unavailable because balances or an active Zonk curve could not be loaded." : undefined}
      quoteBuy={quoteBuy}
      quoteSell={quoteSell}
      execute={execute}
      resume={resume}
      check={check}
      onConfirmed={onConfirmed}
    />;
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

export function TokenTradeHistory({ tokenAddress, symbol }: { tokenAddress: Address; symbol: string }) {
  if (!hasPrivyAppId) return <TradeHistory tokenAddress={tokenAddress} symbol={symbol} />;
  return <PrivyTradeHistory tokenAddress={tokenAddress} symbol={symbol} />;
}

function PrivyTradeHistory({ tokenAddress, symbol }: { tokenAddress: Address; symbol: string }) {
  const { activeAddress } = useActiveWallet();
  return <TradeHistory tokenAddress={tokenAddress} symbol={symbol} walletAddress={activeAddress} />;
}

function TradeHistory({ tokenAddress, symbol, walletAddress }: { tokenAddress: Address; symbol: string; walletAddress?: Address }) {
  const { reference } = useOraclePrice();
  const [tab, setTab] = useState<"recent" | "yours">("recent");
  const trades = useQuery({
    queryKey: ["trades", tokenAddress],
    queryFn: () => api.trades(tokenAddress, "?limit=20"),
    refetchInterval: 15_000,
  });
  const visible = trades.data?.items.filter((trade) => tab === "recent" || (walletAddress && trade.trader.toLowerCase() === walletAddress.toLowerCase()));
  return <section className="terminal-panel min-w-0" aria-label="Indexed trade history">
    <div className="flex items-center justify-between gap-3 border-b border-white/8 p-4"><div className="flex rounded-lg border border-white/8 bg-black/20 p-0.5" role="group" aria-label="Trade history view"><button type="button" className={`min-h-9 rounded-md px-3 text-xs font-semibold ${tab === "recent" ? "bg-white/10 text-white" : "text-zinc-500"}`} aria-pressed={tab === "recent"} onClick={() => setTab("recent")}>Recent trades</button><button type="button" className={`min-h-9 rounded-md px-3 text-xs font-semibold ${tab === "yours" ? "bg-cyan-300/10 text-cyan-200" : "text-zinc-500"}`} aria-pressed={tab === "yours"} disabled={!walletAddress} onClick={() => setTab("yours")}>Your trades</button></div><span className="badge-neutral">Finalized</span></div>
    <p className="px-4 pt-3 text-xs leading-5 text-zinc-600">The “Your trades” view filters the currently loaded recent records for the active wallet.</p>
    {trades.isPending && <p className="mt-5 text-sm text-zinc-400">Loading trade history…</p>}
    {trades.isError && <p className="mt-5 text-sm text-red-300">Trade history could not be loaded.</p>}
    {visible?.length === 0 && <p className="m-4 text-sm text-zinc-400">{tab === "yours" ? "No trades from the active wallet are present in the recent indexed window." : "No indexed trades yet."}</p>}
    {visible && visible.length > 0 && <ul className="grid max-h-[43rem] divide-y divide-white/6 overflow-y-auto">
      {visible.map((trade) => <li className="p-4 text-sm transition-colors hover:bg-white/[0.02]" key={`${trade.transaction_hash}:${trade.log_index}`}>
        <div className="flex items-center justify-between gap-3"><span className={trade.side === "buy" ? "text-emerald-300" : "text-rose-300"}>{trade.side.toUpperCase()}</span><span className="font-mono text-xs text-zinc-600">#{trade.block_number}</span></div>
        <p className="mt-2 font-medium text-zinc-100">{formatWeiUsd(trade.reserve_amount, reference)}</p><p className="mt-0.5 text-xs text-zinc-500">{formatTokenAmount(trade.token_amount, 18, symbol)} · {formatNative(trade.reserve_amount)}</p>
        <a className="mt-2 inline-block text-cyan-300 hover:text-cyan-200" href={`https://sepolia.basescan.org/tx/${trade.transaction_hash}`} target="_blank" rel="noreferrer">View on BaseScan ↗</a>
      </li>)}
    </ul>}{!reference && <p className="border-t border-white/8 px-4 py-3 text-xs text-zinc-600">USD unavailable · exact indexed ETH values remain visible.</p>}
  </section>;
}
