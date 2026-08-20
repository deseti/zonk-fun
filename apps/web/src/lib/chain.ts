import {
  BASE_MAINNET_CHAIN_ID,
  baseMainnet,
} from "@zonk/contracts-sdk";
import type { Address } from "viem";

const configuredChainId = process.env.NEXT_PUBLIC_ZONK_CHAIN_ID?.trim() || String(BASE_MAINNET_CHAIN_ID);
if (configuredChainId !== String(BASE_MAINNET_CHAIN_ID)) throw new Error(`Zonk.fun web requires Base Mainnet chain ID ${BASE_MAINNET_CHAIN_ID}; received ${configuredChainId}.`);

export const selectedZonkChain = baseMainnet;
export const selectedZonkChainId = selectedZonkChain.id;
export const selectedZonkChainName = selectedZonkChain.name;
export const selectedZonkExplorer = selectedZonkChain.blockExplorers.default.url;
export const selectedZonkRPCURL = process.env.NEXT_PUBLIC_BASE_MAINNET_RPC_URL?.trim() || selectedZonkChain.rpcUrls.default.http[0];

export function isSelectedZonkChain(chainId: number | undefined): boolean {
  return chainId === selectedZonkChainId;
}
export function explorerTransactionURL(hash: string): string { return `${selectedZonkExplorer}/tx/${hash}`; }
export function explorerAddressURL(address: string): string { return `${selectedZonkExplorer}/address/${address}`; }
export function validAddress(value: string): value is Address { return /^0x[0-9a-fA-F]{40}$/.test(value); }
