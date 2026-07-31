import { IronManDatabase } from "../db/database";
import { errors } from "../errors";
import type { Instrument, MarketSource, PriceBar } from "../market/types";
import { MarketService } from "./market-service";
import type { AiProvider } from "./assistant-service";
import {
  summarizeTrendReport,
  TrendIndicatorService,
  type TrendDirection,
  type TrendIndicatorResult,
  type TrendRiskAssessment,
  type TrendRiskLevel,
  type TrendTurningPoint
} from "./trend-indicator-service";
import { TrendStrategyService, type TrendDateRange, type TrendStrategy } from "./trend-strategy-service";

export type TrendRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type TrendRunEventType = "progress" | "report" | "log" | "completed" | "failed" | "cancelled";

export interface TrendRun {
  id: string;
  strategyId: string;
  status: TrendRunStatus;
  progress: number;
  targetTotal: number;
  targetCompleted: number;
  errorMessage: string | null;
  cancelRequested: boolean;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  overallDirection: TrendDirection | null;
}

export interface TrendRunReport {
  id: string;
  instrumentId: string;
  aiInterpretation: Pick<TrendRunReportInterpretation, "provider" | "createdAt"> | null;
  result: {
    instrument: Pick<Instrument, "id" | "code" | "exchange" | "name" | "assetType">;
    source: MarketSource | null;
    bars: PriceBar[];
    indicators: TrendIndicatorResult[];
    direction: TrendDirection;
    turningPoints: TrendTurningPoint[];
    risk: TrendRiskAssessment;
    error: string | null;
  };
  createdAt: string;
}

export interface TrendRunReportInterpretation {
  provider: AiProvider;
  content: string;
  createdAt: string;
}

export interface TrendRunLog {
  id: string;
  level: "info" | "error";
  message: string;
  createdAt: string;
}

export interface TrendRunSummary {
  total: number;
  direction: Record<TrendDirection, number>;
  risk: Record<TrendRiskLevel, number>;
  turningPointCount: number;
  riskItems: Array<{
    reportId: string;
    instrument: TrendRunReport["result"]["instrument"];
    risk: TrendRiskAssessment;
  }>;
}

export type TrendRunEvent =
  | { type: "progress" | "completed" | "failed" | "cancelled"; run: TrendRun }
  | { type: "report"; report: TrendRunReport }
  | { type: "log"; log: TrendRunLog };

interface RunRow {
  id: string;
  strategy_id: string;
  status: TrendRunStatus;
  progress: number;
  target_total: number;
  target_completed: number;
  error_message: string | null;
  cancel_requested: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface ReportRow {
  id: string;
  instrument_id: string;
  result_json: string;
  created_at: string;
  interpretation_provider: AiProvider | null;
  interpretation_created_at: string | null;
}

interface Confirmation {
  userId: string;
  strategyId: string;
  targetIds: string[];
  expiresAt: number;
}

const allScopeConfirmationTtlMs = 5 * 60_000;
const concurrency = 3;

export class TrendRunService {
  private readonly listeners = new Map<string, Set<(event: TrendRunEvent) => void>>();
  private readonly confirmations = new Map<string, Confirmation>();

  constructor(
    private readonly database: IronManDatabase,
    private readonly strategies: TrendStrategyService,
    private readonly market: MarketService,
    private readonly indicators: TrendIndicatorService
  ) {}

  estimate(userId: string, strategyId: string): { targetTotal: number; confirmationToken: string | null; expiresAt: string | null } {
    const strategy = this.strategies.get(userId, strategyId);
    const targets = this.strategies.resolveTargets(userId, strategy);
    if (strategy.targetScope !== "all") return { targetTotal: targets.length, confirmationToken: null, expiresAt: null };
    const token = crypto.randomUUID();
    const expiresAt = Date.now() + allScopeConfirmationTtlMs;
    this.confirmations.set(token, { userId, strategyId, targetIds: targets.map((item) => item.id), expiresAt });
    return { targetTotal: targets.length, confirmationToken: token, expiresAt: new Date(expiresAt).toISOString() };
  }

