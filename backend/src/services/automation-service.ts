import { IronManDatabase } from "../db/database";
import { errors } from "../errors";
import { AnalysisTaskService } from "./analysis-task-service";
import { MarketService } from "./market-service";
import { StrategyService } from "./strategy-service";

type ScheduleKind = "analysis" | "alert-scan";
type AlertDirection = "above" | "below";

interface ScheduleRow {
  id: string;
  name: string;
  kind: ScheduleKind;
  strategy_id: string | null;
  interval_minutes: number;
  enabled: number;
  last_run_at: string | null;
  next_run_at: string;
  created_at: string;
  updated_at: string;
  user_id?: string;
}

interface AlertRow {
  id: string;
  instrument_id: string;
  direction: AlertDirection;
  threshold: number;
  cooldown_minutes: number;
  enabled: number;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduledJob {
  id: string;
  name: string;
  kind: ScheduleKind;
  strategyId: string | null;
  intervalMinutes: number;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AlertRule {
  id: string;
  instrumentId: string;
  direction: AlertDirection;
  threshold: number;
  cooldownMinutes: number;
  enabled: boolean;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export class AutomationService {
  constructor(
    private readonly database: IronManDatabase,
    private readonly market: MarketService,
    private readonly strategies: StrategyService,
    private readonly tasks: AnalysisTaskService
  ) {}

  createSchedule(userId: string, input: { name: string; kind: ScheduleKind; intervalMinutes: number; strategyId: string | null }): ScheduledJob {
    if (input.kind === "analysis" && input.strategyId !== null) this.strategies.get(userId, input.strategyId);
    if (input.kind === "alert-scan" && input.strategyId !== null) throw errors.validation("告警扫描计划不能绑定策略");
    const now = new Date();
    const row: ScheduleRow = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      kind: input.kind,
      strategy_id: input.strategyId,
      interval_minutes: input.intervalMinutes,
      enabled: 1,
      last_run_at: null,
      next_run_at: new Date(now.getTime() + input.intervalMinutes * 60_000).toISOString(),
      created_at: now.toISOString(),
      updated_at: now.toISOString()
    };
    this.database.run(
      `INSERT INTO scheduled_jobs (id, user_id, name, kind, strategy_id, interval_minutes, enabled, next_run_at, created_at, updated_at)
       VALUES ($id, $userId, $name, $kind, $strategyId, $intervalMinutes, $enabled, $nextRunAt, $createdAt, $updatedAt)`,
      { id: row.id, userId, name: row.name, kind: row.kind, strategyId: row.strategy_id, intervalMinutes: row.interval_minutes, enabled: row.enabled, nextRunAt: row.next_run_at, createdAt: row.created_at, updatedAt: row.updated_at }
    );
    return this.toSchedule(row);
  }

  listSchedules(userId: string): ScheduledJob[] {
    return this.database.all<ScheduleRow>("SELECT * FROM scheduled_jobs WHERE user_id = $userId ORDER BY updated_at DESC", { userId }).map((row) => this.toSchedule(row));
  }

  createAlert(userId: string, input: { instrumentId: string; direction: AlertDirection; threshold: number; cooldownMinutes: number }): AlertRule {
    this.market.getInstrument(input.instrumentId);
    const now = new Date().toISOString();
    const row: AlertRow = { id: crypto.randomUUID(), instrument_id: input.instrumentId, direction: input.direction, threshold: input.threshold, cooldown_minutes: input.cooldownMinutes, enabled: 1, last_triggered_at: null, created_at: now, updated_at: now };
    this.database.run(
      `INSERT INTO alerts (id, user_id, instrument_id, direction, threshold, cooldown_minutes, enabled, created_at, updated_at)
       VALUES ($id, $userId, $instrumentId, $direction, $threshold, $cooldownMinutes, $enabled, $createdAt, $updatedAt)`,
      { id: row.id, userId, instrumentId: row.instrument_id, direction: row.direction, threshold: row.threshold, cooldownMinutes: row.cooldown_minutes, enabled: row.enabled, createdAt: now, updatedAt: now }
    );
    return this.toAlert(row);
  }

  listAlerts(userId: string): AlertRule[] {
    return this.database.all<AlertRow>("SELECT * FROM alerts WHERE user_id = $userId ORDER BY updated_at DESC", { userId }).map((row) => this.toAlert(row));
  }

  async evaluateAlerts(userId: string): Promise<number> {
    const alerts = this.database.all<AlertRow>("SELECT * FROM alerts WHERE user_id = $userId AND enabled = 1 ORDER BY updated_at ASC", { userId });
    let triggered = 0;
    for (const alert of alerts) {
      const now = new Date();
      if (alert.last_triggered_at !== null && now.getTime() - new Date(alert.last_triggered_at).getTime() < alert.cooldown_minutes * 60_000) continue;
      const history = await this.market.getHistory(userId, alert.instrument_id, "day", false);
      const latest = history.bars.at(-1);
      if (latest === undefined) continue;
      const match = alert.direction === "above" ? latest.close >= alert.threshold : latest.close <= alert.threshold;
      if (!match) continue;
      const instrument = this.market.getInstrument(alert.instrument_id);
      const timestamp = now.toISOString();
      const relation = alert.direction === "above" ? "高于" : "低于";
      this.database.transaction(() => {
        this.database.run("UPDATE alerts SET last_triggered_at = $triggeredAt, updated_at = $updatedAt WHERE id = $id AND user_id = $userId", { id: alert.id, userId, triggeredAt: timestamp, updatedAt: timestamp });
        this.database.run("INSERT INTO alert_events (id, user_id, alert_id, price, message, created_at) VALUES ($id, $userId, $alertId, $price, $message, $createdAt)", { id: crypto.randomUUID(), userId, alertId: alert.id, price: latest.close, message: `${instrument.name} 最新价 ${latest.close} ${relation} ${alert.threshold}`, createdAt: timestamp });
      });
      triggered += 1;
    }
    return triggered;
  }

  listAlertEvents(userId: string): Array<{ id: string; alertId: string; price: number; message: string; createdAt: string }> {
    return this.database.all<{ id: string; alert_id: string; price: number; message: string; created_at: string }>("SELECT id, alert_id, price, message, created_at FROM alert_events WHERE user_id = $userId ORDER BY created_at DESC", { userId }).map((row) => ({ id: row.id, alertId: row.alert_id, price: row.price, message: row.message, createdAt: row.created_at }));
  }

  async runDueSchedules(): Promise<void> {
    const now = new Date();
    const due = this.database.transaction(() => {
      const rows = this.database.all<ScheduleRow>("SELECT * FROM scheduled_jobs WHERE enabled = 1 AND next_run_at <= $now ORDER BY next_run_at ASC", { now: now.toISOString() });
      for (const row of rows) {
        const nextRunAt = new Date(now.getTime() + row.interval_minutes * 60_000).toISOString();
        this.database.run("UPDATE scheduled_jobs SET last_run_at = $now, next_run_at = $nextRunAt, updated_at = $now WHERE id = $id AND enabled = 1", { id: row.id, now: now.toISOString(), nextRunAt });
      }
      return rows;
    });
    for (const schedule of due) {
      try {
        if (schedule.kind === "analysis" && schedule.strategy_id !== null && schedule.user_id !== undefined) this.tasks.start(schedule.user_id, schedule.strategy_id);
        if (schedule.kind === "alert-scan" && schedule.user_id !== undefined) await this.evaluateAlerts(schedule.user_id);
      } catch (error) {
        console.error("scheduled job failed", schedule.id, error);
      }
    }
  }

  private toSchedule(row: ScheduleRow): ScheduledJob {
    return { id: row.id, name: row.name, kind: row.kind, strategyId: row.strategy_id, intervalMinutes: row.interval_minutes, enabled: row.enabled === 1, lastRunAt: row.last_run_at, nextRunAt: row.next_run_at, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  private toAlert(row: AlertRow): AlertRule {
    return { id: row.id, instrumentId: row.instrument_id, direction: row.direction, threshold: row.threshold, cooldownMinutes: row.cooldown_minutes, enabled: row.enabled === 1, lastTriggeredAt: row.last_triggered_at, createdAt: row.created_at, updatedAt: row.updated_at };
  }
}

export class AutomationScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly automation: AutomationService) {}

  start(): void {
    if (this.timer !== undefined) return;
    void this.automation.runDueSchedules();
    this.timer = setInterval(() => void this.automation.runDueSchedules(), 30_000);
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }
}
