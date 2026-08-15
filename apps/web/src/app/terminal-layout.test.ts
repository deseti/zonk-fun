import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/app/token/[address]/page.tsx"), "utf8");

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
});
