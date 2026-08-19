import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Base Mainnet frontend configuration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_ZONK_CHAIN_ID", "8453");
    vi.stubEnv("NEXT_PUBLIC_BASE_MAINNET_RPC_URL", "https://mainnet.invalid");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("selects the Mainnet chain, RPC, and explorer", async () => {
    const chain = await import("./chain");
    expect(chain.selectedZonkChainId).toBe(8453);
    expect(chain.selectedZonkChainName).toBe("Base");
    expect(chain.selectedZonkRPCURL).toBe("https://mainnet.invalid");
    expect(chain.explorerTransactionURL("0xabc")).toBe("https://basescan.org/tx/0xabc");
  });

  it("selects only the Mainnet Uniswap V3 environment set", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_MAINNET_UNISWAP_V3_QUOTER_V2", "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a");
    vi.stubEnv("NEXT_PUBLIC_BASE_MAINNET_UNISWAP_V3_SWAP_ROUTER_02", "0x2626664c2603336E57B271c5C0b26F421741e481");
    vi.stubEnv("NEXT_PUBLIC_BASE_MAINNET_UNISWAP_V3_FACTORY", "0x33128a8fC17869897dcE68Ed026d694621f6FDfD");
    vi.stubEnv("NEXT_PUBLIC_BASE_SEPOLIA_UNISWAP_V3_FACTORY", "0x0000000000000000000000000000000000000001");
    const uniswap = await import("./uniswap-v3");
    expect(uniswap.configuredUniswapV3()).toEqual({
      quoter: uniswap.BASE_MAINNET_QUOTER_V2,
      router: uniswap.BASE_MAINNET_SWAP_ROUTER_02,
      factory: uniswap.BASE_MAINNET_V3_FACTORY,
    });
  });
});
