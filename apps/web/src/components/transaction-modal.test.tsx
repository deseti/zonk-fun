import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TransactionModal } from "./transaction-modal";

const wallet = "0x1111111111111111111111111111111111111111" as const;
const hash = `0x${"ab".repeat(32)}` as const;

describe("TransactionModal", () => {
  it("shows review values and waits for explicit confirmation", () => {
    const confirm = vi.fn();
    render(<TransactionModal open title="Buy ZONK" phase="review" wallet={wallet} details={[{ label: "Maximum input", value: "0.1 ETH" }]} onClose={() => {}} onConfirm={confirm} />);
    expect(screen.getByRole("dialog").textContent).toContain("Base · 8453");
    expect(screen.getByRole("dialog").textContent).toContain("0.1 ETH");
    fireEvent.click(screen.getByRole("button", { name: "Confirm transaction" }));
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("renders confirmed hashes with the canonical BaseScan link", () => {
    render(<TransactionModal open title="Sell ZONK" phase="confirmed" wallet={wallet} hash={hash} details={[]} onClose={() => {}} />);
    expect(screen.getByRole("link", { name: "View Explorer" }).getAttribute("href")).toBe(`https://basescan.org/tx/${hash}`);
  });

  it("states that a rejected wallet request submitted nothing", () => {
    render(<TransactionModal open title="Create token" phase="rejected" wallet={wallet} error="User rejected" details={[]} onClose={() => {}} />);
    expect(screen.getByText("Nothing was submitted by Zonk.fun.")).toBeTruthy();
  });
});
