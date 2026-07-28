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

export interface TrendIndicatorDetail {
  meaning: string;
  usage: string;
  trend: string;
}

export interface TrendIndicatorDefinition {
  id: TrendIndicatorId;
  label: string;
  category: TrendIndicatorCategory;
  description: string;
  usageHint: string;
  detail: TrendIndicatorDetail;
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
  definition("MA", "移动平均线", "overlap", "平滑价格波动的趋势参考线。", "观察价格相对均线的位置、均线方向与交叉。", detail("过滤短期噪音，帮助确认价格的主要运行方向。", "常看收盘价与均线的位置、均线斜率，以及短周期与长周期均线交叉。", "价格持续在上行均线上方偏多，跌破并带动均线走平或下弯偏弱。"), [parameter("period", "周期", 20, 2, 240)], ["ma"], "main"),
  definition("SAR", "抛物线转向", "overlap", "随价格变化移动的抛物线止损参考。", "关注点位翻转，辅助判断趋势反转与跟踪止损。", detail("用随趋势推进的点位提示潜在反转和移动止损位置。", "观察 SAR 点位在价格上下方的切换，并结合加速因子控制灵敏度。", "点位在价格下方偏多，翻到价格上方偏空；连续翻转说明震荡较强。"), [parameter("acceleration", "加速因子", 0.02, 0.001, 0.2, 0.001), parameter("maximum", "最大值", 0.2, 0.02, 1, 0.01)], ["sar"], "main"),
  definition("ADX", "平均趋向指数", "momentum", "衡量趋势强度及多空方向。", "结合 ADX 强度与 +DI、-DI 的相对位置判断方向。", detail("区分市场是否有趋势，并用 DI 线判断多空力量。", "ADX 看趋势强弱，+DI 与 -DI 看方向；趋势交易中通常不单独用 ADX 判多空。", "ADX 抬升且 +DI 高于 -DI 偏多，ADX 抬升且 -DI 高于 +DI 偏空；ADX 低位多为震荡。"), [parameter("period", "周期", 14, 2, 120)], ["adx", "plusDi", "minusDi"], "sub"),
  definition("MACD", "指数平滑异同移动平均线", "momentum", "由快慢均线差构成的趋势与动量指标。", "关注 DIF、DEA 交叉、零轴位置与柱体变化。", detail("用快慢均线差观察趋势方向、动量强弱和节奏切换。", "关注 DIF 与 DEA 的金叉死叉、零轴上下、柱体放大缩小，以及价格背离。", "DIF 上穿 DEA 且靠近或站上零轴偏多，DIF 下穿 DEA 且柱体转弱偏空。"), [parameter("fast", "快线", 12, 2, 120), parameter("slow", "慢线", 26, 3, 240), parameter("signal", "信号线", 9, 2, 120)], ["dif", "dea", "hist"], "sub"),
  definition("MACDEXT", "扩展 MACD", "momentum", "允许自定义参数的 MACD 变体。", "调整均线参数后，观察趋势交叉与动量变化。", detail("提供更灵活的 MACD 参数，用来适配不同周期和波动节奏。", "根据标的节奏调整快线、慢线和信号线，再观察交叉、零轴与柱体变化。", "快线强于信号线且柱体扩张偏多，快线弱于信号线且柱体走弱偏空。"), [parameter("fast", "快线", 12, 2, 120), parameter("slow", "慢线", 26, 3, 240), parameter("signal", "信号线", 9, 2, 120)], ["macd", "signal", "hist"], "sub"),
  definition("RSI", "相对强弱指数", "momentum", "衡量涨跌速度和相对强弱。", "关注超买超卖区、背离与拐点。", detail("衡量近期上涨和下跌力量的相对强弱，适合识别过热或过冷。", "常看 30/70 区域、50 中轴、拐头，以及价格与 RSI 的背离。", "RSI 上穿 50 且回落不破偏强，跌破 50 或高位背离偏弱；极值区需等确认。"), [parameter("period", "周期", 14, 2, 120)], ["rsi"], "sub"),
  definition("MOM", "动量指标", "momentum", "比较当前价格与历史价格的动量。", "关注零轴穿越与动量方向变化。", detail("直接比较当前价格与若干周期前价格，观察价格推进速度。", "关注 MOM 与零轴关系、斜率变化，以及价格新高新低时动量是否跟随。", "MOM 在零轴上方并继续上行偏多，跌破零轴或价格上涨但 MOM 回落提示转弱。"), [parameter("period", "周期", 10, 1, 120)], ["mom"], "sub"),
  definition("KDJ", "随机指标", "momentum", "以区间高低价衡量当前价格位置。", "关注 K、D 交叉、超买超卖与 J 值变化。", detail("衡量收盘价在近期高低区间中的位置，反映短线摆动强弱。", "关注 K、D 金叉死叉、20/80 区域、J 值过热，以及背离信号。", "低位金叉并向上脱离超卖区偏多，高位死叉或背离偏空；震荡中更有效。"), [parameter("period", "周期", 9, 2, 120), parameter("smooth", "平滑", 3, 1, 30)], ["k", "d", "j"], "sub"),
  definition("BOLL", "布林带", "volatility", "围绕均线绘制的价格波动通道。", "关注带宽收缩扩张以及价格对上下轨的突破。", detail("用均线和标准差刻画价格波动区间，观察趋势突破和波动变化。", "关注价格在中轨上下的位置、上下轨突破、带宽收缩扩张，以及回到轨道内的假突破。", "站上中轨并沿上轨运行偏多，跌破中轨或下轨扩张偏弱；收口后突破需看量能确认。"), [parameter("period", "周期", 20, 2, 240), parameter("deviation", "标准差", 2, 0.5, 5, 0.1)], ["upper", "middle", "lower"], "main"),
  definition("ATR", "真实波幅", "volatility", "衡量包含跳空的真实价格波动。", "用于评估波动风险和设置止损距离。", detail("衡量真实波动幅度，不直接判断方向，主要用于风险和仓位管理。", "可用 ATR 设置止损距离、过滤异常波动，并比较当前波动是否放大。", "ATR 上升说明波动扩大，需结合价格方向判断突破或下跌风险；ATR 下降说明趋势推进可能放缓。"), [parameter("period", "周期", 14, 2, 120)], ["atr"], "sub"),
  definition("NATR", "归一化真实波幅", "volatility", "以百分比表达的真实波幅。", "适合比较不同价格水平标的的波动风险。", detail("把 ATR 换算为价格百分比，便于跨标的比较波动水平。", "用于筛选波动率、设置相对止损，或判断当前风险是否高于平常。", "NATR 抬升代表风险和机会同步放大；方向仍需结合价格、均线或动量指标确认。"), [parameter("period", "周期", 14, 2, 120)], ["natr"], "sub"),
  definition("OBV", "能量潮", "volume", "按涨跌方向累积成交量的量能指标。", "关注量价同步、背离以及量能趋势。", detail("用成交量累积方向观察资金是否支持价格趋势。", "比较 OBV 趋势和价格趋势，重点看同步上行、背离，以及突破前的量能先行。", "价格上行且 OBV 同步创新高偏多；价格上涨但 OBV 不跟随，或 OBV 破位，提示趋势质量下降。"), [], ["obv"], "sub"),
  definition("AD", "累积派发线", "volume", "根据收盘位置累计资金流向。", "观察资金流与价格趋势是否一致。", detail("用收盘价在日内区间中的位置估算资金累积或派发。", "观察 AD 线方向、与价格的背离，以及横盘期间资金是否提前流入或流出。", "价格与 AD 同步上行偏多；价格新高但 AD 走弱提示派发压力，价格下跌且 AD 上行可能有承接。"), [], ["ad"], "sub"),
  definition("VWAP", "成交量加权均价", "volume", "按成交量加权的平均成交价格。", "可作为盘中交易成本与价格强弱的参考。", detail("反映成交量加权后的平均成本，常用于判断价格相对资金成本的位置。", "观察价格围绕 VWAP 的支撑阻力、回踩承接，以及成交密集区的强弱转换。", "价格持续在 VWAP 上方偏强，跌回 VWAP 下方偏弱；反复穿越说明方向不清晰。"), [], ["vwap"], "main"),
  definition("AVGPRICE", "平均价格", "price", "以开高低收计算的当期平均价格。", "用于减少单一收盘价带来的偶然波动。", detail("用开高低收的平均值提供更平滑的价格基准。", "可与收盘价、均线或通道类指标搭配，减少单点价格噪音。", "平均价持续抬升说明重心上移，持续下移说明重心转弱；单独使用方向信号较弱。"), [], ["avgPrice"], "main"),
  definition("MEDPRICE", "中位价格", "price", "以最高价与最低价计算的中位价格。", "适合观察当期价格区间的中心位置。", detail("用高低价中点代表当期价格区间的重心。", "适合与均线、布林带或周期指标搭配，观察价格区间中心的变化。", "中位价格连续抬升偏强，连续下移偏弱；需要结合收盘位置确认买卖力量。"), [], ["medPrice"], "main"),
  definition("CDLHAMMER", "锤头", "pattern", "识别具有长下影线的锤头 K 线形态。", "在下跌后出现时可结合量能观察反转可能。", detail("提示下跌过程中出现下方承接，可能是短线止跌信号。", "更适合出现在下跌末端，需结合成交量放大和后续阳线确认。", "下跌后锤头并次日站上实体高点偏多；高位出现或无确认时信号较弱。"), [], ["pattern"], "hidden"),
  definition("CDLENGULFING", "吞没形态", "pattern", "识别实体覆盖前一根实体的吞没形态。", "结合趋势背景区分看涨与看跌吞没。", detail("用后一根实体吞没前一根实体，提示多空力量快速切换。", "看形态方向、出现位置和成交量；底部看涨吞没、高位看跌吞没更有参考。", "下跌后看涨吞没并放量偏多，上涨后看跌吞没偏空；震荡区信号需降低权重。"), [], ["pattern"], "hidden"),
  definition("CDLMORNINGSTAR", "晨星", "pattern", "识别下跌末端可能出现的晨星反转结构。", "配合成交量和后续确认 K 线观察。", detail("由下跌、犹豫和反攻三段构成，提示空头衰竭后的反转可能。", "关注是否出现在连续下跌后，第三根阳线是否收复前段跌幅并伴随放量。", "晨星后价格继续站稳第三根阳线中上部偏多，失守形态低点则反转失败。"), [], ["pattern"], "hidden"),
  definition("CDLDOJI", "十字星", "pattern", "识别开收盘接近的犹豫形态。", "在趋势末端出现时关注后续方向确认。", detail("提示多空暂时均衡，本身不代表方向，重点在出现位置。", "趋势末端、关键支撑阻力附近的十字星更值得关注，并需等待后续 K 线确认。", "上涨末端十字星后跌破低点偏空，下跌末端十字星后突破高点偏多；中途出现多为整理。"), [], ["pattern"], "hidden"),
  definition("CDLEVENINGSTAR", "暮星", "pattern", "识别上涨末端可能出现的暮星反转结构。", "配合成交量和后续确认 K 线观察。", detail("由上涨、犹豫和回落三段构成，提示多头衰竭后的反转风险。", "关注是否出现在连续上涨后，第三根阴线是否明显回落并跌回前段实体。", "暮星后价格继续跌破形态低点偏空，重新收复阴线实体则风险减弱。"), [], ["pattern"], "hidden"),
  definition("CDL3WHITESOLDIERS", "三白兵", "pattern", "识别连续三根走强阳线的形态。", "确认位置与涨幅，避免在高位追涨。", detail("连续阳线显示多头持续推进，常用于确认反弹或趋势启动。", "关注出现位置、实体长度、上影线和成交量，低位或突破位更有意义。", "低位三白兵并放量偏多；若出现在高位且涨幅过大，反而要警惕短线透支。"), [], ["pattern"], "hidden"),
  definition("CDL3BLACKCROWS", "三黑鸦", "pattern", "识别连续三根走弱阴线的形态。", "确认位置与跌幅，留意趋势转弱风险。", detail("连续阴线显示空头持续压制，常提示上涨趋势转弱或下跌延续。", "关注是否出现在高位或跌破关键支撑后，阴线实体是否连续且反弹乏力。", "高位三黑鸦偏空，若伴随放量和跌破支撑风险更高；低位急跌后需防止过度解读。"), [], ["pattern"], "hidden"),
  definition("CDLDARKCLOUDCOVER", "乌云盖顶", "pattern", "识别上涨后出现的乌云盖顶形态。", "结合成交量与后续下跌确认信号强度。", detail("上涨后高开低走并压回前一阳线实体，提示抛压增强。", "关注第二根阴线压入前一阳线实体的深度、成交量和后续是否继续走弱。", "高位乌云盖顶后跌破形态低点偏空，若次日快速收复阴线则信号失效。"), [], ["pattern"], "hidden"),
  definition("HT_DCPERIOD", "希尔伯特主导周期", "cycle", "估计市场主导震荡周期。", "用于辅助判断当前波动节奏与周期变化。", detail("估算价格序列中的主导循环长度，帮助识别市场节奏。", "用于辅助设置指标周期、观察周期变长变短，不适合单独给出买卖方向。", "周期稳定时震荡节奏较清晰；周期快速变化说明结构不稳定，趋势判断应更谨慎。"), [parameter("period", "观察周期", 20, 8, 120)], ["period"], "sub"),
  definition("HT_DCPHASE", "希尔伯特主导相位", "cycle", "估计市场在主导周期中的相位。", "用于观察周期阶段的推进与切换。", detail("估算当前价格在主导周期中的相位位置，辅助观察节奏转换。", "结合主导周期和价格拐点使用，观察相位推进是否接近转折区域。", "相位连续推进说明节奏延续，突然跳变或失真说明行情可能从周期切换到趋势或噪音。"), [parameter("period", "观察周期", 20, 8, 120)], ["phase"], "sub")
];

export const trendIndicatorCatalog = definitions.map((item) => ({ ...item, detail: { ...item.detail }, parameters: item.parameters.map((parameter) => ({ ...parameter })) }));
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

function definition(
  id: TrendIndicatorId,
  label: string,
  category: TrendIndicatorCategory,
  description: string,
  usageHint: string,
  detail: TrendIndicatorDetail,
  parameters: TrendIndicatorParameter[],
  lines: string[],
  chart: TrendIndicatorDefinition["chart"],
): TrendIndicatorDefinition {
  return { id, label, category, description, usageHint, detail, parameters, lines, chart };
}
function detail(meaning: string, usage: string, trend: string): TrendIndicatorDetail { return { meaning, usage, trend }; }
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
