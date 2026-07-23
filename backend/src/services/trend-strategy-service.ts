import { IronManDatabase } from "../db/database";
import { errors } from "../errors";
import type { Instrument } from "../market/types";
import { MarketService } from "./market-service";
import {
  normalizeTrendIndicators,
  type TrendIndicatorId,
  type TrendIndicatorSelection
} from "./trend-indicator-service";

export const TREND_TARGET_SCOPES = ["holdings", "watchlist", "custom", "all", "holdings_watchlist"] as const;
export const TREND_RANGE_PRESETS = ["3m", "6m", "1y", "2y", "custom"] as const;
export const TREND_REPORT_WINDOWS = ["1d", "3d", "7d", "30d", "all"] as const;

export type TrendTargetScope = (typeof TREND_TARGET_SCOPES)[number];
export type TrendRangePreset = (typeof TREND_RANGE_PRESETS)[number];
export type TrendReportWindow = (typeof TREND_REPORT_WINDOWS)[number];

export interface TrendDateRange {
  preset: TrendRangePreset;
  startDate?: string;
  endDate?: string;
}

export interface TrendStrategy {
  id: string;
  name: string;
  remarks: string;
  targetScope: TrendTargetScope;
  dataRange: TrendDateRange;
  reportWindow: TrendReportWindow;
  backtestConfig: Record<string, unknown> | null;
  customInstrumentIds: string[];
  indicators: Array<{ indicatorId: TrendIndicatorId; parameters: Record<string, number>; enabled: boolean; displayOrder: number }>;
  createdAt: string;
  updatedAt: string;
}

export interface TrendStrategyInput {
  name: string;
  remarks?: string;
  targetScope: TrendTargetScope;
  dataRange: TrendDateRange;
  reportWindow: TrendReportWindow;
  customInstrumentIds?: string[];
  indicators: TrendIndicatorSelection[];
  backtestConfig?: Record<string, unknown> | null;
}

export interface TrendStrategyTargetItem {
  instrument: Pick<Instrument, "id" | "code" | "exchange" | "name" | "assetType">;
  currentPrice: number | null;
}

export interface TrendStrategyTargets {
  targetScope: TrendTargetScope;
  items: TrendStrategyTargetItem[];
}

interface StrategyRow {
  id: string;
  user_id: string;
  name: string;
  remarks: string;
  target_scope: TrendTargetScope;
  data_range_json: string;
  report_window: TrendReportWindow;
  backtest_config_json: string | null;
  created_at: string;
  updated_at: string;
}

interface IndicatorRow {
  indicator_id: TrendIndicatorId;
  parameters_json: string;
  display_order: number;
  enabled: number;
}

export class TrendStrategyService {
  constructor(
    private readonly database: IronManDatabase,
    private readonly market: MarketService
  ) {}

  create(userId: string, input: TrendStrategyInput): TrendStrategy {
    const prepared = this.prepareInput(input);
    const duplicate = this.database.get<{ id: string }>("SELECT id FROM trend_strategies WHERE user_id = $userId AND name = $name", { userId, name: prepared.name });
    if (duplicate !== undefined) throw errors.alreadyExists("同名趋势策略已存在");
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.database.transaction(() => {
      this.database.run(
        `INSERT INTO trend_strategies (id, user_id, name, remarks, target_scope, data_range_json, report_window, backtest_config_json, created_at, updated_at)
         VALUES ($id, $userId, $name, $remarks, $targetScope, $dataRange, $reportWindow, $backtestConfig, $createdAt, $updatedAt)`,
        { id, userId, name: prepared.name, remarks: prepared.remarks, targetScope: prepared.targetScope, dataRange: JSON.stringify(prepared.dataRange), reportWindow: prepared.reportWindow, backtestConfig: prepared.backtestConfig === null ? null : JSON.stringify(prepared.backtestConfig), createdAt: now, updatedAt: now }
      );
      this.replaceTargets(userId, id, prepared.customInstrumentIds, now);
      this.replaceIndicators(userId, id, prepared.indicators, now);
    });
    return this.get(userId, id);
  }

