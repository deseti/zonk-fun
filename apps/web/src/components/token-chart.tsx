"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, ColorType, createChart, CrosshairMode, HistogramSeries, type CandlestickData, type HistogramData, type Time } from "lightweight-charts";
import { useQuery } from "@tanstack/react-query";
import type { ChartPoint } from "@zonk/types";
import { api } from "@/lib/api";
import { presentationNumber, weiToUsdUnits, type EthUsdReference } from "@/lib/format";
import { useOraclePrice } from "@/providers/oracle-price-provider";

type CanonicalCandle = ChartPoint & { open_price: string; high_price: string; low_price: string; close_price: string };
type ChartView = "price" | "fdv";
const TIMEFRAMES = ["1m", "5m", "15m", "1H", "4H", "1D", "1W"] as const;
type Timeframe = typeof TIMEFRAMES[number];
const API_INTERVAL: Record<Timeframe, "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w"> = { "1m": "1m", "5m": "5m", "15m": "15m", "1H": "1h", "4H": "4h", "1D": "1d", "1W": "1w" };
export const CANDLE_COLORS = {
  buy: { body: "#22c55e", wick: "#4ade80", volume: "rgb(34 197 94 / 0.28)" },
  sell: { body: "#ef4444", wick: "#f87171", volume: "rgb(239 68 68 / 0.28)" },
} as const;

function decimalPrice(value: string | null): value is string {
  return value !== null && /^\d+$/.test(value);
}

function completeCandle(point: ChartPoint): point is CanonicalCandle {
  return decimalPrice(point.open_price) && decimalPrice(point.high_price) && decimalPrice(point.low_price) && decimalPrice(point.close_price);
}

export function candleTradeSide(point: Pick<ChartPoint, "buy_count" | "sell_count">): "buy" | "sell" {
  return point.sell_count > point.buy_count ? "sell" : "buy";
}

// Retained as a narrow adapter for regression coverage. The terminal chart uses
// chartDisplayData below so authoritative API strings remain untouched.
export function chartCandles(points: ChartPoint[]): { candles: CandlestickData<Time>[]; scale: bigint } {
  const complete = points.filter(completeCandle);
  if (complete.length === 0) return { candles: [], scale: BigInt(1) };
  const largest = complete.flatMap((point) => [point.open_price, point.high_price, point.low_price, point.close_price]).reduce((max, value) => BigInt(value) > max ? BigInt(value) : max, BigInt(0));
  const digits = largest.toString().length;
  const scale = digits > 12 ? BigInt(10) ** BigInt(digits - 12) : BigInt(1);
  return { scale, candles: complete.map((point) => { const colors = CANDLE_COLORS[candleTradeSide(point)]; return { time: point.bucket_start as Time, open: Number(BigInt(point.open_price) / scale), high: Number(BigInt(point.high_price) / scale), low: Number(BigInt(point.low_price) / scale), close: Number(BigInt(point.close_price) / scale), color: colors.body, wickColor: colors.wick, borderColor: colors.body }; }) };
}

function chartDisplayData(points: ChartPoint[], view: ChartView, initialSupply: string | undefined, reference: EthUsdReference | null) {
  const complete = points.filter(completeCandle);
  const priceValue = (value: string) => {
    let wei = BigInt(value);
    if (view === "fdv") {
      if (!initialSupply) return 0;
      wei = wei * BigInt(initialSupply) / BigInt(1_000_000_000_000_000_000);
    }
    const usd = weiToUsdUnits(wei, reference);
    return usd === null ? presentationNumber(wei) : presentationNumber(usd, 8);
  };
  const volumeValue = (value: string) => {
    const usd = weiToUsdUnits(value, reference);
    return usd === null ? presentationNumber(BigInt(value)) : presentationNumber(usd, 8);
  };
  return {
    candles: complete.map((point) => { const colors = CANDLE_COLORS[candleTradeSide(point)]; return { time: point.bucket_start as Time, open: priceValue(point.open_price), high: priceValue(point.high_price), low: priceValue(point.low_price), close: priceValue(point.close_price), color: colors.body, wickColor: colors.wick, borderColor: colors.body } satisfies CandlestickData<Time>; }),
    volumes: complete.map((point) => ({ time: point.bucket_start as Time, value: volumeValue(point.volume), color: CANDLE_COLORS[candleTradeSide(point)].volume } satisfies HistogramData<Time>)),
  };
}

