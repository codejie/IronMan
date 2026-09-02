import { z } from "@hono/zod-openapi";
import { IronManDatabase } from "../db/database";
import { errors } from "../errors";
import type { MarketSource, PriceBar } from "../market/types";
import { MarketService } from "./market-service";
import { SettingsService } from "./settings-service";
import { TradingCalendarService } from "./trading-calendar-service";

export type MarketSnapshotMode = "auto" | "manual";
export type MarketSnapshotScope = "holdings" | "watchlist" | "holdings_watchlist";
export type ManualSnapshotOrigin = "holdings" | "watchlist";

export interface MarketSnapshotSettings {
  enabled: boolean;
  mode: MarketSnapshotMode;
  startTime: string;
  endTime: string;
  intervalMinutes: 1 | 3 | 5 | 10 | 15 | 30;
  scope: MarketSnapshotScope;
  retentionDays: 5 | 10 | 15;
}

export interface MarketSnapshotStatus {
  totalCount: number;
  firstCapturedAt: string | null;
  lastCapturedAt: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastCaptureMode: MarketSnapshotMode | null;
  lastTargetCount: number;
  lastCapturedCount: number;
  lastSkippedCount: number;
  lastFailedCount: number;
  lastError: string | null;
}

export const marketSnapshotSettingsSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(["auto", "manual"]),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  intervalMinutes: z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(10), z.literal(15), z.literal(30)]),
  scope: z.enum(["holdings", "watchlist", "holdings_watchlist"]),
  retentionDays: z.union([z.literal(5), z.literal(10), z.literal(15)]),
});

export const marketSnapshotStatusSchema = z.object({
  totalCount: z.number().int().nonnegative(),
  firstCapturedAt: z.string().datetime().nullable(),
  lastCapturedAt: z.string().datetime().nullable(),
  lastAttemptAt: z.string().datetime().nullable(),
  lastSuccessAt: z.string().datetime().nullable(),
  lastCaptureMode: z.enum(["auto", "manual"]).nullable(),
  lastTargetCount: z.number().int().nonnegative(),
  lastCapturedCount: z.number().int().nonnegative(),
  lastSkippedCount: z.number().int().nonnegative(),
  lastFailedCount: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
});

export interface MarketSnapshotPoint {
  capturedAt: string;
  tradeDate: string;
  source: MarketSource;
  captureMode: MarketSnapshotMode;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

interface SettingRow {
  user_id: string;
  value_json: string;
}

interface StateRow {
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_capture_mode: MarketSnapshotMode | null;
  last_target_count: number;
  last_captured_count: number;
  last_skipped_count: number;
  last_failed_count: number;
  last_error: string | null;
  last_cleanup_trade_date: string | null;
}

interface SnapshotRow {
  captured_at: string;
  trade_date: string;
  source: MarketSource;
  capture_mode: MarketSnapshotMode;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

const settingsKey = "market.intraday-snapshots";
const intervalOptions = new Set([1, 3, 5, 10, 15, 30]);
const retentionOptions = new Set([5, 10, 15]);
const snapshotScopes = new Set<MarketSnapshotScope>([
  "holdings",
  "watchlist",
  "holdings_watchlist",
]);
const defaultSettings: MarketSnapshotSettings = {
  enabled: false,
  mode: "auto",
  startTime: "09:30",
  endTime: "15:00",
  intervalMinutes: 15,
  scope: "holdings",
  retentionDays: 5,
};

export class MarketSnapshotService {
  private automaticRunInProgress = false;

