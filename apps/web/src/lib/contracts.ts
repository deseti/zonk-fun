import {
  baseSepolia,
  CURVE_ALLOCATION,
  contractAddresses,
  encodeApprove,
  encodeBuy,
  encodeCreateToken,
  encodeSell,
  erc20TradeAbi,
  feeManagerV3Abi,
  graduationManagerV3Abi,
  graduationSettlementExecutorV3Abi,
  permanentLPFeeVaultV3Abi,
  permanentLPCustodianV3Abi,
  maxInputWithSlippage,
  minOutputWithSlippage,
  parseTokenLaunchedReceipt,
  parseTradeReceipt,
  zonkCurveAbi,
  zonkFactoryAbi,
  type BuyQuote,
  type SellQuote,
} from "@zonk/contracts-sdk";
import type { SmartWalletClientType } from "@privy-io/react-auth/smart-wallets";
import type { EIP1193Provider, SendTransactionModalUIOptions } from "@privy-io/react-auth";
import { createPublicClient, createWalletClient, custom, formatEther, getAddress, http, keccak256, stringToBytes, type Address, type Hash, type Transaction, type TransactionReceipt } from "viem";
import type { TradeRecovery } from "@/lib/transactions";

export { contractAddresses, erc20TradeAbi, feeManagerV3Abi, graduationManagerV3Abi, graduationSettlementExecutorV3Abi, permanentLPFeeVaultV3Abi, permanentLPCustodianV3Abi, zonkCurveAbi, zonkFactoryAbi };

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"),
});

export async function readTokenOnchain(token: Address) {
  if (!contractAddresses.zonkFactory) return null;
  return publicClient.readContract({ address: contractAddresses.zonkFactory, abi: zonkFactoryAbi, functionName: "tokenInfo", args: [token] });
}

export async function readCurveOnchain(token: Address) {
  const curve = await resolveCurveAddress(token);
  if (!curve) return null;
  return publicClient.readContract({ address: curve, abi: zonkCurveAbi, functionName: "token" });
}

export async function submitCreateToken(client: SmartWalletClientType, creator: Address, name: string, symbol: string, userSalt: `0x${string}` | CurveInitialization | { startingPrice: bigint; slope: bigint; graduationThreshold: bigint }) {
  const factory = contractAddresses.zonkFactory;
  if (!factory) throw new Error("Factory address is not configured.");
  const salt = typeof userSalt === "string" ? userSalt : ("userSalt" in userSalt ? userSalt.userSalt : keccak256(stringToBytes(`${name}-${symbol}-${Date.now()}`)));
  const args = [name, symbol, salt] as const;
  await publicClient.simulateContract({ address: factory, abi: zonkFactoryAbi, functionName: "createToken", args, account: creator });
  return sendSmartWalletTransaction(client, { calls: [{ to: factory, data: encodeCreateToken(...args) }] }, {
    action: "Create token",
    description: `Create ${symbol} on Zonk.fun with the Privy embedded smart wallet on Base Sepolia.`,
  });
}

export async function submitExternalCreateToken(client: ExternalWalletClient, creator: Address, name: string, symbol: string, userSalt: `0x${string}` | CurveInitialization | { startingPrice: bigint; slope: bigint; graduationThreshold: bigint }) {
  const factory = contractAddresses.zonkFactory;
  if (!factory) throw new Error("Factory address is not configured.");
  const salt = typeof userSalt === "string" ? userSalt : ("userSalt" in userSalt ? userSalt.userSalt : keccak256(stringToBytes(`${name}-${symbol}-${Date.now()}`)));
  const args = [name, symbol, salt] as const;
  await publicClient.simulateContract({ address: factory, abi: zonkFactoryAbi, functionName: "createToken", args, account: creator });
  return client.sendTransaction({ account: creator, chain: baseSepolia, to: factory, data: encodeCreateToken(...args) });
}

export async function confirmCreatedToken(hash: Hash) {
  const factory = contractAddresses.zonkFactory;
  if (!factory) throw new Error("Factory address is not configured.");
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  return { receipt, created: parseTokenLaunchedReceipt(receipt, factory) };
}

export type CurveTradeState = {
  curveSupply: bigint;
  soldSupply: bigint;
  reserveBalance: bigint;
  graduationThreshold: bigint;
  lifecycle: number;
  nativeBalance: bigint;
  tokenBalance: bigint;
  allowance: bigint;
  decimals: number;
};

