import { describe, expect, test } from "vitest";
import type { TrendIndicatorDefinition, TrendRunReport } from "@/api/client";
import { buildTrendChartPresentation, buildTrendIndicatorParameterSummary } from "./trend-report-presentation";

const definitions: TrendIndicatorDefinition[] = [
  { id: "MA", label: "移动平均线", category: "overlap", parameters: [{ key: "period", label: "周期", defaultValue: 20, min: 2, max: 240 }], lines: ["ma"], chart: "main" },
  {
    id: "MACD",
    label: "MACD",
    category: "momentum",
    parameters: [
      { key: "fast", label: "快线", defaultValue: 12, min: 2, max: 120 },
      { key: "slow", label: "慢线", defaultValue: 26, min: 3, max: 240 },
      { key: "signal", label: "信号线", defaultValue: 9, min: 2, max: 120 }
    ],
    lines: ["dif", "dea", "hist"],
    chart: "sub"
  }
];

const report: TrendRunReport = {
  id: "report-1",
  instrumentId: "instrument-1",
  createdAt: "2026-07-23T00:00:00.000Z",
  result: {
    instrument: { id: "instrument-1", code: "563230", exchange: "sh", name: "卫星ETF富国", assetType: "fund" },
    source: "mock",
    bars: [
      { date: "2026-07-21", open: 1, close: 1.02, high: 1.03, low: .99, volume: 100 },
      { date: "2026-07-22", open: 1.02, close: 1.05, high: 1.06, low: 1.01, volume: 120 }
    ],
    indicators: [
      { indicatorId: "MA", lines: { ma: [null, 1.03] }, signals: [], turningPoints: [] },
      { indicatorId: "MACD", lines: { dif: [null, .01], dea: [null, .005], hist: [null, .01] }, signals: [], turningPoints: [] }
    ],
    direction: "bullish",
    turningPoints: [
      { date: "2026-07-21", direction: "bearish", level: "warning", title: "MA", reason: "跌破均线", price: 1.02, indicatorId: "MA" },
      { date: "2026-07-22", direction: "bullish", level: "info", title: "MACD", reason: "MACD上穿", price: 1.05, indicatorId: "MACD" }
    ],
    risk: { level: "low", evidence: ["MACD 多头"], suggestedAction: "继续观察", reminder: { direction: "above", threshold: 1.07, cooldownMinutes: 240 } },
    error: null
  }
};

describe("trend report chart presentation", () => {
  test("summarizes the active indicator using its selected strategy parameters", () => {
    expect(buildTrendIndicatorParameterSummary(definitions, [{ indicatorId: "MA", parameters: { period: 20 }, enabled: true, displayOrder: 0 }], "MA"))
      .toBe("MA · 周期: 20");
    expect(buildTrendIndicatorParameterSummary(definitions, [{ indicatorId: "MACD", parameters: { fast: 12, slow: 26, signal: 9 }, enabled: true, displayOrder: 1 }], "MACD"))
      .toBe("MACD · 快线: 12 · 慢线: 26 · 信号线: 9");
  });

  test("builds shared overlays and markers for combined, multi-indicator, and K-line modes", () => {
    const combined = buildTrendChartPresentation(report, definitions, "combined", []);
    expect(combined.mainOverlays).toHaveLength(1);
    expect(combined.subOverlays).toHaveLength(3);
    expect(combined.annotations).toEqual([
      expect.objectContaining({ indicatorId: "MA", date: "2026-07-21", color: "#68d991" }),
      expect.objectContaining({ indicatorId: "MACD", date: "2026-07-22", color: "#fa7575" })
    ]);
    expect(combined.subOverlays.find((item) => item.id === "MACD:hist")?.kind).toBe("bar");

    const selected = buildTrendChartPresentation(report, definitions, "indicator", ["MA", "MACD"]);
    expect(selected.mainOverlays.map((item) => item.id)).toEqual(["MA:ma"]);
    expect(selected.subOverlays.map((item) => item.id)).toEqual(["MACD:dif", "MACD:dea", "MACD:hist"]);
    expect(selected.annotations.map((item) => item.indicatorId)).toEqual(["MA", "MACD"]);

    const macdOnly = buildTrendChartPresentation(report, definitions, "indicator", ["MACD"]);
    expect(macdOnly.annotations.map((item) => item.indicatorId)).toEqual(["MACD"]);

    const kline = buildTrendChartPresentation(report, definitions, "kline", []);
    expect(kline.mainOverlays).toHaveLength(0);
    expect(kline.subOverlays).toHaveLength(0);
  });
});
