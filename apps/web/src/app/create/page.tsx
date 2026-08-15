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
    return <main className="container page-shell flex-1"><p className="eyebrow">Token launch</p><h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Create a token</h1><div className="status-box status-warning mt-8 max-w-xl">Set NEXT_PUBLIC_PRIVY_APP_ID to enable token creation.</div></main>;
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
    form.set("website_url", input.websiteUrl.trim());
    form.set("x_url", input.xUrl.trim());
    form.set("telegram_url", input.telegramUrl.trim());
    form.set("discord_url", input.discordUrl.trim());
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

  return <main className="container page-shell flex-1">
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="min-w-0"><p className="eyebrow">Token launch</p><h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">Create your token</h1><p className="mt-4 max-w-2xl text-base leading-7 text-zinc-300">Publish its identity, review the permanent supply settings, then confirm one Base Sepolia factory transaction.</p><CreateTokenForm authenticated={authenticated} chainId={chainId} walletAddress={creator as Address | undefined} walletMode={mode} execute={execute} onSuccess={(address) => router.push(`/token/${address}`)} /></div>
      <aside className="panel lg:sticky lg:top-24" aria-label="Launch overview"><p className="eyebrow">What happens</p><ol className="mt-5 grid gap-5"><LaunchStep number="1" title="Metadata" copy="Your image and description are uploaded as a draft." /><LaunchStep number="2" title="Factory transaction" copy="Your wallet creates the token and its bonding curve atomically." /><LaunchStep number="3" title="Confirmation" copy="After Base Sepolia confirms and the indexer catches up, your token page opens." /></ol><div className="mt-6 border-t border-white/8 pt-5 text-sm leading-6 text-zinc-400"><p><span className="font-medium text-zinc-200">Initial purchase:</span> not part of this launch transaction.</p><p className="mt-2"><span className="font-medium text-zinc-200">Cost:</span> network gas only; trading fees are shown in protected quotes later.</p></div></aside>
    </div>
  </main>;
}

function LaunchStep({ number, title, copy }: { number: string; title: string; copy: string }) {
  return <li className="flex gap-3"><span className="flex h-7 w-7 flex-none items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-300/8 font-mono text-xs text-cyan-200">{number}</span><div><p className="text-sm font-semibold text-white">{title}</p><p className="mt-1 text-xs leading-5 text-zinc-500">{copy}</p></div></li>;
}