export async function readTradeState(token: Address, account: Address): Promise<CurveTradeState> {
  const curveAddress = await resolveCurveAddress(token);
  if (!curveAddress) throw new Error("Curve address is not configured for this token.");
  const [soldSupply, activeEthReserve, graduated, nativeBalance, tokenBalance, allowance, decimals] = await Promise.all([
    publicClient.readContract({ address: curveAddress, abi: zonkCurveAbi, functionName: "soldSupply" }),
    publicClient.readContract({ address: curveAddress, abi: zonkCurveAbi, functionName: "activeEthReserve" }),
    publicClient.readContract({ address: curveAddress, abi: zonkCurveAbi, functionName: "graduated" }),
    publicClient.getBalance({ address: account }),
    publicClient.readContract({ address: token, abi: erc20TradeAbi, functionName: "balanceOf", args: [account] }),
    publicClient.readContract({ address: token, abi: erc20TradeAbi, functionName: "allowance", args: [account, curveAddress] }),
    publicClient.readContract({ address: token, abi: erc20TradeAbi, functionName: "decimals" }),
  ]);
  return {
    curveSupply: CURVE_ALLOCATION,
    soldSupply,
    reserveBalance: activeEthReserve,
    graduationThreshold: CURVE_ALLOCATION,
    lifecycle: graduated ? 2 : 0,
    nativeBalance,
    tokenBalance,
    allowance,
    decimals,
  };
}

export async function readCurveAvailability(token: Address) {
  const curveAddress = await resolveCurveAddress(token);
  if (!curveAddress) return null;
  try {
    const [factory, curveToken, creator, graduated] = await Promise.all([
      publicClient.readContract({ address: curveAddress, abi: zonkCurveAbi, functionName: "factory" }),
      publicClient.readContract({ address: curveAddress, abi: zonkCurveAbi, functionName: "token" }),
      publicClient.readContract({ address: curveAddress, abi: zonkCurveAbi, functionName: "creator" }),
      publicClient.readContract({ address: curveAddress, abi: zonkCurveAbi, functionName: "graduated" }),
    ]);
    if (!contractAddresses.zonkFactory || getAddress(factory) !== getAddress(contractAddresses.zonkFactory) || getAddress(curveToken) !== getAddress(token)) throw new Error("Configured curve is not linked to the configured factory and token.");
    return { address: curveAddress, state: { graduated, creator } };
  } catch (error) {
    if (isCurveNotFound(error)) return null;
    throw error;
  }
}

export type CurveInitialization = { userSalt: `0x${string}` };
export function configuredCurveInitialization(): CurveInitialization { return { userSalt: keccak256(stringToBytes(`${Date.now()}-${Math.random()}`)) }; }

export type BudgetBuyQuote = BuyQuote & { tokenAmount: bigint; maxReserveIn: bigint; slippageBps: number; deadline: bigint };
export type ProtectedSellQuote = SellQuote & { tokenAmount: bigint; minReserveOut: bigint; slippageBps: number; deadline: bigint };

export async function quoteBuyByBudget(token: Address, budget: bigint, state: Pick<CurveTradeState, "soldSupply" | "graduationThreshold">, slippageBps: number): Promise<BudgetBuyQuote> {
  if (budget <= BigInt(0)) throw new Error("Enter an ETH amount greater than zero.");
  const quote = await readBuyQuote(token, budget);
  if (quote.tokensOut === BigInt(0)) throw new Error("The ETH amount is too small for the minimum trade.");
  return { reserveIn: quote.acceptedGross ?? budget, curveCost: quote.netCurveInput ?? BigInt(0), protocolFee: quote.protocolFee, creatorFee: quote.creatorFee, acceptedGross: quote.acceptedGross, netCurveInput: quote.netCurveInput, tokensOut: quote.tokensOut, tokenAmount: quote.tokensOut ?? BigInt(0), maxReserveIn: budget, slippageBps, deadline: transactionDeadline() };
}

export async function quoteSellAmount(token: Address, tokenAmount: bigint, slippageBps: number): Promise<ProtectedSellQuote> {
  if (tokenAmount <= BigInt(0)) throw new Error("Enter a token amount greater than zero.");
  const quote = await readSellQuote(token, tokenAmount);
  return { ...quote, tokenAmount, minReserveOut: minOutputWithSlippage(quote.reserveOut, slippageBps), slippageBps, deadline: transactionDeadline() };
}

