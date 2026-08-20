import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canUseBrowserWallet, wagmiConfig } from "./wallet";
import { selectedZonkChainId, selectedZonkChainName } from "./chain";

describe("RainbowKit/Wagmi Base Mainnet wallet architecture", () => {
  it("configures only Base Mainnet and an injected browser-wallet connector", () => {
    expect(selectedZonkChainId).toBe(8453);
    expect(selectedZonkChainName).toBe("Base");
    expect(wagmiConfig.chains.map((chain) => chain.id)).toEqual([8453]);
    expect(wagmiConfig.connectors.some((connector) => connector.type === "injected")).toBe(true);
  });

  it("rejects disconnected and wrong-network wallets", () => {
    expect(canUseBrowserWallet(8453, true)).toBe(true);
    expect(canUseBrowserWallet(8453, false)).toBe(false);
    expect(canUseBrowserWallet(84532, true)).toBe(false);
  });

  it("renders RainbowKit ConnectButton and contains no Privy trading dependency", () => {
    const status = readFileSync(resolve(process.cwd(), "src/components/wallet-status.tsx"), "utf8");
    const trading = readFileSync(resolve(process.cwd(), "src/components/token-trading.tsx"), "utf8");
    const create = readFileSync(resolve(process.cwd(), "src/app/create/page.tsx"), "utf8");
    expect(status).toContain("ConnectButton");
    expect(`${status}\n${trading}\n${create}`).not.toMatch(/privy|embedded wallet|external wallet/i);
  });
});
