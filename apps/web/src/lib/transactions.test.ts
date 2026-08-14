import { afterEach, describe, expect, it } from "vitest";
import { canCreateToken, clearPendingTrade, idleTransaction, MAX_IMAGE_BYTES, pendingTradeKey, persistPendingTrade, readPendingTrade, validateCreateToken, type TradeTransactionStatus, type TransactionStatus } from "./transactions";

afterEach(() => localStorage.clear());

describe("transaction foundation", () => {
  it("defines distinct lifecycle states", () => {
    const states: TransactionStatus[] = ["idle", "preparing", "awaiting_wallet", "submitted", "confirming", "confirmed", "failed", "rejected"];
    expect(new Set(states).size).toBe(8);
    expect(idleTransaction.status).toBe("idle");
    expect(states).toContain("failed");
    expect(states).toContain("rejected");
  });

  it("defines the required trade transaction state machine", () => {
    const states: TradeTransactionStatus[] = ["idle", "preparing", "awaiting_approval", "approval_confirming", "awaiting_wallet", "submitted", "confirming", "confirmation_unknown", "confirmed", "reverted", "replaced", "failed"];
    expect(new Set(states).size).toBe(12);
  });

  it("persists and isolates pending trades by wallet and token", () => {
    const wallet = "0x0000000000000000000000000000000000000001" as const;
    const token = "0x0000000000000000000000000000000000000002" as const;
    const hash = `0x${"ab".repeat(32)}` as const;
    const recovery = { sender: wallet, nonce: 3, to: token, value: "0", input: "0x1234", nextScanBlock: "99" } as const;
    persistPendingTrade({ version: 1, walletAddress: wallet, tokenAddress: token, side: "sell", hash, status: "confirmation_unknown", submittedAt: 1, recovery });
    expect(readPendingTrade(token, wallet)).toMatchObject({ side: "sell", hash, status: "confirmation_unknown", recovery });
    expect(readPendingTrade(token, "0x0000000000000000000000000000000000000003")).toBeNull();
    expect(localStorage.getItem(pendingTradeKey(token, wallet))).not.toBeNull();
    clearPendingTrade(token, wallet);
    expect(readPendingTrade(token, wallet)).toBeNull();
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
