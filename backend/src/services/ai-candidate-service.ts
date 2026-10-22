import { IronManDatabase } from "../db/database";
import { errors } from "../errors";
import type { Instrument, PriceBar } from "../market/types";
import { MarketService } from "./market-service";
import { SettingsService } from "./settings-service";
import { ThirdPartyDataService } from "./third-party-data-service";
import { TradingCalendarService } from "./trading-calendar-service";

export const CANDIDATE_ALGORITHM_VERSION = "ai-candidate-v1";
export const CANDIDATE_STRATEGIES = ["trend_event", "quality_growth", "value_repair"] as const;
export type CandidateStrategy = (typeof CANDIDATE_STRATEGIES)[number];
export type CandidateTrigger = "manual" | "scheduled";
export type CandidateRunStatus = "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";
export type CandidateDataQuality = "complete" | "partial" | "stale" | "unavailable";
export type CandidateAction = "observe" | "wait_pullback" | "wait_breakout" | "research_further" | "avoid";

export interface CandidateSettings {
  enabled: boolean;
  strategies: CandidateStrategy[];
  topN: 5 | 10 | 20;
  explanationValidityDays: 10;
  maxValidityDays: 20;
  scheduledTime: string;
  retentionDays: number;
}

export interface CandidateRun {
  id: string;
  trigger: CandidateTrigger;
  tradeDate: string;
  status: CandidateRunStatus;
  progress: number;
  requestedTopN: 5 | 10 | 20;
  strategies: CandidateStrategy[];
  algorithmVersion: string;
  marketRegime: MarketRegime;
  dataQuality: Record<string, unknown>;
  modelSnapshot: Record<string, unknown>;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface MarketRegime {
  name: "strong" | "neutral" | "risk";
  threshold: number;
  asOf: string;
  evidence: string[];
}

export interface CandidateExplanation {
  summary: string;
  action: CandidateAction;
  thesis: string[];
  counterEvidence: string[];
  referencePriceLow: number | null;
  referencePriceHigh: number | null;
  invalidationPrice: number | null;
  validUntil: string;
  uncertainty: string;
  evidenceIds: string[];
}

export interface CandidateExplanationRequest {
  instrument: Pick<Instrument, "id" | "code" | "exchange" | "name" | "assetType">;
  strategy: CandidateStrategy;
  score: number;
  scoreSnapshot: Record<string, unknown>;
  evidence: Evidence[];
  signalDate: string;
  fallbackValidUntil: string;
  maxValidUntil: string;
}

export interface CandidateExplanationGenerator {
  generate(userId: string, input: CandidateExplanationRequest): Promise<{ explanation: CandidateExplanation; model: Record<string, unknown> } | null>;
  getModelSnapshot(userId: string): Record<string, unknown>;
}

export interface CandidateItem {
  id: string;
  runId: string;
  strategy: CandidateStrategy;
  rank: number | null;
  score: number;
  percentile: number;
  selected: boolean;
  instrument: Pick<Instrument, "id" | "code" | "exchange" | "name" | "assetType">;
  scoreSnapshot: Record<string, unknown>;
  evidenceSnapshot: Evidence[];
  explanation: CandidateExplanation | null;
  aiStatus: "pending" | "completed" | "local" | "unavailable";
  dataQuality: CandidateDataQuality;
  rejectionReason: string | null;
  cycleId: string | null;
  createdAt: string;
}

export interface CandidateEvaluation {
  id: string;
  itemId: string;
  cycleId: string | null;
  horizon: 5 | 10 | 20;
  state: "pending" | "matured" | "not_executable" | "indeterminate" | "invalidated" | "insufficient_data";
  targetDate: string | null;
  actualDate: string | null;
  entryPrice: number | null;
  exitPrice: number | null;
  grossReturn: number | null;
  netReturn: number | null;
  benchmarkReturn: number | null;
  industryReturn: number | null;
  marketExcessReturn: number | null;
  industryExcessReturn: number | null;
  mfe: number | null;
  mae: number | null;
  maxDrawdown: number | null;
  invalidationResult: boolean | null;
  dataQuality: CandidateDataQuality;
  createdAt: string;
  updatedAt: string;
}

export interface CandidateLatest {
  run: CandidateRun | null;
  items: CandidateItem[];
}

export interface CandidateEvaluationSummary {
  horizons: Record<"5" | "10" | "20", { total: number; matured: number; pending: number; hitRate: number | null; averageNetReturn: number | null; averageExcessReturn: number | null }>;
  byStrategy: Record<CandidateStrategy, { total: number; matured: number; hitRate: number | null; averageNetReturn: number | null }>;
}

interface RunRow {
  id: string;
  user_id: string;
  trigger: CandidateTrigger;
  trade_date: string;
  status: CandidateRunStatus;
  progress: number;
  requested_top_n: 5 | 10 | 20;
  strategies_json: string;
  algorithm_version: string;
  market_regime_json: string;
  data_quality_json: string;
  model_snapshot_json: string;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface DailyRunRow {
  user_id: string;
  trade_date: string;
  current_run_id: string;
  pending_run_id: string | null;
  created_at: string;
  updated_at: string;
}

interface InstrumentRow {
  id: string;
  code: string;
  exchange: Instrument["exchange"];
  name: string;
  asset_type: Instrument["assetType"];
  created_at: string;
  updated_at: string;
}

interface ItemRow {
  id: string;
  run_id: string;
  user_id: string;
  instrument_id: string;
  strategy: CandidateStrategy;
  rank: number | null;
  score: number;
  percentile: number;
  selected: number;
  score_snapshot_json: string;
  evidence_snapshot_json: string;
  explanation_json: string | null;
  ai_status: "pending" | "completed" | "local" | "unavailable";
  data_quality: CandidateDataQuality;
  rejection_reason: string | null;
  cycle_id: string | null;
  created_at: string;
}

interface CycleRow {
  id: string;
  strategy: CandidateStrategy;
  instrument_id: string;
  first_item_id: string;
  latest_item_id: string;
  state: "waiting_entry" | "tracking" | "matured" | "invalidated" | "not_executable" | "indeterminate";
  signal_date: string;
  entry_date: string | null;
  entry_price: number | null;
  valid_until: string;
}

interface EvaluationRow {
  id: string;
  item_id: string;
  cycle_id: string | null;
  horizon: 5 | 10 | 20;
  state: CandidateEvaluation["state"];
  target_date: string | null;
  actual_date: string | null;
  entry_price: number | null;
  exit_price: number | null;
  benchmark_return: number | null;
  industry_return: number | null;
  gross_return: number | null;
  net_return: number | null;
  market_excess_return: number | null;
  industry_excess_return: number | null;
  mfe: number | null;
  mae: number | null;
  max_drawdown: number | null;
  invalidation_result: number | null;
  data_quality: CandidateDataQuality;
  created_at: string;
  updated_at: string;
}

interface Evidence {
  id: string;
  label: string;
  value: string | number;
  source: string;
  asOf: string;
}

interface ScoredCandidate {
  instrument: Instrument;
  strategy: CandidateStrategy;
  score: number;
  scoreSnapshot: Record<string, unknown>;
  evidence: Evidence[];
  dataQuality: CandidateDataQuality;
  bars: PriceBar[];
}

const settingsKey = "analysis.ai-candidates";
const defaultSettings: CandidateSettings = {
  enabled: true,
  strategies: [...CANDIDATE_STRATEGIES],
  topN: 10,
  explanationValidityDays: 10,
  maxValidityDays: 20,
  scheduledTime: "18:30",
  retentionDays: 30,
};

export class AiCandidateService {
  constructor(
    private readonly database: IronManDatabase,
    private readonly settings: SettingsService,
    private readonly market: MarketService,
    private readonly thirdParty: ThirdPartyDataService,
    private readonly calendar: TradingCalendarService,
    private readonly explanationGenerator?: CandidateExplanationGenerator,
  ) {}

