export type TransactionStatus = "idle" | "preparing" | "awaiting_wallet" | "submitted" | "confirming" | "confirmed" | "failed" | "rejected";
export type TransactionState = { status: TransactionStatus; hash?: `0x${string}`; error?: string };
export const idleTransaction: TransactionState = { status: "idle" };
