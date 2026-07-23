import type { PriceBar } from "../market/types";
import { errors } from "../errors";
import type { TrendReportWindow } from "./trend-strategy-service";

export const TREND_INDICATOR_IDS = [
  "MA", "SAR", "ADX", "MACD", "MACDEXT", "RSI", "MOM", "KDJ", "BOLL", "ATR", "NATR", "OBV", "AD", "VWAP",
  "AVGPRICE", "MEDPRICE", "CDLHAMMER", "CDLENGULFING", "CDLMORNINGSTAR", "CDLDOJI", "CDLEVENINGSTAR", "CDL3WHITESOLDIERS",
  "CDL3BLACKCROWS", "CDLDARKCLOUDCOVER", "HT_DCPERIOD", "HT_DCPHASE"
] as const;

export type TrendIndicatorId = (typeof TREND_INDICATOR_IDS)[number];
export type TrendDirection = "bullish" | "bearish" | "neutral";
export type TrendIndicatorCategory = "overlap" | "momentum" | "volatility" | "volume" | "price" | "pattern" | "cycle";
export type TrendValue = number | null;

export interface TrendIndicatorParameter {
  key: string;
  label: string;
  defaultValue: number;
  min: number;
  max: number;
  step?: number;
}

export interface TrendIndicatorDefinition {
  id: TrendIndicatorId;
  label: string;
  category: TrendIndicatorCategory;
  parameters: TrendIndicatorParameter[];
  lines: string[];
  chart: "main" | "sub" | "hidden";
}

export interface TrendIndicatorSelection {
  indicatorId: TrendIndicatorId;
  parameters?: Record<string, number>;
  enabled?: boolean;
  displayOrder?: number;
}

export interface TrendSignal {
  date: string;
  direction: TrendDirection;
  strength: number;
  reason: string;
}

export type TrendRiskLevel = "high" | "medium" | "low";

export interface TrendTurningPoint {
  date: string;
  direction: Exclude<TrendDirection, "neutral">;
  level: "info" | "warning" | "risk";
  title: string;
  reason: string;
  price: number | null;
  indicatorId: TrendIndicatorId;
}

export interface TrendRiskReminder {
  direction: "above" | "below";
  threshold: number;
  cooldownMinutes: number;
}

export interface TrendRiskAssessment {
  level: TrendRiskLevel;
  evidence: string[];
  suggestedAction: string;
  reminder: TrendRiskReminder | null;
}

export interface TrendReportAssessment {
  direction: TrendDirection;
  turningPoints: TrendTurningPoint[];
  risk: TrendRiskAssessment;
}

export interface TrendIndicatorResult {
  indicatorId: TrendIndicatorId;
  lines: Record<string, TrendValue[]>;
  signals: TrendSignal[];
  turningPoints: TrendTurningPoint[];
}

