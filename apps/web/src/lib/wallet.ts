import { baseSepolia, BASE_SEPOLIA_CHAIN_ID } from "@zonk/contracts-sdk";
import type { BaseConnectedEthereumWallet, PrivyClientConfig } from "@privy-io/react-auth";
import { isBaseSepolia } from "@/lib/chain";

export const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() ?? "";
export const hasPrivyAppIdValue = (value: string | undefined) => Boolean(value?.trim());
export const hasPrivyAppId = hasPrivyAppIdValue(privyAppId);
export const privyLoginMethods = ["wallet", "email", "google", "twitter"] as const;
export const privyExternalWalletList = ["detected_ethereum_wallets", "metamask", "coinbase_wallet", "rainbow", "wallet_connect"] as const;

export function isPrivyEmbeddedWallet(wallet: Pick<BaseConnectedEthereumWallet, "walletClientType">) {
  return wallet.walletClientType === "privy";
}

export function isExternalWallet(wallet: Pick<BaseConnectedEthereumWallet, "walletClientType">) {
  return !isPrivyEmbeddedWallet(wallet);
}

export function parsePrivyChainId(chainId: string | number | undefined): number | undefined {
  if (chainId === undefined) return undefined;
  const value = typeof chainId === "string" && chainId.includes(":") ? chainId.split(":").at(-1) : chainId;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

export type PrivyWalletState =
  | "logged_out"
  | "logging_in"
  | "logged_in_without_embedded_wallet"
  | "embedded_wallet_creating"
  | "smart_wallet_ready"
  | "wrong_network"
  | "error";

export function derivePrivyWalletState(input: {
  ready: boolean;
  authenticated: boolean;
  loginPending: boolean;
  createPending: boolean;
  hasEmbeddedWallet: boolean;
  hasSmartWalletAddress: boolean;
  hasSmartWalletClient: boolean;
  chainId?: number;
  error?: unknown;
}): PrivyWalletState {
  if (input.error) return "error";
  if (!input.ready || input.loginPending) return "logging_in";
  if (!input.authenticated) return "logged_out";
  if (!input.hasEmbeddedWallet) return input.createPending ? "embedded_wallet_creating" : "logged_in_without_embedded_wallet";
  if (!isBaseSepolia(input.chainId)) return "wrong_network";
  if (!input.hasSmartWalletAddress || !input.hasSmartWalletClient) return "embedded_wallet_creating";
  return "smart_wallet_ready";
}

export function canPrepareTransaction(chainId: number | undefined, authenticated: boolean, smartWalletReady: boolean) {
  return authenticated && smartWalletReady && isBaseSepolia(chainId);
}

export const privyConfig: PrivyClientConfig = {
  defaultChain: baseSepolia,
  supportedChains: [baseSepolia],
  loginMethods: [...privyLoginMethods],
  appearance: {
    showWalletLoginFirst: true,
    walletChainType: "ethereum-only",
    walletList: [...privyExternalWalletList],
  },
  externalWallets: {},
  embeddedWallets: {
    ethereum: { createOnLogin: "all-users" },
    showWalletUIs: true,
  },
};

export { BASE_SEPOLIA_CHAIN_ID };
