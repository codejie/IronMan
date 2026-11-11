import { describe, expect, test } from "bun:test";
import type { PriceBar } from "../src/market/types";
import {
  evaluateProfitRule,
  type ProfitRuleInput,
} from "../src/services/profit-rule-service";
import {
  DEFAULT_STOP_PROFIT_SETTINGS,
  normalizeStopProfit,
} from "../src/services/stop-profit-service";
import type { StopProfitSettings } from "../src/services/stop-profit-settings";

function settings(patch: Record<string, unknown> = {}): StopProfitSettings {
  return normalizeStopProfit(patch, DEFAULT_STOP_PROFIT_SETTINGS);
}

function bars(closes: number[], startDay = 1): PriceBar[] {
  return closes.map((close, index) => ({
    date: `2026-10-${String(startDay + index).padStart(2, "0")}`,
    open: close,
    close,
    high: close,
    low: close,
    volume: 1000,
  }));
}

function input(patch: Partial<ProfitRuleInput> = {}): ProfitRuleInput {
  return {
    averageCost: 10,
    quantity: 100,
    currentPrice: 10,
    quoteDate: "2026-10-20",
    bars: bars(Array.from({ length: 30 }, () => 10)),
    firstBuyDate: "2026-10-01",
    settings: settings(),
    ...patch,
  };
}