  start(userId: string, strategyId: string, confirmationToken?: string): TrendRun {
    const strategy = this.strategies.get(userId, strategyId);
    const targets = this.resolveStartTargets(userId, strategy, confirmationToken);
    if (targets.length === 0) throw errors.validation("当前目标范围没有可分析标的");
    const now = new Date().toISOString();
    const row: RunRow = { id: crypto.randomUUID(), strategy_id: strategy.id, status: "queued", progress: 0, target_total: targets.length, target_completed: 0, error_message: null, cancel_requested: 0, created_at: now, started_at: null, completed_at: null };
    this.database.run(
      `INSERT INTO trend_runs (id, user_id, strategy_id, status, progress, target_total, target_completed, target_snapshot_json, error_message, cancel_requested, created_at)
       VALUES ($id, $userId, $strategyId, $status, $progress, $targetTotal, $targetCompleted, $targets, NULL, 0, $createdAt)`,
      { id: row.id, userId, strategyId: row.strategy_id, status: row.status, progress: row.progress, targetTotal: row.target_total, targetCompleted: row.target_completed, targets: JSON.stringify(targets.map((target) => target.id)), createdAt: now }
    );
    this.writeLog(userId, row.id, "info", `已排队 ${targets.length} 个标的的趋势计算`);
    queueMicrotask(() => void this.run(userId, row.id));
    return this.toRun(row, userId);
  }

  cancel(userId: string, runId: string): TrendRun {
    const run = this.get(userId, runId);
    if (run.status !== "queued" && run.status !== "running") return run;
    this.database.run("UPDATE trend_runs SET cancel_requested = 1 WHERE id = $runId AND user_id = $userId", { runId, userId });
    this.writeLog(userId, runId, "info", "已请求停止趋势计算；当前正在处理的标的完成后将停止");
    const updated = this.get(userId, runId);
    this.emit({ type: "progress", run: updated });
    return updated;
  }

  delete(userId: string, runId: string): { deleted: true } {
    const run = this.get(userId, runId);
    if (run.status === "queued" || run.status === "running") {
      throw errors.validation("运行中的趋势任务请先停止，完成后再删除");
    }
    this.database.run("DELETE FROM trend_runs WHERE id = $runId AND user_id = $userId", { runId, userId });
    this.listeners.delete(runId);
    return { deleted: true };
  }

  get(userId: string, runId: string): TrendRun {
    const row = this.database.get<RunRow>("SELECT id, strategy_id, status, progress, target_total, target_completed, error_message, cancel_requested, created_at, started_at, completed_at FROM trend_runs WHERE id = $runId AND user_id = $userId", { runId, userId });
    if (row === undefined) throw errors.notFound("趋势计算任务不存在");
    return this.toRun(row, userId);
  }

  list(userId: string, strategyId?: string): TrendRun[] {
    const rows = strategyId === undefined
      ? this.database.all<RunRow>("SELECT id, strategy_id, status, progress, target_total, target_completed, error_message, cancel_requested, created_at, started_at, completed_at FROM trend_runs WHERE user_id = $userId ORDER BY created_at DESC LIMIT 100", { userId })
      : this.database.all<RunRow>("SELECT id, strategy_id, status, progress, target_total, target_completed, error_message, cancel_requested, created_at, started_at, completed_at FROM trend_runs WHERE user_id = $userId AND strategy_id = $strategyId ORDER BY created_at DESC LIMIT 100", { userId, strategyId });
    return rows.map((row) => this.toRun(row, userId));
  }

  listReports(userId: string, runId: string): TrendRunReport[] {
    this.get(userId, runId);
    return this.database.all<ReportRow>(
      `SELECT reports.id, reports.instrument_id, reports.result_json, reports.created_at,
              interpretations.provider AS interpretation_provider,
              interpretations.created_at AS interpretation_created_at
         FROM trend_run_reports AS reports
         LEFT JOIN trend_run_report_interpretations AS interpretations ON interpretations.report_id = reports.id
        WHERE reports.user_id = $userId AND reports.run_id = $runId
        ORDER BY reports.created_at ASC`,
      { userId, runId },
    ).map((row) => this.toReport(row));
  }

  getReport(userId: string, runId: string, reportId: string): TrendRunReport {
    this.get(userId, runId);
    const row = this.database.get<ReportRow>(
      `SELECT reports.id, reports.instrument_id, reports.result_json, reports.created_at,
              interpretations.provider AS interpretation_provider,
              interpretations.created_at AS interpretation_created_at
         FROM trend_run_reports AS reports
         LEFT JOIN trend_run_report_interpretations AS interpretations ON interpretations.report_id = reports.id
        WHERE reports.id = $reportId AND reports.user_id = $userId AND reports.run_id = $runId`,
      { reportId, userId, runId }
    );
    if (row === undefined) throw errors.notFound("趋势报告不存在");
    return this.toReport(row);
  }

