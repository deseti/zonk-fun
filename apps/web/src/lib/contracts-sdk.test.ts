import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, getAddress, type Hex } from "viem";
import {
  encodeBuy,
  encodeCreateToken,
  encodeSell,
  FIXED_TOKEN_SUPPLY,
  maxInputWithSlippage,
  minOutputWithSlippage,
  parseTokenLaunchedReceipt,
  parseTradeReceipt,
  zonkCurveAbi,
  zonkFactoryAbi,
} from "@zonk/contracts-sdk";
import type { SmartWalletClientType } from "@privy-io/react-auth/smart-wallets";
import { assertBuyQuoteFresh, buildSellCalls, contractAddresses, createExternalWalletClient, privyTransactionUiOptions, publicClient, sendSmartWalletTransaction, submitBuy, submitCreateToken, submitExternalBuy, submitExternalCreateToken, submitExternalSell, submitSell, type ExternalWalletClient } from "./contracts";

const factory = "0x11657C36DDa4F6E9C4b6d73ed56DF91d65d500E4" as const;
const token = "0x0000000000000000000000000000000000000011" as const;
const creator = "0x0000000000000000000000000000000000000022" as const;
const curve = "0x0000000000000000000000000000000000000033" as const;

describe("factory SDK", () => {
  it("encodes the exact atomic createToken signature", () => {
    expect(decodeFunctionData({ abi: zonkFactoryAbi, data: encodeCreateToken("Zonk", "ZK", `0x${"01".repeat(32)}`) })).toEqual({
      functionName: "createToken",
      args: ["Zonk", "ZK", `0x${"01".repeat(32)}`],
    });
  });
  it("decodes the exact canonical TokenLaunched event", () => {
    const topics = encodeEventTopics({ abi: zonkFactoryAbi, eventName: "TokenLaunchedV3", args: { creator, token, curve } });
    const data = encodeAbiParameters([{type:"string"},{type:"uint256"},{type:"uint256"},{type:"uint256"},{type:"address"},{type:"address"},{type:"bytes32"},{type:"bytes32"},{type:"uint16"}], ["endpoint-cp-v3",BigInt("1000000000000000000000000000"),BigInt("800000000000000000000000000"),BigInt("200000000000000000000000000"),creator,"0x0000000000000000000000000000000000000044",`0x${"02".repeat(32)}`,`0x${"03".repeat(32)}`,0]);
    const logTopics = topics.filter((topic): topic is Hex => typeof topic === "string");
    expect(parseTokenLaunchedReceipt({ status:"success", logs:[{address:factory,data,topics:logTopics}] },factory)).toEqual({token:getAddress(token),curve:getAddress(curve),creator:getAddress(creator),protocolVersion:"endpoint-cp-v3",totalSupply:FIXED_TOKEN_SUPPLY,curveAllocation:BigInt("800000000000000000000000000"),lpAllocation:BigInt("200000000000000000000000000"),canonicalPool:getAddress("0x0000000000000000000000000000000000000044")});
  });
  it("rejects malformed or reverted receipts", () => {
    expect(() => parseTokenLaunchedReceipt({status:"success",logs:[]},factory)).toThrow(/exactly one/);
    expect(() => parseTokenLaunchedReceipt({status:"reverted",logs:[]},factory)).toThrow(/reverted/);
  });
});

