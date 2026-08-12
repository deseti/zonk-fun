import { BASE_SEPOLIA_CHAIN_ID } from "@zonk/contracts-sdk";
import type { Address } from "viem";

export function isBaseSepolia(chainId: number | undefined): boolean { return chainId === BASE_SEPOLIA_CHAIN_ID; }
export function validAddress(value: string): value is Address { return /^0x[0-9a-fA-F]{40}$/.test(value); }