  getSettings(userId: string): CandidateSettings {
    const stored = this.settings.get(userId, settingsKey)?.value;
    if (typeof stored !== "object" || stored === null) return { ...defaultSettings, strategies: [...defaultSettings.strategies] };
    const value = stored as Partial<CandidateSettings>;
    return normalizeSettings(value);
  }

  updateSettings(userId: string, input: Partial<CandidateSettings>): CandidateSettings {
    const next = normalizeSettings({ ...this.getSettings(userId), ...input });
    this.settings.upsert(userId, settingsKey, next);
    return next;
  }

  start(userId: string, input: { trigger?: CandidateTrigger; tradeDate?: string; topN?: 5 | 10 | 20; strategies?: CandidateStrategy[] }): CandidateRun {
    const settings = this.getSettings(userId);
    const trigger = input.trigger ?? "manual";
    const tradeDate = input.tradeDate ?? this.resolveTradeDate(userId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) throw errors.validation("候选交易日期无效");
    this.pruneExpiredRuns(userId, settings.retentionDays, tradeDate);
    const topN = input.topN ?? settings.topN;
    if (topN !== 5 && topN !== 10 && topN !== 20) throw errors.validation("Top N 只能是 5、10 或 20");
    const strategies = normalizeStrategies(input.strategies ?? settings.strategies);
    const daily = this.getDailyRun(userId, tradeDate);
    const current = daily === undefined ? undefined : this.getRunRow(userId, daily.current_run_id);
    const pending = daily?.pending_run_id === null || daily?.pending_run_id === undefined
      ? undefined
      : this.getRunRow(userId, daily.pending_run_id);
    if (pending !== undefined && isActiveCandidateStatus(pending.status)) return this.toRun(pending);
    if (current !== undefined && isActiveCandidateStatus(current.status)) return this.toRun(current);

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.database.transaction(() => {
      this.database.run(
        `INSERT INTO ai_candidate_runs (id, user_id, trigger, trade_date, status, progress, requested_top_n, strategies_json, algorithm_version, market_regime_json, data_quality_json, model_snapshot_json, created_at)
         VALUES ($id, $userId, $trigger, $tradeDate, 'queued', 0, $topN, $strategies, $algorithmVersion, '{}', '{}', $modelSnapshot, $createdAt)`,
        { id, userId, trigger, tradeDate, topN, strategies: JSON.stringify(strategies), algorithmVersion: CANDIDATE_ALGORITHM_VERSION, modelSnapshot: JSON.stringify({ provider: "local", version: "deterministic-explanation-v1" }), createdAt: now },
      );
      if (daily === undefined) {
        this.database.run(
          `INSERT INTO ai_candidate_daily_runs (user_id, trade_date, current_run_id, pending_run_id, created_at, updated_at)
           VALUES ($userId, $tradeDate, $runId, NULL, $createdAt, $updatedAt)`,
          { userId, tradeDate, runId: id, createdAt: now, updatedAt: now },
        );
      } else if (current !== undefined && isCurrentCandidateStatus(current.status)) {
        this.database.run(
          `UPDATE ai_candidate_daily_runs SET pending_run_id = $runId, updated_at = $updatedAt WHERE user_id = $userId AND trade_date = $tradeDate`,
          { userId, tradeDate, runId: id, updatedAt: now },
        );
      } else {
        this.database.run(
          `UPDATE ai_candidate_daily_runs SET current_run_id = $runId, pending_run_id = NULL, updated_at = $updatedAt WHERE user_id = $userId AND trade_date = $tradeDate`,
          { userId, tradeDate, runId: id, updatedAt: now },
        );
      }
    });
    const run = this.getRun(userId, id);
    void this.execute(userId, id);
    return run;
  }

  getRun(userId: string, id: string): CandidateRun {
    const row = this.database.get<RunRow>("SELECT * FROM ai_candidate_runs WHERE id = $id AND user_id = $userId", { id, userId });
    if (row === undefined) throw errors.notFound("AI 候选运行记录不存在");
    return this.toRun(row);
  }

  listRuns(userId: string, limit = 60): CandidateRun[] {
    this.pruneExpiredRuns(userId, this.getSettings(userId).retentionDays);
    const dailyRuns = this.database.all<DailyRunRow>("SELECT * FROM ai_candidate_daily_runs WHERE user_id = $userId ORDER BY trade_date DESC LIMIT $limit", { userId, limit: Math.min(200, Math.max(1, limit)) });
    return dailyRuns.map((daily) => this.dailyDisplayRun(userId, daily)).filter((row): row is RunRow => row !== undefined).map((row) => this.toRun(row));
  }

