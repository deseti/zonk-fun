import type { BaseConnectedEthereumWallet } from "@privy-io/react-auth";
import type { SmartWalletClientType } from "@privy-io/react-auth/smart-wallets";
import type { Address, Hash } from "viem";
import { confirmTrade, createExternalWalletClient, quoteBuyByBudget, readTradeState, submitBuy, submitExternalBuy } from "@/lib/contracts";
import { DEFAULT_BUY_SLIPPAGE_BPS, type TransactionState } from "@/lib/transactions";
import { selectedZonkChainId, selectedZonkChainName } from "@/lib/chain";

export class DevBuyAttemptError extends Error {
  constructor(message: string, public readonly retryable: boolean, public readonly buyHash?: Hash, public readonly rejected = false) {
    super(message);
    this.name = "DevBuyAttemptError";
  }
}

export type DevBuyInput = {
  tokenAddress: Address;
  creatorAddress: Address;
  amount: bigint;
  creationHash: Hash;
  walletMode: "embedded" | "external";
  externalWallet?: BaseConnectedEthereumWallet;
  getClientForChain: (chain: { id: number }) => Promise<SmartWalletClientType | null | undefined>;
  report: (state: TransactionState) => void;
};

export async function executeDevBuy(input: DevBuyInput): Promise<Hash> {
  const { tokenAddress, creatorAddress, amount, creationHash, walletMode, externalWallet, getClientForChain, report } = input;
  report({ status: "dev_buy_preparing", hash: creationHash });
  let buyHash: Hash | undefined;
  try {
    const state = await readTradeState(tokenAddress, creatorAddress);
    const quote = await quoteBuyByBudget(tokenAddress, amount, state, DEFAULT_BUY_SLIPPAGE_BPS);
    if (walletMode === "external") {
      if (!externalWallet || externalWallet.address.toLowerCase() !== creatorAddress.toLowerCase()) throw new Error("The selected external wallet does not match the active account.");
      const provider = await externalWallet.getEthereumProvider();
      report({ status: "dev_buy_awaiting_wallet", hash: creationHash });
      buyHash = await submitExternalBuy(createExternalWalletClient(provider, creatorAddress), creatorAddress, tokenAddress, quote);
    } else {
      const client = await getClientForChain({ id: selectedZonkChainId });
      if (!client) throw new Error(`The ${selectedZonkChainName} smart-wallet client is unavailable.`);
      report({ status: "dev_buy_awaiting_wallet", hash: creationHash });
      buyHash = await submitBuy(client, creatorAddress, tokenAddress, quote);
    }
    report({ status: "dev_buy_submitted", hash: buyHash });
    report({ status: "dev_buy_confirming", hash: buyHash });
    const confirmation = await confirmTrade(buyHash, "buy", tokenAddress, creatorAddress);
    if (confirmation.status === "confirmed") {
      report({ status: "dev_buy_confirmed", hash: confirmation.hash });
      return confirmation.hash;
    }
    if (confirmation.status === "reverted") throw new DevBuyAttemptError(`The Dev buy transaction reverted on ${selectedZonkChainName}.`, true, confirmation.hash);
    throw new DevBuyAttemptError("The Dev buy transaction still needs a definitive receipt before it can be retried.", false, confirmation.hash);
  } catch (error) {
    if (error instanceof DevBuyAttemptError) throw error;
    const message = error instanceof Error ? error.message : "The Dev buy could not be completed.";
    throw new DevBuyAttemptError(message, !buyHash, buyHash, /reject|denied|cancelled/i.test(message));
  }
}
