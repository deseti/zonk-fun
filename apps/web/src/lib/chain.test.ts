import { describe, expect, it } from "vitest";
import { isSelectedZonkChain, selectedZonkChainId, validAddress } from "./chain";
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  resolveZonkChain,
} from "@zonk/contracts-sdk";

describe("chain guard", () => {
  it("recognizes only the configured Zonk chain", () => {
    expect(BASE_SEPOLIA_CHAIN_ID).toBe(84532);
    expect(isSelectedZonkChain(selectedZonkChainId)).toBe(true);
    expect(isSelectedZonkChain(84532)).toBe(false);
    expect(isSelectedZonkChain(undefined)).toBe(false);
  });
  it("resolves exactly the two supported Zonk chains", () => {
    const sepolia = resolveZonkChain("84532");
    const mainnet = resolveZonkChain(8453);
    expect(sepolia.id).toBe(BASE_SEPOLIA_CHAIN_ID);
    expect(sepolia.blockExplorers.default.url).toBe("https://sepolia.basescan.org");
    expect(mainnet.id).toBe(BASE_MAINNET_CHAIN_ID);
    expect(mainnet.blockExplorers.default.url).toBe("https://basescan.org");
    expect(() => resolveZonkChain("1")).toThrow("Unsupported Zonk chain ID");
    expect(() => resolveZonkChain("invalid")).toThrow("Unsupported Zonk chain ID");
    expect(() => resolveZonkChain("8.453e3")).toThrow("Unsupported Zonk chain ID");
  });
  it("validates addresses", () => {
    expect(validAddress("0x0000000000000000000000000000000000000001")).toBe(true);
    expect(validAddress("0x123")).toBe(false);
    expect(validAddress("not-an-address")).toBe(false);
  });
});
