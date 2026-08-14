"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { FIXED_TOKEN_SUPPLY } from "@zonk/contracts-sdk";
import { useRouter } from "next/navigation";
import { getAddress, type Address } from "viem";
import { CreateTokenForm, type CreateExecution } from "@/components/create-token-form";
import { api, ApiClientError } from "@/lib/api";
import { confirmCreatedToken, configuredCurveInitialization, createExternalWalletClient, submitCreateToken, submitExternalCreateToken } from "@/lib/contracts";
import { hasPrivyAppId, isPrivyEmbeddedWallet, parsePrivyChainId } from "@/lib/wallet";
import { useActiveWallet } from "@/providers/active-wallet-provider";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function CreatePage() {
  if (!hasPrivyAppId) {
    return <main className="container flex-1 py-12"><p className="eyebrow">Phase 7</p><h1 className="mt-3 text-3xl font-semibold text-white">Create a token</h1><div className="panel mt-8 max-w-xl text-sm text-amber-200">Set NEXT_PUBLIC_PRIVY_APP_ID to enable token creation.</div></main>;
  }
  return <PrivyCreatePage />;
}

function PrivyCreatePage() {
  const { authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const { getClientForChain } = useSmartWallets();
  const { mode, activeAddress, activeChainId, externalWallet } = useActiveWallet();
  const router = useRouter();
  const embedded = wallets.find(isPrivyEmbeddedWallet);
  const chainId = mode === "external" ? activeChainId : parsePrivyChainId(embedded?.chainId);
  const creator = mode === "external" ? activeAddress : user?.smartWallet?.address;

  const execute: CreateExecution = async (input, report) => {
    if (chainId !== 84532) throw new Error(`Switch the ${mode} wallet to Base Sepolia before creating a token.`);
    if (!creator) throw new Error("Wait for the Privy smart wallet before creating a token.");
    const config = configuredCurveInitialization();
    const creatorAddress = getAddress(creator);
    const form = new FormData();
    form.set("name", input.name.trim());
    form.set("symbol", input.symbol.trim());
    form.set("description", input.description.trim());
    form.set("initial_supply", FIXED_TOKEN_SUPPLY.toString());
    form.set("image", input.image!);
    report({ status: "preparing" });
    const draft = await api.uploadMetadata(form);
    report({ status: "awaiting_wallet" });
    let hash;
    if (mode === "external") {
      if (!externalWallet || externalWallet.address.toLowerCase() !== creatorAddress.toLowerCase()) throw new Error("The selected external wallet does not match the active account.");
      const provider = await externalWallet.getEthereumProvider();
      const client = createExternalWalletClient(provider, creatorAddress);
      hash = await submitExternalCreateToken(client, creatorAddress, input.name.trim(), input.symbol.trim(), config.userSalt);
    } else {
      const client = await getClientForChain({ id: 84532 });
      if (!client) throw new Error("The Base Sepolia smart-wallet client is unavailable.");
      hash = await submitCreateToken(client, creatorAddress, input.name.trim(), input.symbol.trim(), config.userSalt);
    }
    report({ status: "submitted", hash });
    report({ status: "confirming", hash });
    const { created } = await confirmCreatedToken(hash);
    if (getAddress(created.creator) !== creatorAddress) throw new Error("Confirmed creator does not match the connected wallet.");
    let token;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { token = await api.finalizeMetadata(draft.draft_id, created.token, hash); break; }
      catch (error) { if (!(error instanceof ApiClientError) || error.code !== "not_indexed") throw error; await pause(2000); }
    }
    if (!token) throw new Error("The transaction confirmed, but indexing did not finish in time.");
    return { tokenAddress: getAddress(created.token), hash };
  };

  return <main className="container flex-1 py-12"><p className="eyebrow">Phase 7</p><h1 className="mt-3 text-3xl font-semibold text-white">Create a token</h1><p className="mt-3 max-w-2xl text-zinc-300">Atomically launch a fixed 1 billion supply token with all inventory assigned to its Base Sepolia bonding curve.</p><CreateTokenForm authenticated={authenticated} chainId={chainId} walletAddress={creator as Address | undefined} walletMode={mode} execute={execute} onSuccess={(address) => router.push(`/token/${address}`)} /></main>;
}
