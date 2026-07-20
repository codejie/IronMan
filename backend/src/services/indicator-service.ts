import type { PriceBar } from "../market/types";

export type IndicatorType = "MA" | "MACD" | "RSI" | "BOLL";
export type IndicatorValue = number | null;

export interface IndicatorResult {
  type: IndicatorType;
  lines: Record<string, IndicatorValue[]>;
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function sma(values: number[], period: number): IndicatorValue[] {
  const result: IndicatorValue[] = Array.from({ length: values.length }, () => null);
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index] ?? 0;
    if (index >= period) sum -= values[index - period] ?? 0;
    if (index >= period - 1) result[index] = rounded(sum / period);
  }
  return result;
}

function ema(values: Array<number | null>, period: number): IndicatorValue[] {
  const result: IndicatorValue[] = Array.from({ length: values.length }, () => null);
  const multiplier = 2 / (period + 1);
  let window: number[] = [];
  let previous: number | null = null;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === null || value === undefined) continue;
    if (previous === null) {
      window.push(value);
      if (window.length < period) continue;
      previous = window.reduce((total, entry) => total + entry, 0) / period;
      result[index] = rounded(previous);
      window = [];
      continue;
    }
    previous = (value - previous) * multiplier + previous;
    result[index] = rounded(previous);
  }
  return result;
}

function macd(values: number[]): Record<string, IndicatorValue[]> {
  const fast = ema(values, 12);
  const slow = ema(values, 26);
  const dif = values.map((_, index) => (fast[index] === null || slow[index] === null ? null : rounded((fast[index] as number) - (slow[index] as number))));
  const dea = ema(dif, 9);
  const hist = dif.map((value, index) => (value === null || dea[index] === null ? null : rounded(2 * (value - (dea[index] as number)))));
  return { dif, dea, hist };
}

function rsi(values: number[], period = 14): IndicatorValue[] {
  const result: IndicatorValue[] = Array.from({ length: values.length }, () => null);
  if (values.length <= period) return result;
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = (values[index] ?? 0) - (values[index - 1] ?? 0);
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }
  const calculate = () => {
    if (losses === 0) return 100;
    const relativeStrength = gains / losses;
    return 100 - 100 / (1 + relativeStrength);
  };
  result[period] = rounded(calculate());
  for (let index = period + 1; index < values.length; index += 1) {
    const change = (values[index] ?? 0) - (values[index - 1] ?? 0);
    gains = (gains * (period - 1) + Math.max(change, 0)) / period;
    losses = (losses * (period - 1) + Math.max(-change, 0)) / period;
    result[index] = rounded(calculate());
  }
  return result;
}

function bollinger(values: number[], period = 20, deviation = 2): Record<string, IndicatorValue[]> {
  const middle = sma(values, period);
  const upper: IndicatorValue[] = Array.from({ length: values.length }, () => null);
  const lower: IndicatorValue[] = Array.from({ length: values.length }, () => null);
  for (let index = period - 1; index < values.length; index += 1) {
    const window = values.slice(index - period + 1, index + 1);
    const average = middle[index] as number;
    const variance = window.reduce((total, value) => total + (value - average) ** 2, 0) / period;
    const standardDeviation = Math.sqrt(variance);
    upper[index] = rounded(average + deviation * standardDeviation);
    lower[index] = rounded(average - deviation * standardDeviation);
  }
  return { upper, middle, lower };
}

export class IndicatorService {
  calculate(bars: PriceBar[], types: IndicatorType[]): IndicatorResult[] {
    const close = bars.map((bar) => bar.close);
    return types.map<IndicatorResult>((type) => {
      switch (type) {
        case "MA":
          return { type, lines: { ma: sma(close, 20) } } as IndicatorResult;
        case "MACD":
          return { type, lines: macd(close) } as IndicatorResult;
        case "RSI":
          return { type, lines: { rsi: rsi(close) } } as IndicatorResult;
        case "BOLL":
          return { type, lines: bollinger(close) } as IndicatorResult;
      }
    });
  }
}