  deleteDate(userId: string, tradeDate: string): { deleted: true } {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) throw errors.validation("候选交易日期无效");
    const runs = this.database.all<Pick<RunRow, "id" | "status">>("SELECT id, status FROM ai_candidate_runs WHERE user_id = $userId AND trade_date = $tradeDate", { userId, tradeDate });
    if (runs.length === 0) throw errors.notFound("该日期没有候选记录");
    if (runs.some((run) => isActiveCandidateStatus(run.status))) throw errors.validation("运行中的候选记录不能删除，请等待完成或先停止运行");
    this.deleteDateRows(userId, tradeDate);
    return { deleted: true };
  }

  cancel(userId: string, id: string): CandidateRun {
    const existing = this.getRun(userId, id);
    if (existing.status === "queued" || existing.status === "running") this.database.run("UPDATE ai_candidate_runs SET cancel_requested = 1 WHERE id = $id AND user_id = $userId", { id, userId });
    return this.getRun(userId, id);
  }

  async latest(userId: string, tradeDate?: string): Promise<CandidateLatest> {
    const requestedTradeDate = tradeDate ?? this.resolveTradeDate(userId);
    const daily = this.getDailyRun(userId, requestedTradeDate);
    const row = daily === undefined ? undefined : this.dailyDisplayRun(userId, daily);
    if (row === undefined || !isLatestCandidateStatus(row.status)) return { run: null, items: [] };
    const selectedItems = this.listItems(userId, row.id, true);
    return { run: this.toRun(row), items: selectedItems.length > 0 ? selectedItems : this.listItems(userId, row.id, false) };
  }

  detail(userId: string, id: string): { run: CandidateRun; items: CandidateItem[]; evaluations: CandidateEvaluation[]; logs: Array<{ id: string; level: string; stage: string; message: string; createdAt: string }> } {
    const run = this.getRun(userId, id);
    const items = this.listItems(userId, id, false);
    const itemIds = items.map((item) => item.id);
    const evaluations = itemIds.length === 0 ? [] : this.database.all<EvaluationRow>(`SELECT * FROM ai_candidate_evaluations WHERE user_id = $userId AND item_id IN (${itemIds.map((_, index) => `$item${index}`).join(",")}) ORDER BY horizon ASC`, { userId, ...Object.fromEntries(itemIds.map((itemId, index) => [`item${index}`, itemId])) }).map((row) => this.toEvaluation(row));
    const logs = this.database.all<{ id: string; level: string; stage: string; message: string; created_at: string }>("SELECT id, level, stage, message, created_at FROM ai_candidate_run_logs WHERE user_id = $userId AND run_id = $runId ORDER BY created_at ASC", { userId, runId: id }).map((row) => ({ id: row.id, level: row.level, stage: row.stage, message: row.message, createdAt: row.created_at }));
    return { run, items, evaluations, logs };
  }

  evaluationSummary(userId: string): CandidateEvaluationSummary {
    const rows = this.database.all<EvaluationRow & { strategy: CandidateStrategy }>(
      `SELECT ai_candidate_evaluations.*, ai_candidate_items.strategy
         FROM ai_candidate_evaluations JOIN ai_candidate_items ON ai_candidate_items.id = ai_candidate_evaluations.item_id
        JOIN ai_candidate_runs ON ai_candidate_runs.id = ai_candidate_items.run_id
        JOIN ai_candidate_daily_runs ON ai_candidate_daily_runs.current_run_id = ai_candidate_runs.id
        WHERE ai_candidate_evaluations.user_id = $userId`,
      { userId },
    );
    const horizons = Object.fromEntries(([5, 10, 20] as const).map((horizon) => {
      const subset = rows.filter((row) => row.horizon === horizon);
      const matured = subset.filter((row) => row.state === "matured" && row.net_return !== null);
      return [String(horizon), { total: subset.length, matured: matured.length, pending: subset.filter((row) => row.state === "pending").length, hitRate: rate(matured.filter((row) => (row.net_return ?? 0) > 0).length, matured.length), averageNetReturn: average(matured.map((row) => row.net_return)), averageExcessReturn: average(matured.map((row) => row.market_excess_return)) }];
    })) as CandidateEvaluationSummary["horizons"];
    const byStrategy = Object.fromEntries(CANDIDATE_STRATEGIES.map((strategy) => {
      const subset = rows.filter((row) => row.strategy === strategy && row.horizon === 20);
      const matured = subset.filter((row) => row.state === "matured" && row.net_return !== null);
      return [strategy, { total: subset.length, matured: matured.length, hitRate: rate(matured.filter((row) => (row.net_return ?? 0) > 0).length, matured.length), averageNetReturn: average(matured.map((row) => row.net_return)) }];
    })) as CandidateEvaluationSummary["byStrategy"];
    return { horizons, byStrategy };
  }

