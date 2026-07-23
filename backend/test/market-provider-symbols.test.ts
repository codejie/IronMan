import { describe, expect, test } from "bun:test";
import { eastmoneySecurityId } from "../src/market/eastmoney-provider";
import { tencentSymbol } from "../src/market/tencent-provider";
import type { Instrument } from "../src/market/types";

function instrument(input: Pick<Instrument, "code" | "exchange" | "assetType">): Instrument {
  return {
    id: "instrument-id",
    name: input.code,
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
    ...input
  };
}

describe("listed fund market symbols", () => {
  test("uses the Shanghai market prefix for a 563 ETF stored as a fund", () => {
    const etf = instrument({ code: "563230", exchange: "fund", assetType: "fund" });

    expect(tencentSymbol(etf)).toBe("sh563230");
    expect(eastmoneySecurityId(etf)).toBe("1.563230");
  });

  test("uses the Shenzhen market prefix for a 159 ETF stored as a fund", () => {
    const etf = instrument({ code: "159919", exchange: "fund", assetType: "fund" });

    expect(tencentSymbol(etf)).toBe("sz159919");
    expect(eastmoneySecurityId(etf)).toBe("0.159919");
  });

  test("keeps ordinary open-fund symbols unprefixed for Tencent", () => {
    const openFund = instrument({ code: "000001", exchange: "fund", assetType: "fund" });

    expect(tencentSymbol(openFund)).toBe("000001");
    expect(eastmoneySecurityId(openFund)).toBe("0.000001");
  });
});
