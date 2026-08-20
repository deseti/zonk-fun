import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("product logo identity", () => {
  it("reuses the app favicon asset without a duplicate mark", () => {
    const navigation = readFileSync(resolve(process.cwd(), "src/components/navigation.tsx"), "utf8");
    const favicon = readFileSync(resolve(process.cwd(), "src/app/favicon.ico"));
    expect(navigation).toContain('src="/favicon.ico"');
    expect(navigation).toContain('data-logo-source="/favicon.ico"');
    expect(favicon.byteLength).toBeGreaterThan(0);
  });
});