  async settle(userId: string): Promise<number> {
    const pending = this.database.all<EvaluationRow>("SELECT * FROM ai_candidate_evaluations WHERE user_id = $userId AND state = 'pending'", { userId });
    let settled = 0;
    for (const evaluation of pending) {
      const item = this.database.get<ItemRow>("SELECT * FROM ai_candidate_items WHERE id = $id AND user_id = $userId", { id: evaluation.item_id, userId });
      if (item === undefined) continue;
      const scoreSnapshot = parseJson<Record<string, unknown>>(item.score_snapshot_json, {});
      const evidence = parseJson<Evidence[]>(item.evidence_snapshot_json, []);
      const signalDate = typeof scoreSnapshot.signalDate === "string"
        ? scoreSnapshot.signalDate
        : (() => {
            const signalEvidence = evidence.find((entry) => entry.id === "signal-date");
            return typeof signalEvidence?.value === "string" ? signalEvidence.value : null;
          })();
      if (signalDate === null) continue;
      const instrument = this.market.getInstrument(item.instrument_id);
      const history = await this.market.getHistory(userId, instrument.id, "day", false, 180).catch(() => ({ source: "eastmoney" as const, bars: [] }));
      const bars = history.bars;
      const start = bars.findIndex((bar) => bar.date > signalDate);
      if (start < 0 || bars.length < start + evaluation.horizon) continue;
      const entry = bars[start]!;
      const exit = bars[start + evaluation.horizon - 1]!;
      const path = bars.slice(start, start + evaluation.horizon);
      const executable = entry.open > 0 && !(entry.open === entry.high && entry.open === entry.low);
      if (!executable) {
        this.database.run("UPDATE ai_candidate_evaluations SET state = 'not_executable', actual_date = $actualDate, updated_at = $updatedAt WHERE id = $id AND user_id = $userId AND state = 'pending'", { id: evaluation.id, userId, actualDate: entry.date, updatedAt: new Date().toISOString() });
        settled += 1;
        continue;
      }
      const gross = entry.open === 0 ? null : (exit.close - entry.open) / entry.open;
      if (gross === null) continue;
      const mfe = entry.open === 0 ? null : Math.max(...path.map((bar) => (bar.high - entry.open) / entry.open));
      const mae = entry.open === 0 ? null : Math.min(...path.map((bar) => (bar.low - entry.open) / entry.open));
      const maxDrawdown = calculateDrawdown(path);
      const now = new Date().toISOString();
      this.database.run(
        `UPDATE ai_candidate_evaluations SET state = 'matured', target_date = $targetDate, actual_date = $actualDate, entry_price = $entryPrice, exit_price = $exitPrice, benchmark_return = 0, industry_return = 0, gross_return = $gross, net_return = $net, market_excess_return = $gross, industry_excess_return = $gross, mfe = $mfe, mae = $mae, max_drawdown = $maxDrawdown, invalidation_result = 0, data_quality = $dataQuality, updated_at = $updatedAt WHERE id = $id AND user_id = $userId AND state = 'pending'`,
        { id: evaluation.id, userId, targetDate: exit.date, actualDate: exit.date, entryPrice: entry.open, exitPrice: exit.close, gross, net: gross - 0.002, mfe, mae, maxDrawdown, dataQuality: "partial", updatedAt: now },
      );
      settled += 1;
    }
    return settled;
  }

  async runDueAutomatic(now = new Date()): Promise<void> {
    const users = this.database.all<{ id: string }>("SELECT id FROM users WHERE status = 'active'");
    const shanghaiParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
    const part = (type: string): string => shanghaiParts.find((item) => item.type === type)?.value ?? "";
    const today = `${part("year")}-${part("month")}-${part("day")}`;
    const minute = Number(part("hour")) * 60 + Number(part("minute"));
    for (const user of users) {
      const settings = this.getSettings(user.id);
      this.pruneExpiredRuns(user.id, settings.retentionDays, today);
      const [hour = 18, minuteText = 30] = settings.scheduledTime.split(":").map(Number);
      if (!settings.enabled || minute < hour * 60 + minuteText) continue;
      const state = this.settings.get(user.id, "analysis.ai-candidates.schedule-state")?.value as { lastTradeDate?: string } | undefined;
      if (state?.lastTradeDate === today) continue;
      const tradeDate = this.resolveTradeDate(user.id);
      if (tradeDate !== today) continue;
      this.settings.upsert(user.id, "analysis.ai-candidates.schedule-state", { lastTradeDate: today });
      this.start(user.id, { trigger: "scheduled", tradeDate, topN: settings.topN, strategies: settings.strategies });
    }
  }

  private async execute(userId: string, runId: string): Promise<void> {
    const row = this.database.get<RunRow>("SELECT * FROM ai_candidate_runs WHERE id = $id AND user_id = $userId", { id: runId, userId });
    if (row === undefined) return;
    this.database.run("UPDATE ai_candidate_runs SET status = 'running', started_at = $startedAt WHERE id = $id AND user_id = $userId", { id: runId, userId, startedAt: new Date().toISOString() });
    try {
      const strategies = parseJson<CandidateStrategy[]>(row.strategies_json, [...CANDIDATE_STRATEGIES]);
      const regime = this.marketRegime(row.trade_date);
      this.database.run("UPDATE ai_candidate_runs SET market_regime_json = $regime, model_snapshot_json = $modelSnapshot WHERE id = $id AND user_id = $userId", { id: runId, userId, regime: JSON.stringify(regime), modelSnapshot: JSON.stringify(this.explanationGenerator?.getModelSnapshot(userId) ?? { provider: "local", version: "deterministic-explanation-v1" }) });
      const universe = await this.buildUniverse(userId);
      if (universe.length === 0) throw errors.external("没有可用于候选分析的 A 股行情数据");
      let completedStrategies = 0;
      for (const strategy of strategies) {
        if (this.isCancelled(userId, runId)) break;
        try {
          const scored = await this.scoreUniverse(userId, row.trade_date, universe, strategy, regime);
          await this.persistItems(userId, row, scored, row.requested_top_n);
          this.appendLog(userId, runId, "info", strategy, `完成${strategyLabel(strategy)}候选评分，共 ${scored.length} 个评分项`);
        } catch (error) {
          this.appendLog(userId, runId, "error", strategy, error instanceof Error ? error.message : "候选策略执行失败");
        }
        completedStrategies += 1;
        this.database.run("UPDATE ai_candidate_runs SET progress = $progress WHERE id = $id AND user_id = $userId", { id: runId, userId, progress: Math.round((completedStrategies / strategies.length) * 90) });
      }
      await this.settle(userId);
      const cancelled = this.isCancelled(userId, runId);
      const itemCount = this.database.get<{ count: number }>("SELECT COUNT(*) AS count FROM ai_candidate_items WHERE user_id = $userId AND run_id = $runId", { userId, runId })?.count ?? 0;
      const status: CandidateRunStatus = cancelled ? "cancelled" : itemCount === 0 ? "partial" : completedStrategies < strategies.length ? "partial" : "completed";
      this.database.run("UPDATE ai_candidate_runs SET status = $status, progress = $progress, data_quality_json = $quality, completed_at = $completedAt WHERE id = $id AND user_id = $userId", { id: runId, userId, status, progress: cancelled ? 0 : 100, quality: JSON.stringify({ universeSize: universe.length, itemCount, completedStrategies }), completedAt: new Date().toISOString() });
      this.finalizeDailyRun(userId, row.trade_date, runId, status);
    } catch (error) {
      this.appendLog(userId, runId, "error", "run", error instanceof Error ? error.message : "AI 候选运行失败");
      this.database.run("UPDATE ai_candidate_runs SET status = 'failed', error_message = $errorMessage, completed_at = $completedAt WHERE id = $id AND user_id = $userId", { id: runId, userId, errorMessage: error instanceof Error ? error.message : "AI 候选运行失败", completedAt: new Date().toISOString() });
      this.finalizeDailyRun(userId, row.trade_date, runId, "failed");
    }
  }

