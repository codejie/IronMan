import { IronManDatabase } from "../db/database";
import {
  type StopLossSettings,
  type StopProfitSettings,
  type TakeProfitSettings
} from "./stop-profit-settings";

export const STOP_PROFIT_SETTINGS_KEY = "stop-profit.settings";

export const DEFAULT_STOP_PROFIT_SETTINGS: StopProfitSettings = {
  stopLoss: {
    strategy: "fixed_percentage",
    fixedPercent: 5,
    fixedAmount: 500,
    maPeriod: 20,
    bufferPercent: 1,
    atrPeriod: 14,
    atrMultiplier: 2
  },
  takeProfit: {
    strategy: "risk_reward",
    riskRewardRatio: 3,
    trailingPercent: 5,
    atrPeriod: 14,
    atrTrailMultiplier: 3,
    maTrailPeriod: 20,
    scaleStages: [
      { ratio: 1, sellPercent: 50 },
      { ratio: 2, sellPercent: 30 }
    ]
  },
  risk: {
    riskPerTradePercent: 1
  }
};

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const num = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, num));
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const num = typeof value === "number" && Number.isInteger(value) ? value : fallback;
  return Math.min(max, Math.max(min, num));
}

export function normalizeStopLoss(input: unknown, fallback: StopLossSettings): StopLossSettings {
  const src = (typeof input === "object" && input !== null ? input : {}) as Partial<StopLossSettings>;
  const strategy =
    src.strategy === "fixed_percentage" ||
    src.strategy === "fixed_amount" ||
    src.strategy === "technical" ||
    src.strategy === "atr"
      ? src.strategy
      : fallback.strategy;
  return {
    strategy,
    fixedPercent: clamp(src.fixedPercent, fallback.fixedPercent, 0.1, 90),
    fixedAmount: clamp(src.fixedAmount, fallback.fixedAmount, 1, 1_000_000_000),
    maPeriod: clampInt(src.maPeriod, fallback.maPeriod, 2, 500),
    bufferPercent: clamp(src.bufferPercent, fallback.bufferPercent, 0, 30),
    atrPeriod: clampInt(src.atrPeriod, fallback.atrPeriod, 2, 500),
    atrMultiplier: clamp(src.atrMultiplier, fallback.atrMultiplier, 0.1, 20)
  };
}

export function normalizeTakeProfit(
  input: unknown,
  fallback: TakeProfitSettings
): TakeProfitSettings {
  const src = (typeof input === "object" && input !== null ? input : {}) as Partial<TakeProfitSettings>;
  const strategy =
    src.strategy === "risk_reward" ||
    src.strategy === "trailing" ||
    src.strategy === "atr_trailing" ||
    src.strategy === "ma_trail" ||
    src.strategy === "scaled"
      ? src.strategy
      : fallback.strategy;
  const stages = Array.isArray(src.scaleStages)
    ? src.scaleStages.slice(0, 8).map((stage) => ({
        ratio: clamp(stage.ratio, 1, 0.1, 50),
        sellPercent: clamp(stage.sellPercent, 30, 1, 100)
      }))
    : fallback.scaleStages.map((stage) => ({ ...stage }));
  return {
    strategy,
    riskRewardRatio: clamp(src.riskRewardRatio, fallback.riskRewardRatio, 0.1, 50),
    trailingPercent: clamp(src.trailingPercent, fallback.trailingPercent, 0.1, 90),
    atrPeriod: clampInt(src.atrPeriod, fallback.atrPeriod, 2, 500),
    atrTrailMultiplier: clamp(src.atrTrailMultiplier, fallback.atrTrailMultiplier, 0.1, 20),
    maTrailPeriod: clampInt(src.maTrailPeriod, fallback.maTrailPeriod, 2, 500),
    scaleStages: stages.length > 0 ? stages : fallback.scaleStages.map((stage) => ({ ...stage }))
  };
}

export function normalizeStopProfit(
  input: unknown,
  fallback: StopProfitSettings = DEFAULT_STOP_PROFIT_SETTINGS
): StopProfitSettings {
  const src = (typeof input === "object" && input !== null ? input : {}) as Partial<StopProfitSettings>;
  return {
    stopLoss: normalizeStopLoss(src.stopLoss, fallback.stopLoss),
    takeProfit: normalizeTakeProfit(src.takeProfit, fallback.takeProfit),
    risk: {
      riskPerTradePercent: clamp(src.risk?.riskPerTradePercent, fallback.risk.riskPerTradePercent, 0.1, 50)
    }
  };
}

export class StopProfitSettingsService {
  constructor(private readonly database: IronManDatabase) {}

  get(userId: string): StopProfitSettings {
    const row = this.database.get<{ value_json: string }>(
      "SELECT value_json FROM user_settings WHERE user_id = $userId AND setting_key = $key",
      { userId, key: STOP_PROFIT_SETTINGS_KEY }
    );
    if (row === undefined) return cloneDefaults();
    return normalizeStopProfit(JSON.parse(row.value_json) as unknown);
  }

  update(userId: string, input: Partial<StopProfitSettings>): StopProfitSettings {
    const next = normalizeStopProfit(input);
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.database.run(
        `INSERT INTO user_settings (id, user_id, setting_key, value_json, created_at, updated_at)
         VALUES ($id, $userId, $key, $value, $createdAt, $updatedAt)
         ON CONFLICT(user_id, setting_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
        {
          id: crypto.randomUUID(),
          userId,
          key: STOP_PROFIT_SETTINGS_KEY,
          value: JSON.stringify(next),
          createdAt: now,
          updatedAt: now
        }
      );
    });
    return next;
  }
}

function cloneDefaults(): StopProfitSettings {
  return JSON.parse(JSON.stringify(DEFAULT_STOP_PROFIT_SETTINGS)) as StopProfitSettings;
}
