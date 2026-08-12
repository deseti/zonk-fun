import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BaseConnectedEthereumWallet } from "@privy-io/react-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmbeddedWalletExport, findEmbeddedEvmWallet } from "./embedded-wallet-export";

const mocks = vi.hoisted(() => ({
  usePrivy: vi.fn(),
  useWallets: vi.fn(),
  useExportWallet: vi.fn(),
  exportWallet: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: mocks.usePrivy,
  useWallets: mocks.useWallets,
  useExportWallet: mocks.useExportWallet,
}));

const embeddedAddress = "0x0000000000000000000000000000000000000011";
const smartAddress = "0x0000000000000000000000000000000000000022";

function wallet(address: string, overrides: Partial<BaseConnectedEthereumWallet> = {}) {
  return { type: "ethereum", address, walletClientType: "privy", connectorType: "embedded", imported: false, ...overrides } as BaseConnectedEthereumWallet;
}

function renderExport({ authenticated = true, wallets = [wallet(embeddedAddress)] }: { authenticated?: boolean; wallets?: BaseConnectedEthereumWallet[] } = {}) {
  mocks.usePrivy.mockReturnValue({ authenticated });
  mocks.useWallets.mockReturnValue({ wallets });
  mocks.useExportWallet.mockReturnValue({ exportWallet: mocks.exportWallet });
  return render(<EmbeddedWalletExport smartWalletAddress={smartAddress} />);
}

describe("Embedded Wallet export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exportWallet.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("does not render an export control for unauthenticated users", () => {
    renderExport({ authenticated: false });
    expect(screen.queryByRole("button", { name: "Export Embedded Wallet" })).toBeNull();
    expect(mocks.exportWallet).not.toHaveBeenCalled();
  });

  it("identifies the Privy embedded EVM wallet and excludes Smart Wallet-like entries", () => {
    const smartLike = wallet(smartAddress, { walletClientType: "privy", connectorType: "smart_wallet" as never });
    expect(findEmbeddedEvmWallet([smartLike, wallet(embeddedAddress)])?.address).toBe(embeddedAddress);
    expect(findEmbeddedEvmWallet([smartLike])).toBeUndefined();
  });

  it("does not select imported or non-EVM wallets", () => {
    const imported = wallet(embeddedAddress, { imported: true });
    const nonEvm = { ...wallet(embeddedAddress), type: "solana" } as unknown as BaseConnectedEthereumWallet;
    expect(findEmbeddedEvmWallet([imported, nonEvm])).toBeUndefined();
  });

  it("renders both explicitly labelled addresses and the export button", () => {
    renderExport();
    expect(screen.getByText("Embedded Wallet / EOA address")).toBeTruthy();
    expect(screen.getByText("Smart Wallet address used for indexed activity")).toBeTruthy();
    expect(screen.getByText(embeddedAddress)).toBeTruthy();
    expect(screen.getByText(smartAddress)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export Embedded Wallet" })).toBeTruthy();
  });

  it("handles Smart Wallet-only accounts without offering export", () => {
    renderExport({ wallets: [] });
    expect(screen.queryByRole("button", { name: "Export Embedded Wallet" })).toBeNull();
    expect(screen.getByText(/Smart Wallet-only accounts cannot export/)).toBeTruthy();
  });

  it("requires explicit acknowledgement and cancel does not call Privy", async () => {
    const user = userEvent.setup();
    renderExport();
    await user.click(screen.getByRole("button", { name: "Export Embedded Wallet" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Continue to Privy export" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.exportWallet).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("calls the installed Privy exportWallet API with the embedded address after confirmation", async () => {
    const user = userEvent.setup();
    renderExport();
    await user.click(screen.getByRole("button", { name: "Export Embedded Wallet" }));
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Continue to Privy export" }));
    expect(mocks.exportWallet).toHaveBeenCalledOnce();
    expect(mocks.exportWallet).toHaveBeenCalledWith({ address: embeddedAddress });
  });

  it("prevents duplicate export calls while Privy is pending", async () => {
    const user = userEvent.setup();
    let resolveExport: (() => void) | undefined;
    mocks.exportWallet.mockImplementation(() => new Promise<void>((resolve) => { resolveExport = resolve; }));
    renderExport();
    await user.click(screen.getByRole("button", { name: "Export Embedded Wallet" }));
    await user.click(screen.getByRole("checkbox"));
    const confirm = screen.getByRole("button", { name: "Continue to Privy export" });
    await user.click(confirm);
    await user.click(confirm);
    expect(mocks.exportWallet).toHaveBeenCalledOnce();
    expect((screen.getByRole("button", { name: "Opening secure export…" }) as HTMLButtonElement).disabled).toBe(true);
    resolveExport?.();
  });

  it("renders a safe generic error and does not expose returned error content", async () => {
    const user = userEvent.setup();
    const sensitive = "0xnot-a-private-key";
    mocks.exportWallet.mockRejectedValue(new Error(sensitive));
    renderExport();
    await user.click(screen.getByRole("button", { name: "Export Embedded Wallet" }));
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Continue to Privy export" }));
    expect(await screen.findByText(/could not start the wallet export/)).toBeTruthy();
    expect(screen.queryByText(sensitive)).toBeNull();
  });

  it("does not log or persist key material and clears the confirmation state on close", async () => {
    const user = userEvent.setup();
    const log = vi.spyOn(console, "log");
    const localStorageSet = vi.spyOn(Storage.prototype, "setItem");
    renderExport();
    await user.click(screen.getByRole("button", { name: "Export Embedded Wallet" }));
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Export Embedded Wallet" }));
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(log).not.toHaveBeenCalled();
    expect(localStorageSet).not.toHaveBeenCalled();
    log.mockRestore();
    localStorageSet.mockRestore();
  });
});
