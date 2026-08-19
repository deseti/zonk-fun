import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  baseSepolia,
  resolveZonkChain,
  type ZonkChain,
} from "@zonk/contracts-sdk";
import type { Address } from "viem";

const configuredChainId = process.env.NEXT_PUBLIC_ZONK_CHAIN_ID?.trim() || String(BASE_SEPOLIA_CHAIN_ID);

export const selectedZonkChain: ZonkChain = resolveZonkChain(configuredChainId);
export const selectedZonkChainId = selectedZonkChain.id;
export const selectedZonkChainName = selectedZonkChain.name;
export const selectedZonkExplorer = selectedZonkChain.blockExplorers.default.url;
export const selectedZonkRPCURL = selectedZonkChainId === BASE_MAINNET_CHAIN_ID
  ? process.env.NEXT_PUBLIC_BASE_MAINNET_RPC_URL?.trim() || selectedZonkChain.rpcUrls.default.http[0]
  : process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL?.trim() || baseSepolia.rpcUrls.default.http[0];

export function isSelectedZonkChain(chainId: number | undefined): boolean {
  return chainId === selectedZonkChainId;
}
export function explorerTransactionURL(hash: string): string { return `${selectedZonkExplorer}/tx/${hash}`; }
export function explorerAddressURL(address: string): string { return `${selectedZonkExplorer}/address/${address}`; }
export function validAddress(value: string): value is Address { return /^0x[0-9a-fA-F]{40}$/.test(value); }
