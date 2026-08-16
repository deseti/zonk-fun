import { decodeFunctionData, getAddress } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BASE_SEPOLIA_SWAP_ROUTER_02, BASE_SEPOLIA_V3_FACTORY, BASE_SEPOLIA_WETH, BASE_SEPOLIA_QUOTER_V2, CANONICAL_POOL_FEE, CONTRACT_BALANCE, approvalCall, buildGraduatedSwapTransaction, configuredUniswapV3, minimumOutput, orchestrateGraduatedSwap, quoteIsFresh, simulateGraduatedSwapTransaction, swapRouter02Abi, validateCanonicalPool, waitForGraduatedAllowance, type GraduatedQuote, type GraduatedExecutionState, type ValidatedPool } from "./uniswap-v3";
import { erc20TradeAbi, publicClient } from "@/lib/contracts";

const token = "0x0000000000000000000000000000000000000011" as const;
const wallet = "0x0000000000000000000000000000000000000022" as const;
const pool: ValidatedPool = { pool: "0x0000000000000000000000000000000000000033", token, token0: BASE_SEPOLIA_WETH, token1: token, quoter: "0x0000000000000000000000000000000000000044", router: "0x0000000000000000000000000000000000000055", factory: "0x0000000000000000000000000000000000000066" };
const quote = (side: "buy" | "sell"): GraduatedQuote => ({ side, amountIn: BigInt(1000), amountOut: BigInt(900), minimumOut: BigInt(895), slippageBps: 50, createdAt: 1_000, deadline: BigInt(2_000), pool: pool.pool, wallet, chainId: 84532 });

