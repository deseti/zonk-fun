export type TransactionStatus = "idle" | "preparing" | "awaiting_wallet" | "submitted" | "confirming" | "confirmed" | "failed" | "rejected";
export type TransactionState = { status: TransactionStatus; hash?: `0x${string}`; error?: string };
export const idleTransaction: TransactionState = { status: "idle" };

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type CreateTokenInput = { name: string; symbol: string; description: string; image: File | null };

export function validateCreateToken(input: CreateTokenInput): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = input.name.trim();
  const symbol = input.symbol.trim();
  const description = input.description.trim();
  if (!name || new TextEncoder().encode(name).length > 64) errors.name = "Name must be between 1 and 64 bytes.";
  if (!symbol || new TextEncoder().encode(symbol).length > 16) errors.symbol = "Symbol must be between 1 and 16 bytes.";
  if (!description || new TextEncoder().encode(description).length > 1000) errors.description = "Description must be between 1 and 1000 bytes.";
  if (!input.image) errors.image = "Select a token image.";
  else if (!ACCEPTED_IMAGE_TYPES.includes(input.image.type as typeof ACCEPTED_IMAGE_TYPES[number])) errors.image = "Use PNG, JPEG, WebP, or GIF.";
  else if (input.image.size > MAX_IMAGE_BYTES) errors.image = "Image must be at most 5 MB.";
  return errors;
}

export const canCreateToken = (chainId: number | undefined, authenticated: boolean, pending: boolean) => chainId === 84532 && authenticated && !pending;

export type TradeTransactionStatus =
  | "idle"
  | "preparing"
  | "awaiting_approval"
  | "approval_confirming"
  | "awaiting_wallet"
  | "submitted"
  | "confirming"
  | "confirmation_unknown"
  | "confirmed"
  | "reverted"
  | "replaced"
  | "failed";

export type TradeSide = "buy" | "sell";

export type TradeRecovery = {
  sender: `0x${string}`;
  nonce: number;
  to?: `0x${string}`;
  value: string;
  input: `0x${string}`;
  nextScanBlock: string;
};

export type PendingTrade = {
  version: 1;
  walletAddress: `0x${string}`;
  tokenAddress: `0x${string}`;
  side: TradeSide;
  hash?: `0x${string}`;
  status: "submitted" | "confirming" | "confirmation_unknown";
  submittedAt: number;
  recovery?: TradeRecovery;
};

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function pendingTradeKey(token: `0x${string}`, wallet: `0x${string}`) {
  return `zonk:pending-trade:v1:${wallet.toLowerCase()}:${token.toLowerCase()}`;
}

export function persistPendingTrade(trade: PendingTrade) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(pendingTradeKey(trade.tokenAddress, trade.walletAddress), JSON.stringify(trade));
}

export function readPendingTrade(token: `0x${string}`, wallet: `0x${string}`): PendingTrade | null {
  if (typeof window === "undefined") return null;
  const key = pendingTradeKey(token, wallet);
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isPendingTrade(value)) throw new Error("invalid pending trade");
    if (value.tokenAddress.toLowerCase() !== token.toLowerCase() || value.walletAddress.toLowerCase() !== wallet.toLowerCase()) {
      throw new Error("pending trade identity mismatch");
    }
    return value;
  } catch {
    window.localStorage.removeItem(key);
    return null;
  }
}

export function clearPendingTrade(token: `0x${string}`, wallet: `0x${string}`) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(pendingTradeKey(token, wallet));
}

function isPendingTrade(value: unknown): value is PendingTrade {
  if (typeof value !== "object" || value === null) return false;
  const trade = value as Partial<PendingTrade>;
  return trade.version === 1
    && (trade.side === "buy" || trade.side === "sell")
    && (trade.status === "submitted" || trade.status === "confirming" || trade.status === "confirmation_unknown")
    && typeof trade.walletAddress === "string" && ADDRESS_PATTERN.test(trade.walletAddress)
    && typeof trade.tokenAddress === "string" && ADDRESS_PATTERN.test(trade.tokenAddress)
    && (trade.hash === undefined || (typeof trade.hash === "string" && HASH_PATTERN.test(trade.hash)))
    && typeof trade.submittedAt === "number" && Number.isFinite(trade.submittedAt) && trade.submittedAt > 0
    && (trade.recovery === undefined || isTradeRecovery(trade.recovery));
}

function isTradeRecovery(value: unknown): value is TradeRecovery {
  if (typeof value !== "object" || value === null) return false;
  const recovery = value as Partial<TradeRecovery>;
  return typeof recovery.sender === "string" && ADDRESS_PATTERN.test(recovery.sender)
    && typeof recovery.nonce === "number" && Number.isSafeInteger(recovery.nonce) && recovery.nonce >= 0
    && (recovery.to === undefined || (typeof recovery.to === "string" && ADDRESS_PATTERN.test(recovery.to)))
    && typeof recovery.value === "string" && /^\d+$/.test(recovery.value)
    && typeof recovery.input === "string" && /^0x[0-9a-fA-F]*$/.test(recovery.input)
    && typeof recovery.nextScanBlock === "string" && /^\d+$/.test(recovery.nextScanBlock);
}
