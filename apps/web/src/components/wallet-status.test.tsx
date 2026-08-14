import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { logoutPrivy, switchPrivyEmbeddedWallet } from "./wallet-status";

describe("Privy account controls", () => {
  it("keeps the logged-out login label visible", () => {
    expect(renderToStaticMarkup(<button>Log in: wallet, email, or social</button>)).toContain("wallet, email, or social");
  });

  it.each(["wrong network", "wallet creating", "smart wallet ready"])("keeps Log out visible for authenticated %s state", (state) => {
    expect(renderToStaticMarkup(<div><span>{state}</span><button>Log out</button></div>)).toContain("Log out");
  });

  it("calls Privy's official logout method", async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    const setError = vi.fn();
    await logoutPrivy(logout, setError);
    expect(logout).toHaveBeenCalledOnce();
    expect(setError).toHaveBeenCalledWith(null);
  });

  it("switches the actual embedded Privy wallet and refreshes its smart-wallet client", async () => {
    const switchChain = vi.fn().mockResolvedValue(undefined);
    const getClientForChain = vi.fn().mockResolvedValue({ chain: { id: 84532 } });
    const nextClient = await switchPrivyEmbeddedWallet({ switchChain }, getClientForChain);
    expect(switchChain).toHaveBeenCalledWith(84532);
    expect(getClientForChain).toHaveBeenCalledWith({ id: 84532 });
    expect(nextClient).toMatchObject({ chain: { id: 84532 } });
  });

  it("preserves the failed switch error instead of claiming Base Sepolia", async () => {
    const switchChain = vi.fn().mockRejectedValue(new Error("unsupported"));
    await expect(switchPrivyEmbeddedWallet({ switchChain }, vi.fn())).rejects.toThrow("unsupported");
    expect(switchChain).toHaveBeenCalledWith(84532);
  });
});
