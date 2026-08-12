import { encodeFunctionData, getAddress, parseEventLogs, type Address, type Hex } from "viem";

export const BASE_SEPOLIA_CHAIN_ID = 84532 as const;

export const baseSepolia = {
  id: BASE_SEPOLIA_CHAIN_ID,
  name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://sepolia.base.org"] } },
  blockExplorers: { default: { name: "Basescan", url: "https://sepolia.basescan.org" } },
} as const;

export type ContractAddresses = {
  zonkFactory?: `0x${string}`;
  zonkCurve?: `0x${string}`;
};

const address = (value: string | undefined): `0x${string}` | undefined => {
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/.test(value)) return undefined;
  return value as `0x${string}`;
};

export const contractAddresses: ContractAddresses = {
  zonkFactory: address(process.env.NEXT_PUBLIC_ZONK_FACTORY_ADDRESS),
  zonkCurve: address(process.env.NEXT_PUBLIC_ZONK_CURVE_ADDRESS),
};

export const zonkFactoryAbi = [
  { type: "function", name: "createToken", stateMutability: "nonpayable", inputs: [{ name: "name", type: "string" }, { name: "symbol", type: "string" }, { name: "initialSupply", type: "uint256" }], outputs: [{ name: "token", type: "address" }] },
  { type: "function", name: "isToken", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "tokenInfo", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ name: "creator", type: "address" }, { name: "launchState", type: "uint8" }] },
  { type: "function", name: "tokensByCreator", stateMutability: "view", inputs: [{ name: "creator", type: "address" }], outputs: [{ type: "address[]" }] },
  { type: "event", name: "TokenCreated", anonymous: false, inputs: [{ name: "token", type: "address", indexed: true }, { name: "creator", type: "address", indexed: true }, { name: "name", type: "string", indexed: false }, { name: "symbol", type: "string", indexed: false }, { name: "initialSupply", type: "uint256", indexed: false }] },
] as const;

export type TokenCreated = { token: Address; creator: Address; name: string; symbol: string; initialSupply: bigint };
export const encodeCreateToken = (name: string, symbol: string, initialSupply: bigint): Hex => encodeFunctionData({ abi: zonkFactoryAbi, functionName: "createToken", args: [name, symbol, initialSupply] });
export function parseTokenCreatedReceipt(receipt: { status: string; logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[] }, factory: Address): TokenCreated {
  if (receipt.status !== "success") throw new Error("token creation transaction reverted");
  const receiptLogs = [...receipt.logs] as unknown as Parameters<typeof parseEventLogs>[0]["logs"];
  const logs = parseEventLogs({ abi: zonkFactoryAbi, eventName: "TokenCreated", logs: receiptLogs, strict: true }).filter((log) => getAddress(log.address) === getAddress(factory));
  if (logs.length !== 1) throw new Error("confirmed receipt did not contain exactly one TokenCreated event");
  const args = logs[0].args;
  if (!args.token || !args.creator || args.initialSupply === undefined) throw new Error("TokenCreated event is malformed");
  return { token: getAddress(args.token), creator: getAddress(args.creator), name: args.name, symbol: args.symbol, initialSupply: args.initialSupply };
}

export const zonkCurveAbi = [
  { type: "function", name: "curve", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ name: "token", type: "address" }, { name: "creator", type: "address" }, { name: "curveSupply", type: "uint256" }, { name: "soldSupply", type: "uint256" }, { name: "reserveBalance", type: "uint256" }, { name: "startingPrice", type: "uint256" }, { name: "slope", type: "uint256" }, { name: "graduationThreshold", type: "uint256" }, { name: "lifecycle", type: "uint8" }] },
  { type: "function", name: "quoteBuy", stateMutability: "view", inputs: [{ name: "token", type: "address" }, { name: "tokenAmount", type: "uint256" }], outputs: [{ name: "reserveIn", type: "uint256" }, { name: "curveCost", type: "uint256" }, { name: "protocolFee", type: "uint256" }, { name: "creatorFee", type: "uint256" }] },
  { type: "function", name: "quoteSell", stateMutability: "view", inputs: [{ name: "token", type: "address" }, { name: "tokenAmount", type: "uint256" }], outputs: [{ name: "reserveOut", type: "uint256" }, { name: "curveValue", type: "uint256" }, { name: "protocolFee", type: "uint256" }, { name: "creatorFee", type: "uint256" }] },
] as const;
