import { describe, expect, it, vi } from "vitest";
import * as contracts from "@/lib/contracts";
import { activeTradeStateQueryKey, loadActiveTradeState, selectActiveSigner, tradeInvalidationKeys } from "./token-trading";

describe("trade query refresh", () => {
  it("invalidates balances, pricing, token data, trades, and activity after confirmation", () => {
    const token = "0x0000000000000000000000000000000000000011" as const;
    expect(tradeInvalidationKeys(token)).toEqual([
      ["trade-state", token],
      ["curve-availability", token],
      ["trades", token],
      ["activity", token],
      ["token", token],
      ["tokens"],
      ["trending"],
    ]);
  });

  it("reads balances and allowance for the active wallet address", async () => {
    const token = "0x0000000000000000000000000000000000000011" as const;
    const external = "0x0000000000000000000000000000000000000022" as const;
    const state = { nativeBalance: BigInt(0), tokenBalance: BigInt(0) };
    const read = vi.spyOn(contracts, "readTradeState").mockResolvedValue(state as never);
    expect(activeTradeStateQueryKey(token, external)).toEqual(["trade-state", token, external]);
    await expect(loadActiveTradeState(token, external)).resolves.toBe(state);
    expect(read).toHaveBeenCalledWith(token, external);
  });

  it("keeps embedded and external signer selection separate without fallback", () => {
    const embedded = { sendTransaction: vi.fn() } as never;
    const external = { address: "0x0000000000000000000000000000000000000022", getEthereumProvider: vi.fn() } as never;
    expect(selectActiveSigner("embedded", { embedded, external })).toEqual({ mode: "embedded", client: embedded });
    expect(selectActiveSigner("external", { embedded, external })).toEqual({ mode: "external", wallet: external });
    expect(() => selectActiveSigner("external", { embedded })).toThrow(/selected external wallet is unavailable/i);
    expect(() => selectActiveSigner("embedded", { external })).toThrow(/embedded smart-wallet client is unavailable/i);
  });
});
