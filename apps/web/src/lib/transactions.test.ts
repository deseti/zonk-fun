import { describe, expect, it } from "vitest";
import { idleTransaction, type TransactionStatus } from "./transactions";

describe("transaction foundation", () => {
  it("defines distinct lifecycle states", () => {
    const states: TransactionStatus[] = ["idle", "preparing", "awaiting_wallet", "submitted", "confirming", "confirmed", "failed", "rejected"];
    expect(new Set(states).size).toBe(8);
    expect(idleTransaction.status).toBe("idle");
    expect(states).toContain("failed");
    expect(states).toContain("rejected");
  });
});
