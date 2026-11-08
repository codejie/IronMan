import { describe, expect, test } from "bun:test";
import {
  normalizeStopLoss,
  normalizeStopProfit,
  normalizeTakeProfit,
  DEFAULT_STOP_PROFIT_SETTINGS
} from "../src/services/stop-profit-service";
import type { StopLossSettings, TakeProfitSettings } from "../src/services/stop-profit-settings";

describe("normalizeStopProfit", () => {
  test("returns clean defaults for empty input", () => {
    const result = normalizeStopProfit(null);
    expect(result).toEqual(DEFAULT_STOP_PROFIT_SETTINGS);
  });

  test("clamps out-of-range numbers to the valid window", () => {
    const result = normalizeStopProfit({
      stopLoss: {
        strategy: "atr",
        fixedPercent: 999,
        atrMultiplier: 0,
        atrPeriod: 999,
        maPeriod: 1,
        bufferPercent: 999,
        fixedAmount: 0
      },
      takeProfit: {
        strategy: "risk_reward",
        riskRewardRatio: 999,
        trailingPercent: 0,
        atrTrailMultiplier: 99,
        maTrailPeriod: 1,
        scaleStages: [
          { ratio: 999, sellPercent: 999 },
          { ratio: 0.01, sellPercent: 0 },
          { ratio: 1, sellPercent: 50 },
          { ratio: 2, sellPercent: 30 },
          { ratio: 3, sellPercent: 20 },
          { ratio: 4, sellPercent: 10 },
          { ratio: 5, sellPercent: 5 },
          { ratio: 6, sellPercent: 5 },
          { ratio: 7, sellPercent: 5 }
        ]
      },
      risk: { riskPerTradePercent: 999 }
    });
    expect(result.stopLoss.fixedPercent).toBe(90);
    expect(result.stopLoss.atrMultiplier).toBe(0.1);
    expect(result.stopLoss.atrPeriod).toBe(500);
    expect(result.stopLoss.maPeriod).toBe(2);
    expect(result.stopLoss.bufferPercent).toBe(30);
    expect(result.stopLoss.fixedAmount).toBe(1);
    expect(result.takeProfit.riskRewardRatio).toBe(50);
    expect(result.takeProfit.trailingPercent).toBe(0.1);
    expect(result.takeProfit.atrTrailMultiplier).toBe(20);
    expect(result.takeProfit.maTrailPeriod).toBe(2);
    expect(result.takeProfit.scaleStages).toHaveLength(8);
    expect(result.takeProfit.scaleStages[0]).toEqual({ ratio: 50, sellPercent: 100 });
    expect(result.risk.riskPerTradePercent).toBe(50);
  });

  test("keeps valid strategy values and rejects unknown ones", () => {
    const ok = normalizeStopProfit({
      stopLoss: { ...DEFAULT_STOP_PROFIT_SETTINGS.stopLoss, strategy: "technical" },
      takeProfit: { ...DEFAULT_STOP_PROFIT_SETTINGS.takeProfit, strategy: "ma_trail" }
    });
    expect(ok.stopLoss.strategy).toBe("technical");
    expect(ok.takeProfit.strategy).toBe("ma_trail");

    const bad = normalizeStopProfit({
      stopLoss: { ...DEFAULT_STOP_PROFIT_SETTINGS.stopLoss, strategy: "unknown" } as unknown as StopLossSettings,
      takeProfit: { ...DEFAULT_STOP_PROFIT_SETTINGS.takeProfit, strategy: "unknown" } as unknown as TakeProfitSettings
    });
    expect(bad.stopLoss.strategy).toBe(DEFAULT_STOP_PROFIT_SETTINGS.stopLoss.strategy);
    expect(bad.takeProfit.strategy).toBe(DEFAULT_STOP_PROFIT_SETTINGS.takeProfit.strategy);
  });

  test("deep-clones default scale stages so callers cannot mutate the shared defaults", () => {
    const result = normalizeStopProfit(null);
    const firstStage = result.takeProfit.scaleStages[0];
    if (firstStage === undefined) throw new Error("scale stage was missing");
    firstStage.ratio = 999;
    const defaultFirst = DEFAULT_STOP_PROFIT_SETTINGS.takeProfit.scaleStages[0];
    if (defaultFirst === undefined) throw new Error("default scale stage was missing");
    expect(defaultFirst.ratio).toBe(1);
  });
});

describe("normalizeTakeProfit", () => {
  test("replaces empty stage lists with the default stages", () => {
    const result = normalizeTakeProfit(
      { scaleStages: [] },
      DEFAULT_STOP_PROFIT_SETTINGS.takeProfit
    );
    expect(result.scaleStages).toEqual(DEFAULT_STOP_PROFIT_SETTINGS.takeProfit.scaleStages);
  });
});