export async function submitBuy(client: SmartWalletClientType, account: Address, token: Address, quote: BudgetBuyQuote, assertReady: () => void = () => undefined): Promise<Hash> {
  const curve = await resolveCurveAddress(token);
  if (!curve) throw new Error("Curve address is not configured for this token.");
  const deadline = quote.deadline;
  assertReady();
  await publicClient.simulateContract({
    address: curve,
    abi: zonkCurveAbi,
    functionName: "buy",
    args: [minOutputWithSlippage(quote.tokenAmount, quote.slippageBps), deadline],
    account,
    value: quote.maxReserveIn,
  });
  assertReady();
  return sendSmartWalletTransaction(client, { calls: [{ to: curve, data: encodeBuy(minOutputWithSlippage(quote.tokenAmount, quote.slippageBps), deadline), value: quote.maxReserveIn }] }, {
    action: "Buy token",
    description: `Buy ${quote.tokenAmount.toString()} token units with at most ${formatEther(quote.maxReserveIn)} ETH on Base Sepolia.`,
  });
}

export async function submitSell(client: SmartWalletClientType, account: Address, token: Address, quote: ProtectedSellQuote, allowance: bigint, assertReady: () => void = () => undefined): Promise<Hash> {
  const curve = await resolveCurveAddress(token);
  if (!curve) throw new Error("Curve address is not configured for this token.");
  const deadline = quote.deadline;
  assertReady();
  if (allowance < quote.tokenAmount) {
    // A standalone sell simulation would fail before the approval in this
    // atomic smart-wallet batch has executed.
  } else {
    await publicClient.simulateContract({ address: curve, abi: zonkCurveAbi, functionName: "sell", args: [quote.tokenAmount, quote.minReserveOut, deadline], account });
  }
  const calls = buildSellCalls(token, curve, quote, allowance, deadline);
  assertReady();
  return sendSmartWalletTransaction(client, { calls }, {
    action: allowance < quote.tokenAmount ? "Approve + sell" : "Sell token",
    description: `Sell ${quote.tokenAmount.toString()} token units for at least ${formatEther(quote.minReserveOut)} ETH on Base Sepolia${allowance < quote.tokenAmount ? " in one atomic approval and sell batch" : ""}.`,
  });
}

export function createExternalWalletClient(provider: EIP1193Provider, account: Address) {
  return createWalletClient({ account, chain: baseSepolia, transport: custom(provider) });
}

export type ExternalWalletClient = ReturnType<typeof createExternalWalletClient>;

export async function submitExternalBuy(client: ExternalWalletClient, account: Address, token: Address, quote: BudgetBuyQuote, assertReady: () => void = () => undefined): Promise<Hash> {
  const curve = await resolveCurveAddress(token);
  if (!curve) throw new Error("Curve address is not configured for this token.");
  assertReady();
  await publicClient.simulateContract({
    address: curve,
    abi: zonkCurveAbi,
    functionName: "buy",
    args: [minOutputWithSlippage(quote.tokenAmount, quote.slippageBps), quote.deadline],
    account,
    value: quote.maxReserveIn,
  });
  assertReady();
  return client.sendTransaction({ account, chain: baseSepolia, to: curve, data: encodeBuy(minOutputWithSlippage(quote.tokenAmount, quote.slippageBps), quote.deadline), value: quote.maxReserveIn });
}

