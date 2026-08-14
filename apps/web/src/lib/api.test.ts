import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

const emptyPage = { items: [] };
afterEach(() => vi.unstubAllGlobals());

describe("API client", () => {
  it("parses successful and empty collections", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(emptyPage), { status: 200 })));
    await expect(api.listTokens()).resolves.toEqual(emptyPage);
  });
  it("preserves normalized backend errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "not_found", message: "token not found" } }), { status: 404 })));
    await expect(api.token("0x0000000000000000000000000000000000000001")).rejects.toMatchObject({ status: 404, code: "not_found", message: "token not found" });
  });
  it("preserves normalized validation errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "invalid_request", message: "limit must be between 1 and 100" } }), { status: 400 })));
    await expect(api.listTokens("?limit=101")).rejects.toMatchObject({ status: 400, code: "invalid_request" });
  });
  it("normalizes malformed HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("oops", { status: 500 })));
    await expect(api.listTokens()).rejects.toMatchObject({ status: 500, code: "http_error" });
  });
  it("parses V3 pricing and canonical chart payloads", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token_address: "0x1", current_price: "7", fully_diluted_value: "7000", source: "indexed_v3_curve" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ bucket_start: 3600, trade_count: 1, buy_count: 1, sell_count: 0, volume: "10", unique_trader_count: 1, open_price: "6", high_price: "8", low_price: "5", close_price: "7" }] }), { status: 200 })));
    await expect(api.pricing("0x1")).resolves.toMatchObject({ fully_diluted_value: "7000", source: "indexed_v3_curve" });
    await expect(api.chart("0x1")).resolves.toMatchObject({ items: [expect.objectContaining({ open_price: "6", high_price: "8", low_price: "5", close_price: "7" })] });
  });
});
