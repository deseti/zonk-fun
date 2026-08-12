import { baseSepolia, contractAddresses, zonkCurveAbi, zonkFactoryAbi } from "@zonk/contracts-sdk";
import { createPublicClient, http, type Address } from "viem";

export { contractAddresses, zonkCurveAbi, zonkFactoryAbi };
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org") });
export async function readTokenOnchain(token: Address) {
  if (!contractAddresses.zonkFactory) return null;
  return publicClient.readContract({ address: contractAddresses.zonkFactory, abi: zonkFactoryAbi, functionName: "tokenInfo", args: [token] });
}
export async function readCurveOnchain(token: Address) {
  if (!contractAddresses.zonkCurve) return null;
  return publicClient.readContract({ address: contractAddresses.zonkCurve, abi: zonkCurveAbi, functionName: "curve", args: [token] });
}
