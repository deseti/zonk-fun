import { describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { activeProfileQueryKey, loadActiveProfile, profileAddressForMode } from "./page";

describe("active wallet profile", () => {
  it("keys and loads the creator profile by the active address", async () => {
    const external = "0x0000000000000000000000000000000000000022";
    const response = { address: external, token_count: 0, volume: "0", tokens: [] };
    const creator = vi.spyOn(api, "creator").mockResolvedValue(response);
    expect(activeProfileQueryKey(external)).toEqual(["creator", external]);
    await expect(loadActiveProfile(external)).resolves.toBe(response);
    expect(creator).toHaveBeenCalledWith(external, "?limit=12");
  });

  it("uses the external active address and never substitutes the embedded address", () => {
    const external = "0x0000000000000000000000000000000000000033" as const;
    const embedded = "0x0000000000000000000000000000000000000044" as const;
    expect(profileAddressForMode("external", external, embedded)).toBe(external);
    expect(activeProfileQueryKey(profileAddressForMode("external", external, embedded))).toEqual(["creator", external]);
  });

  it("uses the embedded smart-wallet address in embedded mode", () => {
    const external = "0x0000000000000000000000000000000000000033" as const;
    const embedded = "0x0000000000000000000000000000000000000044" as const;
    expect(profileAddressForMode("embedded", external, embedded)).toBe(embedded);
    expect(activeProfileQueryKey(profileAddressForMode("embedded", external, embedded))).toEqual(["creator", embedded]);
  });
});
