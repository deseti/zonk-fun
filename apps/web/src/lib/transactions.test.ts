import { describe, expect, it } from "vitest";
import { canCreateToken, idleTransaction, MAX_IMAGE_BYTES, validateCreateToken, type TransactionStatus } from "./transactions";

describe("transaction foundation", () => {
  it("defines distinct lifecycle states", () => {
    const states: TransactionStatus[] = ["idle", "preparing", "awaiting_wallet", "submitted", "confirming", "confirmed", "failed", "rejected"];
    expect(new Set(states).size).toBe(8);
    expect(idleTransaction.status).toBe("idle");
    expect(states).toContain("failed");
    expect(states).toContain("rejected");
  });

  it("only allows creation on Base Sepolia while authenticated and idle", () => {
    expect(canCreateToken(84532, true, false)).toBe(true);
    expect(canCreateToken(1, true, false)).toBe(false);
    expect(canCreateToken(84532, false, false)).toBe(false);
    expect(canCreateToken(84532, true, true)).toBe(false);
  });

  it("validates metadata and image constraints", () => {
    const valid = { name: "Zonk", symbol: "ZK", description: "A token", supply: "1000", image: new File(["ok"], "token.png", { type: "image/png" }) };
    expect(validateCreateToken(valid)).toEqual({});
    expect(validateCreateToken({ ...valid, image: new File(["bad"], "token.svg", { type: "image/svg+xml" }) }).image).toMatch(/PNG/);
    expect(validateCreateToken({ ...valid, image: new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], "large.png", { type: "image/png" }) }).image).toMatch(/5 MB/);
  });
});
