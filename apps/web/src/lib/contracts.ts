import { baseSepolia, contractAddresses, encodeCreateToken, parseTokenCreatedReceipt, zonkCurveAbi, zonkFactoryAbi } from "@zonk/contracts-sdk";
import { createPublicClient, http, type Address } from "viem";
import type { SmartWalletClientType } from "@privy-io/react-auth/smart-wallets";

export { contractAddresses, zonkCurveAbi, zonkFactoryAbi };
export const publicClient = createPublicClient({ chain: baseSepolia, transport: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org") });
export async function readTokenOnchain(token: Address) {
  if (!contractAddresses.zonkFactory) return null;
  return publicClient.readContract({ address: contractAddresses.zonkFactory, abi: zonkFactoryAbi, functionName: "tokenInfo", args: [token] });
}
export async function readCurveOnchain(token: Address) {
  if (!contractAddresses.zonkCurve) return null;
  return publicClient.readContract({ address: contractAddresses.zonkCurve, abi: zonkCurveAbi, functionName: "curve", args: [token] });
}
export async function submitCreateToken(client: SmartWalletClientType, creator: Address, name: string, symbol: string, initialSupply: bigint) {
  const factory=contractAddresses.zonkFactory;if(!factory) throw new Error("Factory address is not configured.");
  await publicClient.simulateContract({address:factory,abi:zonkFactoryAbi,functionName:"createToken",args:[name,symbol,initialSupply],account:creator});
  return client.sendTransaction({calls:[{to:factory,data:encodeCreateToken(name,symbol,initialSupply)}]});
}
export async function confirmCreatedToken(hash:`0x${string}`){
  const factory=contractAddresses.zonkFactory;if(!factory) throw new Error("Factory address is not configured.");
  const receipt=await publicClient.waitForTransactionReceipt({hash,confirmations:1});
  return {receipt,created:parseTokenCreatedReceipt(receipt,factory)};
}
