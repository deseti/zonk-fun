import { describe, expect, it } from "vitest";
import { isBaseSepolia, validAddress } from "./chain";
import { BASE_SEPOLIA_CHAIN_ID } from "@zonk/contracts-sdk";

describe("chain guard", () => {
  it("recognizes only Base Sepolia", () => {
    expect(BASE_SEPOLIA_CHAIN_ID).toBe(84532);
    expect(isBaseSepolia(84532)).toBe(true);
    expect(isBaseSepolia(8453)).toBe(false);
    expect(isBaseSepolia(undefined)).toBe(false);
  });
  it("validates addresses", () => {
    expect(validAddress("0x0000000000000000000000000000000000000001")).toBe(true);
    expect(validAddress("0x123")).toBe(false);
    expect(validAddress("not-an-address")).toBe(false);
  });
});