  constructor(
    private readonly database: IronManDatabase,
    private readonly settings: SettingsService,
    private readonly calendar: TradingCalendarService,
    private readonly market: MarketService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  getSettings(userId: string): MarketSnapshotSettings {
    return normalizeSettings(this.settings.get(userId, settingsKey)?.value);
  }

  updateSettings(userId: string, input: Partial<MarketSnapshotSettings>): MarketSnapshotSettings {
    const next = { ...this.getSettings(userId), ...input };
    validateSettings(next);
    this.settings.upsert(userId, settingsKey, next);
    return next;
  }

  getStatus(userId: string): MarketSnapshotStatus {
    const aggregate = this.database.get<{ count: number; first_captured_at: string | null; last_captured_at: string | null }>(
      `SELECT COUNT(*) AS count, MIN(captured_at) AS first_captured_at, MAX(captured_at) AS last_captured_at
         FROM market_intraday_snapshots WHERE user_id = $userId`,
      { userId },
    );
    const state = this.stateFor(userId);
    return {
      totalCount: aggregate?.count ?? 0,
      firstCapturedAt: aggregate?.first_captured_at ?? null,
      lastCapturedAt: aggregate?.last_captured_at ?? null,
      lastAttemptAt: state?.last_attempt_at ?? null,
      lastSuccessAt: state?.last_success_at ?? null,
      lastCaptureMode: state?.last_capture_mode ?? null,
      lastTargetCount: state?.last_target_count ?? 0,
      lastCapturedCount: state?.last_captured_count ?? 0,
      lastSkippedCount: state?.last_skipped_count ?? 0,
      lastFailedCount: state?.last_failed_count ?? 0,
      lastError: state?.last_error ?? null,
    };
  }

  deleteSnapshots(userId: string): { deleted: number } {
    const deleted = this.database.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM market_intraday_snapshots WHERE user_id = $userId",
      { userId },
    )?.count ?? 0;
    this.database.run("DELETE FROM market_intraday_snapshots WHERE user_id = $userId", { userId });
    return { deleted };
  }

  listSeries(userId: string, instrumentId: string, startAt: string, endAt: string): MarketSnapshotPoint[] {
    this.market.getInstrument(instrumentId);
    if (Number.isNaN(Date.parse(startAt)) || Number.isNaN(Date.parse(endAt)) || startAt > endAt) {
      throw errors.validation("盘中快照时间范围无效");
    }
    return this.database.all<SnapshotRow>(
      `SELECT captured_at, trade_date, source, capture_mode, open, close, high, low, volume
         FROM market_intraday_snapshots
        WHERE user_id = $userId AND instrument_id = $instrumentId
          AND captured_at >= $startAt AND captured_at <= $endAt
        ORDER BY captured_at ASC`,
      { userId, instrumentId, startAt, endAt },
    ).map((row) => ({
      capturedAt: row.captured_at,
      tradeDate: row.trade_date,
      source: row.source,
      captureMode: row.capture_mode,
      open: row.open,
      close: row.close,
      high: row.high,
      low: row.low,
      volume: row.volume,
    }));
  }

  captureFromManualRefresh(
    userId: string,
    origin: ManualSnapshotOrigin,
    instrumentId: string,
    source: MarketSource,
    bar: PriceBar,
    now = this.clock(),
  ): boolean {
    const config = this.getSettings(userId);
    if (!config.enabled || config.mode !== "manual" || !this.isEligibleNow(userId, config, now)) return false;
    if (!this.scopeIncludesOrigin(config.scope, origin) || !this.isCurrentScopeTarget(userId, config.scope, instrumentId)) return false;
    const cleanupTradeDate = this.cleanupExpiredSnapshots(userId, config.retentionDays, localParts(now).date);
    return this.storeCurrentSnapshot(userId, instrumentId, source, "manual", bar, now, cleanupTradeDate);
  }

  async captureDueAutomatic(now = this.clock()): Promise<void> {
    if (this.automaticRunInProgress) return;
    this.automaticRunInProgress = true;
    try {
      const candidates = this.database.all<SettingRow>(
        "SELECT user_id, value_json FROM user_settings WHERE setting_key = $settingKey",
        { settingKey: settingsKey },
      );
      for (const candidate of candidates) {
        let config: MarketSnapshotSettings;
        try {
          config = normalizeSettings(JSON.parse(candidate.value_json));
        } catch {
          continue;
        }
        if (!config.enabled || config.mode !== "auto" || !this.isEligibleNow(candidate.user_id, config, now)) continue;
        const state = this.stateFor(candidate.user_id);
        if (state?.last_attempt_at !== null && state?.last_attempt_at !== undefined && now.getTime() - Date.parse(state.last_attempt_at) < config.intervalMinutes * 60_000) continue;
        await this.captureAutomaticForUser(candidate.user_id, config, now);
      }
    } finally {
      this.automaticRunInProgress = false;
    }
  }