export function TokenChart({ tokenAddress, initialSupply, className = "mt-10" }: { tokenAddress: string; initialSupply?: string; className?: string }) {
  const { reference } = useOraclePrice();
  const container = useRef<HTMLDivElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>("1H");
  const [requestVersion, setRequestVersion] = useState(0);
  const [view, setView] = useState<ChartView>("price");
  const interval = API_INTERVAL[timeframe];
  const query = useQuery({ queryKey: ["token-chart", tokenAddress, interval, requestVersion], queryFn: () => api.chart(tokenAddress, `?interval=${interval}&limit=500`), refetchInterval: 15_000 });
  const chartData = useMemo(() => query.data ? chartDisplayData(query.data.candles, view, initialSupply, reference) : { candles: [], volumes: [] }, [initialSupply, query.data, reference, view]);
  const currency = reference ? "USD" : "ETH";

  useEffect(() => {
    const element = container.current;
    if (!element || chartData.candles.length === 0) return;
    const formatValue = (value: number) => formatChartValue(value, currency);
    const chart = createChart(element, {
      width: element.clientWidth,
      height: element.clientHeight,
      layout: { background: { type: ColorType.Solid, color: "#071019" }, textColor: "#7e91a0", fontFamily: "Geist, sans-serif" },
      grid: { vertLines: { color: "#111e2a" }, horzLines: { color: "#111e2a" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#223443", scaleMargins: { top: 0.08, bottom: 0.28 } },
      timeScale: { borderColor: "#223443", timeVisible: true, secondsVisible: false },
      localization: { priceFormatter: formatValue },
    });
    const priceSeries = chart.addSeries(CandlestickSeries, { upColor: CANDLE_COLORS.buy.body, downColor: CANDLE_COLORS.sell.body, borderVisible: false, wickUpColor: CANDLE_COLORS.buy.wick, wickDownColor: CANDLE_COLORS.sell.wick, priceFormat: { type: "custom", minMove: 0.00000001, formatter: formatValue } });
    const volumeSeries = chart.addSeries(HistogramSeries, { priceScaleId: "volume", priceFormat: { type: "custom", minMove: 0.00000001, formatter: formatValue } });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, borderVisible: false });
    priceSeries.setData(chartData.candles);
    volumeSeries.setData(chartData.volumes);
    chart.timeScale().fitContent();
    chart.subscribeCrosshairMove((params) => {
      const target = tooltip.current;
      if (!target || !params.time || !params.point || params.point.x < 0 || params.point.y < 0 || params.point.x > element.clientWidth || params.point.y > element.clientHeight) {
        if (target) target.hidden = true;
        return;
      }
      const candle = params.seriesData.get(priceSeries) as CandlestickData<Time> | undefined;
      const volume = params.seriesData.get(volumeSeries) as HistogramData<Time> | undefined;
      if (!candle || !("open" in candle)) { target.hidden = true; return; }
      target.hidden = false;
      target.textContent = `O ${formatValue(candle.open)}  H ${formatValue(candle.high)}  L ${formatValue(candle.low)}  C ${formatValue(candle.close)}  ·  Vol ${volume ? formatValue(volume.value) : "—"}`;
    });
    const resize = () => chart.applyOptions({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => { observer.disconnect(); chart.remove(); };
  }, [chartData, currency]);

  const controls = <div className="flex min-w-0 flex-wrap items-center gap-2"><div className="grid w-full grid-cols-4 rounded-lg border border-white/8 bg-black/20 p-0.5 sm:flex sm:w-auto sm:flex-wrap" role="group" aria-label="Chart timeframe">{TIMEFRAMES.map((item) => { const loading = query.isFetching && timeframe === item; return <button key={item} type="button" disabled={loading} title={`Canonical indexed ${item} candles`} aria-pressed={timeframe === item} className={`min-h-9 rounded-md px-2.5 text-xs font-semibold ${timeframe === item ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-200"} ${loading ? "cursor-wait opacity-60" : ""}`} onClick={() => { setTimeframe(item); setRequestVersion((version) => version + 1); }}>{item}</button>; })}</div><div className="flex rounded-lg border border-white/8 bg-black/20 p-0.5" role="group" aria-label="Chart value"><button type="button" aria-pressed={view === "price"} className={`min-h-9 rounded-md px-3 text-xs font-semibold ${view === "price" ? "bg-cyan-300/12 text-cyan-200" : "text-zinc-500 hover:text-zinc-200"}`} onClick={() => setView("price")}>Price</button><button type="button" disabled={!initialSupply} aria-pressed={view === "fdv"} className={`min-h-9 rounded-md px-3 text-xs font-semibold ${view === "fdv" ? "bg-violet-300/12 text-violet-200" : "text-zinc-500 hover:text-zinc-200"}`} onClick={() => setView("fdv")}>FDV</button></div></div>;

  if (query.isPending) return <ChartState className={className} controls={controls} timeframe={timeframe} copy={`Loading canonical ${timeframe} candles and volume…`} loading />;
  if (query.isError) return <ChartState className={className} controls={controls} timeframe={timeframe} copy="Historical prices could not be loaded." error />;
  if (chartData.candles.length === 0) return <ChartState className={className} controls={controls} timeframe={timeframe} copy={`No complete canonical ${timeframe} candle is available yet.`} />;
  return <section className={`terminal-panel min-w-0 overflow-hidden ${className}`} aria-label="Price history"><div className="flex flex-col gap-3 border-b border-white/8 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><h2 className="font-semibold text-white">{view === "price" ? "Price" : "Fully diluted value"}</h2><span className={reference ? "badge-success" : "badge-warning"}>{currency}</span></div><p className="mt-1 text-xs text-zinc-600">Canonical V3 {timeframe} OHLC · indexed volume</p><p className="mt-1 text-[0.65rem] text-zinc-700">UTC-aligned candles · green buy-dominant, red sell-dominant.</p></div>{controls}</div><div className="relative bg-[#071019]"><div ref={container} className="h-[24rem] w-full sm:h-[30rem] lg:h-[40rem] xl:h-[44rem]" role="img" aria-label={`${view === "price" ? "Price" : "FDV"} candlestick chart with volume in ${currency}`} /><div ref={tooltip} hidden className="pointer-events-none absolute left-3 top-3 max-w-[calc(100%-1.5rem)] rounded-lg border border-white/10 bg-[#071019]/95 px-3 py-2 font-mono text-[0.65rem] text-zinc-300 shadow-xl" /></div><p className="border-t border-white/8 px-4 py-3 text-xs leading-5 text-zinc-600">{reference ? `Chainlink reference updated ${new Date(reference.asOf).toLocaleString()}.` : "USD unavailable; the chart falls back to ETH-denominated indexed values."} No external pool feed is used before graduation.</p></section>;
}

function ChartState({ copy, controls, timeframe = "1H", error = false, loading = false, className }: { copy: string; controls: React.ReactNode; timeframe?: Timeframe; error?: boolean; loading?: boolean; className: string }) {
  return <section className={`terminal-panel ${className}`} aria-label="Price history"><div className="flex flex-col gap-3 border-b border-white/8 p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold text-white">Market chart</h2><p className="mt-1 text-xs text-zinc-600">Canonical V3 {timeframe} OHLC</p></div>{controls}</div><p className={`m-4 text-sm ${error ? "text-red-300" : "text-zinc-400"}`}>{copy}</p>{loading && <div className="skeleton m-4 h-64 rounded-xl sm:h-80" />}</section>;
}

function formatChartValue(value: number, currency: "USD" | "ETH") {
  if (!Number.isFinite(value)) return "—";
  if (currency === "USD") {
    if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    if (Math.abs(value) >= 1) return `$${value.toFixed(2)}`;
    return `$${value.toFixed(8).replace(/0+$/, "")}`;
  }
  return `${value.toFixed(value >= 1 ? 4 : 8).replace(/0+$/, "").replace(/\.$/, "")} ETH`;
}