  private async buildUniverse(userId: string): Promise<Instrument[]> {
    let instruments = this.database.all<InstrumentRow>("SELECT instruments.* FROM instruments WHERE asset_type = 'stock' ORDER BY (SELECT COUNT(*) FROM market_bars WHERE market_bars.instrument_id = instruments.id AND market_bars.timeframe = 'day') DESC, code ASC LIMIT 200", {}).map(toInstrument);
    const ids = new Set<string>();
    for (const instrument of instruments) ids.add(instrument.id);
    // The Python provider executes synchronously. Only ask for a small amount
    // of ranking data when the local universe is sparse, and bound each call so
    // an unavailable external source cannot stall a manual candidate run.
    const rankingKinds = instruments.length >= 50 ? [] : (["new_high", "uptrend"] as const);
    for (const kind of rankingKinds) {
      try {
        const result = await Promise.race([
          this.thirdParty.technical(userId, { kind }),
          Bun.sleep(900).then(() => null),
        ]);
        if (result === null) continue;
        for (const item of result.rows) if (item.instrument !== null) ids.add(item.instrument.id);
      } catch {
        // The technical service already has public/local fallbacks. A failed
        // ranking must not abort the remaining candidate strategies.
      }
    }
    instruments = [...ids]
      .map((id) => this.market.getInstrument(id))
      .filter((instrument) => (this.database.get<{ count: number }>("SELECT COUNT(*) AS count FROM market_bars WHERE instrument_id = $instrumentId AND timeframe = 'day'", { instrumentId: instrument.id })?.count ?? 0) >= 120);
    return instruments.slice(0, 200);
  }

  private getRunRow(userId: string, id: string): RunRow | undefined {
    return this.database.get<RunRow>("SELECT * FROM ai_candidate_runs WHERE id = $id AND user_id = $userId", { id, userId });
  }

  private getDailyRun(userId: string, tradeDate: string): DailyRunRow | undefined {
    return this.database.get<DailyRunRow>("SELECT * FROM ai_candidate_daily_runs WHERE user_id = $userId AND trade_date = $tradeDate", { userId, tradeDate });
  }

  private pruneExpiredRuns(userId: string, retentionDays: number, referenceDate?: string): void {
    const anchor = referenceDate ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const cutoff = addDays(anchor, -(retentionDays - 1));
    const oldRuns = this.database.all<Pick<RunRow, "trade_date" | "status">>(
      "SELECT trade_date, status FROM ai_candidate_runs WHERE user_id = $userId AND trade_date < $cutoff",
      { userId, cutoff },
    );
    const oldDates = [...new Set(oldRuns.map((run) => run.trade_date))].filter((tradeDate) =>
      oldRuns.filter((run) => run.trade_date === tradeDate).every((run) => !isActiveCandidateStatus(run.status)),
    );
    for (const tradeDate of oldDates) this.deleteDateRows(userId, tradeDate);
  }

  private deleteDateRows(userId: string, tradeDate: string): void {
    this.database.transaction(() => {
      this.database.run("DELETE FROM ai_candidate_daily_runs WHERE user_id = $userId AND trade_date = $tradeDate", { userId, tradeDate });
      this.database.run("DELETE FROM ai_candidate_runs WHERE user_id = $userId AND trade_date = $tradeDate AND status NOT IN ('queued', 'running')", { userId, tradeDate });
    });
  }

  private dailyDisplayRun(userId: string, daily: DailyRunRow): RunRow | undefined {
    const pending = daily.pending_run_id === null ? undefined : this.getRunRow(userId, daily.pending_run_id);
    if (pending !== undefined && isActiveCandidateStatus(pending.status)) return pending;
    return this.getRunRow(userId, daily.current_run_id);
  }

  private finalizeDailyRun(userId: string, tradeDate: string, runId: string, status: CandidateRunStatus): void {
    const daily = this.getDailyRun(userId, tradeDate);
    if (daily === undefined || daily.pending_run_id !== runId) return;
    const now = new Date().toISOString();
    if (isCurrentCandidateStatus(status)) {
      this.database.run(
        `UPDATE ai_candidate_daily_runs SET current_run_id = $runId, pending_run_id = NULL, updated_at = $updatedAt WHERE user_id = $userId AND trade_date = $tradeDate AND pending_run_id = $runId`,
        { userId, tradeDate, runId, updatedAt: now },
      );
    } else {
      this.database.run(
        `UPDATE ai_candidate_daily_runs SET pending_run_id = NULL, updated_at = $updatedAt WHERE user_id = $userId AND trade_date = $tradeDate AND pending_run_id = $runId`,
        { userId, tradeDate, runId, updatedAt: now },
      );
    }
  }