  private async captureAutomaticForUser(userId: string, config: MarketSnapshotSettings, now: Date): Promise<void> {
    const local = localParts(now);
    const cleanupTradeDate = this.cleanupExpiredSnapshots(userId, config.retentionDays, local.date);
    const targets = this.listScopeInstrumentIds(userId, config.scope);
    let captured = 0;
    let skipped = 0;
    let failed = 0;
    let lastError: string | null = null;
    for (const instrumentId of targets) {
      try {
        const history = await this.market.getHistory(userId, instrumentId, "day", true);
        const latest = history.bars.at(-1);
        if (latest === undefined || !this.storeCurrentSnapshot(userId, instrumentId, history.source, "auto", latest, now)) skipped += 1;
        else captured += 1;
      } catch (error) {
        failed += 1;
        lastError = error instanceof Error ? error.message : "行情数据获取失败";
      }
    }
    this.updateState(userId, {
      now,
      mode: "auto",
      targets: targets.length,
      captured,
      skipped,
      failed,
      lastError,
      success: captured > 0,
      cleanupTradeDate,
    });
  }

  private storeCurrentSnapshot(
    userId: string,
    instrumentId: string,
    source: MarketSource,
    mode: MarketSnapshotMode,
    bar: PriceBar,
    now: Date,
    cleanupTradeDate?: string,
  ): boolean {
    const local = localParts(now);
    if (bar.date !== local.date || !this.isSupportedInstrument(instrumentId)) return false;
    const capturedAt = now.toISOString();
    const capturedMinute = `${local.date} ${local.hour}:${local.minute}`;
    this.database.run(
      `INSERT INTO market_intraday_snapshots (
        id, user_id, instrument_id, captured_at, captured_minute, trade_date, source, capture_mode,
        open, close, high, low, volume, created_at
      ) VALUES (
        $id, $userId, $instrumentId, $capturedAt, $capturedMinute, $tradeDate, $source, $captureMode,
        $open, $close, $high, $low, $volume, $createdAt
      ) ON CONFLICT(user_id, instrument_id, captured_minute) DO UPDATE SET
        captured_at = excluded.captured_at, trade_date = excluded.trade_date, source = excluded.source,
        capture_mode = excluded.capture_mode, open = excluded.open, close = excluded.close, high = excluded.high,
        low = excluded.low, volume = excluded.volume, created_at = excluded.created_at`,
      {
        id: crypto.randomUUID(),
        userId,
        instrumentId,
        capturedAt,
        capturedMinute,
        tradeDate: bar.date,
        source,
        captureMode: mode,
        open: bar.open,
        close: bar.close,
        high: bar.high,
        low: bar.low,
        volume: bar.volume,
        createdAt: capturedAt,
      },
    );
    this.updateState(userId, {
      now,
      mode,
      targets: 1,
      captured: 1,
      skipped: 0,
      failed: 0,
      lastError: null,
      success: true,
      cleanupTradeDate,
    });
    return true;
  }

  private cleanupExpiredSnapshots(userId: string, retentionDays: number, tradeDate: string): string | undefined {
    const state = this.stateFor(userId);
    if (state?.last_cleanup_trade_date === tradeDate) return undefined;
    const firstCalendarYear = Number(tradeDate.slice(0, 4)) - 1;
    const retainedTradeDates = this.calendar.getTradeDays(userId, `${firstCalendarYear}-01-01`, tradeDate);
    const earliestRetainedTradeDate = retainedTradeDates.at(-retentionDays);
    if (earliestRetainedTradeDate === undefined) return undefined;
    this.database.run(
      "DELETE FROM market_intraday_snapshots WHERE user_id = $userId AND trade_date < $earliestRetainedTradeDate",
      { userId, earliestRetainedTradeDate },
    );
    return tradeDate;
  }

  private isEligibleNow(userId: string, config: MarketSnapshotSettings, now: Date): boolean {
    const local = localParts(now);
    if (!this.calendar.getTradeDays(userId, local.date, local.date).includes(local.date)) return false;
    const time = `${local.hour}:${local.minute}`;
    if (time < config.startTime || time > config.endTime) return false;
    return (time >= "09:30" && time <= "11:30") || (time >= "13:00" && time <= "15:00");
  }

  private scopeIncludesOrigin(scope: MarketSnapshotScope, origin: ManualSnapshotOrigin): boolean {
    return scope === "holdings_watchlist" || scope === origin;
  }

  private isCurrentScopeTarget(userId: string, scope: MarketSnapshotScope, instrumentId: string): boolean {
    return this.listScopeInstrumentIds(userId, scope).includes(instrumentId);
  }