const definitions: TrendIndicatorDefinition[] = [
  definition("MA", "移动平均线", "overlap", [parameter("period", "周期", 20, 2, 240)], ["ma"], "main"),
  definition("SAR", "抛物线转向", "overlap", [parameter("acceleration", "加速因子", 0.02, 0.001, 0.2, 0.001), parameter("maximum", "最大值", 0.2, 0.02, 1, 0.01)], ["sar"], "main"),
  definition("ADX", "平均趋向指数", "momentum", [parameter("period", "周期", 14, 2, 120)], ["adx", "plusDi", "minusDi"], "sub"),
  definition("MACD", "指数平滑异同移动平均线", "momentum", [parameter("fast", "快线", 12, 2, 120), parameter("slow", "慢线", 26, 3, 240), parameter("signal", "信号线", 9, 2, 120)], ["dif", "dea", "hist"], "sub"),
  definition("MACDEXT", "扩展 MACD", "momentum", [parameter("fast", "快线", 12, 2, 120), parameter("slow", "慢线", 26, 3, 240), parameter("signal", "信号线", 9, 2, 120)], ["macd", "signal", "hist"], "sub"),
  definition("RSI", "相对强弱指数", "momentum", [parameter("period", "周期", 14, 2, 120)], ["rsi"], "sub"),
  definition("MOM", "动量指标", "momentum", [parameter("period", "周期", 10, 1, 120)], ["mom"], "sub"),
  definition("KDJ", "随机指标", "momentum", [parameter("period", "周期", 9, 2, 120), parameter("smooth", "平滑", 3, 1, 30)], ["k", "d", "j"], "sub"),
  definition("BOLL", "布林带", "volatility", [parameter("period", "周期", 20, 2, 240), parameter("deviation", "标准差", 2, 0.5, 5, 0.1)], ["upper", "middle", "lower"], "main"),
  definition("ATR", "真实波幅", "volatility", [parameter("period", "周期", 14, 2, 120)], ["atr"], "sub"),
  definition("NATR", "归一化真实波幅", "volatility", [parameter("period", "周期", 14, 2, 120)], ["natr"], "sub"),
  definition("OBV", "能量潮", "volume", [], ["obv"], "sub"),
  definition("AD", "累积派发线", "volume", [], ["ad"], "sub"),
  definition("VWAP", "成交量加权均价", "volume", [], ["vwap"], "main"),
  definition("AVGPRICE", "平均价格", "price", [], ["avgPrice"], "main"),
  definition("MEDPRICE", "中位价格", "price", [], ["medPrice"], "main"),
  definition("CDLHAMMER", "锤头", "pattern", [], ["pattern"], "hidden"),
  definition("CDLENGULFING", "吞没形态", "pattern", [], ["pattern"], "hidden"),
  definition("CDLMORNINGSTAR", "晨星", "pattern", [], ["pattern"], "hidden"),
  definition("CDLDOJI", "十字星", "pattern", [], ["pattern"], "hidden"),
  definition("CDLEVENINGSTAR", "暮星", "pattern", [], ["pattern"], "hidden"),
  definition("CDL3WHITESOLDIERS", "三白兵", "pattern", [], ["pattern"], "hidden"),
  definition("CDL3BLACKCROWS", "三黑鸦", "pattern", [], ["pattern"], "hidden"),
  definition("CDLDARKCLOUDCOVER", "乌云盖顶", "pattern", [], ["pattern"], "hidden"),
  definition("HT_DCPERIOD", "希尔伯特主导周期", "cycle", [parameter("period", "观察周期", 20, 8, 120)], ["period"], "sub"),
  definition("HT_DCPHASE", "希尔伯特主导相位", "cycle", [parameter("period", "观察周期", 20, 8, 120)], ["phase"], "sub")
];

export const trendIndicatorCatalog = definitions.map((item) => ({ ...item, parameters: item.parameters.map((parameter) => ({ ...parameter })) }));
const definitionById = new Map(definitions.map((item) => [item.id, item]));

export function getTrendIndicatorDefinition(id: TrendIndicatorId): TrendIndicatorDefinition {
  const item = definitionById.get(id);
  if (item === undefined) throw errors.validation(`不支持的趋势指标: ${id}`);
  return item;
}

export function normalizeTrendIndicators(selections: TrendIndicatorSelection[]): Required<TrendIndicatorSelection>[] {
  if (selections.length === 0) throw errors.validation("策略至少需要一个指标");
  if (selections.length > TREND_INDICATOR_IDS.length) throw errors.validation("趋势指标数量超出限制");
  const seen = new Set<TrendIndicatorId>();
  return selections
    .filter((item) => item.enabled !== false)
    .map((item, index) => {
      if (!TREND_INDICATOR_IDS.includes(item.indicatorId)) throw errors.validation(`不支持的趋势指标: ${item.indicatorId}`);
      if (seen.has(item.indicatorId)) throw errors.validation(`趋势指标重复: ${item.indicatorId}`);
      seen.add(item.indicatorId);
      const definition = getTrendIndicatorDefinition(item.indicatorId);
      const parameters: Record<string, number> = {};
      for (const spec of definition.parameters) {
        const value = item.parameters?.[spec.key] ?? spec.defaultValue;
        if (!Number.isFinite(value) || value < spec.min || value > spec.max) throw errors.validation(`${definition.label} 的 ${spec.label} 参数无效`);
        parameters[spec.key] = value;
      }
      for (const key of Object.keys(item.parameters ?? {})) {
        if (!definition.parameters.some((parameter) => parameter.key === key)) throw errors.validation(`${definition.label} 不支持参数 ${key}`);
      }
      return { indicatorId: item.indicatorId, parameters, enabled: true, displayOrder: item.displayOrder ?? index };
    })
    .sort((left, right) => left.displayOrder - right.displayOrder);
}

export class TrendIndicatorService {
  calculate(bars: PriceBar[], rawSelections: TrendIndicatorSelection[]): TrendIndicatorResult[] {
    if (bars.length === 0) return [];
    return normalizeTrendIndicators(rawSelections).map((selection) => this.calculateOne(bars, selection));
  }

