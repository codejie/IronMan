import type { PriceBar } from "../market/types";
import type {
  StopLossStrategy,
  StopProfitSettings,
  TakeProfitStrategy,
} from "./stop-profit-settings";

export type ProfitRuleSignal =
  | "stop_loss"
  | "take_profit"
  | "safe"
  | "unavailable";

export type ProfitRuleStatus = "triggered" | "safe" | "unavailable";

export type ProfitRuleKind = "stop_loss" | "take_profit";

export interface ProfitRuleCheck {
  kind: ProfitRuleKind;
  strategy: StopLossStrategy | TakeProfitStrategy;
  strategyLabel: string;
  status: ProfitRuleStatus;
  /** 触发价；移动止盈类为离场价。 */
  thresholdPrice: number | null;
  /** 触发时相对持仓成本的盈亏金额。 */
  thresholdAmount: number | null;
  /** 当前价相对持仓成本的浮盈亏金额。 */
  currentProfit: number | null;
  /** (当前价 − 触发价) / 触发价 × 100。 */
  distancePercent: number | null;
  detail: string;
  basis: string[];
}

export interface ProfitRuleEvaluation {
  signal: ProfitRuleSignal;
  summary: string;
  asOf: string | null;
  stopLoss: ProfitRuleCheck;
  takeProfit: ProfitRuleCheck;
}

export interface ProfitRuleInput {
  averageCost: number;
  quantity: number;
  currentPrice: number | null;
  quoteDate: string | null;
  bars: PriceBar[];
  /** 首次买入业务日期，用于移动止盈的持仓期最高价。 */
  firstBuyDate: string | null;
  settings: StopProfitSettings;
}

const STOP_LOSS_LABELS: Record<StopLossStrategy, string> = {
  fixed_percentage: "固定比例止损",
  fixed_amount: "固定金额止损",
  technical: "技术均线止损",
  atr: "ATR 止损",
};

const TAKE_PROFIT_LABELS: Record<TakeProfitStrategy, string> = {
  risk_reward: "盈亏比止盈",
  trailing: "移动止盈",
  atr_trailing: "ATR 移动止盈",
  ma_trail: "均线跟踪止盈",
  scaled: "阶梯止盈",
};

const EPSILON = 1e-9;

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

function price(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function money(value: number): string {
  return value.toFixed(2);
}

function percent(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function movingAverage(bars: PriceBar[], period: number): number | null {
  if (period <= 0 || bars.length < period) return null;
  const recent = bars.slice(-period);
  return recent.reduce((total, bar) => total + bar.close, 0) / period;
}

function averageTrueRange(bars: PriceBar[], period: number): number | null {
  if (period <= 0 || bars.length < period + 1) return null;
  let total = 0;
  for (let index = bars.length - period; index < bars.length; index += 1) {
    const bar = bars[index];
    const previous = bars[index - 1];
    if (bar === undefined || previous === undefined) return null;
    total += Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - previous.close),
      Math.abs(bar.low - previous.close)
    );
  }
  return total / period;
}

function highestHighSince(bars: PriceBar[], date: string | null): number | null {
  const scope = date === null ? bars : bars.filter((bar) => bar.date >= date);
  if (scope.length === 0) return null;
  return scope.reduce((highest, bar) => Math.max(highest, bar.high), scope[0]!.high);
}

function currentProfit(input: ProfitRuleInput): number | null {
  if (input.currentPrice === null) return null;
  return round((input.currentPrice - input.averageCost) * input.quantity);
}

function distanceFromThreshold(currentPrice: number | null, thresholdPrice: number | null): number | null {
  if (currentPrice === null || thresholdPrice === null || thresholdPrice === 0) return null;
  return round(((currentPrice - thresholdPrice) / thresholdPrice) * 100, 4);
}

function unavailableCheck(
  kind: ProfitRuleKind,
  strategy: StopLossStrategy | TakeProfitStrategy,
  strategyLabel: string,
  detail: string,
  input: ProfitRuleInput,
  basis: string[] = []
): ProfitRuleCheck {
  return {
    kind,
    strategy,
    strategyLabel,
    status: "unavailable",
    thresholdPrice: null,
    thresholdAmount: null,
    currentProfit: currentProfit(input),
    distancePercent: null,
    detail,
    basis,
  };
}

interface StopLossResult {
  check: ProfitRuleCheck;
  stopPrice: number | null;
}

