import { afterEach, describe, expect, it, vi } from "vitest";
import type { Address, Hash } from "viem";
import { contractAddresses, publicClient, quoteBuyByBudget, quoteSellAmount, readCurveAvailability, readTradeState, submitBuy, submitSell } from "./contracts";

const factory = "0x90B371F571975a0b0693Dc3C46Eea19733c72ddD" as Address;
const token = "0xEC2710A9df34b66B07BF96933d13B76e1d526c07" as Address;
const curve = "0x83Cae06f86672038d203E3676Ae1943D36f3E2a2" as Address;
const wallet = "0x0000000000000000000000000000000000000022" as Address;
const hash = `0x${"ab".repeat(32)}` as Hash;

afterEach(() => vi.restoreAllMocks());

describe("Base Mainnet curve reads", () => {
  it("resolves the canonical deployed curve and validates bytecode/ABI without a wallet", async () => {
    contractAddresses.zonkFactory = factory;
    vi.spyOn(publicClient, "getChainId").mockResolvedValue(8453);
    vi.spyOn(publicClient, "getBytecode").mockResolvedValue("0x6000");
    vi.spyOn(publicClient, "readContract").mockImplementation(async (request) => {
      if (request.functionName === "curveOf") return curve;
      if (request.functionName === "factory") return factory;
      if (request.functionName === "token") return token;
      if (request.functionName === "creator") return wallet;
      if (request.functionName === "graduated") return false;
      throw new Error(`unexpected ${request.functionName}`);
    });
    await expect(readCurveAvailability(token)).resolves.toEqual({ address: curve, state: { creator: wallet, graduated: false } });
  });

  it("reports missing curve bytecode precisely", async () => {
    contractAddresses.zonkFactory = factory;
    vi.spyOn(publicClient, "getChainId").mockResolvedValue(8453);
    vi.spyOn(publicClient, "getBytecode").mockResolvedValueOnce("0x6000").mockResolvedValueOnce(undefined);
    vi.spyOn(publicClient, "readContract").mockResolvedValue(curve as never);
    await expect(readCurveAvailability(token)).rejects.toThrow(/no curve bytecode exists.*Base Mainnet/i);
  });

  it("reports wrong RPC chain separately", async () => {
    vi.spyOn(publicClient, "getChainId").mockResolvedValue(84532);
    await expect(readCurveAvailability(token)).rejects.toThrow(/RPC returned chain ID 84532.*8453/i);
  });

  it("loads bonding-curve state before any wallet is connected", async () => {
    contractAddresses.zonkCurve = curve;
    const balance = vi.spyOn(publicClient, "getBalance");
    vi.spyOn(publicClient, "readContract").mockImplementation(async (request) => {
      if (request.functionName === "soldSupply") return BigInt(12);
      if (request.functionName === "activeEthReserve") return BigInt(34);
      if (request.functionName === "graduated") return false;
      if (request.functionName === "decimals") return 18;
      throw new Error(`wallet-dependent read attempted: ${request.functionName}`);
    });
    await expect(readTradeState(token)).resolves.toMatchObject({ soldSupply: BigInt(12), reserveBalance: BigInt(34), nativeBalance: BigInt(0), tokenBalance: BigInt(0), allowance: BigInt(0) });
    expect(balance).not.toHaveBeenCalled();
  });
});