  private calculateOne(bars: PriceBar[], selection: Required<TrendIndicatorSelection>): TrendIndicatorResult {
    const close = bars.map((bar) => bar.close);
    const p = selection.parameters;
    const parameter = (key: string): number => p[key] ?? getTrendIndicatorDefinition(selection.indicatorId).parameters.find((item) => item.key === key)?.defaultValue ?? 0;
    let lines: Record<string, TrendValue[]>;
    switch (selection.indicatorId) {
      case "MA": lines = { ma: sma(close, parameter("period")) }; break;
      case "SAR": lines = { sar: sar(bars, parameter("acceleration"), parameter("maximum")) }; break;
      case "ADX": lines = adx(bars, parameter("period")); break;
      case "MACD": lines = macd(close, parameter("fast"), parameter("slow"), parameter("signal")); break;
      case "MACDEXT": { const result = macd(close, parameter("fast"), parameter("slow"), parameter("signal")); lines = { macd: result.dif!, signal: result.dea!, hist: result.hist! }; break; }
      case "RSI": lines = { rsi: rsi(close, parameter("period")) }; break;
      case "MOM": { const period = parameter("period"); lines = { mom: close.map((value, index) => index < period ? null : round(value - close[index - period]!)) }; break; }
      case "KDJ": lines = kdj(bars, parameter("period"), parameter("smooth")); break;
      case "BOLL": lines = boll(close, parameter("period"), parameter("deviation")); break;
      case "ATR": lines = { atr: atr(bars, parameter("period")) }; break;
      case "NATR": { const values = atr(bars, parameter("period")); lines = { natr: values.map((value, index) => value === null || close[index] === 0 ? null : round(value / close[index]! * 100)) }; break; }
      case "OBV": lines = { obv: obv(bars) }; break;
      case "AD": lines = { ad: ad(bars) }; break;
      case "VWAP": lines = { vwap: vwap(bars) }; break;
      case "AVGPRICE": lines = { avgPrice: bars.map((bar) => round((bar.open + bar.high + bar.low + bar.close) / 4)) }; break;
      case "MEDPRICE": lines = { medPrice: bars.map((bar) => round((bar.high + bar.low) / 2)) }; break;
      case "CDLHAMMER": lines = { pattern: hammer(bars) }; break;
      case "CDLENGULFING": lines = { pattern: engulfing(bars) }; break;
      case "CDLMORNINGSTAR": lines = { pattern: morningStar(bars) }; break;
      case "CDLDOJI": lines = { pattern: doji(bars) }; break;
      case "CDLEVENINGSTAR": lines = { pattern: eveningStar(bars) }; break;
      case "CDL3WHITESOLDIERS": lines = { pattern: threeWhiteSoldiers(bars) }; break;
      case "CDL3BLACKCROWS": lines = { pattern: threeBlackCrows(bars) }; break;
      case "CDLDARKCLOUDCOVER": lines = { pattern: darkCloudCover(bars) }; break;
      case "HT_DCPERIOD": lines = { period: dominantPeriod(close, parameter("period")) }; break;
      case "HT_DCPHASE": lines = { phase: dominantPhase(close, parameter("period")) }; break;
    }
    return {
      indicatorId: selection.indicatorId,
      lines,
      signals: extractSignals(selection.indicatorId, bars, lines),
      turningPoints: extractTurningPoints(selection.indicatorId, bars, lines)
    };
  }
}

