import { Attribution } from "ox/erc8021";
import type { Hex } from "viem";

export const ZONK_BUILDER_CODE = "bc_tea0a669";

export const ZONK_BUILDER_CODE_DATA_SUFFIX = Attribution.toDataSuffix({
  codes: [ZONK_BUILDER_CODE],
}) as Hex;

/** Attach Base Mainnet ERC-8021 attribution without changing the original request. */
export function withBuilderCode<T extends object>(request: T): T & { dataSuffix: Hex } {
  return { ...request, dataSuffix: ZONK_BUILDER_CODE_DATA_SUFFIX };
}
