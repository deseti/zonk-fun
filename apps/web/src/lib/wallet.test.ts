import { describe, expect, it } from "vitest";
import { canPrepareTransaction, derivePrivyWalletState, hasPrivyAppIdValue, parsePrivyChainId, privyConfig, privyLoginMethods } from "./wallet";

const base = {
  ready: true,
  authenticated: true,
  loginPending: false,
  createPending: false,
  hasEmbeddedWallet: true,
  hasSmartWalletAddress: true,
  hasSmartWalletClient: true,
  chainId: 84532,
};

describe("Privy wallet state", () => {
  it("covers logged-out and login states", () => {
    expect(derivePrivyWalletState({ ...base, authenticated: false })).toBe("logged_out");
    expect(derivePrivyWalletState({ ...base, ready: false })).toBe("logging_in");
    expect(derivePrivyWalletState({ ...base, loginPending: true })).toBe("logging_in");
  });

  it("covers embedded-wallet creation and smart-wallet readiness", () => {
    expect(derivePrivyWalletState({ ...base, hasEmbeddedWallet: false })).toBe("logged_in_without_embedded_wallet");
    expect(derivePrivyWalletState({ ...base, hasEmbeddedWallet: false, createPending: true })).toBe("embedded_wallet_creating");
    expect(derivePrivyWalletState({ ...base, hasSmartWalletAddress: false })).toBe("embedded_wallet_creating");
    expect(derivePrivyWalletState(base)).toBe("smart_wallet_ready");
  });

  it("recognizes Base Sepolia and blocks unsupported transaction preparation", () => {
    expect(derivePrivyWalletState({ ...base, chainId: 1 })).toBe("wrong_network");
    expect(canPrepareTransaction(84532, true, true)).toBe(true);
    expect(canPrepareTransaction(1, true, true)).toBe(false);
    expect(canPrepareTransaction(84532, false, true)).toBe(false);
    expect(canPrepareTransaction(84532, true, false)).toBe(false);
    expect(parsePrivyChainId("eip155:84532")).toBe(84532);
    expect(parsePrivyChainId("eip155:1")).toBe(1);
    expect(parsePrivyChainId(undefined)).toBeUndefined();
  });

  it("surfaces errors and validates missing App ID configuration", () => {
    expect(derivePrivyWalletState({ ...base, error: new Error("login failed") })).toBe("error");
    expect(hasPrivyAppIdValue(undefined)).toBe(false);
    expect(hasPrivyAppIdValue("  ")).toBe(false);
    expect(hasPrivyAppIdValue("public-app-id")).toBe(true);
  });

  it("keeps the provider Privy-only", () => {
    expect(privyConfig.defaultChain?.id).toBe(84532);
    expect(privyConfig.supportedChains?.map((chain) => chain.id)).toEqual([84532]);
    expect(privyLoginMethods).toEqual(["email", "google", "twitter"]);
    expect(privyConfig.loginMethods).toEqual(["email", "google", "twitter"]);
    expect(privyConfig.loginMethods).not.toContain("wallet");
    expect(privyConfig.embeddedWallets?.ethereum?.createOnLogin).toBe("all-users");
    expect(privyConfig.embeddedWallets?.showWalletUIs).toBe(false);
    expect(privyConfig.externalWallets).toEqual({});
  });
});