export function summarizeTrendReport(bars: PriceBar[], results: TrendIndicatorResult[], reportWindow: TrendReportWindow = "all"): TrendReportAssessment {
  const allTurningPoints = results
    .flatMap((result) => result.turningPoints)
    .sort((left, right) => left.date.localeCompare(right.date) || left.indicatorId.localeCompare(right.indicatorId));
  const turningPoints = filterTurningPointsForWindow(allTurningPoints, bars, reportWindow);
  const signals = results.flatMap((result) => result.signals);
  const score = signals.reduce((total, signal) => total + (signal.direction === "bullish" ? signal.strength : signal.direction === "bearish" ? -signal.strength : 0), 0);
  const direction: TrendDirection = score > 1 ? "bullish" : score < -1 ? "bearish" : "neutral";
  const latest = bars.at(-1);
  const bearishSignals = signals.filter((signal) => signal.direction === "bearish");
  const recentBearishPoint = turningPoints.filter((point) => point.direction === "bearish").at(-1);
  const highRisk = bearishSignals.some((signal) => signal.strength >= 60) || recentBearishPoint?.level === "risk";
  const mediumRisk = highRisk || bearishSignals.length > 0 || direction === "neutral" && recentBearishPoint !== undefined;
  const level: TrendRiskLevel = highRisk ? "high" : mediumRisk ? "medium" : "low";
  const evidence = (bearishSignals.length > 0 ? bearishSignals : signals)
    .slice(0, 3)
    .map((signal) => signal.reason);
  if (evidence.length === 0) {
    evidence.push(bars.length === 0 ? "可用行情不足，暂不形成趋势结论" : "所选指标未给出明确方向，建议继续观察");
  }
  const suggestedAction = level === "high"
    ? "建议检查仓位与止损边界，必要时创建价格下破提醒"
    : level === "medium"
      ? "建议持续观察关键价位与下一交易日的量价变化"
      : direction === "bullish"
        ? "趋势仍偏强，关注回踩关键均线后的承接情况"
        : "暂无明确风险信号，维持常规观察";
  const reminder = latest === undefined
    ? null
    : direction === "bearish"
      ? { direction: "below" as const, threshold: round(latest.close * .98), cooldownMinutes: 240 }
      : { direction: "above" as const, threshold: round(latest.close * 1.02), cooldownMinutes: 240 };
  return { direction, turningPoints, risk: { level, evidence, suggestedAction, reminder } };
}

function filterTurningPointsForWindow(points: TrendTurningPoint[], bars: PriceBar[], window: TrendReportWindow): TrendTurningPoint[] {
  if (window === "all" || bars.length === 0) return points;
  const days = window === "1d" ? 1 : window === "3d" ? 3 : window === "7d" ? 7 : 30;
  const latest = bars.at(-1)?.date;
  if (latest === undefined) return points;
  const end = new Date(`${latest}T00:00:00.000Z`);
  if (Number.isNaN(end.valueOf())) return points;
  end.setUTCDate(end.getUTCDate() - days + 1);
  const start = end.toISOString().slice(0, 10);
  return points.filter((point) => point.date >= start);
}

