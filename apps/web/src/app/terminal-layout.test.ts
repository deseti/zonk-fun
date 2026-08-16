import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/app/token/[address]/page.tsx"), "utf8");
const graduation = readFileSync(resolve(process.cwd(), "src/components/token-graduation.tsx"), "utf8");

describe("token terminal responsive layout", () => {
  it("stacks without horizontal overflow in the required mobile order", () => {
    expect(css).toContain('grid-template-areas: "right" "center" "history"');
    expect(css).toContain(".terminal-center, .terminal-right { display: grid");
    expect(css).toContain(".terminal-layout > * { min-width: 0; max-width: 100%; }");
    expect(page.indexOf('className="terminal-market"')).toBeLessThan(page.indexOf('className="terminal-graduation"'));
    expect(page.indexOf('className="terminal-chart"')).toBeLessThan(page.indexOf('className="terminal-trade"'));
  });

  it("keeps three desktop columns with the chart as the dominant track", () => {
    expect(css).toContain("grid-template-columns: minmax(12rem, 0.52fr) minmax(0, 2.9fr) minmax(16rem, 0.7fr)");
    expect(css).toContain('grid-template-areas: "history center right"');
  });

  it("keeps curve reserves and raw V3 liquidity semantically separate", () => {
    expect(page).toContain('label="Curve reserve"');
    expect(page).toContain('label="LP custody"');
    expect(page).not.toContain('label="Liquidity"');
    expect(page).toContain("graduated={graduated}");
    expect(graduation).toContain('label="V3 liquidity"');
    expect(graduation).not.toContain("formatNative(graduation.liquidity");
    expect(graduation).not.toContain("formatWeiUsd(graduation.liquidity");
  });
});
