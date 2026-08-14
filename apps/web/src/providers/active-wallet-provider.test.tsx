import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const embeddedAddress = "0x0000000000000000000000000000000000000011";
const externalAddress = "0x0000000000000000000000000000000000000022";
const hooks = vi.hoisted(() => ({
  user: { smartWallet: { address: "0x0000000000000000000000000000000000000011" } } as unknown,
  wallets: [] as unknown[],
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ user: hooks.user }),
  useWallets: () => ({ wallets: hooks.wallets }),
}));

import { ActiveWalletProvider, useActiveWallet } from "./active-wallet-provider";

function wallet(address: string, walletClientType: string, chainId = "eip155:84532") {
  return { type: "ethereum", address, walletClientType, chainId, connectorType: walletClientType === "privy" ? "embedded" : "injected" };
}

function Probe() {
  const active = useActiveWallet();
  return <div><p>mode:{active.mode}</p><p>address:{active.activeAddress}</p><p>chain:{active.activeChainId}</p><button onClick={() => active.selectMode("embedded")}>Use embedded</button><button onClick={() => active.selectMode("external")}>Use external</button></div>;
}

afterEach(() => { cleanup(); hooks.wallets = []; hooks.user = { smartWallet: { address: embeddedAddress } }; });

describe("active wallet selection", () => {
  it("selects a connected external wallet and never substitutes the embedded address", async () => {
    hooks.wallets = [wallet(embeddedAddress, "privy"), wallet(externalAddress, "metamask")];
    const user = userEvent.setup();
    render(<ActiveWalletProvider><Probe /></ActiveWalletProvider>);
    expect(screen.getByText("mode:external")).toBeTruthy();
    expect(screen.getByText(`address:${externalAddress}`)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Use embedded" }));
    expect(screen.getByText("mode:embedded")).toBeTruthy();
    expect(screen.getByText(`address:${embeddedAddress}`)).toBeTruthy();
  });

  it("resets stale external mode to embedded when the external wallet disappears", async () => {
    hooks.wallets = [wallet(embeddedAddress, "privy"), wallet(externalAddress, "metamask")];
    const user = userEvent.setup();
    const view = render(<ActiveWalletProvider><Probe /></ActiveWalletProvider>);
    await user.click(screen.getByRole("button", { name: "Use external" }));
    hooks.wallets = [wallet(embeddedAddress, "privy")];
    view.rerender(<ActiveWalletProvider><Probe /></ActiveWalletProvider>);
    expect(await screen.findByText("mode:embedded")).toBeTruthy();
    expect(screen.getByText(`address:${embeddedAddress}`)).toBeTruthy();
  });
});