function definition(id: TrendIndicatorId, label: string, category: TrendIndicatorCategory, parameters: TrendIndicatorParameter[], lines: string[], chart: TrendIndicatorDefinition["chart"]): TrendIndicatorDefinition {
  return { id, label, category, parameters, lines, chart };
}
function parameter(key: string, label: string, defaultValue: number, min: number, max: number, step?: number): TrendIndicatorParameter { return { key, label, defaultValue, min, max, step }; }
function round(value: number): number { return Number(value.toFixed(6)); }
function blank(length: number): TrendValue[] { return Array.from({ length }, () => null); }
function sma(values: number[], period: number): TrendValue[] { const output = blank(values.length); let sum = 0; for (let index = 0; index < values.length; index += 1) { sum += values[index]!; if (index >= period) sum -= values[index - period]!; if (index >= period - 1) output[index] = round(sum / period); } return output; }
function ema(values: TrendValue[], period: number): TrendValue[] { const output = blank(values.length); const multiplier = 2 / (period + 1); let seed: number[] = []; let previous: number | null = null; for (let index = 0; index < values.length; index += 1) { const value = values[index] ?? null; if (value === null) continue; if (previous === null) { seed.push(value); if (seed.length === period) { previous = seed.reduce((sum, item) => sum + item, 0) / period; output[index] = round(previous); } continue; } previous = previous + (value - previous) * multiplier; output[index] = round(previous); } return output; }
function macd(values: number[], fast: number, slow: number, signal: number): Record<string, TrendValue[]> { const fastLine = ema(values, fast); const slowLine = ema(values, slow); const dif = values.map((_, index) => fastLine[index] === null || slowLine[index] === null ? null : round(fastLine[index]! - slowLine[index]!)); const dea = ema(dif, signal); return { dif, dea, hist: dif.map((value, index) => value === null || dea[index] === null ? null : round((value - dea[index]!) * 2)) }; }
function rsi(values: number[], period: number): TrendValue[] { const output = blank(values.length); if (values.length <= period) return output; let gains = 0; let losses = 0; for (let index = 1; index <= period; index += 1) { const delta = values[index]! - values[index - 1]!; gains += Math.max(delta, 0); losses += Math.max(-delta, 0); } output[period] = rsiValue(gains, losses); for (let index = period + 1; index < values.length; index += 1) { const delta = values[index]! - values[index - 1]!; gains = (gains * (period - 1) + Math.max(delta, 0)) / period; losses = (losses * (period - 1) + Math.max(-delta, 0)) / period; output[index] = rsiValue(gains, losses); } return output; }
function rsiValue(gain: number, loss: number): number { return loss === 0 ? 100 : round(100 - 100 / (1 + gain / loss)); }
function boll(values: number[], period: number, deviation: number): Record<string, TrendValue[]> { const middle = sma(values, period); const upper = blank(values.length); const lower = blank(values.length); for (let index = period - 1; index < values.length; index += 1) { const average = middle[index]!; const slice = values.slice(index - period + 1, index + 1); const variance = slice.reduce((sum, item) => sum + (item - average) ** 2, 0) / period; const delta = Math.sqrt(variance) * deviation; upper[index] = round(average + delta); lower[index] = round(average - delta); } return { upper, middle, lower }; }
function trueRanges(bars: PriceBar[]): number[] { return bars.map((bar, index) => index === 0 ? bar.high - bar.low : Math.max(bar.high - bar.low, Math.abs(bar.high - bars[index - 1]!.close), Math.abs(bar.low - bars[index - 1]!.close))); }
function atr(bars: PriceBar[], period: number): TrendValue[] { const ranges = trueRanges(bars); const output = blank(bars.length); if (ranges.length < period) return output; let value = ranges.slice(0, period).reduce((sum, item) => sum + item, 0) / period; output[period - 1] = round(value); for (let index = period; index < ranges.length; index += 1) { value = (value * (period - 1) + ranges[index]!) / period; output[index] = round(value); } return output; }
function adx(bars: PriceBar[], period: number): Record<string, TrendValue[]> { const plusDm = bars.map((bar, index) => index === 0 ? 0 : Math.max(bar.high - bars[index - 1]!.high, 0) > Math.max(bars[index - 1]!.low - bar.low, 0) ? Math.max(bar.high - bars[index - 1]!.high, 0) : 0); const minusDm = bars.map((bar, index) => index === 0 ? 0 : Math.max(bars[index - 1]!.low - bar.low, 0) > Math.max(bar.high - bars[index - 1]!.high, 0) ? Math.max(bars[index - 1]!.low - bar.low, 0) : 0); const ranges = trueRanges(bars); const plusDi = blank(bars.length); const minusDi = blank(bars.length); const dx = blank(bars.length); if (bars.length <= period) return { adx: blank(bars.length), plusDi, minusDi }; let smoothTr = ranges.slice(1, period + 1).reduce((sum, value) => sum + value, 0); let smoothPlus = plusDm.slice(1, period + 1).reduce((sum, value) => sum + value, 0); let smoothMinus = minusDm.slice(1, period + 1).reduce((sum, value) => sum + value, 0); for (let index = period; index < bars.length; index += 1) { if (index > period) { smoothTr = smoothTr - smoothTr / period + ranges[index]!; smoothPlus = smoothPlus - smoothPlus / period + plusDm[index]!; smoothMinus = smoothMinus - smoothMinus / period + minusDm[index]!; } plusDi[index] = smoothTr === 0 ? 0 : round(smoothPlus / smoothTr * 100); minusDi[index] = smoothTr === 0 ? 0 : round(smoothMinus / smoothTr * 100); const sum = plusDi[index]! + minusDi[index]!; dx[index] = sum === 0 ? 0 : round(Math.abs(plusDi[index]! - minusDi[index]!) / sum * 100); } const output = blank(bars.length); const dxStart = period; const seed = dx.slice(dxStart, dxStart + period).filter((item): item is number => item !== null); if (seed.length === period) { let value = seed.reduce((sum, item) => sum + item, 0) / period; output[dxStart + period - 1] = round(value); for (let index = dxStart + period; index < bars.length; index += 1) { value = (value * (period - 1) + (dx[index] ?? 0)) / period; output[index] = round(value); } } return { adx: output, plusDi, minusDi }; }
function sar(bars: PriceBar[], acceleration: number, maximum: number): TrendValue[] { const output = blank(bars.length); if (bars.length === 0) return output; let rising = bars.length < 2 || bars[1]!.close >= bars[0]!.close; let value = rising ? bars[0]!.low : bars[0]!.high; let extreme = rising ? bars[0]!.high : bars[0]!.low; let factor = acceleration; output[0] = round(value); for (let index = 1; index < bars.length; index += 1) { const previous = bars[index - 1]!; const current = bars[index]!; value = value + factor * (extreme - value); if (rising) { value = Math.min(value, previous.low, index > 1 ? bars[index - 2]!.low : previous.low); if (current.low < value) { rising = false; value = extreme; extreme = current.low; factor = acceleration; } else if (current.high > extreme) { extreme = current.high; factor = Math.min(maximum, factor + acceleration); } } else { value = Math.max(value, previous.high, index > 1 ? bars[index - 2]!.high : previous.high); if (current.high > value) { rising = true; value = extreme; extreme = current.high; factor = acceleration; } else if (current.low < extreme) { extreme = current.low; factor = Math.min(maximum, factor + acceleration); } } output[index] = round(value); } return output; }
function kdj(bars: PriceBar[], period: number, smooth: number): Record<string, TrendValue[]> { const k = blank(bars.length); const d = blank(bars.length); const j = blank(bars.length); let previousK = 50; let previousD = 50; for (let index = period - 1; index < bars.length; index += 1) { const window = bars.slice(index - period + 1, index + 1); const high = Math.max(...window.map((bar) => bar.high)); const low = Math.min(...window.map((bar) => bar.low)); const rsv = high === low ? 50 : (bars[index]!.close - low) / (high - low) * 100; previousK = (previousK * (smooth - 1) + rsv) / smooth; previousD = (previousD * (smooth - 1) + previousK) / smooth; k[index] = round(previousK); d[index] = round(previousD); j[index] = round(3 * previousK - 2 * previousD); } return { k, d, j }; }
function obv(bars: PriceBar[]): TrendValue[] { let value = 0; return bars.map((bar, index) => { if (index > 0) value += bar.close > bars[index - 1]!.close ? bar.volume : bar.close < bars[index - 1]!.close ? -bar.volume : 0; return round(value); }); }
function ad(bars: PriceBar[]): TrendValue[] { let value = 0; return bars.map((bar) => { const range = bar.high - bar.low; const multiplier = range === 0 ? 0 : ((bar.close - bar.low) - (bar.high - bar.close)) / range; value += multiplier * bar.volume; return round(value); }); }
function vwap(bars: PriceBar[]): TrendValue[] { let amount = 0; let volume = 0; return bars.map((bar) => { volume += Math.max(bar.volume, 0); amount += ((bar.high + bar.low + bar.close) / 3) * Math.max(bar.volume, 0); return volume === 0 ? null : round(amount / volume); }); }
function patternOutput(bars: PriceBar[], callback: (index: number) => number): TrendValue[] { return bars.map((_, index) => callback(index)); }
function body(bar: PriceBar): number { return Math.abs(bar.close - bar.open); }
function hammer(bars: PriceBar[]): TrendValue[] { return patternOutput(bars, (index) => { const bar = bars[index]!; const lower = Math.min(bar.open, bar.close) - bar.low; const upper = bar.high - Math.max(bar.open, bar.close); return body(bar) > 0 && lower >= body(bar) * 2 && upper <= body(bar) ? 100 : 0; }); }
function engulfing(bars: PriceBar[]): TrendValue[] { return patternOutput(bars, (index) => { if (index === 0) return 0; const previous = bars[index - 1]!; const current = bars[index]!; if (previous.close < previous.open && current.close > current.open && current.open <= previous.close && current.close >= previous.open) return 100; if (previous.close > previous.open && current.close < current.open && current.open >= previous.close && current.close <= previous.open) return -100; return 0; }); }
function doji(bars: PriceBar[]): TrendValue[] { return patternOutput(bars, (index) => { const bar = bars[index]!; return bar.high !== bar.low && body(bar) <= (bar.high - bar.low) * 0.1 ? 100 : 0; }); }
function morningStar(bars: PriceBar[]): TrendValue[] { return threeBarPattern(bars, (first, second, third) => first.close < first.open && body(second) <= body(first) * .4 && third.close > third.open && third.close >= (first.open + first.close) / 2 ? 100 : 0); }
function eveningStar(bars: PriceBar[]): TrendValue[] { return threeBarPattern(bars, (first, second, third) => first.close > first.open && body(second) <= body(first) * .4 && third.close < third.open && third.close <= (first.open + first.close) / 2 ? -100 : 0); }
function threeWhiteSoldiers(bars: PriceBar[]): TrendValue[] { return threeBarPattern(bars, (first, second, third) => first.close > first.open && second.close > second.open && third.close > third.open && second.close > first.close && third.close > second.close ? 100 : 0); }
function threeBlackCrows(bars: PriceBar[]): TrendValue[] { return threeBarPattern(bars, (first, second, third) => first.close < first.open && second.close < second.open && third.close < third.open && second.close < first.close && third.close < second.close ? -100 : 0); }
function darkCloudCover(bars: PriceBar[]): TrendValue[] { return patternOutput(bars, (index) => { if (index === 0) return 0; const previous = bars[index - 1]!; const current = bars[index]!; return previous.close > previous.open && current.open > previous.close && current.close < (previous.open + previous.close) / 2 ? -100 : 0; }); }
function threeBarPattern(bars: PriceBar[], callback: (first: PriceBar, second: PriceBar, third: PriceBar) => number): TrendValue[] { return patternOutput(bars, (index) => index < 2 ? 0 : callback(bars[index - 2]!, bars[index - 1]!, bars[index]!)); }
function dominantPeriod(values: number[], period: number): TrendValue[] { const output = blank(values.length); for (let index = period - 1; index < values.length; index += 1) { const window = values.slice(index - period + 1, index + 1); const mean = window.reduce((sum, value) => sum + value, 0) / window.length; const crossings = window.slice(1).reduce((count, value, offset) => count + ((value - mean) * (window[offset]! - mean) < 0 ? 1 : 0), 0); output[index] = round(Math.max(2, Math.min(period, crossings === 0 ? period : period / (crossings / 2)))); } return output; }
function dominantPhase(values: number[], period: number): TrendValue[] { const output = blank(values.length); for (let index = period - 1; index < values.length; index += 1) { const window = values.slice(index - period + 1, index + 1); const mean = window.reduce((sum, value) => sum + value, 0) / window.length; const cosine = window.reduce((sum, value, offset) => sum + (value - mean) * Math.cos(2 * Math.PI * offset / period), 0); const sine = window.reduce((sum, value, offset) => sum + (value - mean) * Math.sin(2 * Math.PI * offset / period), 0); output[index] = round((Math.atan2(sine, cosine) * 180 / Math.PI + 360) % 360); } return output; }
function latest<T>(values: T[]): T | undefined { return values.at(-1); }
function extractSignals(indicatorId: TrendIndicatorId, bars: PriceBar[], lines: Record<string, TrendValue[]>): TrendSignal[] { const index = bars.length - 1; const date = bars[index]?.date; if (date === undefined) return []; const value = (name: string) => latest(lines[name] ?? []); const price = bars[index]!.close; const signal = (direction: TrendDirection, strength: number, reason: string): TrendSignal => ({ date, direction, strength: Math.max(0, Math.min(100, round(strength))), reason }); switch (indicatorId) { case "MA": { const ma = value("ma"); return ma === null || ma === undefined ? [] : [signal(price > ma ? "bullish" : price < ma ? "bearish" : "neutral", Math.abs(price - ma) / Math.max(ma, .000001) * 1000, `收盘价${price > ma ? "高于" : price < ma ? "低于" : "等于"} MA`)]; } case "MACD": case "MACDEXT": { const dif = value(indicatorId === "MACD" ? "dif" : "macd"); const dea = value(indicatorId === "MACD" ? "dea" : "signal"); return dif === null || dea === null || dif === undefined || dea === undefined ? [] : [signal(dif > dea ? "bullish" : dif < dea ? "bearish" : "neutral", Math.abs(dif - dea) * 100, `MACD ${dif > dea ? "多头" : dif < dea ? "空头" : "平衡"}`)]; } case "RSI": { const r = value("rsi"); return r === null || r === undefined ? [] : [signal(r < 30 ? "bullish" : r > 70 ? "bearish" : "neutral", Math.abs(r - 50) * 2, r < 30 ? "RSI 超卖" : r > 70 ? "RSI 超买" : "RSI 中性")]; } case "KDJ": { const k = value("k"); const d = value("d"); return k === null || d === null || k === undefined || d === undefined ? [] : [signal(k > d ? "bullish" : k < d ? "bearish" : "neutral", Math.abs(k - d) * 2, `KDJ ${k > d ? "金叉倾向" : k < d ? "死叉倾向" : "平衡"}`)]; } case "BOLL": { const upper = value("upper"); const lower = value("lower"); const middle = value("middle"); if (upper === null || lower === null || middle === null || upper === undefined || lower === undefined || middle === undefined) return []; return [signal(price > upper ? "bullish" : price < lower ? "bearish" : price > middle ? "bullish" : "bearish", Math.abs(price - middle) / Math.max(upper - lower, .000001) * 200, price > upper ? "突破布林上轨" : price < lower ? "跌破布林下轨" : "布林带区间内")]; } case "ADX": { const a = value("adx"); const plus = value("plusDi"); const minus = value("minusDi"); return a === null || plus === null || minus === null || a === undefined || plus === undefined || minus === undefined ? [] : [signal(plus > minus ? "bullish" : "bearish", a, `ADX ${a.toFixed(1)}，${plus > minus ? "多方" : "空方"}占优`)]; } default: { const pattern = value("pattern"); if (pattern !== null && pattern !== undefined && pattern !== 0) return [signal(pattern > 0 ? "bullish" : "bearish", Math.abs(pattern), "识别到K线形态")]; const terminal = Object.values(lines).map((line) => latest(line)).find((item) => item !== null && item !== undefined); return terminal === null || terminal === undefined ? [] : [signal("neutral", 0, `${getTrendIndicatorDefinition(indicatorId).label} 已计算`)]; } } }