  update(userId: string, id: string, input: TrendStrategyInput): TrendStrategy {
    this.get(userId, id);
    const prepared = this.prepareInput(input);
    const duplicate = this.database.get<{ id: string }>("SELECT id FROM trend_strategies WHERE user_id = $userId AND name = $name AND id != $id", { userId, name: prepared.name, id });
    if (duplicate !== undefined) throw errors.alreadyExists("同名趋势策略已存在");
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.database.run(
        `UPDATE trend_strategies SET name = $name, remarks = $remarks, target_scope = $targetScope, data_range_json = $dataRange,
         report_window = $reportWindow, backtest_config_json = $backtestConfig, updated_at = $updatedAt WHERE id = $id AND user_id = $userId`,
        { id, userId, name: prepared.name, remarks: prepared.remarks, targetScope: prepared.targetScope, dataRange: JSON.stringify(prepared.dataRange), reportWindow: prepared.reportWindow, backtestConfig: prepared.backtestConfig === null ? null : JSON.stringify(prepared.backtestConfig), updatedAt: now }
      );
      this.replaceTargets(userId, id, prepared.customInstrumentIds, now);
      this.replaceIndicators(userId, id, prepared.indicators, now);
    });
    return this.get(userId, id);
  }

  updateTargets(userId: string, id: string, instrumentIds: string[]): TrendStrategy {
    const strategy = this.get(userId, id);
    const unique = this.validateInstruments(instrumentIds);
    if (strategy.targetScope === "custom" && unique.length === 0) throw errors.validation("自定义范围至少需要一个标的");
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.replaceTargets(userId, id, unique, now);
      this.database.run("UPDATE trend_strategies SET updated_at = $updatedAt WHERE id = $id AND user_id = $userId", { id, userId, updatedAt: now });
    });
    return this.get(userId, id);
  }

  delete(userId: string, id: string): { deleted: true } {
    this.get(userId, id);
    this.database.run("DELETE FROM trend_strategies WHERE id = $id AND user_id = $userId", { id, userId });
    return { deleted: true };
  }

  get(userId: string, id: string): TrendStrategy {
    const row = this.database.get<StrategyRow>("SELECT * FROM trend_strategies WHERE id = $id AND user_id = $userId", { id, userId });
    if (row === undefined) throw errors.notFound("趋势策略不存在");
    return this.toStrategy(row);
  }

  list(userId: string): TrendStrategy[] {
    return this.database.all<StrategyRow>("SELECT * FROM trend_strategies WHERE user_id = $userId ORDER BY updated_at DESC", { userId }).map((row) => this.toStrategy(row));
  }

  resolveTargets(userId: string, strategy: TrendStrategy): Instrument[] {
    let ids: string[];
    switch (strategy.targetScope) {
      case "holdings":
        ids = this.database.all<{ instrument_id: string }>("SELECT instrument_id FROM holdings WHERE user_id = $userId AND status = 'active'", { userId }).map((row) => row.instrument_id);
        break;
      case "watchlist":
        ids = this.database.all<{ instrument_id: string }>("SELECT instrument_id FROM watchlist_entries WHERE user_id = $userId", { userId }).map((row) => row.instrument_id);
        break;
      case "custom":
        ids = strategy.customInstrumentIds;
        break;
      case "holdings_watchlist":
        ids = this.database.all<{ instrument_id: string }>(`SELECT instrument_id FROM holdings WHERE user_id = $userId AND status = 'active' UNION SELECT instrument_id FROM watchlist_entries WHERE user_id = $userId`, { userId }).map((row) => row.instrument_id);
        break;
      case "all":
        ids = this.database.all<{ id: string }>("SELECT id FROM instruments ORDER BY code ASC").map((row) => row.id);
        break;
    }
    return [...new Set(ids)].map((id) => this.market.getInstrument(id));
  }

  async listTargets(userId: string, strategyId: string): Promise<TrendStrategyTargets> {
    const strategy = this.get(userId, strategyId);
    if (strategy.targetScope === "all") return { targetScope: strategy.targetScope, items: [] };
    const targets = this.resolveTargets(userId, strategy);
    const items = await Promise.all(targets.map(async (instrument) => {
      try {
        const history = await this.market.getHistory(userId, instrument.id, "day", false, 1);
        return {
          instrument: pickInstrument(instrument),
          currentPrice: history.bars.at(-1)?.close ?? null
        } satisfies TrendStrategyTargetItem;
      } catch {
        return { instrument: pickInstrument(instrument), currentPrice: null } satisfies TrendStrategyTargetItem;
      }
    }));
    return { targetScope: strategy.targetScope, items };
  }

  private prepareInput(input: TrendStrategyInput): Omit<TrendStrategyInput, "indicators"> & { name: string; remarks: string; customInstrumentIds: string[]; indicators: ReturnType<typeof normalizeTrendIndicators> } {
    const name = input.name.trim();
    if (name.length === 0 || name.length > 120) throw errors.validation("策略名称长度应在 1 到 120 之间");
    if (!TREND_TARGET_SCOPES.includes(input.targetScope)) throw errors.validation("目标范围无效");
    if (!TREND_REPORT_WINDOWS.includes(input.reportWindow)) throw errors.validation("报告窗口无效");
    const dataRange = normalizeDateRange(input.dataRange);
    const customInstrumentIds = this.validateInstruments(input.customInstrumentIds ?? []);
    if (input.targetScope === "custom" && customInstrumentIds.length === 0) throw errors.validation("自定义范围至少需要一个标的");
    return {
      ...input,
      name,
      remarks: (input.remarks ?? "").trim().slice(0, 1_000),
      dataRange,
      customInstrumentIds,
      indicators: normalizeTrendIndicators(input.indicators),
      backtestConfig: input.backtestConfig ?? null
    };
  }

  private validateInstruments(ids: string[]): string[] {
    const unique = [...new Set(ids)];
    if (unique.length > 2_000) throw errors.validation("目标标的数量超出限制");
    for (const id of unique) this.market.getInstrument(id);
    return unique;
  }

  private replaceTargets(userId: string, strategyId: string, instrumentIds: string[], now: string): void {
    this.database.run("DELETE FROM trend_strategy_targets WHERE strategy_id = $strategyId AND user_id = $userId", { strategyId, userId });
    for (const instrumentId of instrumentIds) this.database.run("INSERT INTO trend_strategy_targets (strategy_id, user_id, instrument_id, created_at) VALUES ($strategyId, $userId, $instrumentId, $createdAt)", { strategyId, userId, instrumentId, createdAt: now });
  }

  private replaceIndicators(userId: string, strategyId: string, indicators: ReturnType<typeof normalizeTrendIndicators>, now: string): void {
    this.database.run("DELETE FROM trend_strategy_indicators WHERE strategy_id = $strategyId AND user_id = $userId", { strategyId, userId });
    for (const indicator of indicators) this.database.run(
      `INSERT INTO trend_strategy_indicators (id, strategy_id, user_id, indicator_id, parameters_json, display_order, enabled, created_at, updated_at)
       VALUES ($id, $strategyId, $userId, $indicatorId, $parameters, $displayOrder, 1, $createdAt, $updatedAt)`,
      { id: crypto.randomUUID(), strategyId, userId, indicatorId: indicator.indicatorId, parameters: JSON.stringify(indicator.parameters), displayOrder: indicator.displayOrder, createdAt: now, updatedAt: now }
    );
  }

  private toStrategy(row: StrategyRow): TrendStrategy {
    const dataRange = normalizeDateRange(JSON.parse(row.data_range_json) as TrendDateRange);
    const targets = this.database.all<{ instrument_id: string }>("SELECT instrument_id FROM trend_strategy_targets WHERE strategy_id = $strategyId AND user_id = $userId ORDER BY created_at ASC", { strategyId: row.id, userId: row.user_id }).map((target) => target.instrument_id);
    const indicators = this.database.all<IndicatorRow>("SELECT indicator_id, parameters_json, display_order, enabled FROM trend_strategy_indicators WHERE strategy_id = $strategyId AND user_id = $userId ORDER BY display_order ASC", { strategyId: row.id, userId: row.user_id }).map((indicator) => ({ indicatorId: indicator.indicator_id, parameters: JSON.parse(indicator.parameters_json) as Record<string, number>, displayOrder: indicator.display_order, enabled: indicator.enabled === 1 }));
    return { id: row.id, name: row.name, remarks: row.remarks, targetScope: row.target_scope, dataRange, reportWindow: row.report_window, backtestConfig: row.backtest_config_json === null ? null : JSON.parse(row.backtest_config_json) as Record<string, unknown>, customInstrumentIds: targets, indicators, createdAt: row.created_at, updatedAt: row.updated_at };
  }
}

function pickInstrument(instrument: Instrument): TrendStrategyTargetItem["instrument"] {
  return { id: instrument.id, code: instrument.code, exchange: instrument.exchange, name: instrument.name, assetType: instrument.assetType };
}

function normalizeDateRange(range: TrendDateRange): TrendDateRange {
  if (!TREND_RANGE_PRESETS.includes(range.preset)) throw errors.validation("数据时间范围无效");
  if (range.preset !== "custom") return { preset: range.preset };
  if (!isDate(range.startDate) || !isDate(range.endDate) || range.startDate! > range.endDate!) throw errors.validation("自定义数据日期范围无效");
  return { preset: "custom", startDate: range.startDate, endDate: range.endDate };
}

function isDate(value: string | undefined): value is string { return value !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)); }
