import { describe, expect, it } from "vitest";
import { CANDLE_COLORS, candleTradeSide, chartCandles } from "./token-chart";

describe("chartCandles", () => {
  it("renders only complete canonical OHLC records with a bounded presentation scale", () => {
    const { candles, scale } = chartCandles([
      { bucket_start: 3600, trade_count: 2, buy_count: 2, sell_count: 0, volume: "30", unique_trader_count: 1, open_price: "1000000000000000000", high_price: "3000000000000000000", low_price: "1000000000000000000", close_price: "2000000000000000000" },
      { bucket_start: 7200, trade_count: 1, buy_count: 1, sell_count: 0, volume: "10", unique_trader_count: 1, open_price: null, high_price: null, low_price: null, close_price: null },
    ]);
    expect(scale).toBe(BigInt(10_000_000));
    expect(candles).toEqual([{ time: 3600, open: 100_000_000_000, high: 300_000_000_000, low: 100_000_000_000, close: 200_000_000_000, color: CANDLE_COLORS.buy.body, wickColor: CANDLE_COLORS.buy.wick, borderColor: CANDLE_COLORS.buy.body }]);
  });

  it("uses trade-side counts instead of price movement for green buy and red sell candles", () => {
    const { candles } = chartCandles([
      { bucket_start: 60, trade_count: 3, buy_count: 2, sell_count: 1, volume: "3", unique_trader_count: 2, open_price: "30", high_price: "30", low_price: "10", close_price: "10" },
      { bucket_start: 120, trade_count: 3, buy_count: 1, sell_count: 2, volume: "3", unique_trader_count: 2, open_price: "10", high_price: "30", low_price: "10", close_price: "30" },
    ]);
    expect(candleTradeSide({ buy_count: 2, sell_count: 1 })).toBe("buy");
    expect(candleTradeSide({ buy_count: 1, sell_count: 2 })).toBe("sell");
    expect(candles[0]).toMatchObject({ open: 30, close: 10, color: CANDLE_COLORS.buy.body, wickColor: CANDLE_COLORS.buy.wick });
    expect(candles[1]).toMatchObject({ open: 10, close: 30, color: CANDLE_COLORS.sell.body, wickColor: CANDLE_COLORS.sell.wick });
  });
});