function extractTurningPoints(indicatorId: TrendIndicatorId, bars: PriceBar[], lines: Record<string, TrendValue[]>): TrendTurningPoint[] {
  const points: TrendTurningPoint[] = [];
  const add = (index: number, direction: Exclude<TrendDirection, "neutral">, level: TrendTurningPoint["level"], title: string, reason: string): void => {
    const bar = bars[index];
    if (bar === undefined) return;
    points.push({ date: bar.date, direction, level, title, reason, price: bar.close, indicatorId });
  };
  const cross = (left: TrendValue[] | undefined, right: TrendValue[] | undefined, title: string): void => {
    if (left === undefined || right === undefined) return;
    for (let index = 1; index < bars.length; index += 1) {
      const beforeLeft = left[index - 1];
      const beforeRight = right[index - 1];
      const currentLeft = left[index];
      const currentRight = right[index];
      if (beforeLeft === null || beforeRight === null || currentLeft === null || currentRight === null || beforeLeft === undefined || beforeRight === undefined || currentLeft === undefined || currentRight === undefined) continue;
      if (beforeLeft <= beforeRight && currentLeft > currentRight) add(index, "bullish", "info", title, `${title}上穿`);
      if (beforeLeft >= beforeRight && currentLeft < currentRight) add(index, "bearish", "warning", title, `${title}下穿`);
    }
  };
  const closes = bars.map((bar) => bar.close) as TrendValue[];
  switch (indicatorId) {
    case "MA":
      cross(closes, lines.ma, "价格与 MA");
      break;
    case "SAR":
      cross(closes, lines.sar, "价格与 SAR");
      break;
    case "MACD":
      cross(lines.dif, lines.dea, "MACD");
      break;
    case "MACDEXT":
      cross(lines.macd, lines.signal, "扩展 MACD");
      break;
    case "KDJ":
      cross(lines.k, lines.d, "KDJ");
      break;
    case "BOLL":
      for (let index = 1; index < bars.length; index += 1) {
        const previous = bars[index - 1]!;
        const current = bars[index]!;
        const upper = lines.upper?.[index];
        const lower = lines.lower?.[index];
        const previousUpper = lines.upper?.[index - 1];
        const previousLower = lines.lower?.[index - 1];
        if (upper !== null && upper !== undefined && previousUpper !== null && previousUpper !== undefined && previous.close <= previousUpper && current.close > upper) add(index, "bullish", "info", "BOLL", "价格突破布林上轨");
        if (lower !== null && lower !== undefined && previousLower !== null && previousLower !== undefined && previous.close >= previousLower && current.close < lower) add(index, "bearish", "risk", "BOLL", "价格跌破布林下轨");
      }
      break;
    case "RSI":
      for (let index = 1; index < bars.length; index += 1) {
        const previous = lines.rsi?.[index - 1];
        const current = lines.rsi?.[index];
        if (previous === null || previous === undefined || current === null || current === undefined) continue;
        if (previous < 30 && current >= 30) add(index, "bullish", "info", "RSI", "RSI 脱离超卖区");
        if (previous > 70 && current <= 70) add(index, "bearish", "warning", "RSI", "RSI 回落离开超买区");
      }
      break;
    default:
      for (let index = 0; index < bars.length; index += 1) {
        const pattern = lines.pattern?.[index];
        if (pattern !== null && pattern !== undefined && pattern !== 0) add(index, pattern > 0 ? "bullish" : "bearish", pattern > 0 ? "info" : "warning", getTrendIndicatorDefinition(indicatorId).label, "识别到 K 线形态");
      }
  }
  return points.slice(-30);
}
