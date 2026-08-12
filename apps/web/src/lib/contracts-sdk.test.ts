import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, getAddress, type Hex } from "viem";
import { encodeCreateToken, parseTokenCreatedReceipt, zonkFactoryAbi } from "@zonk/contracts-sdk";

const factory = "0x26463E0645c676DdBAf2e4b9bE8A2ee6354fe960" as const;
const token = "0x0000000000000000000000000000000000000011" as const;
const creator = "0x0000000000000000000000000000000000000022" as const;

describe("factory SDK", () => {
  it("encodes the exact createToken(string,string,uint256) call", () => {
    expect(encodeCreateToken("Zonk", "ZK", BigInt(1000))).toBe("0x5b060530000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000003e800000000000000000000000000000000000000000000000000000000000000045a6f6e6b0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000025a4b000000000000000000000000000000000000000000000000000000000000");
  });
  it("decodes the exact TokenCreated event", () => {
    const topics = encodeEventTopics({ abi: zonkFactoryAbi, eventName: "TokenCreated", args: { token, creator } });
    const data = encodeAbiParameters([{type:"string"},{type:"string"},{type:"uint256"}], ["Zonk","ZK",BigInt(1000)]);
    const logTopics = topics.filter((topic): topic is Hex => typeof topic === "string");
    expect(parseTokenCreatedReceipt({ status:"success", logs:[{address:factory,data,topics:logTopics}] },factory)).toEqual({token:getAddress(token),creator:getAddress(creator),name:"Zonk",symbol:"ZK",initialSupply:BigInt(1000)});
  });
  it("rejects malformed or reverted receipts", () => {
    expect(() => parseTokenCreatedReceipt({status:"success",logs:[]},factory)).toThrow(/exactly one/);
    expect(() => parseTokenCreatedReceipt({status:"reverted",logs:[]},factory)).toThrow(/reverted/);
  });
});