describe("curve trade SDK", () => {
  it("rejects stale protected buy quotes", () => {
    expect(() => assertBuyQuoteFresh({ deadline: BigInt(Math.floor(Date.now() / 1000) - 1) })).toThrow(/expired/i);
  });

  it("requires Privy's confirmation UI for direct smart-wallet calls", async () => {
    const hash = `0x${"ab".repeat(32)}` as const;
    const sendTransaction = vi.fn().mockResolvedValue(hash);
    const client = { sendTransaction } as unknown as SmartWalletClientType;
    const calls = [{ to: curve, data: "0x" as const }];
    await expect(sendSmartWalletTransaction(client, { calls }, { action: "Buy token", description: "Review protected buy" })).resolves.toBe(hash);
    expect(sendTransaction).toHaveBeenCalledWith({ calls }, {
      uiOptions: expect.objectContaining({
        showWalletUIs: true,
        isCancellable: true,
        buttonText: "Authorize transaction",
        description: "Review protected buy",
        transactionInfo: expect.objectContaining({ action: "Buy token" }),
      }),
    });
  });

  it("does not permit callers to silently disable the Privy transaction modal", () => {
    expect(privyTransactionUiOptions({ action: "Create token", description: "Create ZK" }).showWalletUIs).toBe(true);
  });

  it("shows Privy confirmation before create, buy, and atomic approval + sell submission", async () => {
    const previousFactory = contractAddresses.zonkFactory;
    const previousCurve = contractAddresses.zonkCurve;
    contractAddresses.zonkFactory = factory;
    contractAddresses.zonkCurve = curve;
    const simulate = vi.spyOn(publicClient, "simulateContract").mockResolvedValue({} as never);
    const hash = `0x${"ab".repeat(32)}` as const;
    const sendTransaction = vi.fn().mockResolvedValue(hash);
    const client = { sendTransaction } as unknown as SmartWalletClientType;
    const buyQuote = { tokenAmount: BigInt(12), reserveIn: BigInt(30), maxReserveIn: BigInt(34), curveCost: BigInt(28), protocolFee: BigInt(1), creatorFee: BigInt(1), slippageBps: 100, deadline: BigInt(Math.floor(Date.now() / 1000) + 300) };
    const sellQuote = { tokenAmount: BigInt(56), reserveOut: BigInt(90), minReserveOut: BigInt(78), curveValue: BigInt(92), protocolFee: BigInt(1), creatorFee: BigInt(1), slippageBps: 100, deadline: BigInt(99) };
    try {
      await submitCreateToken(client, creator, "Zonk", "ZK", { startingPrice: BigInt(1), slope: BigInt(2), graduationThreshold: BigInt(3) });
      await submitBuy(client, creator, token, buyQuote);
      await submitSell(client, creator, token, sellQuote, BigInt(0));
      expect(sendTransaction).toHaveBeenCalledTimes(3);
      for (const call of sendTransaction.mock.calls) expect(call[1]?.uiOptions?.showWalletUIs).toBe(true);
      expect(sendTransaction.mock.calls[0][1].uiOptions.transactionInfo.action).toBe("Create token");
      expect(sendTransaction.mock.calls[1][1].uiOptions.transactionInfo.action).toBe("Buy token");
      expect(sendTransaction.mock.calls[2][1].uiOptions.transactionInfo.action).toBe("Approve + sell");
      expect(sendTransaction.mock.calls[2][0].calls).toHaveLength(2);
    } finally {
      simulate.mockRestore();
      contractAddresses.zonkFactory = previousFactory;
      contractAddresses.zonkCurve = previousCurve;
    }
  });

  it("uses the external signer for buy without invoking a smart-wallet batch", async () => {
    const previousCurve = contractAddresses.zonkCurve;
    contractAddresses.zonkCurve = curve;
    const simulate = vi.spyOn(publicClient, "simulateContract").mockResolvedValue({} as never);
    const hash = `0x${"31".repeat(32)}` as const;
    const sendTransaction = vi.fn().mockResolvedValue(hash);
    const client = { sendTransaction } as unknown as ExternalWalletClient;
    const quote = { tokenAmount: BigInt(12), reserveIn: BigInt(30), maxReserveIn: BigInt(34), curveCost: BigInt(28), protocolFee: BigInt(1), creatorFee: BigInt(1), slippageBps: 100, deadline: BigInt(Math.floor(Date.now() / 1000) + 300) };
    try {
      await expect(submitExternalBuy(client, creator, token, quote)).resolves.toBe(hash);
      expect(sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ account: creator, chain: expect.objectContaining({ id: 84532 }), to: curve, value: quote.maxReserveIn }));
      expect(sendTransaction.mock.calls[0]).toHaveLength(1);
    } finally {
      simulate.mockRestore();
      contractAddresses.zonkCurve = previousCurve;
    }
  });

  it("routes external create directly through the browser wallet without Privy UI or UserOperation calls", async () => {
    const previousFactory = contractAddresses.zonkFactory;
    contractAddresses.zonkFactory = factory;
    const simulate = vi.spyOn(publicClient, "simulateContract").mockResolvedValue({} as never);
    const hash = `0x${"33".repeat(32)}` as const;
    const sendTransaction = vi.fn().mockResolvedValue(hash);
    const client = { sendTransaction } as unknown as ExternalWalletClient;
    try {
      await expect(submitExternalCreateToken(client, creator, "External", "EXT", { userSalt: `0x${"04".repeat(32)}` })).resolves.toBe(hash);
      expect(sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ account: creator, chain: expect.objectContaining({ id: 84532 }), to: factory }));
      expect(sendTransaction.mock.calls[0][0]).not.toHaveProperty("calls");
      expect(sendTransaction.mock.calls[0][1]).toBeUndefined();
    } finally {
      simulate.mockRestore();
      contractAddresses.zonkFactory = previousFactory;
    }
  });

  it("sends external transactions through the selected wallet EIP-1193 provider", async () => {
    const previousCurve = contractAddresses.zonkCurve;
    contractAddresses.zonkCurve = curve;
    const simulate = vi.spyOn(publicClient, "simulateContract").mockResolvedValue({} as never);
    const hash = `0x${"32".repeat(32)}` as const;
    const request = vi.fn().mockImplementation(async ({ method }: { method: string }) => method === "eth_chainId" ? "0x14a34" : hash);
    const quote = { tokenAmount: BigInt(12), reserveIn: BigInt(30), maxReserveIn: BigInt(34), curveCost: BigInt(28), protocolFee: BigInt(1), creatorFee: BigInt(1), slippageBps: 100, deadline: BigInt(Math.floor(Date.now() / 1000) + 300) };
    try {
      const client = createExternalWalletClient({ request } as never, creator);
      await expect(submitExternalBuy(client, creator, token, quote)).resolves.toBe(hash);
      const sendRequest = request.mock.calls.find(([input]) => input.method === "eth_sendTransaction")?.[0];
      expect(sendRequest?.method).toBe("eth_sendTransaction");
      expect(sendRequest?.params[0]).toMatchObject({ from: creator.toLowerCase(), to: curve.toLowerCase() });
    } finally {
      simulate.mockRestore();
      contractAddresses.zonkCurve = previousCurve;
    }
  });

  it("confirms external approval before requesting the sell transaction", async () => {
    const previousCurve = contractAddresses.zonkCurve;
    contractAddresses.zonkCurve = curve;
    const simulate = vi.spyOn(publicClient, "simulateContract").mockResolvedValue({} as never);
    const approvalHash = `0x${"41".repeat(32)}` as const;
    const sellHash = `0x${"42".repeat(32)}` as const;
    const wait = vi.spyOn(publicClient, "waitForTransactionReceipt").mockResolvedValue({ status: "success" } as never);
    const allowances = [BigInt(0), BigInt(56)];
    const read = vi.spyOn(publicClient, "readContract").mockImplementation(async (input: unknown) => {
      return (input as { functionName: string }).functionName === "allowance" ? allowances.shift()! : BigInt(100);
    });
    const sendTransaction = vi.fn().mockResolvedValueOnce(approvalHash).mockResolvedValueOnce(sellHash);
    const callbacks = { onApprovalRequested: vi.fn(), onApprovalSubmitted: vi.fn(), onApprovalConfirmed: vi.fn(), onSellRequested: vi.fn() };
    const quote = { tokenAmount: BigInt(56), reserveOut: BigInt(90), minReserveOut: BigInt(78), curveValue: BigInt(92), protocolFee: BigInt(1), creatorFee: BigInt(1), slippageBps: 100, deadline: BigInt(Math.floor(Date.now() / 1000) + 300) };
    try {
      await expect(submitExternalSell({ sendTransaction } as unknown as ExternalWalletClient, creator, token, quote, callbacks)).resolves.toBe(sellHash);
      expect(sendTransaction).toHaveBeenCalledTimes(2);
      expect(sendTransaction.mock.calls[0][0]).toMatchObject({ account: creator, to: token });
      expect(wait).toHaveBeenCalledWith(expect.objectContaining({ hash: approvalHash, confirmations: 1 }));
      expect(read.mock.calls.filter(([input]) => (input as { functionName: string }).functionName === "allowance")).toHaveLength(2);
      expect(callbacks.onApprovalSubmitted).toHaveBeenCalledWith(approvalHash);
      expect(callbacks.onApprovalConfirmed).toHaveBeenCalledWith(approvalHash);
      expect(callbacks.onSellRequested).toHaveBeenCalledTimes(1);
      expect(sendTransaction.mock.calls[1][0]).toMatchObject({ account: creator, to: curve });
      expect(callbacks.onApprovalConfirmed.mock.invocationCallOrder[0]).toBeLessThan(sendTransaction.mock.invocationCallOrder[1]);
      expect(callbacks.onSellRequested.mock.invocationCallOrder[0]).toBeLessThan(sendTransaction.mock.invocationCallOrder[1]);
    } finally {
      simulate.mockRestore();
      wait.mockRestore();
      read.mockRestore();
      contractAddresses.zonkCurve = previousCurve;
    }
  });

  it("automatically submits sell after a lagging approval allowance becomes visible", async () => {
    const previousCurve = contractAddresses.zonkCurve;
    contractAddresses.zonkCurve = curve;
    const simulate = vi.spyOn(publicClient, "simulateContract").mockResolvedValue({} as never);
    const approvalHash = `0x${"43".repeat(32)}` as const;
    const sellHash = `0x${"44".repeat(32)}` as const;
    const wait = vi.spyOn(publicClient, "waitForTransactionReceipt").mockResolvedValue({ status: "success" } as never);
    const allowances = [BigInt(0), BigInt(0), BigInt(56)];
    const read = vi.spyOn(publicClient, "readContract").mockImplementation(async (input: unknown) => {
      return (input as { functionName: string }).functionName === "allowance" ? allowances.shift()! : BigInt(100);
    });
    const sendTransaction = vi.fn().mockResolvedValueOnce(approvalHash).mockResolvedValueOnce(sellHash);
    const callbacks = { onApprovalRequested: vi.fn(), onApprovalSubmitted: vi.fn(), onApprovalConfirmed: vi.fn(), onSellRequested: vi.fn() };
    const quote = { tokenAmount: BigInt(56), reserveOut: BigInt(90), minReserveOut: BigInt(78), curveValue: BigInt(92), protocolFee: BigInt(1), creatorFee: BigInt(1), slippageBps: 100, deadline: BigInt(Math.floor(Date.now() / 1000) + 300) };
    try {
      await expect(submitExternalSell({ sendTransaction } as unknown as ExternalWalletClient, creator, token, quote, callbacks)).resolves.toBe(sellHash);
      expect(sendTransaction).toHaveBeenCalledTimes(2);
      expect(sendTransaction.mock.calls[0][0]).toMatchObject({ account: creator, to: token, data: expect.any(String) });
      expect(decodeFunctionData({ abi: zonkCurveAbi, data: sendTransaction.mock.calls[1][0].data })).toEqual({ functionName: "sell", args: [BigInt(56), BigInt(78), quote.deadline] });
      expect(callbacks.onApprovalConfirmed.mock.invocationCallOrder[0]).toBeLessThan(callbacks.onSellRequested.mock.invocationCallOrder[0]);
      expect(callbacks.onSellRequested.mock.invocationCallOrder[0]).toBeLessThan(sendTransaction.mock.invocationCallOrder[1]);
      expect(read.mock.calls.filter(([input]) => (input as { functionName: string }).functionName === "allowance")).toHaveLength(3);
    } finally {
      simulate.mockRestore();
      wait.mockRestore();
      read.mockRestore();
      contractAddresses.zonkCurve = previousCurve;
    }
  });

  it("skips approval when the current on-chain allowance is sufficient", async () => {
    const previousCurve = contractAddresses.zonkCurve;
    contractAddresses.zonkCurve = curve;
    const simulate = vi.spyOn(publicClient, "simulateContract").mockResolvedValue({} as never);
    const read = vi.spyOn(publicClient, "readContract").mockImplementation(async (input: unknown) => {
      return (input as { functionName: string }).functionName === "allowance" ? BigInt(56) : BigInt(100);
    });
    const wait = vi.spyOn(publicClient, "waitForTransactionReceipt");
    const sellHash = `0x${"42".repeat(32)}` as const;
    const sendTransaction = vi.fn().mockResolvedValue(sellHash);
    const callbacks = { onApprovalRequested: vi.fn(), onApprovalSubmitted: vi.fn(), onApprovalConfirmed: vi.fn(), onSellRequested: vi.fn() };
    const quote = { tokenAmount: BigInt(56), reserveOut: BigInt(90), minReserveOut: BigInt(78), curveValue: BigInt(92), protocolFee: BigInt(1), creatorFee: BigInt(1), slippageBps: 100, deadline: BigInt(Math.floor(Date.now() / 1000) + 300) };
    try {
      await expect(submitExternalSell({ sendTransaction } as unknown as ExternalWalletClient, creator, token, quote, callbacks)).resolves.toBe(sellHash);
      expect(sendTransaction).toHaveBeenCalledTimes(1);
      expect(sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ account: creator, to: curve }));
      expect(wait).not.toHaveBeenCalled();
      expect(callbacks.onApprovalRequested).not.toHaveBeenCalled();
      expect(callbacks.onSellRequested).toHaveBeenCalledTimes(1);
    } finally {
      simulate.mockRestore();
      read.mockRestore();
      wait.mockRestore();
      contractAddresses.zonkCurve = previousCurve;
    }
  });

  it("stops external sell when approval is rejected", async () => {
    const previousCurve = contractAddresses.zonkCurve;
    contractAddresses.zonkCurve = curve;
    const rejection = Object.assign(new Error("User rejected the request"), { code: 4001 });
    const read = vi.spyOn(publicClient, "readContract").mockImplementation(async (input: unknown) => {
      return (input as { functionName: string }).functionName === "allowance" ? BigInt(0) : BigInt(100);
    });
    const sendTransaction = vi.fn().mockRejectedValue(rejection);
    const callbacks = { onApprovalRequested: vi.fn(), onApprovalSubmitted: vi.fn(), onApprovalConfirmed: vi.fn(), onSellRequested: vi.fn() };
    const quote = { tokenAmount: BigInt(56), reserveOut: BigInt(90), minReserveOut: BigInt(78), curveValue: BigInt(92), protocolFee: BigInt(1), creatorFee: BigInt(1), slippageBps: 100, deadline: BigInt(Math.floor(Date.now() / 1000) + 300) };
    try {
      await expect(submitExternalSell({ sendTransaction } as unknown as ExternalWalletClient, creator, token, quote, callbacks)).rejects.toBe(rejection);
      expect(sendTransaction).toHaveBeenCalledTimes(1);
      expect(callbacks.onApprovalConfirmed).not.toHaveBeenCalled();
      expect(callbacks.onSellRequested).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
      contractAddresses.zonkCurve = previousCurve;
    }
  });

  it("stops external sell when the approval receipt reverted", async () => {
    const previousCurve = contractAddresses.zonkCurve;
    contractAddresses.zonkCurve = curve;
    const approvalHash = `0x${"41".repeat(32)}` as const;
    const read = vi.spyOn(publicClient, "readContract").mockImplementation(async (input: unknown) => {
      return (input as { functionName: string }).functionName === "allowance" ? BigInt(0) : BigInt(100);
    });
    const wait = vi.spyOn(publicClient, "waitForTransactionReceipt").mockResolvedValue({ status: "reverted" } as never);
    const sendTransaction = vi.fn().mockResolvedValue(approvalHash);
    const callbacks = { onApprovalRequested: vi.fn(), onApprovalSubmitted: vi.fn(), onApprovalConfirmed: vi.fn(), onSellRequested: vi.fn() };
    const quote = { tokenAmount: BigInt(56), reserveOut: BigInt(90), minReserveOut: BigInt(78), curveValue: BigInt(92), protocolFee: BigInt(1), creatorFee: BigInt(1), slippageBps: 100, deadline: BigInt(Math.floor(Date.now() / 1000) + 300) };
    try {
      await expect(submitExternalSell({ sendTransaction } as unknown as ExternalWalletClient, creator, token, quote, callbacks)).rejects.toThrow(/approval transaction reverted/i);
      expect(sendTransaction).toHaveBeenCalledTimes(1);
      expect(callbacks.onApprovalConfirmed).not.toHaveBeenCalled();
      expect(callbacks.onSellRequested).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
      wait.mockRestore();
      contractAddresses.zonkCurve = previousCurve;
    }
  });

  it("stops after approval when the quote expires before sell preparation", async () => {
    const previousCurve = contractAddresses.zonkCurve;
    contractAddresses.zonkCurve = curve;
    const approvalHash = `0x${"41".repeat(32)}` as const;
    const read = vi.spyOn(publicClient, "readContract").mockImplementation(async (input: unknown) => {
      return (input as { functionName: string }).functionName === "allowance" ? BigInt(0) : BigInt(100);
    });
    const wait = vi.spyOn(publicClient, "waitForTransactionReceipt").mockResolvedValue({ status: "success" } as never);
    const simulate = vi.spyOn(publicClient, "simulateContract");
    const sendTransaction = vi.fn().mockResolvedValue(approvalHash);
    const callbacks = { onApprovalRequested: vi.fn(), onApprovalSubmitted: vi.fn(), onApprovalConfirmed: vi.fn(), onSellRequested: vi.fn() };
    const assertReady = vi.fn().mockImplementationOnce(() => undefined).mockImplementationOnce(() => undefined).mockImplementationOnce(() => {
      throw new Error("This quote expired during wallet approval. Request a fresh quote before submitting.");
    });
    const quote = { tokenAmount: BigInt(56), reserveOut: BigInt(90), minReserveOut: BigInt(78), curveValue: BigInt(92), protocolFee: BigInt(1), creatorFee: BigInt(1), slippageBps: 100, deadline: BigInt(Math.floor(Date.now() / 1000) + 300) };
    try {
      await expect(submitExternalSell({ sendTransaction } as unknown as ExternalWalletClient, creator, token, quote, callbacks, assertReady)).rejects.toThrow(/quote expired during wallet approval/i);
      expect(sendTransaction).toHaveBeenCalledTimes(1);
      expect(callbacks.onApprovalConfirmed).toHaveBeenCalledWith(approvalHash);
      expect(callbacks.onSellRequested).not.toHaveBeenCalled();
      expect(simulate).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
      wait.mockRestore();
      simulate.mockRestore();
      contractAddresses.zonkCurve = previousCurve;
    }
  });

  it("surfaces the sell simulation revert and never opens the sell request", async () => {
    const previousCurve = contractAddresses.zonkCurve;
    contractAddresses.zonkCurve = curve;
    const read = vi.spyOn(publicClient, "readContract").mockImplementation(async (input: unknown) => {
      return (input as { functionName: string }).functionName === "allowance" ? BigInt(56) : BigInt(100);
    });
    const revert = new Error("ContractFunctionExecutionError: sell reverted with SlippageExceeded");
    const simulate = vi.spyOn(publicClient, "simulateContract").mockRejectedValue(revert);
    const sendTransaction = vi.fn();
    const callbacks = { onApprovalRequested: vi.fn(), onApprovalSubmitted: vi.fn(), onApprovalConfirmed: vi.fn(), onSellRequested: vi.fn() };
    const quote = { tokenAmount: BigInt(56), reserveOut: BigInt(90), minReserveOut: BigInt(78), curveValue: BigInt(92), protocolFee: BigInt(1), creatorFee: BigInt(1), slippageBps: 100, deadline: BigInt(Math.floor(Date.now() / 1000) + 300) };
    try {
      await expect(submitExternalSell({ sendTransaction } as unknown as ExternalWalletClient, creator, token, quote, callbacks)).rejects.toBe(revert);
      expect(sendTransaction).not.toHaveBeenCalled();
      expect(callbacks.onSellRequested).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
      simulate.mockRestore();
      contractAddresses.zonkCurve = previousCurve;
    }
  });

  it("encodes the exact buy and sell function arguments", () => {
    expect(decodeFunctionData({ abi: zonkCurveAbi, data: encodeBuy(BigInt(12), BigInt(99)) })).toEqual({
      functionName: "buy",
      args: [BigInt(12), BigInt(99)],
    });
    expect(decodeFunctionData({ abi: zonkCurveAbi, data: encodeSell(BigInt(56), BigInt(78), BigInt(99)) })).toEqual({
      functionName: "sell",
      args: [BigInt(56), BigInt(78), BigInt(99)],
    });
  });

  it("builds approval and sell as one ordered smart-wallet batch", () => {
    const quote = { tokenAmount: BigInt(56), reserveOut: BigInt(90), minReserveOut: BigInt(78), curveValue: BigInt(92), protocolFee: BigInt(1), creatorFee: BigInt(1), slippageBps: 100, deadline: BigInt(99) };
    const calls = buildSellCalls(token, curve, quote, BigInt(0), BigInt(99));
    expect(calls).toHaveLength(2);
    expect(calls[0].to).toBe(token);
    expect(calls[1].to).toBe(curve);
    expect(decodeFunctionData({ abi: zonkCurveAbi, data: calls[1].data })).toEqual({ functionName: "sell", args: [BigInt(56), BigInt(78), BigInt(99)] });
    expect(buildSellCalls(token, curve, quote, BigInt(56), BigInt(99))).toHaveLength(1);
  });

  it("applies conservative basis-point slippage rounding", () => {
    expect(maxInputWithSlippage(BigInt(101), 100)).toBe(BigInt(103));
    expect(minOutputWithSlippage(BigInt(101), 100)).toBe(BigInt(99));
    expect(() => maxInputWithSlippage(BigInt(1), 5001)).toThrow(/between 0% and 50%/);
  });

  it.each([
    ["buy" as const, "TokensBought" as const, "buyer" as const],
    ["sell" as const, "TokensSold" as const, "seller" as const],
  ])("decodes the exact %s event", (side, eventName, traderField) => {
    const trader = creator;
    const topics = encodeEventTopics({ abi: zonkCurveAbi, eventName, args: { token, [traderField]: trader } });
    const data = side === "buy"
      ? encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
        [BigInt(10), BigInt(11), BigInt(12), BigInt(13), BigInt(3), BigInt(2), BigInt(1), BigInt(0), BigInt(0), BigInt(3)],
      )
      : encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
        [BigInt(10), BigInt(11), BigInt(12), BigInt(3), BigInt(2), BigInt(1), BigInt(0), BigInt(0)],
      );
    const logTopics = topics.filter((topic): topic is Hex => typeof topic === "string");
    expect(parseTradeReceipt({ status: "success", logs: [{ address: factory, data, topics: logTopics }] }, factory, side)).toEqual({
      side,
      token: getAddress(token),
      trader: getAddress(trader),
      tokenAmount: side === "buy" ? BigInt(13) : BigInt(10),
      reserveAmount: side === "buy" ? BigInt(11) : BigInt(11),
      curveValue: side === "buy" ? BigInt(12) : BigInt(12),
      protocolFee: BigInt(1),
      creatorFee: BigInt(2),
      totalFee: BigInt(3),
      communityFee: BigInt(0),
      traderRewardsFee: BigInt(0),
    });
  });

  it("rejects failed and malformed trade receipts", () => {
    expect(() => parseTradeReceipt({ status: "reverted", logs: [] }, factory, "buy")).toThrow(/reverted/);
    expect(() => parseTradeReceipt({ status: "success", logs: [] }, factory, "sell")).toThrow(/exactly one/);
  });
});
