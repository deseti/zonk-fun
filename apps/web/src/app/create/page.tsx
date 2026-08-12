"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { useRouter } from "next/navigation";
import { getAddress, parseUnits, type Address } from "viem";
import { CreateTokenForm, type CreateExecution } from "@/components/create-token-form";
import { api, ApiClientError } from "@/lib/api";
import { confirmCreatedToken, submitCreateToken } from "@/lib/contracts";
import { parsePrivyChainId } from "@/lib/wallet";

const pause=(ms:number)=>new Promise((resolve)=>setTimeout(resolve,ms));

export default function CreatePage(){
  const {authenticated,user}=usePrivy();const {wallets}=useWallets();const {getClientForChain}=useSmartWallets();const router=useRouter();
  const embedded=wallets.find((wallet)=>wallet.walletClientType==="privy");const chainId=parsePrivyChainId(embedded?.chainId);const creator=user?.smartWallet?.address;
  const execute:CreateExecution=async(input,report)=>{
    if(chainId!==84532)throw new Error("Switch the Privy wallet to Base Sepolia before creating a token.");
    if(!creator)throw new Error("Wait for the Privy smart wallet before creating a token.");
    const creatorAddress=getAddress(creator);const initialSupply=parseUnits(input.supply,18);const form=new FormData();form.set("name",input.name.trim());form.set("symbol",input.symbol.trim());form.set("description",input.description.trim());form.set("initial_supply",initialSupply.toString());form.set("image",input.image!);
    report({status:"preparing"});const draft=await api.uploadMetadata(form);const client=await getClientForChain({id:84532});if(!client)throw new Error("The Base Sepolia smart-wallet client is unavailable.");
    report({status:"awaiting_wallet"});const hash=await submitCreateToken(client,creatorAddress,input.name.trim(),input.symbol.trim(),initialSupply);report({status:"submitted",hash});report({status:"confirming",hash});
    const {created}=await confirmCreatedToken(hash);if(getAddress(created.creator)!==creatorAddress)throw new Error("Confirmed creator does not match the connected wallet.");
    let token;for(let attempt=0;attempt<60;attempt++){try{token=await api.finalizeMetadata(draft.draft_id,created.token,hash);break}catch(error){if(!(error instanceof ApiClientError)||error.code!=="not_indexed")throw error;await pause(2000)}}
    if(!token)throw new Error("The transaction confirmed, but indexing did not finish in time.");return{tokenAddress:getAddress(created.token),hash};
  };
  return <main className="container flex-1 py-12"><p className="eyebrow">Phase 7</p><h1 className="mt-3 text-3xl font-semibold text-white">Create a token</h1><p className="mt-3 max-w-2xl text-zinc-300">Create a fixed-supply token through the Zonk factory on Base Sepolia.</p><CreateTokenForm authenticated={authenticated} chainId={chainId} walletAddress={creator as Address|undefined} execute={execute} onSuccess={(address)=>router.push(`/token/${address}`)}/></main>;
}
