import { describe, expect, it } from "vitest";
import { chartCandles } from "./token-chart";

describe("chartCandles", () => {
  it("renders only complete canonical OHLC records with a bounded presentation scale", () => {
    const { candles, scale } = chartCandles([
      { bucket_start: 3600, trade_count: 2, buy_count: 2, sell_count: 0, volume: "30", unique_trader_count: 1, open_price: "1000000000000000000", high_price: "3000000000000000000", low_price: "1000000000000000000", close_price: "2000000000000000000" },
      { bucket_start: 7200, trade_count: 1, buy_count: 1, sell_count: 0, volume: "10", unique_trader_count: 1, open_price: null, high_price: null, low_price: null, close_price: null },
    ]);
	    expect(scale).toBe(BigInt(10_000_000));
	    expect(candles).toEqual([{ time: 3600, open: 100_000_000_000, high: 300_000_000_000, low: 100_000_000_000, close: 200_000_000_000 }]);
  });
});