function evaluateStopLoss(input: ProfitRuleInput): StopLossResult {
  const settings = input.settings.stopLoss;
  const label = STOP_LOSS_LABELS[settings.strategy];
  if (input.currentPrice === null) {
    return {
      check: unavailableCheck(
        "stop_loss",
        settings.strategy,
        label,
        "缺少最新行情，无法判断止损规则",
        input
      ),
      stopPrice: null,
    };
  }

  const basis: string[] = [`成本价 ${price(input.averageCost)}`];
  let stopPrice: number | null = null;
  let reason = "";

  switch (settings.strategy) {
    case "fixed_percentage":
      stopPrice = input.averageCost * (1 - settings.fixedPercent / 100);
      basis.push(`止损比例 ${percent(settings.fixedPercent)}%`);
      break;
    case "fixed_amount":
      if (input.quantity <= 0) {
        reason = "持仓数量为 0，无法换算固定金额止损价";
      } else {
        stopPrice = Math.max(0, input.averageCost - settings.fixedAmount / input.quantity);
        basis.push(`最大亏损金额 ${money(settings.fixedAmount)} 元`, `持仓数量 ${percent(input.quantity)}`);
      }
      break;
    case "technical": {
      const ma = movingAverage(input.bars, settings.maPeriod);
      if (ma === null) {
        reason = `日 K 数据不足，均线需要至少 ${settings.maPeriod} 根日 K`;
      } else {
        stopPrice = ma * (1 - settings.bufferPercent / 100);
        basis.push(`MA${settings.maPeriod} ${price(ma)}`, `缓冲带 ${percent(settings.bufferPercent)}%`);
      }
      break;
    }
    case "atr": {
      const atr = averageTrueRange(input.bars, settings.atrPeriod);
      if (atr === null) {
        reason = `日 K 数据不足，ATR(${settings.atrPeriod}) 需要至少 ${settings.atrPeriod + 1} 根日 K`;
      } else {
        stopPrice = Math.max(0, input.averageCost - settings.atrMultiplier * atr);
        basis.push(`ATR(${settings.atrPeriod}) ${price(atr)}`, `波动倍数 k ${percent(settings.atrMultiplier)}`);
      }
      break;
    }
  }

  if (stopPrice === null) {
    return {
      check: unavailableCheck("stop_loss", settings.strategy, label, reason, input, basis),
      stopPrice: null,
    };
  }

  const triggered = input.currentPrice <= stopPrice + EPSILON;
  return {
    check: {
      kind: "stop_loss",
      strategy: settings.strategy,
      strategyLabel: label,
      status: triggered ? "triggered" : "safe",
      thresholdPrice: round(stopPrice),
      thresholdAmount: round((stopPrice - input.averageCost) * input.quantity),
      currentProfit: currentProfit(input),
      distancePercent: distanceFromThreshold(input.currentPrice, stopPrice),
      detail: triggered
        ? `现价 ${price(input.currentPrice)} 已跌破止损价 ${price(stopPrice)}`
        : `现价 ${price(input.currentPrice)} 仍在止损价 ${price(stopPrice)} 之上`,
      basis,
    },
    stopPrice,
  };
}

interface TakeProfitResult {
  check: ProfitRuleCheck;
  takeProfitTriggered: boolean;
  trailing: boolean;
}

function perShareRisk(input: ProfitRuleInput, stopPrice: number | null): number | null {
  if (stopPrice === null || stopPrice <= 0) return null;
  const risk = input.averageCost - stopPrice;
  return risk > 0 ? risk : null;
}