  getReportInterpretation(userId: string, runId: string, reportId: string): TrendRunReportInterpretation | null {
    this.getReport(userId, runId, reportId);
    const row = this.database.get<{ provider: AiProvider; content: string; created_at: string }>(
      "SELECT provider, content, created_at FROM trend_run_report_interpretations WHERE user_id = $userId AND run_id = $runId AND report_id = $reportId",
      { userId, runId, reportId },
    );
    return row === undefined ? null : { provider: row.provider, content: row.content, createdAt: row.created_at };
  }

  saveReportInterpretation(userId: string, runId: string, reportId: string, input: Pick<TrendRunReportInterpretation, "provider" | "content">): TrendRunReportInterpretation {
    this.getReport(userId, runId, reportId);
    const createdAt = new Date().toISOString();
    this.database.run(
      `INSERT INTO trend_run_report_interpretations (id, user_id, run_id, report_id, provider, content, created_at)
       VALUES ($id, $userId, $runId, $reportId, $provider, $content, $createdAt)
       ON CONFLICT(report_id) DO NOTHING`,
      { id: crypto.randomUUID(), userId, runId, reportId, provider: input.provider, content: input.content, createdAt },
    );
    return this.getReportInterpretation(userId, runId, reportId)!;
  }

  summarize(userId: string, runId: string): TrendRunSummary {
    const reports = this.listReports(userId, runId);
    const direction: Record<TrendDirection, number> = { bullish: 0, bearish: 0, neutral: 0 };
    const risk: Record<TrendRiskLevel, number> = { high: 0, medium: 0, low: 0 };
    const riskItems: TrendRunSummary["riskItems"] = [];
    let turningPointCount = 0;
    for (const report of reports) {
      if (report.result.error !== null) continue;
      direction[report.result.direction] += 1;
      risk[report.result.risk.level] += 1;
      turningPointCount += report.result.turningPoints.length;
      if (report.result.risk.level !== "low") {
        riskItems.push({ reportId: report.id, instrument: report.result.instrument, risk: report.result.risk });
      }
    }
    riskItems.sort((left, right) => riskOrder(left.risk.level) - riskOrder(right.risk.level) || left.instrument.name.localeCompare(right.instrument.name));
    return { total: reports.length, direction, risk, turningPointCount, riskItems };
  }

  listLogs(userId: string, runId: string): TrendRunLog[] {
    this.get(userId, runId);
    return this.database.all<{ id: string; level: "info" | "error"; message: string; created_at: string }>("SELECT id, level, message, created_at FROM trend_run_logs WHERE user_id = $userId AND run_id = $runId ORDER BY created_at ASC", { userId, runId }).map((row) => ({ id: row.id, level: row.level, message: row.message, createdAt: row.created_at }));
  }

  subscribe(runId: string, listener: (event: TrendRunEvent) => void): () => void {
    const set = this.listeners.get(runId) ?? new Set();
    set.add(listener);
    this.listeners.set(runId, set);
    return () => { set.delete(listener); if (set.size === 0) this.listeners.delete(runId); };
  }

  private resolveStartTargets(userId: string, strategy: TrendStrategy, confirmationToken?: string): Instrument[] {
    if (strategy.targetScope !== "all") return this.strategies.resolveTargets(userId, strategy);
    if (confirmationToken === undefined) throw errors.validation("全市场计算需要先确认目标数量");
    const confirmation = this.confirmations.get(confirmationToken);
    this.confirmations.delete(confirmationToken);
    if (confirmation === undefined || confirmation.userId !== userId || confirmation.strategyId !== strategy.id || confirmation.expiresAt < Date.now()) throw errors.validation("全市场确认已过期，请重新估算");
    return confirmation.targetIds.map((id) => this.market.getInstrument(id));
  }

