import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChartInterval, ChartPage } from "@zonk/types";
import { api } from "@/lib/api";
import { TokenChart } from "./token-chart";

const token = "0x0000000000000000000000000000000000000011";
const supported: ChartInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderChart() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><TokenChart tokenAddress={token} /></QueryClientProvider>);
}

function emptyPage(interval: ChartInterval): ChartPage {
  return { interval, supported_intervals: supported, candles: [] };
}

describe("TokenChart timeframe controls", () => {
  it("refetches canonical candles for every selected interval", async () => {
    const chart = vi.spyOn(api, "chart").mockImplementation(async (_address, query = "") => {
      const interval = new URLSearchParams(query.slice(1)).get("interval") as ChartInterval;
      return emptyPage(interval);
    });
    const user = userEvent.setup();
    renderChart();

    await waitFor(() => expect(chart).toHaveBeenCalledWith(token, "?interval=1h&limit=500"));
    for (const [label, interval] of [["1m", "1m"], ["5m", "5m"], ["15m", "15m"], ["1H", "1h"], ["4H", "4h"], ["1D", "1d"], ["1W", "1w"]] as const) {
      await user.click(screen.getByRole("button", { name: label }));
      await waitFor(() => expect(chart).toHaveBeenCalledWith(token, `?interval=${interval}&limit=500`));
      expect(screen.getByRole("button", { name: label }).getAttribute("aria-pressed")).toBe("true");
    }
  });

  it("disables only the selected control while its request is loading", () => {
    vi.spyOn(api, "chart").mockReturnValue(new Promise<ChartPage>(() => undefined));
    renderChart();

    expect(screen.getByText("Loading canonical 1H candles and volume…")).not.toBeNull();
    expect((screen.getByRole("button", { name: "1H" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "1m" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