describe("browser-wallet curve transactions", () => {
  it("loads Base Mainnet buy and sell quotes", async () => {
    contractAddresses.zonkCurve = curve;
    vi.spyOn(publicClient, "readContract").mockImplementation(async (request) => request.functionName === "quoteBuy"
      ? { acceptedGross: BigInt(990), netCurveInput: BigInt(970), protocolFee: BigInt(3), creatorFee: BigInt(4), tokensOut: BigInt(1000) }
      : { netSellerOutput: BigInt(900), grossCurveOutput: BigInt(920), protocolFee: BigInt(3), creatorFee: BigInt(4) });
    await expect(quoteBuyByBudget(token, BigInt(1000), { soldSupply: BigInt(0), graduationThreshold: BigInt(1) }, 50)).resolves.toMatchObject({ tokenAmount: BigInt(1000), maxReserveIn: BigInt(1000) });
    await expect(quoteSellAmount(token, BigInt(1000), 50)).resolves.toMatchObject({ tokenAmount: BigInt(1000), minReserveOut: BigInt(895) });
  });

  it("simulates the exact buy before requesting browser-wallet confirmation", async () => {
    contractAddresses.zonkCurve = curve;
    const order: string[] = [];
    vi.spyOn(publicClient, "getBalance").mockResolvedValue(BigInt(100));
    vi.spyOn(publicClient, "simulateContract").mockImplementation(async () => { order.push("simulate"); return { request: { address: curve } } as never; });
    const client = { writeContract: vi.fn(async () => { order.push("wallet"); return hash; }) } as never;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 60);
    await expect(submitBuy(client, wallet, token, { reserveIn: BigInt(1), curveCost: BigInt(1), protocolFee: BigInt(0), creatorFee: BigInt(0), tokenAmount: BigInt(10), maxReserveIn: BigInt(1), slippageBps: 50, deadline })).resolves.toBe(hash);
    expect(order).toEqual(["simulate", "wallet"]);
  });

  it("waits for approval, re-reads allowance, simulates sell, then requests sell", async () => {
    contractAddresses.zonkCurve = curve;
    let allowance = BigInt(0);
    vi.spyOn(publicClient, "readContract").mockImplementation(async (request) => request.functionName === "allowance" ? allowance : BigInt(100));
    vi.spyOn(publicClient, "simulateContract").mockResolvedValue({ request: { address: curve } } as never);
    vi.spyOn(publicClient, "waitForTransactionReceipt").mockImplementation(async () => { allowance = BigInt(100); return { status: "success" } as never; });
    const writeContract = vi.fn().mockResolvedValueOnce(hash).mockResolvedValueOnce(`0x${"cd".repeat(32)}`);
    const events: string[] = [];
    await submitSell({ writeContract } as never, wallet, token, { reserveOut: BigInt(90), curveValue: BigInt(95), protocolFee: BigInt(1), creatorFee: BigInt(1), tokenAmount: BigInt(100), minReserveOut: BigInt(89), slippageBps: 50, deadline: BigInt(Math.floor(Date.now() / 1000) + 60) }, {
      onApprovalRequested: () => events.push("approval_requested"), onApprovalSubmitted: () => events.push("approval_submitted"), onApprovalConfirmed: () => events.push("approval_confirmed"), onSellRequested: () => events.push("sell_requested"),
    });
    expect(events).toEqual(["approval_requested", "approval_submitted", "approval_confirmed", "sell_requested"]);
    expect(writeContract).toHaveBeenCalledTimes(2);
  });

  it("separates rejected signatures and insufficient token balance", async () => {
    contractAddresses.zonkCurve = curve;
    vi.spyOn(publicClient, "simulateContract").mockResolvedValue({ request: { address: curve } } as never);
    vi.spyOn(publicClient, "getBalance").mockResolvedValue(BigInt(100));
    const rejected = { writeContract: vi.fn().mockRejectedValue(new Error("User rejected the request")) } as never;
    await expect(submitBuy(rejected, wallet, token, { reserveIn: BigInt(1), curveCost: BigInt(1), protocolFee: BigInt(0), creatorFee: BigInt(0), tokenAmount: BigInt(10), maxReserveIn: BigInt(1), slippageBps: 50, deadline: BigInt(Math.floor(Date.now() / 1000) + 60) })).rejects.toThrow(/User rejected/);
    vi.spyOn(publicClient, "readContract").mockImplementation(async (request) => request.functionName === "allowance" ? BigInt(0) : BigInt(1));
    await expect(submitSell({ writeContract: vi.fn() } as never, wallet, token, { reserveOut: BigInt(1), curveValue: BigInt(1), protocolFee: BigInt(0), creatorFee: BigInt(0), tokenAmount: BigInt(2), minReserveOut: BigInt(1), slippageBps: 50, deadline: BigInt(Math.floor(Date.now() / 1000) + 60) }, { onApprovalRequested() {}, onApprovalSubmitted() {}, onApprovalConfirmed() {}, onSellRequested() {} })).rejects.toThrow(/insufficient token balance/i);
  });
});
