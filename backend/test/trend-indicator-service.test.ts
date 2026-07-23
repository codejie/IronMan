import { describe, expect, test } from "bun:test";
import type { PriceBar } from "../src/market/types";
import { TREND_INDICATOR_IDS, TrendIndicatorService, summarizeTrendReport, trendIndicatorCatalog, type TrendIndicatorResult } from "../src/services/trend-indicator-service";

function bars(count = 96): PriceBar[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 10 + index * 0.08 + Math.sin(index / 5) * 0.6;
    return {
      date: `2026-01-${String(index + 1).padStart(2, "0")}`,
      open: close - .12,
      close,
      high: close + .3,
      low: close - .42,
      volume: 1_000 + index * 50
    };
  });
}

describe("trend indicator registry", () => {
  test("exposes every Batman trend indicator with a unique catalog definition", () => {
    expect(TREND_INDICATOR_IDS).toHaveLength(26);
    expect(trendIndicatorCatalog).toHaveLength(26);
    expect(new Set(trendIndicatorCatalog.map((item) => item.id)).size).toBe(26);
    expect(trendIndicatorCatalog.find((item) => item.id === "MACD")?.lines).toEqual(["dif", "dea", "hist"]);
    expect(trendIndicatorCatalog.find((item) => item.id === "BOLL")?.chart).toBe("main");
  });

  test("calculates normalized values and signal records for the full registry", () => {
    const service = new TrendIndicatorService();
    const result = service.calculate(bars(), TREND_INDICATOR_IDS.map((indicatorId) => ({ indicatorId })));
    expect(result).toHaveLength(26);
    for (const item of result) {
      expect(Object.values(item.lines).every((line) => line.length === 96)).toBe(true);
      expect(item.signals.every((signal) => signal.date === "2026-01-96" && signal.strength >= 0 && signal.strength <= 100)).toBe(true);
    }
    const ma = result.find((item) => item.indicatorId === "MA");
    expect(ma?.lines.ma?.[18]).toBeNull();
    expect(ma?.lines.ma?.[19]).not.toBeNull();
    const macd = result.find((item) => item.indicatorId === "MACD");
    expect(macd?.lines.hist?.some((value) => value !== null)).toBe(true);
  });

  test("normalizes turning points and an explainable risk assessment from selected indicators", () => {
    const closes = [10, 9.8, 9.5, 9.2, 8.9, 9.1, 9.5, 9.9, 10.4, 10.8, 11.2, 11.5];
    const reversalBars: PriceBar[] = closes.map((close, index) => ({
      date: `2026-02-${String(index + 1).padStart(2, "0")}`,
      open: close - .1,
      close,
      high: close + .25,
      low: close - .35,
      volume: 1_000 + index * 100
    }));
    const service = new TrendIndicatorService();
    const indicators = service.calculate(reversalBars, [{ indicatorId: "MA", parameters: { period: 3 } }, { indicatorId: "MACD" }, { indicatorId: "RSI", parameters: { period: 3 } }]);
    const assessment = summarizeTrendReport(reversalBars, indicators);

    expect(indicators.some((indicator) => indicator.turningPoints.length > 0)).toBe(true);
    expect(assessment.turningPoints.every((point) => point.date.startsWith("2026-02-") && point.reason.length > 0)).toBe(true);
    expect(assessment.risk.evidence.length).toBeGreaterThan(0);
    expect(["low", "medium", "high"]).toContain(assessment.risk.level);
    expect(assessment.risk.reminder?.threshold).toBeGreaterThan(0);
  });

  test("keeps full indicator history but limits report points to the configured window", () => {
    const windowBars: PriceBar[] = Array.from({ length: 12 }, (_, index) => ({
      date: `2026-02-${String(index + 1).padStart(2, "0")}`,
      open: 10,
      close: 10 + index,
      high: 11 + index,
      low: 9 + index,
      volume: 1_000
    }));
    const result: TrendIndicatorResult = {
      indicatorId: "MA",
      lines: { ma: windowBars.map((bar) => bar.close) },
      signals: [],
      turningPoints: [
        { date: "2026-02-01", direction: "bullish", level: "info", title: "价格与 MA", reason: "早期上穿", price: 10, indicatorId: "MA" },
        { date: "2026-02-10", direction: "bearish", level: "warning", title: "价格与 MA", reason: "近期下穿", price: 19, indicatorId: "MA" },
        { date: "2026-02-12", direction: "bullish", level: "info", title: "价格与 MA", reason: "最新上穿", price: 21, indicatorId: "MA" }
      ]
    };

    const assessment = summarizeTrendReport(windowBars, [result], "3d");

    expect(assessment.turningPoints.map((point) => point.date)).toEqual(["2026-02-10", "2026-02-12"]);
  });
});