  private async run(userId: string, runId: string): Promise<void> {
    try {
      const initial = this.get(userId, runId);
      const strategy = this.strategies.get(userId, initial.strategyId);
      const targetIds = JSON.parse(this.database.get<{ target_snapshot_json: string }>("SELECT target_snapshot_json FROM trend_runs WHERE id = $runId AND user_id = $userId", { runId, userId })!.target_snapshot_json) as string[];
      this.updateRun(userId, runId, "running", 0, 0, null, false);
      this.writeLog(userId, runId, "info", "趋势计算已开始");
      let next = 0;
      let completed = 0;
      const worker = async (): Promise<void> => {
        while (true) {
          if (this.isCancellationRequested(userId, runId)) return;
          const index = next;
          next += 1;
          if (index >= targetIds.length) return;
          const instrumentId = targetIds[index]!;
          await this.processInstrument(userId, runId, strategy, instrumentId);
          completed += 1;
          const progress = Math.round(completed / targetIds.length * 100);
          this.updateRun(userId, runId, "running", progress, completed, null, false);
          this.writeLog(userId, runId, "info", `已完成 ${completed}/${targetIds.length} 个标的`);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, targetIds.length) }, () => worker()));
      if (this.isCancellationRequested(userId, runId)) {
        this.updateRun(userId, runId, "cancelled", Math.round(completed / targetIds.length * 100), completed, null, true);
        this.writeLog(userId, runId, "info", "趋势计算已停止");
      } else {
        this.updateRun(userId, runId, "completed", 100, completed, null, true);
        this.writeLog(userId, runId, "info", "趋势计算完成");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "趋势计算失败";
      const run = this.get(userId, runId);
      this.updateRun(userId, runId, "failed", run.progress, run.targetCompleted, message, true);
      this.writeLog(userId, runId, "error", message);
    }
  }

  private async processInstrument(userId: string, runId: string, strategy: TrendStrategy, instrumentId: string): Promise<void> {
    const instrument = this.market.getInstrument(instrumentId);
    let report: TrendRunReport["result"];
    try {
      const range = datesForRange(strategy.dataRange);
      const history = await this.market.getHistoryRange(userId, instrumentId, "day", range.startDate, range.endDate, false);
      const results = this.indicators.calculate(history.bars, strategy.indicators);
      const assessment = summarizeTrendReport(history.bars, results, strategy.reportWindow);
      report = {
        instrument: pickInstrument(instrument),
        source: history.source,
        bars: history.bars,
        indicators: results,
        direction: assessment.direction,
        turningPoints: assessment.turningPoints,
        risk: assessment.risk,
        error: null
      };
    } catch (error) {
      const assessment = summarizeTrendReport([], []);
      report = {
        instrument: pickInstrument(instrument),
        source: null,
        bars: [],
        indicators: [],
        direction: assessment.direction,
        turningPoints: assessment.turningPoints,
        risk: assessment.risk,
        error: error instanceof Error ? error.message : "行情数据获取失败"
      };
      this.writeLog(userId, runId, "error", `${instrument.name}：${report.error}`);
    }
    const createdAt = new Date().toISOString();
    const item: TrendRunReport = { id: crypto.randomUUID(), instrumentId, result: report, createdAt };
    this.database.run(
      `INSERT INTO trend_run_reports (id, user_id, run_id, instrument_id, result_json, created_at)
       VALUES ($id, $userId, $runId, $instrumentId, $result, $createdAt)
       ON CONFLICT(run_id, instrument_id) DO UPDATE SET result_json = excluded.result_json, created_at = excluded.created_at`,
      { id: item.id, userId, runId, instrumentId, result: JSON.stringify(report), createdAt }
    );
    this.emit({ type: "report", report: item });
  }

  private isCancellationRequested(userId: string, runId: string): boolean {
    return (this.database.get<{ cancel_requested: number }>("SELECT cancel_requested FROM trend_runs WHERE id = $runId AND user_id = $userId", { runId, userId })?.cancel_requested ?? 0) === 1;
  }

  private updateRun(userId: string, runId: string, status: TrendRunStatus, progress: number, targetCompleted: number, errorMessage: string | null, completed: boolean): void {
    const now = new Date().toISOString();
    this.database.run(
      `UPDATE trend_runs SET status = $status, progress = $progress, target_completed = $targetCompleted, error_message = $errorMessage,
       started_at = CASE WHEN $status = 'running' AND started_at IS NULL THEN $now ELSE started_at END,
       completed_at = CASE WHEN $completed = 1 THEN $now ELSE completed_at END WHERE id = $runId AND user_id = $userId`,
      { userId, runId, status, progress, targetCompleted, errorMessage, now, completed: completed ? 1 : 0 }
    );
    const run = this.get(userId, runId);
    const type: TrendRunEventType = status === "completed" ? "completed" : status === "failed" ? "failed" : status === "cancelled" ? "cancelled" : "progress";
    this.emit({ type, run } as TrendRunEvent);
  }

