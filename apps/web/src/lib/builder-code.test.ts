import { describe, expect, it } from "vitest";
import { Attribution } from "ox/erc8021";
import { ZONK_BUILDER_CODE, ZONK_BUILDER_CODE_DATA_SUFFIX, withBuilderCode } from "./builder-code";

describe("Base Builder Code attribution", () => {
  it("encodes the registered Zonk.fun code as a canonical ERC-8021 suffix", () => {
    expect(Attribution.fromData(`0x1234${ZONK_BUILDER_CODE_DATA_SUFFIX.slice(2)}`)).toEqual({
      codes: [ZONK_BUILDER_CODE],
      id: 0,
    });
    expect(ZONK_BUILDER_CODE_DATA_SUFFIX.endsWith("80218021802180218021802180218021")).toBe(true);
  });

  it("adds attribution without mutating calldata or the original request", () => {
    const request = { to: "0x0000000000000000000000000000000000000001", data: "0x1234", value: BigInt(5) } as const;
    const attributed = withBuilderCode(request);
    expect(attributed).toEqual({ ...request, dataSuffix: ZONK_BUILDER_CODE_DATA_SUFFIX });
    expect(request).not.toHaveProperty("dataSuffix");
    expect(attributed.data).toBe(request.data);
  });
});