export async function submitExternalSell(
  client: ExternalWalletClient,
  account: Address,
  token: Address,
  quote: ProtectedSellQuote,
  callbacks: {
    onApprovalRequested: () => void;
    onApprovalSubmitted: (hash: Hash) => void;
    onApprovalConfirmed: (hash: Hash) => void;
    onSellRequested: () => void;
  },
  assertReady: () => void = () => undefined,
): Promise<Hash> {
  const curve = await resolveCurveAddress(token);
  if (!curve) throw new Error("Curve address is not configured for this token.");
  assertExternalSellDeadline(quote);
  assertReady();
  let state = await readExternalSellState(token, account, curve);
  if (state.tokenBalance < quote.tokenAmount) throw new Error("The active external wallet no longer has enough tokens for this sell.");

  if (state.allowance < quote.tokenAmount) {
    assertExternalSellDeadline(quote);
    assertReady();
    callbacks.onApprovalRequested();
    const approvalHash = await client.sendTransaction({ account, chain: baseSepolia, to: token, data: encodeApprove(curve, quote.tokenAmount) });
    callbacks.onApprovalSubmitted(approvalHash);
    const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash, confirmations: 1, timeout: 120_000 });
    if (approvalReceipt.status !== "success") throw new Error("The token approval transaction reverted on Base Sepolia.");
    callbacks.onApprovalConfirmed(approvalHash);

    // The approval changes the exact state this flow depends on. Never carry
    // the pre-approval allowance snapshot into sell preparation.
    assertExternalSellDeadline(quote);
    assertReady();
    state = await waitForExternalAllowance(token, account, curve, quote.tokenAmount);
  }

  if (state.allowance < quote.tokenAmount) throw new Error("The confirmed token approval is still insufficient for this sell.");
  if (state.tokenBalance < quote.tokenAmount) throw new Error("The active external wallet no longer has enough tokens for this sell.");
  assertExternalSellDeadline(quote);
  assertReady();
  await publicClient.simulateContract({ address: curve, abi: zonkCurveAbi, functionName: "sell", args: [quote.tokenAmount, quote.minReserveOut, quote.deadline], account });
  assertExternalSellDeadline(quote);
  assertReady();
  callbacks.onSellRequested();
  return client.sendTransaction({ account, chain: baseSepolia, to: curve, data: encodeSell(quote.tokenAmount, quote.minReserveOut, quote.deadline) });
}

async function readExternalSellState(token: Address, account: Address, curve: Address) {
  const [allowance, tokenBalance] = await Promise.all([
    publicClient.readContract({ address: token, abi: erc20TradeAbi, functionName: "allowance", args: [account, curve] }),
    publicClient.readContract({ address: token, abi: erc20TradeAbi, functionName: "balanceOf", args: [account] }),
  ]);
  return { allowance, tokenBalance };
}

const externalAllowancePollDelays = [0, 250, 500, 1000, 1500] as const;