  private listScopeInstrumentIds(userId: string, scope: MarketSnapshotScope): string[] {
    const conditions: string[] = [];
    if (scope === "holdings" || scope === "holdings_watchlist") {
      conditions.push(`SELECT holdings.instrument_id
        FROM holdings JOIN instruments ON instruments.id = holdings.instrument_id
       WHERE holdings.user_id = $userId AND holdings.status = 'active' AND instruments.asset_type IN ('stock', 'index')`);
    }
    if (scope === "watchlist" || scope === "holdings_watchlist") {
      conditions.push(`SELECT watchlist_entries.instrument_id
        FROM watchlist_entries JOIN instruments ON instruments.id = watchlist_entries.instrument_id
       WHERE watchlist_entries.user_id = $userId AND instruments.asset_type IN ('stock', 'index')`);
    }
    if (conditions.length === 0) return [];
    return this.database.all<{ instrument_id: string }>(conditions.join(" UNION "), { userId }).map((row) => row.instrument_id);
  }

  private isSupportedInstrument(instrumentId: string): boolean {
    return this.database.get<{ id: string }>(
      "SELECT id FROM instruments WHERE id = $instrumentId AND asset_type IN ('stock', 'index')",
      { instrumentId },
    ) !== undefined;
  }

  private stateFor(userId: string): StateRow | undefined {
    return this.database.get<StateRow>("SELECT * FROM market_snapshot_states WHERE user_id = $userId", { userId });
  }

  private updateState(
    userId: string,
    input: {
      now: Date;
      mode: MarketSnapshotMode;
      targets: number;
      captured: number;
      skipped: number;
      failed: number;
      lastError: string | null;
      success: boolean;
      cleanupTradeDate?: string;
    },
  ): void {
    const timestamp = input.now.toISOString();
    this.database.run(
      `INSERT INTO market_snapshot_states (
        user_id, last_attempt_at, last_success_at, last_capture_mode, last_target_count, last_captured_count,
        last_skipped_count, last_failed_count, last_error, last_cleanup_trade_date, updated_at
      ) VALUES (
        $userId, $lastAttemptAt, $lastSuccessAt, $lastCaptureMode, $lastTargetCount, $lastCapturedCount,
        $lastSkippedCount, $lastFailedCount, $lastError, $lastCleanupTradeDate, $updatedAt
      ) ON CONFLICT(user_id) DO UPDATE SET
        last_attempt_at = excluded.last_attempt_at,
        last_success_at = excluded.last_success_at,
        last_capture_mode = excluded.last_capture_mode,
        last_target_count = excluded.last_target_count,
        last_captured_count = excluded.last_captured_count,
        last_skipped_count = excluded.last_skipped_count,
        last_failed_count = excluded.last_failed_count,
        last_error = excluded.last_error,
        last_cleanup_trade_date = COALESCE(excluded.last_cleanup_trade_date, market_snapshot_states.last_cleanup_trade_date),
        updated_at = excluded.updated_at`,
      {
        userId,
        lastAttemptAt: timestamp,
        lastSuccessAt: input.success ? timestamp : this.stateFor(userId)?.last_success_at ?? null,
        lastCaptureMode: input.mode,
        lastTargetCount: input.targets,
        lastCapturedCount: input.captured,
        lastSkippedCount: input.skipped,
        lastFailedCount: input.failed,
        lastError: input.lastError,
        lastCleanupTradeDate: input.cleanupTradeDate ?? null,
        updatedAt: timestamp,
      },
    );
  }
}

function normalizeSettings(value: unknown): MarketSnapshotSettings {
  if (typeof value !== "object" || value === null) return { ...defaultSettings };
  const candidate = value as Partial<MarketSnapshotSettings>;
  const merged = { ...defaultSettings, ...candidate };
  try {
    validateSettings(merged);
    return merged;
  } catch {
    return { ...defaultSettings };
  }
}

function validateSettings(value: MarketSnapshotSettings): void {
  if (typeof value.enabled !== "boolean" || (value.mode !== "auto" && value.mode !== "manual")) {
    throw errors.validation("盘中快照配置无效");
  }
  if (!isTime(value.startTime) || !isTime(value.endTime) || value.startTime >= value.endTime) {
    throw errors.validation("采集开始和结束时间无效");
  }
  if (!intervalOptions.has(value.intervalMinutes) || !snapshotScopes.has(value.scope) || !retentionOptions.has(value.retentionDays)) {
    throw errors.validation("盘中快照配置项无效");
  }
}

function isTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function localParts(value: Date): { date: string; hour: string; minute: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return {
    date: `${map.get("year")}-${map.get("month")}-${map.get("day")}`,
    hour: map.get("hour") ?? "00",
    minute: map.get("minute") ?? "00",
  };
}