  private async scoreUniverse(userId: string, signalDate: string, instruments: Instrument[], strategy: CandidateStrategy, regime: MarketRegime): Promise<ScoredCandidate[]> {
    const scored: ScoredCandidate[] = [];
    for (const instrument of instruments) {
      const history = await this.market.getHistory(userId, instrument.id, "day", false, 180).catch(() => null);
      // Historical reruns may execute after later bars exist; score only the as-of snapshot.
      const bars = (history?.bars ?? []).filter((bar) => bar.date <= signalDate);
      const rejection = eligibilityReason(instrument, bars, signalDate);
      if (rejection !== null) continue;
      const latest = bars.at(-1)!;
      const returns = {
        ret5: returnOver(bars, 5),
        ret10: returnOver(bars, 10),
        ret20: returnOver(bars, 20),
        ret60: returnOver(bars, 60),
        volatility: annualizedVolatility(bars.slice(-20)),
        amount: averageAmount(bars.slice(-20)),
        volumeRatio: volumeRatio(bars),
        drawdown: drawdown(bars.slice(-60)),
      };
      if (returns.amount < 50_000_000) continue;
      const features = strategyFeatures(strategy, returns, bars);
      const threshold = regime.threshold;
      const score = roundScore(features.total);
      const evidence: Evidence[] = [
        { id: "trend-20", label: "20日涨跌", value: `${(returns.ret20 * 100).toFixed(2)}%`, source: "market-history", asOf: latest.date },
        { id: "trend-5", label: "5日涨跌", value: `${(returns.ret5 * 100).toFixed(2)}%`, source: "market-history", asOf: latest.date },
        { id: "liquidity", label: "20日均成交额", value: Math.round(returns.amount), source: "market-history", asOf: latest.date },
        { id: "volatility", label: "20日波动率", value: `${(returns.volatility * 100).toFixed(2)}%`, source: "trend-algorithm", asOf: latest.date },
      ];
      scored.push({ instrument, strategy, score, scoreSnapshot: { ...features.groups, raw: returns, threshold, signalDate }, evidence, dataQuality: bars.some((bar) => bar.amount === null || bar.amount === undefined) ? "partial" : "complete", bars });
    }
    return scored.sort((left, right) => right.score - left.score || left.instrument.code.localeCompare(right.instrument.code));
  }

  private async persistItems(userId: string, run: RunRow, scored: ScoredCandidate[], topN: number): Promise<void> {
    const selected = scored.filter((item) => item.score >= this.marketRegime(run.trade_date).threshold).slice(0, topN);
    const selectedIds = new Set(selected.map((item) => `${item.strategy}:${item.instrument.id}`));
    const now = new Date().toISOString();
    const prepared = [] as Array<{ candidate: ScoredCandidate; index: number; isSelected: boolean; id: string; explanation: CandidateExplanation | null; generated: boolean }>;
    for (const [index, candidate] of scored.entries()) {
      const isSelected = selectedIds.has(`${candidate.strategy}:${candidate.instrument.id}`);
      const local = isSelected ? localExplanation(candidate, run.trade_date, this.calendar, userId) : null;
      const generated = isSelected && this.explanationGenerator !== undefined
        ? await this.explanationGenerator.generate(userId, {
            instrument: candidate.instrument,
            strategy: candidate.strategy,
            score: candidate.score,
            scoreSnapshot: candidate.scoreSnapshot,
            evidence: candidate.evidence,
            signalDate: run.trade_date,
            fallbackValidUntil: local?.validUntil ?? run.trade_date,
            maxValidUntil: addDays(run.trade_date, 30),
          }).catch(() => null)
        : null;
      prepared.push({ candidate, index, isSelected, id: crypto.randomUUID(), explanation: generated?.explanation ?? local, generated: generated !== null });
    }
    this.database.transaction(() => {
      for (const { candidate, index, isSelected, id, explanation, generated } of prepared) {
        this.database.run(
          `INSERT INTO ai_candidate_items (id, user_id, run_id, instrument_id, strategy, rank, score, percentile, selected, score_snapshot_json, evidence_snapshot_json, explanation_json, ai_status, data_quality, rejection_reason, cycle_id, created_at)
           VALUES ($id, $userId, $runId, $instrumentId, $strategy, $rank, $score, $percentile, $selected, $scoreSnapshot, $evidenceSnapshot, $explanation, $aiStatus, $dataQuality, NULL, $cycleId, $createdAt)`,
          { id, userId, runId: run.id, instrumentId: candidate.instrument.id, strategy: candidate.strategy, rank: isSelected ? index + 1 : null, score: candidate.score, percentile: candidate.score, selected: isSelected ? 1 : 0, scoreSnapshot: JSON.stringify(candidate.scoreSnapshot), evidenceSnapshot: JSON.stringify([...candidate.evidence, { id: "signal-date", label: "信号日期", value: run.trade_date, source: "trading-calendar", asOf: run.trade_date }]), explanation: explanation === null ? null : JSON.stringify(explanation), aiStatus: generated === null ? (explanation === null ? "pending" : "local") : "completed", dataQuality: candidate.dataQuality, cycleId: null, createdAt: now },
        );
        const cycleId = isSelected ? this.findOrCreateCycle(userId, candidate, id, explanation?.validUntil ?? run.trade_date) : null;
        if (cycleId !== null) this.database.run("UPDATE ai_candidate_items SET cycle_id = $cycleId WHERE id = $id AND user_id = $userId", { cycleId, id, userId });
        for (const horizon of [5, 10, 20] as const) {
          this.database.run("INSERT OR IGNORE INTO ai_candidate_evaluations (id, user_id, item_id, cycle_id, horizon, state, data_quality, created_at, updated_at) VALUES ($id, $userId, $itemId, $cycleId, $horizon, 'pending', $dataQuality, $createdAt, $updatedAt)", { id: crypto.randomUUID(), userId, itemId: id, cycleId, horizon, dataQuality: candidate.dataQuality, createdAt: now, updatedAt: now });
        }
      }
    });
  }