describe("graduated Uniswap V3 SwapRouter02 guardrails", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of ["NEXT_PUBLIC_BASE_SEPOLIA_UNISWAP_V3_QUOTER_V2", "NEXT_PUBLIC_BASE_SEPOLIA_UNISWAP_V3_SWAP_ROUTER_02", "NEXT_PUBLIC_BASE_SEPOLIA_UNISWAP_V3_FACTORY"]) delete process.env[key];
  });

  it("uses the official SwapRouter02 CONTRACT_BALANCE sentinel", () => {
    expect(CONTRACT_BALANCE).toBe(BigInt(0));
  });

  it("protects quoted output with integer slippage and rejects invalid inputs", () => {
    expect(minimumOutput(BigInt(1001), 50)).toBe(BigInt(995));
    expect(() => minimumOutput(BigInt(1), 0)).toThrow(/slippage/i);
    expect(() => minimumOutput(BigInt(0), 50)).toThrow(/output/i);
  });
  it("rejects stale, wallet-changed, chain-changed, and pool-changed quote contexts", () => {
    expect(quoteIsFresh(quote("buy"), wallet, pool.pool, 84532, 1_500)).toBe(true);
    expect(quoteIsFresh(quote("buy"), wallet, pool.pool, 1, 1_500)).toBe(false);
    expect(quoteIsFresh(quote("buy"), "0x0000000000000000000000000000000000000023", pool.pool, 84532, 1_500)).toBe(false);
    expect(quoteIsFresh(quote("buy"), wallet, "0x0000000000000000000000000000000000000034", 84532, 1_500)).toBe(false);
    expect(quoteIsFresh(quote("buy"), wallet, pool.pool, 84532, 62_000)).toBe(false);
  });
  it("encodes the SwapRouter02 buy payload with explicit wrap then swap", () => {
    const transaction = buildGraduatedSwapTransaction(pool, quote("buy"), wallet);
    const decoded = decodeFunctionData({ abi: swapRouter02Abi, data: transaction.data });
    expect(transaction.to).toBe(pool.router);
    expect(transaction.value).toBe(BigInt(1000));
    expect(decoded.functionName).toBe("multicall");
    const calls = decoded.args?.[1] as readonly `0x${string}`[];
    const wrap = decodeFunctionData({ abi: swapRouter02Abi, data: calls[0] });
    const swap = decodeFunctionData({ abi: swapRouter02Abi, data: calls[1] });
    expect(wrap.functionName).toBe("wrapETH");
    expect(wrap.args).toEqual([BigInt(1000)]);
    const params = swap.args?.[0] as { tokenIn: string; tokenOut: string; fee: number; recipient: string; amountIn: bigint };
    expect(getAddress(params.tokenIn)).toBe(BASE_SEPOLIA_WETH);
    expect(getAddress(params.tokenOut)).toBe(token);
    expect(params.fee).toBe(CANONICAL_POOL_FEE);
    expect(getAddress(params.recipient)).toBe(wallet);
    expect(params.amountIn).toBe(CONTRACT_BALANCE);
  });
  it("encodes the complete sell multicall: token to router then minimum-safe WETH unwrap to wallet", () => {
    const transaction = buildGraduatedSwapTransaction(pool, quote("sell"), wallet);
    const decoded = decodeFunctionData({ abi: swapRouter02Abi, data: transaction.data });
    expect(transaction.value).toBe(BigInt(0));
    expect(decoded.functionName).toBe("multicall");
    const calls = decoded.args?.[1] as readonly `0x${string}`[];
    const swap = decodeFunctionData({ abi: swapRouter02Abi, data: calls[0] });
    const unwrap = decodeFunctionData({ abi: swapRouter02Abi, data: calls[1] });
    const params = swap.args?.[0] as { tokenIn: string; tokenOut: string; recipient: string; amountIn: bigint; fee: number };
    expect(swap.functionName).toBe("exactInputSingle");
    expect(getAddress(params.tokenIn)).toBe(token);
    expect(getAddress(params.tokenOut)).toBe(BASE_SEPOLIA_WETH);
    expect(getAddress(params.recipient)).toBe(pool.router);
    expect(params.amountIn).toBe(BigInt(1000));
    expect(params.amountIn).not.toBe(CONTRACT_BALANCE);
    expect(params.fee).toBe(CANONICAL_POOL_FEE);
    expect(unwrap.functionName).toBe("unwrapWETH9");
    expect(unwrap.args).toEqual([BigInt(895), wallet]);
  });

  it.each(["buy", "sell"] as const)("passes the same canonical %s {to,data,value} to raw simulation and submission", async (side) => {
    const transaction = buildGraduatedSwapTransaction(pool, quote(side), wallet);
    const call = vi.spyOn(publicClient, "call").mockResolvedValue("0x" as never);
    const submitted = vi.fn().mockResolvedValue(`0x${"ab".repeat(32)}` as const);
    await simulateGraduatedSwapTransaction(transaction, wallet);
    await submitted(transaction);
    expect(call).toHaveBeenCalledWith({ account: wallet, ...transaction });
    expect(submitted).toHaveBeenCalledWith(transaction);
    expect(submitted.mock.calls[0][0]).toBe(transaction);
    expect(transaction).toEqual({ to: pool.router, data: expect.any(String), value: side === "buy" ? BigInt(1000) : BigInt(0) });
  });

  it("fails closed when any periphery address is missing", () => {
    process.env.NEXT_PUBLIC_BASE_SEPOLIA_UNISWAP_V3_QUOTER_V2 = BASE_SEPOLIA_QUOTER_V2;
    process.env.NEXT_PUBLIC_BASE_SEPOLIA_UNISWAP_V3_SWAP_ROUTER_02 = BASE_SEPOLIA_SWAP_ROUTER_02;
    expect(configuredUniswapV3()).toBeUndefined();
  });

  async function expectPoolValidationFailure(overrides: Record<string, unknown>, message: RegExp) {
    process.env.NEXT_PUBLIC_BASE_SEPOLIA_UNISWAP_V3_QUOTER_V2 = BASE_SEPOLIA_QUOTER_V2;
    process.env.NEXT_PUBLIC_BASE_SEPOLIA_UNISWAP_V3_SWAP_ROUTER_02 = BASE_SEPOLIA_SWAP_ROUTER_02;
    process.env.NEXT_PUBLIC_BASE_SEPOLIA_UNISWAP_V3_FACTORY = BASE_SEPOLIA_V3_FACTORY;
    vi.spyOn(publicClient, "getBytecode").mockResolvedValue("0x6000" as never);
    const values: Record<string, unknown> = {
      token0: BASE_SEPOLIA_WETH,
      token1: token,
      fee: CANONICAL_POOL_FEE,
      factory: BASE_SEPOLIA_V3_FACTORY,
      quoterFactory: BASE_SEPOLIA_V3_FACTORY,
      routerFactory: BASE_SEPOLIA_V3_FACTORY,
      quoterWeth: BASE_SEPOLIA_WETH,
      routerWeth: BASE_SEPOLIA_WETH,
      ...overrides,
    };
    vi.spyOn(publicClient, "readContract").mockImplementation(async (input: unknown) => {
      const request = input as { address: string; functionName: string };
      if (request.functionName === "factory") return (request.address.toLowerCase() === pool.pool.toLowerCase() ? values.factory : request.address.toLowerCase() === BASE_SEPOLIA_QUOTER_V2.toLowerCase() ? values.quoterFactory : values.routerFactory) as never;
      if (request.functionName === "WETH9") return (request.address.toLowerCase() === BASE_SEPOLIA_QUOTER_V2.toLowerCase() ? values.quoterWeth : values.routerWeth) as never;
      return values[request.functionName] as never;
    });
    await expect(validateCanonicalPool(pool.pool, token)).rejects.toThrow(message);
  }

  it("rejects a wrong pool pair", () => expectPoolValidationFailure({ token1: "0x0000000000000000000000000000000000000099" }, /token pair/i));
  it("rejects a wrong pool fee", () => expectPoolValidationFailure({ fee: 500 }, /1%.*fee tier/i));
  it("rejects a wrong pool or periphery factory", () => expectPoolValidationFailure({ routerFactory: "0x0000000000000000000000000000000000000099" }, /factory/i));
  it("rejects a wrong WETH dependency", () => expectPoolValidationFailure({ routerWeth: "0x0000000000000000000000000000000000000099" }, /WETH/i));

  it("encodes an exact positive sell approval amount", () => {
    const approval = approvalCall(token, pool.router, BigInt(1000));
    expect(decodeFunctionData({ abi: erc20TradeAbi, data: approval.data })).toEqual({ functionName: "approve", args: [pool.router, BigInt(1000)] });
  });

  it("rereads a lagging allowance after the approval receipt before continuing", async () => {
    const reads = vi.fn().mockResolvedValueOnce(BigInt(0)).mockResolvedValueOnce(BigInt(999)).mockResolvedValueOnce(BigInt(1000));
    await expect(waitForGraduatedAllowance(reads, BigInt(1000), [0, 0, 0])).resolves.toBe(BigInt(1000));
    expect(reads).toHaveBeenCalledTimes(3);
  });

  it("fails closed when the confirmed approval never becomes sufficient", async () => {
    const reads = vi.fn().mockResolvedValue(BigInt(999));
    await expect(waitForGraduatedAllowance(reads, BigInt(1000), [0, 0])).rejects.toThrow(/insufficient/i);
    expect(reads).toHaveBeenCalledTimes(2);
  });

  function executionInput(overrides: Partial<GraduatedExecutionState> = {}) {
    const state: GraduatedExecutionState = { eth: BigInt(1000), token: BigInt(1000), allowance: BigInt(1000), ...overrides };
    const transaction = buildGraduatedSwapTransaction(pool, quote("sell"), wallet);
    const readState = vi.fn().mockResolvedValue(state);
    const approve = vi.fn().mockResolvedValue(undefined);
    const assertContext = vi.fn();
    const simulate = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue(`0x${"cd".repeat(32)}` as const);
    return { input: { side: "sell" as const, amountIn: BigInt(1000), initialState: state, readState, approve, assertContext, buildTransaction: () => transaction, simulate, send, allowanceDelays: [0] }, state, readState, approve, assertContext, simulate, send, transaction };
  }

  it("submits one swap automatically when exact allowance is already sufficient", async () => {
    const f = executionInput();
    await expect(orchestrateGraduatedSwap(f.input)).resolves.toMatch(/^0xcd/);
    expect(f.approve).not.toHaveBeenCalled();
    expect(f.simulate).toHaveBeenCalledWith(f.transaction);
    expect(f.send).toHaveBeenCalledWith(f.transaction);
    expect(f.simulate.mock.calls[0][0]).toBe(f.send.mock.calls[0][0]);
  });

  it("awaits approval, rereads allowance, then automatically submits without a second click", async () => {
    const f = executionInput({ allowance: BigInt(0) });
    f.readState.mockResolvedValue({ ...f.state, allowance: BigInt(1000) });
    await orchestrateGraduatedSwap(f.input);
    expect(f.approve).toHaveBeenCalledTimes(1);
    expect(f.readState).toHaveBeenCalled();
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("stops after approval failure, insufficient reread, or context change", async () => {
    const rejected = executionInput({ allowance: BigInt(0) });
    rejected.approve.mockRejectedValue(new Error("approval rejected"));
    await expect(orchestrateGraduatedSwap(rejected.input)).rejects.toThrow("approval rejected");
    expect(rejected.send).not.toHaveBeenCalled();

    const insufficient = executionInput({ allowance: BigInt(0) });
    insufficient.approve.mockResolvedValue(undefined);
    insufficient.readState.mockResolvedValue({ ...insufficient.state, allowance: BigInt(0) });
    await expect(orchestrateGraduatedSwap(insufficient.input)).rejects.toThrow(/insufficient/i);
    expect(insufficient.send).not.toHaveBeenCalled();

    const changed = executionInput({ allowance: BigInt(0) });
    changed.readState.mockResolvedValue({ ...changed.state, allowance: BigInt(1000) });
    changed.assertContext.mockImplementationOnce(() => undefined).mockImplementationOnce(() => { throw new Error("wallet changed"); });
    await expect(orchestrateGraduatedSwap(changed.input)).rejects.toThrow("wallet changed");
    expect(changed.send).not.toHaveBeenCalled();
  });
});
