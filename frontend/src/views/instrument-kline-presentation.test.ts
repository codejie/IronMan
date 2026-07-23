import { describe, expect, test } from "vitest";
import { instrumentCodeLabel, instrumentKlineTitle, instrumentTypeLabel } from "./instrument-kline-presentation";

describe("instrument K-line presentation", () => {
  test("formats the dialog header as name, code, and type", () => {
    expect(instrumentKlineTitle({ assetType: "stock", code: "600519", name: "贵州茅台" })).toBe("贵州茅台 600519 [股票]");
    expect(instrumentKlineTitle({ assetType: "index", code: "000300", name: "沪深300" })).toBe("沪深300 000300 [指数]");
    expect(instrumentKlineTitle({ assetType: "fund", code: "563230", name: "卫星ETF富国" })).toBe("卫星ETF富国 563230 [ETF]");
  });

  test("keeps LOF and open-fund labels distinct", () => {
    expect(instrumentTypeLabel({ assetType: "fund", code: "161725" })).toBe("LOF");
    expect(instrumentTypeLabel({ assetType: "fund", code: "000001" })).toBe("基金");
  });

  test("places the instrument type after its code in table labels", () => {
    expect(instrumentCodeLabel({ assetType: "fund", code: "563230" })).toBe("563230 [ETF]");
  });
});
