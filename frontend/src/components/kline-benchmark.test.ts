import { describe, expect, test } from "vitest";
import type { PriceBar } from "@/api/client";
import { alignBenchmarkClosePrices } from "./kline-benchmark";

function bar(date: string, close: number): PriceBar {
  return { date, open: close, close, high: close + 0.1, low: close - 0.1, volume: 100 };
}

describe("alignBenchmarkClosePrices", () => {
  test("aligns index close prices to the instrument bar dates", () => {
    const bars = [bar("2026-01-05", 10), bar("2026-01-06", 11)];
    const benchmark = [bar("2026-01-05", 3200.1), bar("2026-01-06", 3210.2), bar("2026-01-09", 3220.3)];
    expect(alignBenchmarkClosePrices(bars, benchmark)).toEqual([3200.1, 3210.2]);
  });

  test("fills null for instrument dates without an index bar", () => {
    const bars = [bar("2026-01-05", 10), bar("2026-01-06", 11), bar("2026-01-08", 12)];
    const benchmark = [bar("2026-01-05", 3200.1), bar("2026-01-06", 3210.2)];
    expect(alignBenchmarkClosePrices(bars, benchmark)).toEqual([3200.1, 3210.2, null]);
  });

  test("returns nulls when the benchmark has no data", () => {
    const bars = [bar("2026-01-05", 10)];
    expect(alignBenchmarkClosePrices(bars, [])).toEqual([null]);
  });
});