async function waitForExternalAllowance(token: Address, account: Address, curve: Address, required: bigint) {
  let lastError: unknown;
  for (let attempt = 0; attempt < externalAllowancePollDelays.length; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, externalAllowancePollDelays[attempt]));
    try {
      const state = await readExternalSellState(token, account, curve);
      if (state.allowance >= required) return state;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw new Error(`The confirmed approval could not be re-read for the active token and curve: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  throw new Error("The confirmed token approval is still insufficient for this sell.");
}

function assertExternalSellDeadline(quote: ProtectedSellQuote) {
  if (BigInt(Math.floor(Date.now() / 1000)) >= quote.deadline) {
    throw new Error("This quote expired during wallet approval. Request a fresh quote before selling.");
  }
}

export function privyTransactionUiOptions(input: { action: string; description: string }): SendTransactionModalUIOptions {
  return {
    showWalletUIs: true,
    isCancellable: true,
    description: input.description,
    buttonText: "Authorize transaction",
    transactionInfo: {
      title: "Zonk.fun transaction",
      action: input.action,
      contractInfo: { name: "Zonk.fun" },
    },
  };
}

export function sendSmartWalletTransaction(
  client: SmartWalletClientType,
  input: Parameters<SmartWalletClientType["sendTransaction"]>[0],
  ui: { action: string; description: string },
) {
  return client.sendTransaction(input, { uiOptions: privyTransactionUiOptions(ui) });
}

export type TradeConfirmation = {
  status: "confirmed" | "reverted" | "replaced" | "pending";
  hash: Hash;
  replacementReason?: "cancelled" | "replaced" | "repriced";
  recovery?: TradeRecovery;
};

export function buildSellCalls(token: Address, curve: Address, quote: ProtectedSellQuote, allowance: bigint, deadline: bigint) {
  const calls: Array<{ to: Address; data: `0x${string}` }> = [];
  if (allowance < quote.tokenAmount) calls.push({ to: token, data: encodeApprove(curve, quote.tokenAmount) });
  calls.push({ to: curve, data: encodeSell(quote.tokenAmount, quote.minReserveOut, deadline) });
  return calls;
}

export async function confirmTrade(hash: Hash, side: "buy" | "sell", token: Address, trader: Address, recovery?: TradeRecovery): Promise<TradeConfirmation> {
  const curve = await resolveCurveAddress(token);
  if (!curve) throw new Error("Curve address is not configured for this token.");
  let replacementReason: TradeConfirmation["replacementReason"];
  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
      timeout: 120_000,
      onReplaced: (replacement) => { replacementReason = replacement.reason; },
    });
    return resolveTradeReceipt(receipt, curve, side, token, trader, replacementReason);
  } catch (error) {
    if (!isReceiptTimeout(error)) throw error;
    return checkTrade(hash, side, token, trader, recovery);
  }
}

export async function captureTradeRecovery(hash: Hash): Promise<TradeRecovery | undefined> {
  try {
    const [transaction, blockNumber] = await Promise.all([
      publicClient.getTransaction({ hash }),
      publicClient.getBlockNumber(),
    ]);
    return {
      sender: transaction.from,
      nonce: transaction.nonce,
      to: transaction.to ?? undefined,
      value: transaction.value.toString(),
      input: transaction.input,
      nextScanBlock: (transaction.blockNumber ?? blockNumber).toString(),
    };
  } catch {
    return undefined;
  }
}

export async function checkTrade(hash: Hash, side: "buy" | "sell", token: Address, trader: Address, recovery?: TradeRecovery): Promise<TradeConfirmation> {
  const curve = await resolveCurveAddress(token);
  if (!curve) throw new Error("Curve address is not configured for this token.");
  const result = await recoverTransactionReceipt(publicClient as unknown as TradeRecoveryClient, hash, recovery);
  if (result.kind === "receipt") {
    const receipt = result.receipt;
    return resolveTradeReceipt(receipt, curve, side, token, trader);
  }
  if (result.kind === "replacement") return { status: "replaced", hash: result.receipt.transactionHash, replacementReason: result.reason };
  return { status: "pending", hash, recovery: result.recovery };
}

function resolveTradeReceipt(receipt: TransactionReceipt, curve: Address, side: "buy" | "sell", token: Address, trader: Address, replacementReason?: TradeConfirmation["replacementReason"]): TradeConfirmation {
  if (replacementReason) return { status: "replaced", hash: receipt.transactionHash, replacementReason };
  if (receipt.status === "reverted") return { status: "reverted", hash: receipt.transactionHash };
  let trade;
  try {
    trade = parseTradeReceipt(receipt, curve, side);
  } catch (error) {
    throw error;
  }
  if (getAddress(trade.token) !== getAddress(token) || getAddress(trade.trader) !== getAddress(trader)) {
    throw new Error("Confirmed trade does not match the connected wallet and token.");
  }
  return { status: "confirmed", hash: receipt.transactionHash, replacementReason };
}

type RecoveryTransaction = Pick<Transaction, "from" | "nonce" | "to" | "value" | "input" | "hash">;
type TradeRecoveryClient = {
  getTransactionReceipt: (parameters: { hash: Hash }) => Promise<TransactionReceipt>;
  getTransaction: (parameters: { hash: Hash }) => Promise<RecoveryTransaction>;
  getBlockNumber: () => Promise<bigint>;
  getTransactionCount: (parameters: { address: Address; blockTag: "latest" }) => Promise<number>;
  getBlock: (parameters: { blockNumber: bigint; includeTransactions: true }) => Promise<{ transactions: readonly (Hash | RecoveryTransaction)[] }>;
};

type RecoveryResult =
  | { kind: "receipt"; receipt: TransactionReceipt }
  | { kind: "replacement"; receipt: TransactionReceipt; reason: "cancelled" | "replaced" | "repriced" }
  | { kind: "pending"; recovery?: TradeRecovery };

const REPLACEMENT_SCAN_BATCH = BigInt(128);

export async function recoverTransactionReceipt(client: TradeRecoveryClient, hash: Hash, storedRecovery?: TradeRecovery): Promise<RecoveryResult> {
  try {
    return { kind: "receipt", receipt: await client.getTransactionReceipt({ hash }) };
  } catch (error) {
    if (!isReceiptNotFound(error)) throw error;
  }

  let recovery = storedRecovery;
  if (!recovery) {
    try {
      const [transaction, blockNumber] = await Promise.all([
        client.getTransaction({ hash }),
        client.getBlockNumber(),
      ]);
      recovery = {
        sender: transaction.from,
        nonce: transaction.nonce,
        to: transaction.to ?? undefined,
        value: transaction.value.toString(),
        input: transaction.input,
        nextScanBlock: blockNumber.toString(),
      };
    } catch {
      return { kind: "pending" };
    }
  }

  const consumedNonce = await client.getTransactionCount({ address: recovery.sender, blockTag: "latest" });
  if (consumedNonce <= recovery.nonce) return { kind: "pending", recovery };

  const latestBlock = await client.getBlockNumber();
  const firstBlock = BigInt(recovery.nextScanBlock);
  const lastBlock = firstBlock + REPLACEMENT_SCAN_BATCH - BigInt(1) < latestBlock
    ? firstBlock + REPLACEMENT_SCAN_BATCH - BigInt(1)
    : latestBlock;

  for (let blockNumber = firstBlock; blockNumber <= lastBlock; blockNumber += BigInt(1)) {
    const block = await client.getBlock({ blockNumber, includeTransactions: true });
    const transaction = block.transactions.find((candidate): candidate is RecoveryTransaction => typeof candidate !== "string" && getAddress(candidate.from) === getAddress(recovery.sender) && candidate.nonce === recovery.nonce);
    if (!transaction) continue;
    const receipt = await client.getTransactionReceipt({ hash: transaction.hash });
    if (transaction.hash.toLowerCase() === hash.toLowerCase()) return { kind: "receipt", receipt };
    return { kind: "replacement", receipt, reason: replacementReason(recovery, transaction) };
  }

  if (lastBlock < latestBlock) return { kind: "pending", recovery: { ...recovery, nextScanBlock: (lastBlock + BigInt(1)).toString() } };
  throw new Error("The original nonce was consumed, but replacement provenance was unavailable. Confirmation remains unknown.");
}

function replacementReason(original: TradeRecovery, replacement: RecoveryTransaction): "cancelled" | "replaced" | "repriced" {
  if (replacement.to && getAddress(replacement.from) === getAddress(replacement.to) && replacement.value === BigInt(0)) return "cancelled";
  if ((replacement.to?.toLowerCase() ?? "") === (original.to?.toLowerCase() ?? "") && replacement.value.toString() === original.value && replacement.input.toLowerCase() === original.input.toLowerCase()) return "repriced";
  return "replaced";
}

function isReceiptNotFound(error: unknown) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /TransactionReceiptNotFound|transaction receipt.*(?:not|could not) be found/i.test(message);
}

function isReceiptTimeout(error: unknown) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /WaitForTransactionReceiptTimeout|timed? out|timeout/i.test(message);
}

async function readBuyQuote(token: Address, tokenAmount: bigint): Promise<BuyQuote> {
  const curve = await resolveCurveAddress(token);
  if (!curve) throw new Error("Curve address is not configured for this token.");
  const quote = await publicClient.readContract({ address: curve, abi: zonkCurveAbi, functionName: "quoteBuy", args: [tokenAmount] });
  return { reserveIn: quote.acceptedGross, curveCost: quote.netCurveInput, protocolFee: quote.protocolFee, creatorFee: quote.creatorFee, acceptedGross: quote.acceptedGross, netCurveInput: quote.netCurveInput, tokensOut: quote.tokensOut };
}

async function readSellQuote(token: Address, tokenAmount: bigint): Promise<SellQuote> {
  const curve = await resolveCurveAddress(token);
  if (!curve) throw new Error("Curve address is not configured for this token.");
  const quote = await publicClient.readContract({ address: curve, abi: zonkCurveAbi, functionName: "quoteSell", args: [tokenAmount] });
  return { reserveOut: quote.netSellerOutput, curveValue: quote.grossCurveOutput, protocolFee: quote.protocolFee, creatorFee: quote.creatorFee, netSellerOutput: quote.netSellerOutput };
}

async function resolveCurveAddress(token: Address): Promise<Address | undefined> {
  if (contractAddresses.zonkCurve) return contractAddresses.zonkCurve;
  if (!contractAddresses.zonkFactory) return undefined;
  const curve = await publicClient.readContract({ address: contractAddresses.zonkFactory, abi: zonkFactoryAbi, functionName: "curveOf", args: [token] });
  if (!curve || /^0x0{40}$/i.test(curve)) return undefined;
  return curve;
}

function transactionDeadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 300);
}

function isCurveNotFound(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("0xf3295903") || message.includes("CurveNotFound");
}
