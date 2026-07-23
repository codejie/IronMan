import { describe, expect, test } from "vitest";
import {
  buildKlineAnnotationLabels,
  buildKlineAnnotationVisuals,
  DEFAULT_KLINE_RANGE,
  DEFAULT_MA_PERIODS,
  DEFAULT_SUBCHART,
  fixedKlineTooltipPosition,
  KLINE_RANGES,
  lineVisualStyle,
  layoutKlineAnnotationLabels,
  movingAverage,
  parseKlinePreferences
} from "./kline-analysis";

describe("K-line analysis controls", () => {
  test("uses the agreed default range, MA set, and MACD subchart", () => {
    expect(DEFAULT_KLINE_RANGE).toBe("halfYear");
    expect(KLINE_RANGES.twoYears.limit).toBe(520);
    expect(DEFAULT_MA_PERIODS).toEqual([5, 10, 20]);
    expect(DEFAULT_SUBCHART).toBe("macd");
  });

  test("keeps MA values empty until the selected period has enough bars", () => {
    expect(movingAverage([1, 2, 3, 4, 5, 6], 3)).toEqual([null, null, 2, 3, 4, 5]);
  });

  test("uses the same color for a line and its tooltip marker", () => {
    expect(lineVisualStyle("#6581da", 1.5)).toEqual({
      itemStyle: { color: "#6581da" },
      lineStyle: { color: "#6581da", width: 1.5 }
    });
  });

  test("renders turning points as labelled high-contrast markers with matching guide lines", () => {
    const [bullish, bearish] = buildKlineAnnotationVisuals(
      [
        { date: "2026-07-21", price: 1.02, direction: "bullish", level: "info", title: "MACD", reason: "MACD上穿", color: "#58cf92" },
        { date: "2026-07-22", price: null, direction: "bearish", level: "risk", title: "RSI", reason: "RSI高位回落", color: "#ff8b91" }
      ],
      [
        { date: "2026-07-21", label: "2026/07/21", close: 1.01 },
        { date: "2026-07-22", label: "2026/07/22", close: 1.05 }
      ]
    );

    expect(bullish?.marker).toMatchObject({
      coord: ["2026/07/21", 1.02],
      symbol: "triangle",
      symbolRotate: 0,
      symbolSize: [8, 12],
      label: { show: false },
      itemStyle: { color: "#58cf92", borderColor: "#f4fbff", borderWidth: 1.5 }
    });
    expect(bullish?.guideLine).toMatchObject({ xAxis: "2026/07/21", lineStyle: { color: "#58cf92", type: "dashed" }, label: { show: false } });
    expect(bearish?.marker).toMatchObject({
      coord: ["2026/07/22", 1.05],
      symbolRotate: 180,
      symbolSize: [8, 12],
      label: { show: false }
    });
    expect(bearish?.guideLine).toMatchObject({ label: { show: false } });
  });

  test("places indicator names on dedicated top and bottom chart rails", () => {
    const labels = buildKlineAnnotationLabels(
      [
        { date: "2026-07-21", price: 1.02, direction: "bullish", level: "info", title: "MACD", reason: "MACD上穿", color: "#58cf92" },
        { date: "2026-07-22", price: 1.05, direction: "bearish", level: "warning", title: "RSI", reason: "RSI回落", color: "#ff8b91" },
        { date: "2026-07-22", price: 1.05, direction: "bearish", level: "risk", title: "BOLL", reason: "跌破下轨", color: "#ff8b91" }
      ],
      [
        { date: "2026-07-21", label: "2026/07/21", close: 1.01 },
        { date: "2026-07-22", label: "2026/07/22", close: 1.05 }
      ]
    );

    expect(labels).toEqual([
      expect.objectContaining({ title: "MACD", direction: "bullish", reason: "MACD上穿", axisLabel: "2026/07/21", price: 1.02, position: 0, lane: 0 }),
      expect.objectContaining({ title: "RSI", direction: "bearish", position: 100, lane: 0 }),
      expect.objectContaining({ title: "BOLL", direction: "bearish", position: 100, lane: 1 })
    ]);
  });

  test("moves labels away from the local candle area and avoids using the same rail slot", () => {
    const placements = layoutKlineAnnotationLabels(
      [
        { key: "high", left: 120, pointTop: 28, title: "MACD" },
        { key: "low", left: 120, pointTop: 205, title: "RSI" },
        { key: "nearby", left: 122, pointTop: 202, title: "BOLL" }
      ],
      420,
      18,
      236
    );

    expect(placements.high?.labelTop).toBeGreaterThan(120);
    expect(placements.low?.labelTop).toBeLessThan(120);
    expect(placements.nearby).not.toEqual(placements.low);
  });

  test("pins the K-line tooltip to a chart edge while preserving the hover height", () => {
    expect(fixedKlineTooltipPosition([120, 200], [600, 400], [180, 120])).toEqual([408, 92]);
    expect(fixedKlineTooltipPosition([500, 390], [600, 400], [180, 120])).toEqual([12, 220]);
    expect(fixedKlineTooltipPosition([500, 390], [600, 400], [180, 600])).toEqual([12, 12]);
  });

  test("restores only valid local K-line preferences and falls back for malformed values", () => {
    expect(parseKlinePreferences('{"range":"oneYear","maPeriods":[5,30,999],"subchart":"volume"}')).toEqual({
      range: "oneYear",
      maPeriods: [5, 30],
      subchart: "volume"
    });
    expect(parseKlinePreferences("invalid json")).toEqual({
      range: DEFAULT_KLINE_RANGE,
      maPeriods: DEFAULT_MA_PERIODS,
      subchart: DEFAULT_SUBCHART
    });
  });
});
