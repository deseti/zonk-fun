import { describe, expect, it, vi, afterEach } from "vitest";
import * as contracts from "./contracts";
import { executeDevBuy, DevBuyAttemptError } from "./dev-buy";

const token = "0x0000000000000000000000000000000000000011" as const;
const creator = "0x0000000000000000000000000000000000000022" as const;
const creationHash = `0x${"aa".repeat(32)}` as const;
const buyHash = `0x${"bb".repeat(32)}` as const;
const quote = { tokenAmount: BigInt(12), reserveIn: BigInt(30), maxReserveIn: BigInt(34), curveCost: BigInt(28), protocolFee: BigInt(1), creatorFee: BigInt(1), slippageBps: 100, deadline: BigInt(Math.floor(Date.now() / 1000) + 300) };

afterEach(() => vi.restoreAllMocks());

function input(overrides: Partial<Parameters<typeof executeDevBuy>[0]> = {}) {
  return {
    tokenAddress: token,
    creatorAddress: creator,
    amount: BigInt(100000000000000000),
    creationHash,
    walletMode: "embedded" as const,
    getClientForChain: vi.fn().mockResolvedValue({ sendTransaction: vi.fn().mockResolvedValue(buyHash) }),
    report: vi.fn(),
    ...overrides,
  };
}

describe("optional Dev buy execution", () => {
  it("quotes and buys only after the creation receipt, then waits for the buy receipt", async () => {
    const order: string[] = [];
    vi.spyOn(contracts, "readTradeState").mockImplementation(async () => { order.push("state"); return {} as never; });
    vi.spyOn(contracts, "quoteBuyByBudget").mockImplementation(async () => { order.push("quote"); return quote; });
    vi.spyOn(contracts, "submitBuy").mockImplementation(async () => { order.push("submit"); return buyHash; });
    vi.spyOn(contracts, "confirmTrade").mockImplementation(async () => { order.push("receipt"); return { status: "confirmed", hash: buyHash }; });
    const report = vi.fn();
    const launch = input({ report });
    await expect(executeDevBuy(launch)).resolves.toBe(buyHash);
    expect(order).toEqual(["state", "quote", "submit", "receipt"]);
    expect(report.mock.calls.map(([state]) => state.status)).toEqual(["dev_buy_preparing", "dev_buy_awaiting_wallet", "dev_buy_submitted", "dev_buy_confirming", "dev_buy_confirmed"]);
  });

  it("uses the external wallet boundary and does not call the embedded client", async () => {
    const external = { address: creator, getEthereumProvider: vi.fn().mockResolvedValue({ request: vi.fn() }) } as never;
    const getClient = vi.fn();
    vi.spyOn(contracts, "readTradeState").mockResolvedValue({} as never);
    vi.spyOn(contracts, "quoteBuyByBudget").mockResolvedValue(quote);
    const submit = vi.spyOn(contracts, "submitExternalBuy").mockResolvedValue(buyHash);
    vi.spyOn(contracts, "confirmTrade").mockResolvedValue({ status: "confirmed", hash: buyHash });
    await expect(executeDevBuy(input({ walletMode: "external", externalWallet: external, getClientForChain: getClient }))).resolves.toBe(buyHash);
    expect(getClient).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("preserves a safe retry after wallet rejection and does not report creation failure", async () => {
    vi.spyOn(contracts, "readTradeState").mockResolvedValue({} as never);
    vi.spyOn(contracts, "quoteBuyByBudget").mockResolvedValue(quote);
    vi.spyOn(contracts, "submitBuy").mockRejectedValue(new Error("User rejected the request"));
    const failure = await expect(executeDevBuy(input())).rejects.toBeInstanceOf(DevBuyAttemptError);
    expect(failure).toBeTruthy();
    try { await executeDevBuy(input()); } catch (error) {
      expect(error).toMatchObject({ retryable: true, rejected: true, buyHash: undefined });
    }
  });
});