function evaluateTakeProfit(input: ProfitRuleInput, stopPrice: number | null): TakeProfitResult {
  const settings = input.settings.takeProfit;
  const label = TAKE_PROFIT_LABELS[settings.strategy];
  if (input.currentPrice === null) {
    return {
      check: unavailableCheck(
        "take_profit",
        settings.strategy,
        label,
        "缺少最新行情，无法判断止盈规则",
        input
      ),
      takeProfitTriggered: false,
      trailing: false,
    };
  }

  const basis: string[] = [];
  let thresholdPrice: number | null = null;
  let reason = "";
  let trailing = false;

  switch (settings.strategy) {
    case "risk_reward": {
      const risk = perShareRisk(input, stopPrice);
      if (risk === null) {
        reason = "止损价不可用或高于成本价，无法按盈亏比计算止盈价";
      } else {
        thresholdPrice = input.averageCost + settings.riskRewardRatio * risk;
        basis.push(
          `成本价 ${price(input.averageCost)}`,
          `每股止损空间 ${price(risk)}`,
          `盈亏比 1 : ${percent(settings.riskRewardRatio)}`
        );
      }
      break;
    }
    case "trailing": {
      trailing = true;
      const highest = highestHighSince(input.bars, input.firstBuyDate);
      if (highest === null) {
        reason = "缺少持仓期日 K 行情，无法计算移动止盈离场价";
      } else {
        thresholdPrice = highest * (1 - settings.trailingPercent / 100);
        basis.push(
          `持仓期最高价 ${price(highest)}`,
          `回撤比例 ${percent(settings.trailingPercent)}%`,
          `离场价 ${price(thresholdPrice)}`
        );
      }
      break;
    }
    case "atr_trailing": {
      trailing = true;
      const highest = highestHighSince(input.bars, input.firstBuyDate);
      const atr = averageTrueRange(input.bars, settings.atrPeriod);
      if (highest === null || atr === null) {
        reason = `持仓期日 K 或 ATR(${settings.atrPeriod}) 数据不足，无法计算 ATR 移动止盈离场价`;
      } else {
        thresholdPrice = highest - settings.atrTrailMultiplier * atr;
        basis.push(
          `持仓期最高价 ${price(highest)}`,
          `ATR(${settings.atrPeriod}) ${price(atr)}`,
          `波动倍数 p ${percent(settings.atrTrailMultiplier)}`
        );
      }
      break;
    }
    case "ma_trail": {
      trailing = true;
      const ma = movingAverage(input.bars, settings.maTrailPeriod);
      if (ma === null) {
        reason = `日 K 数据不足，均线跟踪需要至少 ${settings.maTrailPeriod} 根日 K`;
      } else {
        thresholdPrice = ma;
        basis.push(`MA${settings.maTrailPeriod} ${price(ma)}`);
      }
      break;
    }
    case "scaled": {
      const risk = perShareRisk(input, stopPrice);
      if (risk === null) {
        reason = "止损价不可用或高于成本价，无法按阶梯盈亏比计算止盈价";
      } else {
        const stages = [...settings.scaleStages].sort((left, right) => left.ratio - right.ratio);
        const targets = stages.map((stage) => ({
          ...stage,
          price: input.averageCost + stage.ratio * risk
        }));
        thresholdPrice = targets[0]?.price ?? null;
        basis.push(`成本价 ${price(input.averageCost)}`, `每股止损空间 ${price(risk)}`);
        for (const target of targets) {
          basis.push(
            `${percent(target.ratio)}R 目标价 ${price(target.price)}，建议卖出 ${percent(target.sellPercent)}%`
          );
        }
      }
      break;
    }
  }

  if (thresholdPrice === null) {
    return {
      check: unavailableCheck("take_profit", settings.strategy, label, reason, input, basis),
      takeProfitTriggered: false,
      trailing,
    };
  }

  const triggered = trailing
    ? input.currentPrice <= thresholdPrice + EPSILON
    : input.currentPrice >= thresholdPrice - EPSILON;
  return {
    check: {
      kind: "take_profit",
      strategy: settings.strategy,
      strategyLabel: label,
      status: triggered ? "triggered" : "safe",
      thresholdPrice: round(thresholdPrice),
      thresholdAmount: round((thresholdPrice - input.averageCost) * input.quantity),
      currentProfit: currentProfit(input),
      distancePercent: distanceFromThreshold(input.currentPrice, thresholdPrice),
      detail: triggered
        ? trailing
          ? settings.strategy === "ma_trail"
            ? `现价 ${price(input.currentPrice)} 已跌破跟踪均线 ${price(thresholdPrice)}`
            : `现价 ${price(input.currentPrice)} 已回撤至离场价 ${price(thresholdPrice)}`
          : `现价 ${price(input.currentPrice)} 已达到止盈价 ${price(thresholdPrice)}`
        : trailing
          ? settings.strategy === "ma_trail"
            ? `现价 ${price(input.currentPrice)} 仍在跟踪均线 ${price(thresholdPrice)} 之上`
            : `现价 ${price(input.currentPrice)} 仍高于离场价 ${price(thresholdPrice)}`
          : `现价 ${price(input.currentPrice)} 尚未达到止盈价 ${price(thresholdPrice)}`,
      basis,
    },
    takeProfitTriggered: triggered,
    trailing,
  };
}

/**
 * 依据系统配置的损盈规则，计算当前持仓是否触发止损或止盈。
 * 纯函数：不访问数据库和行情服务，便于单元测试。
 */
export function evaluateProfitRule(input: ProfitRuleInput): ProfitRuleEvaluation {
  const stopLoss = evaluateStopLoss(input);
  const takeProfit = evaluateTakeProfit(input, stopLoss.stopPrice);

  let signal: ProfitRuleSignal = "safe";
  if (stopLoss.check.status === "triggered") {
    signal = "stop_loss";
  } else if (takeProfit.check.status === "triggered") {
    signal = "take_profit";
  } else if (input.currentPrice === null) {
    signal = "unavailable";
  }

  let summary: string;
  if (signal === "stop_loss") {
    summary = `${stopLoss.check.strategyLabel}触发：${stopLoss.check.detail}，浮亏 ${money(stopLoss.check.currentProfit ?? 0)} 元。`;
  } else if (signal === "take_profit") {
    summary = `${takeProfit.check.strategyLabel}触发：${takeProfit.check.detail}，浮盈 ${money(takeProfit.check.currentProfit ?? 0)} 元。`;
  } else if (signal === "unavailable") {
    summary = "缺少最新行情，暂时无法判断损盈规则。";
  } else {
    summary = "当前价格未触发止损或止盈规则。";
  }

  return {
    signal,
    summary,
    asOf: input.quoteDate,
    stopLoss: stopLoss.check,
    takeProfit: takeProfit.check,
  };
}
