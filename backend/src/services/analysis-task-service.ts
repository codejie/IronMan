import { IronManDatabase } from "../db/database";
import { errors } from "../errors";
import { IndicatorService } from "./indicator-service";
import { MarketService } from "./market-service";
import { StrategyService } from "./strategy-service";

type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

interface TaskRow {
  id: string;
  strategy_id: string;
  status: TaskStatus;
  progress: number;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface AnalysisTask {
  id: string;
  strategyId: string;
  status: TaskStatus;
  progress: number;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export type TaskEvent = { type: "progress" | "completed" | "failed"; task: AnalysisTask };

export class AnalysisTaskService {
  private readonly listeners = new Map<string, Set<(event: TaskEvent) => void>>();

  constructor(
    private readonly database: IronManDatabase,
    private readonly strategies: StrategyService,
    private readonly market: MarketService,
    private readonly indicators: IndicatorService
  ) {}

  start(userId: string, strategyId: string): AnalysisTask {
    this.strategies.get(userId, strategyId);
    const now = new Date().toISOString();
    const row: TaskRow = { id: crypto.randomUUID(), strategy_id: strategyId, status: "queued", progress: 0, error_message: null, created_at: now, started_at: null, completed_at: null };
    this.database.run(
      `INSERT INTO analysis_tasks (id, user_id, strategy_id, status, progress, created_at)
       VALUES ($id, $userId, $strategyId, $status, $progress, $createdAt)`,
      { id: row.id, userId, strategyId, status: row.status, progress: row.progress, createdAt: now }
    );
    queueMicrotask(() => void this.run(userId, row.id));
    return this.toTask(row);
  }

  retry(userId: string, taskId: string): AnalysisTask {
    const task = this.get(userId, taskId);
    if (task.status !== "failed" && task.status !== "cancelled") {
      throw errors.validation("仅失败或已取消的任务可以重试");
    }
    return this.start(userId, task.strategyId);
  }

  list(userId: string): AnalysisTask[] {
    return this.database.all<TaskRow>("SELECT id, strategy_id, status, progress, error_message, created_at, started_at, completed_at FROM analysis_tasks WHERE user_id = $userId ORDER BY created_at DESC", { userId }).map((row) => this.toTask(row));
  }

  listReports(userId: string, taskId: string): Array<{ id: string; instrumentId: string; result: unknown; createdAt: string }> {
    const task = this.database.get<{ id: string }>("SELECT id FROM analysis_tasks WHERE id = $taskId AND user_id = $userId", { taskId, userId });
    if (task === undefined) throw errors.notFound("分析任务不存在");
    return this.database.all<{ id: string; instrument_id: string; result_json: string; created_at: string }>("SELECT id, instrument_id, result_json, created_at FROM analysis_reports WHERE task_id = $taskId AND user_id = $userId ORDER BY created_at ASC", { taskId, userId }).map((row) => ({ id: row.id, instrumentId: row.instrument_id, result: JSON.parse(row.result_json), createdAt: row.created_at }));
  }

  listLogs(userId: string, taskId: string): Array<{ id: string; level: "info" | "error"; message: string; createdAt: string }> {
    this.get(userId, taskId);
    return this.database.all<{ id: string; level: "info" | "error"; message: string; created_at: string }>("SELECT id, level, message, created_at FROM task_logs WHERE task_id = $taskId AND user_id = $userId ORDER BY created_at ASC", { taskId, userId }).map((row) => ({ id: row.id, level: row.level, message: row.message, createdAt: row.created_at }));
  }

  subscribe(taskId: string, listener: (event: TaskEvent) => void): () => void {
    const set = this.listeners.get(taskId) ?? new Set();
    set.add(listener);
    this.listeners.set(taskId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(taskId);
    };
  }

  get(userId: string, taskId: string): AnalysisTask {
    const row = this.database.get<TaskRow>("SELECT id, strategy_id, status, progress, error_message, created_at, started_at, completed_at FROM analysis_tasks WHERE id = $taskId AND user_id = $userId", { taskId, userId });
    if (row === undefined) throw errors.notFound("分析任务不存在");
    return this.toTask(row);
  }

  private async run(userId: string, taskId: string): Promise<void> {
    const initial = this.get(userId, taskId);
    this.updateTask(taskId, "running", 0, null, false);
    this.writeLog(userId, taskId, "info", "分析任务已启动");
    try {
      const strategy = this.strategies.get(userId, initial.strategyId);
      for (const [index, instrumentId] of strategy.instrumentIds.entries()) {
        const history = await this.market.getHistory(userId, instrumentId, "day", false);
        const result = { source: history.source, bars: history.bars, results: this.indicators.calculate(history.bars, strategy.indicators) };
        this.database.run(
          `INSERT INTO analysis_reports (id, user_id, task_id, instrument_id, result_json, created_at)
           VALUES ($id, $userId, $taskId, $instrumentId, $result, $createdAt)
           ON CONFLICT(task_id, instrument_id) DO UPDATE SET result_json = excluded.result_json, created_at = excluded.created_at`,
          { id: crypto.randomUUID(), userId, taskId, instrumentId, result: JSON.stringify(result), createdAt: new Date().toISOString() }
        );
        this.updateTask(taskId, "running", Math.round(((index + 1) / strategy.instrumentIds.length) * 100), null, false);
        this.writeLog(userId, taskId, "info", `已完成第 ${index + 1}/${strategy.instrumentIds.length} 个标的分析`);
      }
      this.updateTask(taskId, "completed", 100, null, true);
      this.writeLog(userId, taskId, "info", "分析任务完成");
    } catch (error) {
      const message = error instanceof Error ? error.message : "分析任务失败";
      this.updateTask(taskId, "failed", 100, message, true);
      this.writeLog(userId, taskId, "error", message);
    }
  }

  private updateTask(taskId: string, status: TaskStatus, progress: number, errorMessage: string | null, complete: boolean): void {
    const now = new Date().toISOString();
    this.database.run(
      `UPDATE analysis_tasks SET status = $status, progress = $progress, error_message = $errorMessage,
       started_at = CASE WHEN $status = 'running' AND started_at IS NULL THEN $now ELSE started_at END,
       completed_at = CASE WHEN $complete = 1 THEN $now ELSE completed_at END WHERE id = $taskId`,
      { taskId, status, progress, errorMessage, now, complete: complete ? 1 : 0 }
    );
    const row = this.database.get<TaskRow>("SELECT id, strategy_id, status, progress, error_message, created_at, started_at, completed_at FROM analysis_tasks WHERE id = $taskId", { taskId });
    if (row === undefined) return;
    const event: TaskEvent = { type: status === "completed" ? "completed" : status === "failed" ? "failed" : "progress", task: this.toTask(row) };
    this.listeners.get(taskId)?.forEach((listener) => listener(event));
  }

  private writeLog(userId: string, taskId: string, level: "info" | "error", message: string): void {
    this.database.run("INSERT INTO task_logs (id, user_id, task_id, level, message, created_at) VALUES ($id, $userId, $taskId, $level, $message, $createdAt)", { id: crypto.randomUUID(), userId, taskId, level, message, createdAt: new Date().toISOString() });
  }

  private toTask(row: TaskRow): AnalysisTask {
    return { id: row.id, strategyId: row.strategy_id, status: row.status, progress: row.progress, errorMessage: row.error_message, createdAt: row.created_at, startedAt: row.started_at, completedAt: row.completed_at };
  }
}
