import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/wallet", () => ({
  hasPrivyAppId: false,
  parsePrivyChainId: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => { throw new Error("usePrivy must not run without PrivyProvider"); },
  useWallets: () => { throw new Error("useWallets must not run without PrivyProvider"); },
}));

vi.mock("@privy-io/react-auth/smart-wallets", () => ({
  useSmartWallets: () => { throw new Error("useSmartWallets must not run without PrivyProvider"); },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import CreatePage from "@/app/create/page";
import { TokenTrading } from "./token-trading";

const token = "0x0000000000000000000000000000000000000011" as const;
const creator = "0x0000000000000000000000000000000000000022" as const;

afterEach(cleanup);

describe("missing Privy configuration boundary", () => {
  it("renders token creation without invoking hooks that require PrivyProvider", () => {
    render(<CreatePage />);
    expect(screen.getByText(/Set NEXT_PUBLIC_PRIVY_APP_ID to enable token creation/)).toBeTruthy();
  });

  it("renders trading without invoking hooks that require PrivyProvider", () => {
    render(<TokenTrading tokenAddress={token} creator={creator} symbol="ZONK" />);
    expect(screen.getByText(/Set NEXT_PUBLIC_PRIVY_APP_ID to enable Privy trading/)).toBeTruthy();
  });

});
