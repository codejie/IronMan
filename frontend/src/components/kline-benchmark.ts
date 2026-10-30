import type { PriceBar } from "@/api/client";

/** K 线对话框「所属指数」叠加线：指数日 K 的收盘价（与标的 K 线同日期对齐）。 */
export interface KlineBenchmarkSeries {
  name: string;
  /** 与 K 线 bars 等长，按 bars 日期对齐；无数据位置为 null。 */
  values: Array<number | null>;
}

/**
 * 将指数日 K 收盘价对齐到标的 K 线 bars 的日期序列。
 * 指数与标的同市场，交易日一致；缺失日填 null（图表断线）。
 */
export function alignBenchmarkClosePrices(
  bars: PriceBar[],
  benchmarkBars: PriceBar[]
): Array<number | null> {
  const byDate = new Map(benchmarkBars.map((bar) => [bar.date.slice(0, 10), bar.close]));
  return bars.map((bar) => byDate.get(bar.date.slice(0, 10)) ?? null);
}
