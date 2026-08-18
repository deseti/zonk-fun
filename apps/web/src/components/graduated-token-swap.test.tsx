import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ authenticated: true }),
}));

vi.mock("@privy-io/react-auth/smart-wallets", () => ({
  useSmartWallets: () => ({ getClientForChain: vi.fn() }),
}));

vi.mock("@/providers/active-wallet-provider", () => ({
  useActiveWallet: () => ({
    mode: "embedded",
    activeAddress: "0x0000000000000000000000000000000000000022",
    activeChainId: 84532,
    externalWallet: undefined,
  }),
}));

vi.mock("@/lib/uniswap-v3", () => ({
  BASE_SEPOLIA_CHAIN_ID: 84532,
  configuredUniswapV3: () => ({ quoter: "0x1", router: "0x2", factory: "0x3" }),
  validateCanonicalPool: vi.fn().mockResolvedValue({ router: "0x0000000000000000000000000000000000000099", pool: "0x0000000000000000000000000000000000000088" }),
  quoteGraduatedSwap: vi.fn().mockResolvedValue({
    amountIn: BigInt("100000000000000000"),
    amountOut: BigInt("1"),
    minimumOut: BigInt("1"),
    deadline: BigInt(2_000_000_000),
  }),
  quoteIsFresh: () => true,
  buildGraduatedSwapTransaction: vi.fn(),
  simulateGraduatedSwapTransaction: vi.fn(),
  orchestrateGraduatedSwap: vi.fn(),
  approvalCall: vi.fn(),
}));

vi.mock("@/lib/contracts", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/contracts")>();
  return {
    ...original,
    publicClient: {
      getBalance: vi.fn().mockResolvedValue(BigInt("1000000000000000000")),
      readContract: vi.fn().mockImplementation(async ({ functionName }: { functionName: string }) => {
        if (functionName === "decimals") return 18;
        if (functionName === "balanceOf") return BigInt("5000000000000000000");
        return BigInt(0);
      }),
    },
  };
});

import { GraduatedTokenSwap } from "./graduated-token-swap";

const source = readFileSync(resolve(process.cwd(), "src/components/graduated-token-swap.tsx"), "utf8");

function renderSwap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(
    <GraduatedTokenSwap
      tokenAddress="0x0000000000000000000000000000000000000011"
      canonicalPoolAddress="0x0000000000000000000000000000000000000033"
      symbol="ZONK"
    />,
    { wrapper },
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("graduated swap presets", () => {
  it("reuses the shared preset helper and existing quote lifecycle", () => {
    expect(source).toContain("TradeAmountPresets");
    expect(source).toContain("changeAmount");
    expect(source).toContain("setQuote(undefined)");
    expect(source).not.toContain("quoteBuyByBudget");
  });

  it("applies buy 10%, 50%, and gas-reserving MAX from the wallet ETH balance", async () => {
    const user = userEvent.setup();
    renderSwap();
    const ten = await screen.findByRole("button", { name: "Use 10% of ETH balance" });
    await waitFor(() => expect((ten as HTMLButtonElement).disabled).toBe(false));
    await user.click(ten);
    expect((screen.getByLabelText("ETH amount") as HTMLInputElement).value).toBe("0.1");
    await user.click(screen.getByRole("button", { name: "Use 50% of ETH balance" }));
    expect((screen.getByLabelText("ETH amount") as HTMLInputElement).value).toBe("0.5");
    await user.click(screen.getByRole("button", { name: "Use maximum ETH after gas reserve" }));
    expect((screen.getByLabelText("ETH amount") as HTMLInputElement).value).toBe("0.999");
  });

  it("uses the exact token balance for graduated sell MAX", async () => {
    const user = userEvent.setup();
    renderSwap();
    await user.click(await screen.findByRole("button", { name: "Sell ZONK" }));
    await user.click(screen.getByRole("button", { name: "Use exact token balance" }));
    expect((screen.getByLabelText("ZONK amount") as HTMLInputElement).value).toBe("5");
  });
});