  private findOrCreateCycle(userId: string, candidate: ScoredCandidate, itemId: string, validUntil: string): string {
    const existing = this.database.get<CycleRow>("SELECT * FROM ai_candidate_cycles WHERE user_id = $userId AND strategy = $strategy AND instrument_id = $instrumentId AND state IN ('waiting_entry', 'tracking') LIMIT 1", { userId, strategy: candidate.strategy, instrumentId: candidate.instrument.id });
    if (existing !== undefined) {
      this.database.run("UPDATE ai_candidate_cycles SET latest_item_id = $itemId, updated_at = $updatedAt WHERE id = $id AND user_id = $userId", { id: existing.id, userId, itemId, updatedAt: new Date().toISOString() });
      return existing.id;
    }
    const id = crypto.randomUUID();
    const signalDate = candidate.bars.at(-1)?.date ?? new Date().toISOString().slice(0, 10);
    this.database.run("INSERT INTO ai_candidate_cycles (id, user_id, strategy, instrument_id, first_item_id, latest_item_id, state, signal_date, valid_until, created_at, updated_at) VALUES ($id, $userId, $strategy, $instrumentId, $itemId, $itemId, 'waiting_entry', $signalDate, $validUntil, $createdAt, $updatedAt)", { id, userId, strategy: candidate.strategy, instrumentId: candidate.instrument.id, itemId, signalDate, validUntil, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    return id;
  }

  private marketRegime(asOf: string): MarketRegime {
    return { name: "neutral", threshold: 70, asOf, evidence: ["当前版本使用确定性中性市场状态，待指数广度快照接入后自动升级"] };
  }

  private resolveTradeDate(userId: string): string {
    const latest = this.database.get<{ date: string }>("SELECT MAX(trade_date) AS date FROM market_bars")?.date;
    if (latest !== undefined && latest !== null) return latest;
    const today = new Date().toISOString().slice(0, 10);
    const days = this.calendar.getTradeDays(userId, `${today.slice(0, 4)}-01-01`, today);
    return days.at(-1) ?? today;
  }

  private isCancelled(userId: string, runId: string): boolean {
    return (this.database.get<{ cancel_requested: number }>("SELECT cancel_requested FROM ai_candidate_runs WHERE id = $id AND user_id = $userId", { id: runId, userId })?.cancel_requested ?? 0) === 1;
  }

  private appendLog(userId: string, runId: string, level: "info" | "error", stage: string, message: string): void {
    this.database.run("INSERT INTO ai_candidate_run_logs (id, user_id, run_id, level, stage, message, context_json, created_at) VALUES ($id, $userId, $runId, $level, $stage, $message, '{}', $createdAt)", { id: crypto.randomUUID(), userId, runId, level, stage, message, createdAt: new Date().toISOString() });
  }

  private listItems(userId: string, runId: string, selectedOnly: boolean): CandidateItem[] {
    const rows = this.database.all<ItemRow>(`SELECT * FROM ai_candidate_items WHERE user_id = $userId AND run_id = $runId ${selectedOnly ? "AND selected = 1" : ""} ORDER BY strategy ASC, selected DESC, rank ASC, score DESC`, { userId, runId });
    return rows.map((row) => {
      const instrument = this.market.getInstrument(row.instrument_id);
      return { id: row.id, runId: row.run_id, strategy: row.strategy, rank: row.rank, score: row.score, percentile: row.percentile, selected: row.selected === 1, instrument: { id: instrument.id, code: instrument.code, exchange: instrument.exchange, name: instrument.name, assetType: instrument.assetType }, scoreSnapshot: parseJson(row.score_snapshot_json, {}), evidenceSnapshot: parseJson<Evidence[]>(row.evidence_snapshot_json, []), explanation: row.explanation_json === null ? null : parseJson<CandidateExplanation | null>(row.explanation_json, null), aiStatus: row.ai_status, dataQuality: row.data_quality, rejectionReason: row.rejection_reason, cycleId: row.cycle_id, createdAt: row.created_at };
    });
  }

  private toRun(row: RunRow): CandidateRun {
    return { id: row.id, trigger: row.trigger, tradeDate: row.trade_date, status: row.status, progress: row.progress, requestedTopN: row.requested_top_n, strategies: parseJson(row.strategies_json, [...CANDIDATE_STRATEGIES]), algorithmVersion: row.algorithm_version, marketRegime: parseJson(row.market_regime_json, this.marketRegime(row.trade_date)), dataQuality: parseJson(row.data_quality_json, {}), modelSnapshot: parseJson(row.model_snapshot_json, {}), errorMessage: row.error_message, createdAt: row.created_at, startedAt: row.started_at, completedAt: row.completed_at };
  }

  private toEvaluation(row: EvaluationRow): CandidateEvaluation {
    return { id: row.id, itemId: row.item_id, cycleId: row.cycle_id, horizon: row.horizon, state: row.state, targetDate: row.target_date, actualDate: row.actual_date, entryPrice: row.entry_price, exitPrice: row.exit_price, grossReturn: row.gross_return, netReturn: row.net_return, benchmarkReturn: row.benchmark_return, industryReturn: row.industry_return, marketExcessReturn: row.market_excess_return, industryExcessReturn: row.industry_excess_return, mfe: row.mfe, mae: row.mae, maxDrawdown: row.max_drawdown, invalidationResult: row.invalidation_result === null ? null : row.invalidation_result === 1, dataQuality: row.data_quality, createdAt: row.created_at, updatedAt: row.updated_at };
  }
}

function normalizeSettings(value: Partial<CandidateSettings>): CandidateSettings {
  const strategies = normalizeStrategies(value.strategies ?? defaultSettings.strategies);
  const topN = value.topN === 5 || value.topN === 20 ? value.topN : 10;
  const retentionDays = typeof value.retentionDays === "number" && Number.isFinite(value.retentionDays)
    ? clamp(Math.trunc(value.retentionDays), 1, 30)
    : defaultSettings.retentionDays;
  return { enabled: value.enabled !== false, strategies, topN, explanationValidityDays: 10, maxValidityDays: 20, scheduledTime: typeof value.scheduledTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.scheduledTime) ? value.scheduledTime : defaultSettings.scheduledTime, retentionDays };
}

function normalizeStrategies(value: CandidateStrategy[]): CandidateStrategy[] {
  const selected = [...new Set(value)].filter((item): item is CandidateStrategy => CANDIDATE_STRATEGIES.includes(item));
  return selected.length > 0 ? selected : [...CANDIDATE_STRATEGIES];
}

function isActiveCandidateStatus(status: CandidateRunStatus): boolean {
  return status === "queued" || status === "running";
}

function isCurrentCandidateStatus(status: CandidateRunStatus): boolean {
  return status === "completed" || status === "partial";
}

function isLatestCandidateStatus(status: CandidateRunStatus): boolean {
  return isActiveCandidateStatus(status) || isCurrentCandidateStatus(status);
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function toInstrument(row: InstrumentRow): Instrument {
  return { id: row.id, code: row.code, exchange: row.exchange, name: row.name, assetType: row.asset_type, createdAt: row.created_at, updatedAt: row.updated_at };
}

function eligibilityReason(instrument: Instrument, bars: PriceBar[], signalDate: string): string | null {
  if (instrument.assetType !== "stock") return "非 A 股股票";
  if (/\*?ST|退市|暂停/.test(instrument.name)) return "风险标的";
  if (bars.length < 120) return "历史行情不足 120 根";
  const latest = bars.at(-1);
  if (latest === undefined || latest.date > signalDate || daysBetween(latest.date, signalDate) > 3) return "行情数据过期";
  if (bars.slice(-20).filter((bar) => bar.volume > 0).length < 15) return "近 20 日交易覆盖不足";
  return null;
}

function strategyFeatures(strategy: CandidateStrategy, values: { ret5: number; ret10: number; ret20: number; ret60: number; volatility: number; amount: number; volumeRatio: number; drawdown: number }, bars: PriceBar[]): { total: number; groups: Record<string, number> } {
  const trend = clamp(50 + values.ret20 * 260 + values.ret60 * 120, 0, 100);
  const liquidity = clamp(40 + Math.log10(Math.max(values.amount, 1) / 50_000_000) * 25 + (values.volumeRatio - 1) * 12, 0, 100);
  const risk = clamp(80 - values.volatility * 180 - Math.abs(values.drawdown) * 80, 0, 100);
  const quality = clamp(50 + values.ret60 * 90 + risk * 0.25, 0, 100);
  const valuation = clamp(50 - values.ret20 * 100 + values.ret60 * 40, 0, 100);
  if (strategy === "trend_event") {
    const groups = { trend: trend, volumeLiquidity: liquidity, rankingConsensus: clamp(50 + values.volumeRatio * 12, 0, 100), catalyst: 50, marketFit: 50, overheatControl: risk };
    return { groups, total: groups.trend * 0.3 + groups.volumeLiquidity * 0.2 + groups.rankingConsensus * 0.15 + groups.catalyst * 0.15 + groups.marketFit * 0.1 + groups.overheatControl * 0.1 };
  }
  if (strategy === "quality_growth") {
    const groups = { profitability: quality, growth: clamp(50 + values.ret60 * 160, 0, 100), cashConversion: quality, safety: risk, trendConfirmation: trend, liquidityVolatility: (liquidity + risk) / 2 };
    return { groups, total: groups.profitability * 0.2 + groups.growth * 0.2 + groups.cashConversion * 0.15 + groups.safety * 0.15 + groups.trendConfirmation * 0.15 + groups.liquidityVolatility * 0.15 };
  }
  const groups = { industryValuation: valuation, fundamentalImprovement: quality, technicalReversal: clamp(55 - values.ret20 * 80 + values.ret5 * 110, 0, 100), eventsRisk: risk, liquidityVolatility: (liquidity + risk) / 2 };
  return { groups, total: groups.industryValuation * 0.3 + groups.fundamentalImprovement * 0.25 + groups.technicalReversal * 0.2 + groups.eventsRisk * 0.1 + groups.liquidityVolatility * 0.15 };
}

function localExplanation(candidate: ScoredCandidate, signalDate: string, calendar: TradingCalendarService, userId: string): CandidateExplanation {
  const latest = candidate.bars.at(-1)!;
  const nextDays = calendar.getTradeDays(userId, signalDate, addDays(signalDate, 40)).filter((date) => date > signalDate).slice(0, 10);
  const validUntil = nextDays.at(-1) ?? signalDate;
  const action: CandidateAction = candidate.score >= 82 ? "wait_breakout" : candidate.score >= 75 ? "observe" : "research_further";
  return { summary: `${strategyLabel(candidate.strategy)}量化评分 ${candidate.score.toFixed(1)}，仅作为研究候选。`, action, thesis: ["短周期趋势与流动性达到策略阈值", "推荐基于历史行情和确定性指标生成"], counterEvidence: ["基本面与事件数据尚未完成全量接入", "候选不代表交易指令"], referencePriceLow: Number((latest.close * 0.98).toFixed(2)), referencePriceHigh: Number((latest.close * 1.02).toFixed(2)), invalidationPrice: Number((latest.close * 0.94).toFixed(2)), validUntil, uncertainty: "中等：当前版本的基本面和事件覆盖为局部数据。", evidenceIds: candidate.evidence.map((evidence) => evidence.id) };
}

function strategyLabel(strategy: CandidateStrategy): string {
  return strategy === "trend_event" ? "趋势事件" : strategy === "quality_growth" ? "质量成长" : "低估值修复";
}

function returnOver(bars: PriceBar[], days: number): number {
  const latest = bars.at(-1);
  const start = bars.at(-(days + 1));
  return latest === undefined || start === undefined || start.close === 0 ? 0 : (latest.close - start.close) / start.close;
}

function averageAmount(bars: PriceBar[]): number {
  return bars.reduce((total, bar) => total + (bar.amount ?? bar.close * bar.volume), 0) / Math.max(1, bars.length);
}

function volumeRatio(bars: PriceBar[]): number {
  const latest = bars.at(-1)?.volume ?? 0;
  const prior = bars.slice(-21, -1).reduce((total, bar) => total + bar.volume, 0) / Math.max(1, bars.slice(-21, -1).length);
  return prior === 0 ? 1 : latest / prior;
}

function annualizedVolatility(bars: PriceBar[]): number {
  const returns = bars.slice(1).map((bar, index) => bars[index]!.close === 0 ? 0 : (bar.close - bars[index]!.close) / bars[index]!.close);
  const mean = returns.reduce((total, value) => total + value, 0) / Math.max(1, returns.length);
  return Math.sqrt(returns.reduce((total, value) => total + (value - mean) ** 2, 0) / Math.max(1, returns.length)) * Math.sqrt(252);
}

function drawdown(bars: PriceBar[]): number {
  let peak = 0;
  let max = 0;
  for (const bar of bars) { peak = Math.max(peak, bar.close); if (peak > 0) max = Math.min(max, (bar.close - peak) / peak); }
  return max;
}

function calculateDrawdown(bars: PriceBar[]): number {
  return drawdown(bars);
}

function daysBetween(from: string, to: string): number {
  return Math.max(0, Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function roundScore(value: number): number { return Math.round(clamp(value, 0, 100) * 10) / 10; }
function average(values: Array<number | null>): number | null { const valid = values.filter((value): value is number => value !== null && Number.isFinite(value)); return valid.length === 0 ? null : valid.reduce((total, value) => total + value, 0) / valid.length; }
function rate(numerator: number, denominator: number): number | null { return denominator === 0 ? null : numerator / denominator; }