  private writeLog(userId: string, runId: string, level: "info" | "error", message: string): void {
    const log: TrendRunLog = { id: crypto.randomUUID(), level, message, createdAt: new Date().toISOString() };
    this.database.run("INSERT INTO trend_run_logs (id, user_id, run_id, level, message, created_at) VALUES ($id, $userId, $runId, $level, $message, $createdAt)", { id: log.id, userId, runId, level, message, createdAt: log.createdAt });
    this.emit({ type: "log", log });
  }

  private emit(event: TrendRunEvent): void { const runId = event.type === "report" ? this.runIdForReport(event.report.id) : event.type === "log" ? this.runIdForLog(event.log.id) : event.run.id; if (runId === undefined) return; this.listeners.get(runId)?.forEach((listener) => listener(event)); }
  private runIdForReport(reportId: string): string | undefined { return this.database.get<{ run_id: string }>("SELECT run_id FROM trend_run_reports WHERE id = $id", { id: reportId })?.run_id; }
  private runIdForLog(logId: string): string | undefined { return this.database.get<{ run_id: string }>("SELECT run_id FROM trend_run_logs WHERE id = $id", { id: logId })?.run_id; }
  private toRun(row: RunRow, userId: string): TrendRun {
    return {
      id: row.id,
      strategyId: row.strategy_id,
      status: row.status,
      progress: row.progress,
      targetTotal: row.target_total,
      targetCompleted: row.target_completed,
      errorMessage: row.error_message,
      cancelRequested: row.cancel_requested === 1,
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      overallDirection: this.readOverallDirection(userId, row.id)
    };
  }

  private toReport(row: ReportRow): TrendRunReport {
    return {
      id: row.id,
      instrumentId: row.instrument_id,
      aiInterpretation: row.interpretation_provider === null || row.interpretation_created_at === null
        ? null
        : { provider: row.interpretation_provider, createdAt: row.interpretation_created_at },
      result: normalizeReportResult(JSON.parse(row.result_json) as TrendRunReport["result"]),
      createdAt: row.created_at,
    };
  }

  private readOverallDirection(userId: string, runId: string): TrendDirection | null {
    const directions = this.database
      .all<{ result_json: string }>("SELECT result_json FROM trend_run_reports WHERE user_id = $userId AND run_id = $runId", { userId, runId })
      .flatMap((row) => {
        try {
          const report = normalizeReportResult(JSON.parse(row.result_json) as TrendRunReport["result"]);
          return report.error === null ? [report.direction] : [];
        } catch {
          return [];
        }
      });
    if (directions.length === 0) return null;
    const score = directions.reduce((total, direction) => total + (direction === "bullish" ? 1 : direction === "bearish" ? -1 : 0), 0);
    return score > 0 ? "bullish" : score < 0 ? "bearish" : "neutral";
  }
}

function pickInstrument(instrument: Instrument): TrendRunReport["result"]["instrument"] { return { id: instrument.id, code: instrument.code, exchange: instrument.exchange, name: instrument.name, assetType: instrument.assetType }; }
function datesForRange(range: TrendDateRange): { startDate: string; endDate: string } { if (range.preset === "custom") return { startDate: range.startDate!, endDate: range.endDate! }; const end = new Date(); const months = range.preset === "3m" ? 3 : range.preset === "6m" ? 6 : range.preset === "1y" ? 12 : 24; const start = new Date(end); start.setMonth(start.getMonth() - months); return { startDate: formatDate(start), endDate: formatDate(end) }; }
function formatDate(value: Date): string { return value.toISOString().slice(0, 10); }
function normalizeReportResult(result: TrendRunReport["result"]): TrendRunReport["result"] {
  const indicators = result.indicators.map((item) => ({ ...item, turningPoints: item.turningPoints ?? [] }));
  const assessment = result.risk === undefined || result.turningPoints === undefined
    ? summarizeTrendReport(result.bars, indicators)
    : { direction: result.direction, turningPoints: result.turningPoints, risk: result.risk };
  return { ...result, indicators, direction: assessment.direction, turningPoints: assessment.turningPoints, risk: assessment.risk };
}

function riskOrder(level: TrendRiskLevel): number { return level === "high" ? 0 : level === "medium" ? 1 : 2; }
