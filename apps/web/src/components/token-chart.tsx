"use client";

import { useEffect, useMemo, useRef } from "react";
import { CandlestickSeries, ColorType, createChart, type CandlestickData, type Time } from "lightweight-charts";
import { useQuery } from "@tanstack/react-query";
import type { ChartPoint } from "@zonk/types";
import { api } from "@/lib/api";

type CanonicalCandle = ChartPoint & { open_price: string; high_price: string; low_price: string; close_price: string };

function decimalPrice(value: string | null): value is string {
  return value !== null && /^\d+$/.test(value);
}

function completeCandle(point: ChartPoint): point is CanonicalCandle {
  return decimalPrice(point.open_price) && decimalPrice(point.high_price) && decimalPrice(point.low_price) && decimalPrice(point.close_price);
}

// Lightweight Charts requires JavaScript numbers. This presentation-only scale
// keeps the authoritative decimal-string prices in the API while avoiding an
// unsafe direct Number(uint256) conversion in the browser.
export function chartCandles(points: ChartPoint[]): { candles: CandlestickData<Time>[]; scale: bigint } {
  const complete = points.filter(completeCandle);
  if (complete.length === 0) return { candles: [], scale: BigInt(1) };
  const largest = complete.flatMap((point) => [point.open_price, point.high_price, point.low_price, point.close_price]).reduce((max, value) => BigInt(value) > max ? BigInt(value) : max, BigInt(0));
  const digits = largest.toString().length;
  const scale = digits > 12 ? BigInt(10) ** BigInt(digits - 12) : BigInt(1);
  return { scale, candles: complete.map((point) => ({ time: point.bucket_start as Time, open: Number(BigInt(point.open_price) / scale), high: Number(BigInt(point.high_price) / scale), low: Number(BigInt(point.low_price) / scale), close: Number(BigInt(point.close_price) / scale) })) };
}

export function TokenChart({ tokenAddress }: { tokenAddress: string }) {
  const container = useRef<HTMLDivElement>(null);
  const query = useQuery({ queryKey: ["token-chart", tokenAddress], queryFn: () => api.chart(tokenAddress, "?limit=168"), refetchInterval: 15_000 });
  const chartData = useMemo(() => query.data ? chartCandles(query.data.items) : { candles: [], scale: BigInt(1) }, [query.data]);

  useEffect(() => {
    const element = container.current;
    if (!element || chartData.candles.length === 0) return;
    const chart = createChart(element, {
      width: element.clientWidth,
      height: 320,
      layout: { background: { type: ColorType.Solid, color: "#09090b" }, textColor: "#a1a1aa" },
      grid: { vertLines: { color: "#27272a" }, horzLines: { color: "#27272a" } },
      rightPriceScale: { borderColor: "#3f3f46" },
      timeScale: { borderColor: "#3f3f46", timeVisible: true },
    });
    const series = chart.addSeries(CandlestickSeries, { upColor: "#67e8f9", downColor: "#fbbf24", borderVisible: false, wickUpColor: "#67e8f9", wickDownColor: "#fbbf24" });
    series.setData(chartData.candles);
    chart.timeScale().fitContent();
    const resize = () => chart.applyOptions({ width: element.clientWidth });
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => { observer.disconnect(); chart.remove(); };
  }, [chartData]);

  if (query.isPending) return <section className="panel mt-10" aria-label="Price history"><h2 className="text-xl font-semibold text-white">Price history</h2><p className="mt-4 text-sm text-zinc-400">Loading canonical hourly history…</p></section>;
  if (query.isError) return <section className="panel mt-10" aria-label="Price history"><h2 className="text-xl font-semibold text-white">Price history</h2><p className="mt-4 text-sm text-red-300">Historical prices could not be loaded.</p></section>;
  if (chartData.candles.length === 0) return <section className="panel mt-10" aria-label="Price history"><h2 className="text-xl font-semibold text-white">Price history</h2><p className="mt-4 text-sm text-zinc-400">No complete canonical hourly candle is available yet.</p></section>;
  const scaleLabel = chartData.scale === BigInt(1) ? "wei per whole token" : `scaled by 10^${chartData.scale.toString().length - 1} wei per whole token`;
  return <section className="panel mt-10" aria-label="Price history"><div className="flex items-baseline justify-between gap-4"><h2 className="text-xl font-semibold text-white">Price history</h2><p className="text-xs text-zinc-500">Canonical V3 hourly candles</p></div><div ref={container} className="mt-5 h-80 w-full" role="img" aria-label="Canonical hourly candlestick chart" /><p className="mt-3 text-xs text-zinc-500">Indexed V3 curve prices, {scaleLabel}. No external pool feed is used before graduation.</p></section>;
}