describe("profit rule evaluation", () => {
  test("triggers a fixed-percentage stop loss below the stop price", () => {
    const result = evaluateProfitRule(
      input({ currentPrice: 9.4, settings: settings({ stopLoss: { strategy: "fixed_percentage", fixedPercent: 5 } }) })
    );

    expect(result.signal).toBe("stop_loss");
    expect(result.stopLoss.status).toBe("triggered");
    expect(result.stopLoss.thresholdPrice).toBeCloseTo(9.5, 6);
    expect(result.stopLoss.thresholdAmount).toBeCloseTo(-50, 6);
    expect(result.stopLoss.currentProfit).toBeCloseTo(-60, 6);
    expect(result.stopLoss.distancePercent).toBeCloseTo(-1.0526, 4);
    expect(result.stopLoss.basis.join(" ")).toContain("5%");
    expect(result.stopLoss.detail).toContain("止损");
  });

  test("keeps a fixed-percentage stop loss safe above the stop price", () => {
    const result = evaluateProfitRule(
      input({ currentPrice: 9.6, settings: settings({ stopLoss: { strategy: "fixed_percentage", fixedPercent: 5 } }) })
    );

    expect(result.signal).toBe("safe");
    expect(result.stopLoss.status).toBe("safe");
    expect(result.stopLoss.distancePercent).toBeCloseTo(1.0526, 4);
    expect(result.summary).toContain("未触发");
  });

  test("triggers a fixed-amount stop loss when the floating loss reaches the limit", () => {
    const triggered = evaluateProfitRule(
      input({
        currentPrice: 4.9,
        settings: settings({ stopLoss: { strategy: "fixed_amount", fixedAmount: 500 } })
      })
    );
    expect(triggered.signal).toBe("stop_loss");
    expect(triggered.stopLoss.thresholdPrice).toBeCloseTo(5, 6);
    expect(triggered.stopLoss.thresholdAmount).toBeCloseTo(-500, 6);

    const safe = evaluateProfitRule(
      input({
        currentPrice: 5.1,
        settings: settings({ stopLoss: { strategy: "fixed_amount", fixedAmount: 500 } })
      })
    );
    expect(safe.stopLoss.status).toBe("safe");
  });

  test("uses the configured moving average for a technical stop loss", () => {
    const result = evaluateProfitRule(
      input({
        currentPrice: 8.9,
        bars: bars([...Array.from({ length: 19 }, () => 10), 12]),
        settings: settings({ stopLoss: { strategy: "technical", maPeriod: 20, bufferPercent: 1 } })
      })
    );

    const expectedMa = (19 * 10 + 12) / 20;
    expect(result.stopLoss.status).toBe("triggered");
    expect(result.stopLoss.thresholdPrice).toBeCloseTo(expectedMa * 0.99, 6);
    expect(result.stopLoss.basis.join(" ")).toContain("MA20");
  });

  test("marks a technical stop loss unavailable without enough history", () => {
    const result = evaluateProfitRule(
      input({
        bars: bars([10, 10, 10]),
        settings: settings({ stopLoss: { strategy: "technical", maPeriod: 20 } })
      })
    );

    expect(result.stopLoss.status).toBe("unavailable");
    expect(result.stopLoss.thresholdPrice).toBeNull();
    expect(result.stopLoss.detail).toContain("日 K");
    expect(result.signal).toBe("safe");
  });

  test("derives an ATR stop loss from true range", () => {
    const result = evaluateProfitRule(
      input({
        averageCost: 10,
        currentPrice: 9.3,
        bars: bars(Array.from({ length: 10 }, () => 10)),
        settings: settings({ stopLoss: { strategy: "atr", atrPeriod: 14, atrMultiplier: 2 } })
      })
    );

    expect(result.stopLoss.status).toBe("unavailable");
    expect(result.stopLoss.detail).toContain("ATR");

    const withRange = evaluateProfitRule(
      input({
        averageCost: 10,
        currentPrice: 7.9,
        bars: bars(Array.from({ length: 15 }, () => 10)).map((bar) => ({
          ...bar,
          high: 10.5,
          low: 9.5,
        })),
        settings: settings({ stopLoss: { strategy: "atr", atrPeriod: 14, atrMultiplier: 2 } })
      })
    );
    expect(withRange.stopLoss.status).toBe("triggered");
    expect(withRange.stopLoss.thresholdPrice).toBeCloseTo(8, 6);
    expect(withRange.stopLoss.basis.join(" ")).toContain("ATR(14)");
  });

  test("targets a risk-reward take profit from the stop distance", () => {
    const triggered = evaluateProfitRule(
      input({
        currentPrice: 11.6,
        settings: settings({
          stopLoss: { strategy: "fixed_percentage", fixedPercent: 5 },
          takeProfit: { strategy: "risk_reward", riskRewardRatio: 3 }
        })
      })
    );
    expect(triggered.signal).toBe("take_profit");
    expect(triggered.takeProfit.thresholdPrice).toBeCloseTo(11.5, 6);
    expect(triggered.takeProfit.thresholdAmount).toBeCloseTo(150, 6);
    expect(triggered.takeProfit.basis.join(" ")).toContain("盈亏比");

    const safe = evaluateProfitRule(
      input({
        currentPrice: 11.4,
        settings: settings({
          stopLoss: { strategy: "fixed_percentage", fixedPercent: 5 },
          takeProfit: { strategy: "risk_reward", riskRewardRatio: 3 }
        })
      })
    );
    expect(safe.takeProfit.status).toBe("safe");
  });

  test("marks a risk-reward take profit unavailable without a usable stop price", () => {
    const result = evaluateProfitRule(
      input({
        quantity: 10,
        settings: settings({
          stopLoss: { strategy: "fixed_amount", fixedAmount: 1000 },
          takeProfit: { strategy: "risk_reward", riskRewardRatio: 3 }
        })
      })
    );

    expect(result.takeProfit.status).toBe("unavailable");
    expect(result.takeProfit.detail).toContain("止损");
  });

  test("uses the highest price since the first buy for a trailing take profit", () => {
    const result = evaluateProfitRule(
      input({
        currentPrice: 11.3,
        firstBuyDate: "2026-10-03",
        bars: [
          ...bars([20, 20], 1),
          ...bars([11, 12, 11.5], 3)
        ],
        settings: settings({ takeProfit: { strategy: "trailing", trailingPercent: 5 } })
      })
    );

    expect(result.signal).toBe("take_profit");
    expect(result.takeProfit.thresholdPrice).toBeCloseTo(11.4, 6);
    expect(result.takeProfit.basis.join(" ")).toContain("12");
    expect(result.takeProfit.detail).toContain("回撤");
  });

  test("derives an ATR trailing take profit from the highest price", () => {
    const result = evaluateProfitRule(
      input({
        averageCost: 10,
        currentPrice: 10.4,
        bars: bars(Array.from({ length: 15 }, () => 12)).map((bar) => ({
          ...bar,
          high: 12.5,
          low: 11.5,
        })),
        settings: settings({ takeProfit: { strategy: "atr_trailing", atrPeriod: 14, atrTrailMultiplier: 2 } })
      })
    );

    expect(result.signal).toBe("take_profit");
    expect(result.takeProfit.thresholdPrice).toBeCloseTo(10.5, 6);
    expect(result.takeProfit.basis.join(" ")).toContain("ATR(14)");
  });

  test("follows the configured moving average for a ma-trail take profit", () => {
    const result = evaluateProfitRule(
      input({
        currentPrice: 9.8,
        bars: bars(Array.from({ length: 20 }, () => 10)),
        settings: settings({ takeProfit: { strategy: "ma_trail", maTrailPeriod: 20 } })
      })
    );

    expect(result.takeProfit.status).toBe("triggered");
    expect(result.takeProfit.thresholdPrice).toBeCloseTo(10, 6);
    expect(result.takeProfit.detail).toContain("均线");
  });

  test("triggers the first stage of a scaled take profit and lists every stage", () => {
    const result = evaluateProfitRule(
      input({
        currentPrice: 10.6,
        settings: settings({
          stopLoss: { strategy: "fixed_percentage", fixedPercent: 5 },
          takeProfit: {
            strategy: "scaled",
            scaleStages: [
              { ratio: 1, sellPercent: 50 },
              { ratio: 2, sellPercent: 30 }
            ]
          }
        })
      })
    );

    expect(result.signal).toBe("take_profit");
    expect(result.takeProfit.thresholdPrice).toBeCloseTo(10.5, 6);
    expect(result.takeProfit.basis.join(" ")).toContain("10.5");
    expect(result.takeProfit.basis.join(" ")).toContain("11");
    expect(result.takeProfit.basis.join(" ")).toContain("50%");
  });

  test("reports unavailable rules when there is no current price", () => {
    const result = evaluateProfitRule(input({ currentPrice: null, quoteDate: null }));

    expect(result.signal).toBe("unavailable");
    expect(result.stopLoss.status).toBe("unavailable");
    expect(result.takeProfit.status).toBe("unavailable");
    expect(result.summary).toContain("行情");
  });

  test("honours the configured stop and take-profit strategies independently", () => {
    const result = evaluateProfitRule(
      input({
        currentPrice: 10.2,
        settings: settings({
          stopLoss: { strategy: "fixed_percentage", fixedPercent: 20 },
          takeProfit: { strategy: "risk_reward", riskRewardRatio: 1 }
        })
      })
    );

    expect(result.stopLoss.thresholdPrice).toBeCloseTo(8, 6);
    expect(result.takeProfit.thresholdPrice).toBeCloseTo(12, 6);
    expect(result.takeProfit.basis.join(" ")).toContain("1 : 1");
    expect(result.signal).toBe("safe");
  });
});
