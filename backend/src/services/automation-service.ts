import { IronManDatabase } from "../db/database";
import { errors } from "../errors";
import { AnalysisTaskService } from "./analysis-task-service";
import { MarketService } from "./market-service";
import type { MarketSnapshotService } from "./market-snapshot-service";
import type { HoldingDiagnosisService } from "./holding-diagnosis-service";
import { StrategyService } from "./strategy-service";

type ScheduleKind = "analysis" | "alert-scan";
export type AlertDirection = "above" | "below";
export type AlertRuleKind = "price_threshold" | "target_price" | "trade_plan";
export type AlertRuleSource = "manual" | "system";
export type AlertSeverity = "info" | "warning" | "risk";
export type AlertScopeType = "instrument" | "watchlist" | "holdings" | "custom";
export type AlertEventStatus = "unread" | "read" | "acknowledged" | "snoozed" | "resolved";
export type AlertSuggestionSource = "trend" | "watchlist" | "holding" | "system";
export type AlertSuggestionStatus = "pending" | "accepted" | "ignored";
export type AlertSystemMode = "off" | "suggest" | "auto";

export type AlertCondition =
  | { direction: AlertDirection; threshold: number }
  | { direction: AlertDirection; targetPrice: number }
  | { action: "buy" | "sell" | "review" | "note"; note: string; scheduledAt: string };

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

interface AlertRuleRow {
  id: string;
  user_id: string;
  name: string;
  kind: AlertRuleKind;
  source: AlertRuleSource;
  severity: AlertSeverity;
  instrument_id: string | null;
  scope_type: AlertScopeType;
  condition_json: string;
  cooldown_minutes: number;
  enabled: number;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AlertEventRow {
  id: string;
  user_id: string;
  rule_id: string | null;
  instrument_id: string | null;
  severity: AlertSeverity;
  status: AlertEventStatus;
  title: string;
  message: string;
  price: number | null;
  snapshot_json: string;
  dedupe_key: string;
  triggered_at: string;
  read_at: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  snoozed_until: string | null;
  created_at: string;
}

interface AlertSuggestionRow {
  id: string;
  user_id: string;
  source: AlertSuggestionSource;
  instrument_id: string | null;
  title: string;
  message: string;
  severity: AlertSeverity;
  rule_kind: AlertRuleKind;
  condition_json: string;
  cooldown_minutes: number;
  status: AlertSuggestionStatus;
  created_at: string;
  updated_at: string;
  accepted_at: string | null;
  ignored_at: string | null;
}

interface EvaluatedAlert {
  instrumentId: string | null;
  title: string;
  message: string;
  price: number | null;
  snapshot: Record<string, unknown>;
  dedupeKey: string;
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
  name: string;
  kind: AlertRuleKind;
  source: AlertRuleSource;
  severity: AlertSeverity;
  instrumentId: string | null;
  scopeType: AlertScopeType;
  condition: AlertCondition;
  cooldownMinutes: number;
  enabled: boolean;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
  direction: AlertDirection | null;
  threshold: number | null;
}

export interface AlertEvent {
  id: string;
  alertId: string | null;
  ruleId: string | null;
  instrumentId: string | null;
  severity: AlertSeverity;
  status: AlertEventStatus;
  title: string;
  message: string;
  price: number | null;
  snapshot: Record<string, unknown>;
  triggeredAt: string;
  readAt: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  snoozedUntil: string | null;
  createdAt: string;
}

export interface AlertSuggestion {
  id: string;
  source: AlertSuggestionSource;
  instrumentId: string | null;
  title: string;
  message: string;
  severity: AlertSeverity;
  ruleKind: AlertRuleKind;
  condition: AlertCondition;
  cooldownMinutes: number;
  status: AlertSuggestionStatus;
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
  ignoredAt: string | null;
}

export interface AlertSettings {
  systemMode: AlertSystemMode;
  defaultCooldownMinutes: number;
  autoScanEnabled: boolean;
  scanIntervalMinutes: number;
  quietHours: { start: string; end: string } | null;
}

const alertSettingsKey = "alerts.settings";
const automaticAlertScanName = "规则自动扫描";
const defaultAlertSettings: AlertSettings = {
  systemMode: "suggest",
  defaultCooldownMinutes: 60,
  autoScanEnabled: false,
  scanIntervalMinutes: 5,
  quietHours: null
};

export class AutomationService {
  constructor(
    private readonly database: IronManDatabase,
    private readonly market: MarketService,
    private readonly strategies: StrategyService,
    private readonly tasks: AnalysisTaskService,
    private readonly snapshots?: Pick<MarketSnapshotService, "captureDueAutomatic">,
    private readonly diagnosis?: Pick<HoldingDiagnosisService, "runDueAutomatic">,
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
    const instrument = this.market.getInstrument(input.instrumentId);
    const relation = input.direction === "above" ? "突破" : "跌破";
    return this.createRule(userId, {
      name: `${instrument.name} ${relation} ${formatPrice(input.threshold)}`,
      kind: "price_threshold",
      instrumentId: input.instrumentId,
      condition: { direction: input.direction, threshold: input.threshold },
      severity: "warning",
      cooldownMinutes: input.cooldownMinutes
    });
  }

  listAlerts(userId: string): AlertRule[] {
    return this.listRules(userId);
  }

  createRule(userId: string, input: { name: string; kind: AlertRuleKind; instrumentId?: string | null; condition: unknown; severity?: AlertSeverity; cooldownMinutes?: number; enabled?: boolean; source?: AlertRuleSource; scopeType?: AlertScopeType }): AlertRule {
    const now = new Date().toISOString();
    const row = this.prepareRuleRow(userId, input, now);
    this.insertRuleRow(row);
    return this.toAlertRule(row);
  }

  listRules(userId: string): AlertRule[] {
    return this.database.all<AlertRuleRow>("SELECT * FROM alert_rules WHERE user_id = $userId ORDER BY updated_at DESC", { userId }).map((row) => this.toAlertRule(row));
  }

  deleteRule(userId: string, id: string): void {
    const existing = this.database.get<{ id: string }>("SELECT id FROM alert_rules WHERE id = $id AND user_id = $userId", { id, userId });
    if (existing === undefined) throw errors.notFound("提醒规则不存在");
    this.database.run("DELETE FROM alert_rules WHERE id = $id AND user_id = $userId", { id, userId });
  }

  async evaluateAlerts(userId: string): Promise<number> {
    const rules = this.database.all<AlertRuleRow>("SELECT * FROM alert_rules WHERE user_id = $userId AND enabled = 1 ORDER BY updated_at ASC", { userId });
    let triggered = 0;
    for (const rule of rules) {
      const now = new Date();
      if (rule.last_triggered_at !== null && now.getTime() - new Date(rule.last_triggered_at).getTime() < rule.cooldown_minutes * 60_000) continue;
      const evaluated = await this.evaluateRule(userId, rule, now);
      if (evaluated === null) continue;
      const timestamp = now.toISOString();
      const dedupeKey = `${rule.id}:${evaluated.dedupeKey}`;
      const duplicate = this.database.get<{ id: string }>("SELECT id FROM alert_events WHERE user_id = $userId AND dedupe_key = $dedupeKey", { userId, dedupeKey });
      if (duplicate !== undefined) continue;
      this.database.transaction(() => {
        this.database.run("UPDATE alert_rules SET last_triggered_at = $triggeredAt, updated_at = $updatedAt WHERE id = $id AND user_id = $userId", { id: rule.id, userId, triggeredAt: timestamp, updatedAt: timestamp });
        this.database.run(
          `INSERT INTO alert_events (id, user_id, rule_id, instrument_id, severity, status, title, message, price, snapshot_json, dedupe_key, triggered_at, created_at)
           VALUES ($id, $userId, $ruleId, $instrumentId, $severity, 'unread', $title, $message, $price, $snapshot, $dedupeKey, $triggeredAt, $createdAt)`,
          {
            id: crypto.randomUUID(),
            userId,
            ruleId: rule.id,
            instrumentId: evaluated.instrumentId,
            severity: rule.severity,
            title: evaluated.title,
            message: evaluated.message,
            price: evaluated.price,
            snapshot: JSON.stringify(evaluated.snapshot),
            dedupeKey,
            triggeredAt: timestamp,
            createdAt: timestamp
          }
        );
      });
      triggered += 1;
    }
    return triggered;
  }

  listAlertEvents(userId: string, input: { status?: AlertEventStatus } = {}): AlertEvent[] {
    const rows = input.status === undefined
      ? this.database.all<AlertEventRow>("SELECT * FROM alert_events WHERE user_id = $userId ORDER BY triggered_at DESC", { userId })
      : this.database.all<AlertEventRow>("SELECT * FROM alert_events WHERE user_id = $userId AND status = $status ORDER BY triggered_at DESC", { userId, status: input.status });
    return rows.map((row) => this.toAlertEvent(row));
  }

  updateAlertEventStatus(userId: string, input: { id: string; status: AlertEventStatus; snoozedUntil?: string | null }): AlertEvent {
    const existing = this.database.get<AlertEventRow>("SELECT * FROM alert_events WHERE id = $id AND user_id = $userId", { id: input.id, userId });
    if (existing === undefined) throw errors.notFound("提醒记录不存在");
    const now = new Date().toISOString();
    if (input.status === "snoozed" && (input.snoozedUntil === undefined || input.snoozedUntil === null || Number.isNaN(Date.parse(input.snoozedUntil)))) {
      throw errors.validation("稍后提醒时间无效");
    }
    const readAt = input.status === "unread" ? null : existing.read_at ?? now;
    const acknowledgedAt = input.status === "acknowledged" ? existing.acknowledged_at ?? now : existing.acknowledged_at;
    const resolvedAt = input.status === "resolved" ? existing.resolved_at ?? now : existing.resolved_at;
    const snoozedUntil = input.status === "snoozed" ? input.snoozedUntil ?? null : existing.snoozed_until;
    this.database.run(
      `UPDATE alert_events
          SET status = $status, read_at = $readAt, acknowledged_at = $acknowledgedAt, resolved_at = $resolvedAt, snoozed_until = $snoozedUntil
        WHERE id = $id AND user_id = $userId`,
      { id: input.id, userId, status: input.status, readAt, acknowledgedAt, resolvedAt, snoozedUntil }
    );
    return this.getAlertEvent(userId, input.id);
  }

  createSuggestion(userId: string, input: { source: AlertSuggestionSource; instrumentId?: string | null; title: string; message: string; severity: AlertSeverity; ruleKind: AlertRuleKind; condition: unknown; cooldownMinutes?: number }): AlertSuggestion {
    if (input.instrumentId !== undefined && input.instrumentId !== null) this.market.getInstrument(input.instrumentId);
    const condition = this.normalizeCondition(input.ruleKind, input.condition);
    const now = new Date().toISOString();
    const row: AlertSuggestionRow = {
      id: crypto.randomUUID(),
      user_id: userId,
      source: input.source,
      instrument_id: input.instrumentId ?? null,
      title: input.title.trim(),
      message: input.message.trim(),
      severity: input.severity,
      rule_kind: input.ruleKind,
      condition_json: JSON.stringify(condition),
      cooldown_minutes: input.cooldownMinutes ?? this.getAlertSettings(userId).defaultCooldownMinutes,
      status: "pending",
      created_at: now,
      updated_at: now,
      accepted_at: null,
      ignored_at: null
    };
    if (row.title.length === 0 || row.message.length === 0) throw errors.validation("系统建议标题和内容不能为空");
    this.database.run(
      `INSERT INTO alert_suggestions (id, user_id, source, instrument_id, title, message, severity, rule_kind, condition_json, cooldown_minutes, status, created_at, updated_at)
       VALUES ($id, $userId, $source, $instrumentId, $title, $message, $severity, $ruleKind, $condition, $cooldownMinutes, $status, $createdAt, $updatedAt)`,
      { id: row.id, userId, source: row.source, instrumentId: row.instrument_id, title: row.title, message: row.message, severity: row.severity, ruleKind: row.rule_kind, condition: row.condition_json, cooldownMinutes: row.cooldown_minutes, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }
    );
    return this.toAlertSuggestion(row);
  }

  listSuggestions(userId: string, input: { status?: AlertSuggestionStatus } = {}): AlertSuggestion[] {
    const rows = input.status === undefined
      ? this.database.all<AlertSuggestionRow>("SELECT * FROM alert_suggestions WHERE user_id = $userId ORDER BY updated_at DESC", { userId })
      : this.database.all<AlertSuggestionRow>("SELECT * FROM alert_suggestions WHERE user_id = $userId AND status = $status ORDER BY updated_at DESC", { userId, status: input.status });
    return rows.map((row) => this.toAlertSuggestion(row));
  }

  acceptSuggestion(userId: string, id: string): { suggestion: AlertSuggestion; rule: AlertRule } {
    const suggestion = this.database.get<AlertSuggestionRow>("SELECT * FROM alert_suggestions WHERE id = $id AND user_id = $userId", { id, userId });
    if (suggestion === undefined) throw errors.notFound("系统建议不存在");
    if (suggestion.status !== "pending") throw errors.validation("系统建议已处理");
    const now = new Date().toISOString();
    const ruleRow = this.prepareRuleRow(userId, {
      name: suggestion.title,
      kind: suggestion.rule_kind,
      source: "system",
      severity: suggestion.severity,
      instrumentId: suggestion.instrument_id,
      condition: JSON.parse(suggestion.condition_json) as unknown,
      cooldownMinutes: suggestion.cooldown_minutes,
      enabled: true
    }, now);
    this.database.transaction(() => {
      this.insertRuleRow(ruleRow);
      this.database.run("UPDATE alert_suggestions SET status = 'accepted', accepted_at = $acceptedAt, updated_at = $updatedAt WHERE id = $id AND user_id = $userId", { id, userId, acceptedAt: now, updatedAt: now });
    });
    return { suggestion: this.getSuggestion(userId, id), rule: this.toAlertRule(ruleRow) };
  }

  getAlertSettings(userId: string): AlertSettings {
    const row = this.database.get<{ value_json: string }>("SELECT value_json FROM user_settings WHERE user_id = $userId AND setting_key = $key", { userId, key: alertSettingsKey });
    if (row === undefined) return defaultAlertSettings;
    return normalizeSettings(JSON.parse(row.value_json) as unknown);
  }

  updateAlertSettings(userId: string, input: Partial<AlertSettings>): AlertSettings {
    const next = normalizeSettings({ ...this.getAlertSettings(userId), ...input });
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.database.run(
        `INSERT INTO user_settings (id, user_id, setting_key, value_json, created_at, updated_at)
         VALUES ($id, $userId, $key, $value, $createdAt, $updatedAt)
         ON CONFLICT(user_id, setting_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
        { id: crypto.randomUUID(), userId, key: alertSettingsKey, value: JSON.stringify(next), createdAt: now, updatedAt: now }
      );
      if (input.autoScanEnabled !== undefined || input.scanIntervalMinutes !== undefined)
        this.syncAutomaticAlertScan(userId, next, now);
    });
    return next;
  }

  private syncAutomaticAlertScan(userId: string, settings: AlertSettings, now: string): void {
    const schedule = this.database.get<ScheduleRow>(
      "SELECT * FROM scheduled_jobs WHERE user_id = $userId AND kind = 'alert-scan' AND name = $name ORDER BY created_at ASC LIMIT 1",
      { userId, name: automaticAlertScanName },
    );
    const nextRunAt = new Date(new Date(now).getTime() + settings.scanIntervalMinutes * 60_000).toISOString();
    if (schedule === undefined) {
      if (!settings.autoScanEnabled) return;
      this.database.run(
        `INSERT INTO scheduled_jobs (id, user_id, name, kind, strategy_id, interval_minutes, enabled, next_run_at, created_at, updated_at)
         VALUES ($id, $userId, $name, 'alert-scan', NULL, $intervalMinutes, 1, $nextRunAt, $createdAt, $updatedAt)`,
        { id: crypto.randomUUID(), userId, name: automaticAlertScanName, intervalMinutes: settings.scanIntervalMinutes, nextRunAt, createdAt: now, updatedAt: now },
      );
      return;
    }
    this.database.run(
      "UPDATE scheduled_jobs SET interval_minutes = $intervalMinutes, enabled = $enabled, next_run_at = $nextRunAt, updated_at = $updatedAt WHERE id = $id AND user_id = $userId",
      { id: schedule.id, userId, intervalMinutes: settings.scanIntervalMinutes, enabled: settings.autoScanEnabled ? 1 : 0, nextRunAt, updatedAt: now },
    );
  }

  async runDueSchedules(): Promise<void> {
    const now = new Date();
    try {
      await this.snapshots?.captureDueAutomatic(now);
    } catch (error) {
      console.error("market snapshot schedule failed", error);
    }
    try {
      await this.diagnosis?.runDueAutomatic(now);
    } catch (error) {
      console.error("holding diagnosis schedule failed", error);
    }
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

  private prepareRuleRow(userId: string, input: { name: string; kind: AlertRuleKind; instrumentId?: string | null; condition: unknown; severity?: AlertSeverity; cooldownMinutes?: number; enabled?: boolean; source?: AlertRuleSource; scopeType?: AlertScopeType }, now: string): AlertRuleRow {
    const condition = this.normalizeCondition(input.kind, input.condition);
    const instrumentId = input.instrumentId ?? null;
    if (instrumentId !== null) this.market.getInstrument(instrumentId);
    if ((input.kind === "price_threshold" || input.kind === "target_price") && instrumentId === null) throw errors.validation("价格类提醒必须选择标的");
    const cooldownMinutes = input.cooldownMinutes ?? this.getAlertSettings(userId).defaultCooldownMinutes;
    if (!Number.isInteger(cooldownMinutes) || cooldownMinutes < 1 || cooldownMinutes > 10_080) throw errors.validation("冷却时间必须在 1 到 10080 分钟之间");
    const name = input.name.trim();
    if (name.length === 0 || name.length > 120) throw errors.validation("规则名称长度无效");
    return {
      id: crypto.randomUUID(),
      user_id: userId,
      name,
      kind: input.kind,
      source: input.source ?? "manual",
      severity: input.severity ?? "warning",
      instrument_id: instrumentId,
      scope_type: input.scopeType ?? "instrument",
      condition_json: JSON.stringify(condition),
      cooldown_minutes: cooldownMinutes,
      enabled: input.enabled === false ? 0 : 1,
      last_triggered_at: null,
      created_at: now,
      updated_at: now
    };
  }

  private insertRuleRow(row: AlertRuleRow): void {
    this.database.run(
      `INSERT INTO alert_rules (id, user_id, name, kind, source, severity, instrument_id, scope_type, condition_json, cooldown_minutes, enabled, last_triggered_at, created_at, updated_at)
       VALUES ($id, $userId, $name, $kind, $source, $severity, $instrumentId, $scopeType, $condition, $cooldownMinutes, $enabled, $lastTriggeredAt, $createdAt, $updatedAt)`,
      {
        id: row.id,
        userId: row.user_id,
        name: row.name,
        kind: row.kind,
        source: row.source,
        severity: row.severity,
        instrumentId: row.instrument_id,
        scopeType: row.scope_type,
        condition: row.condition_json,
        cooldownMinutes: row.cooldown_minutes,
        enabled: row.enabled,
        lastTriggeredAt: row.last_triggered_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    );
  }

  private async evaluateRule(userId: string, row: AlertRuleRow, now: Date): Promise<EvaluatedAlert | null> {
    const condition = JSON.parse(row.condition_json) as AlertCondition;
    if (row.kind === "trade_plan") return this.evaluateTradePlan(row, condition, now);
    if (row.instrument_id === null) return null;
    const history = await this.market.getHistory(userId, row.instrument_id, "day", false);
    const latest = history.bars.at(-1);
    if (latest === undefined) return null;
    const threshold = row.kind === "target_price" && "targetPrice" in condition ? condition.targetPrice : "threshold" in condition ? condition.threshold : null;
    if (threshold === null || !("direction" in condition)) return null;
    const match = condition.direction === "above" ? latest.close >= threshold : latest.close <= threshold;
    if (!match) return null;
    const instrument = this.market.getInstrument(row.instrument_id);
    const relation = condition.direction === "above" ? "高于" : "低于";
    return {
      instrumentId: row.instrument_id,
      title: `${instrument.name} 价格提醒`,
      message: `${instrument.name} 最新价 ${formatPrice(latest.close)} ${relation} ${formatPrice(threshold)}`,
      price: latest.close,
      snapshot: { source: history.source, latest, condition, ruleKind: row.kind },
      dedupeKey: `${row.kind}:${row.instrument_id}:${condition.direction}:${formatPrice(threshold)}:${latest.date}`
    };
  }

  private evaluateTradePlan(row: AlertRuleRow, condition: AlertCondition, now: Date): EvaluatedAlert | null {
    if (!("scheduledAt" in condition) || new Date(condition.scheduledAt).getTime() > now.getTime()) return null;
    const instrument = row.instrument_id === null ? null : this.market.getInstrument(row.instrument_id);
    const action = tradeActionLabel(condition.action);
    return {
      instrumentId: row.instrument_id,
      title: instrument === null ? `交易计划：${action}` : `${instrument.name} 交易计划`,
      message: instrument === null ? `${action}：${condition.note}` : `${instrument.name} ${action}：${condition.note}`,
      price: null,
      snapshot: { condition, ruleKind: row.kind },
      dedupeKey: `${row.kind}:${row.instrument_id ?? "none"}:${condition.action}:${condition.scheduledAt}`
    };
  }

  private normalizeCondition(kind: AlertRuleKind, condition: unknown): AlertCondition {
    if (typeof condition !== "object" || condition === null) throw errors.validation("提醒条件无效");
    const value = condition as Record<string, unknown>;
    if (kind === "price_threshold") {
      const direction = value.direction;
      const threshold = value.threshold;
      if (!isDirection(direction) || !isPositiveNumber(threshold)) throw errors.validation("价格提醒条件无效");
      return { direction, threshold };
    }
    if (kind === "target_price") {
      const direction = value.direction;
      const targetPrice = value.targetPrice;
      if (!isDirection(direction) || !isPositiveNumber(targetPrice)) throw errors.validation("目标价提醒条件无效");
      return { direction, targetPrice };
    }
    const scheduledAt = value.scheduledAt;
    const action = value.action;
    const note = typeof value.note === "string" ? value.note.trim() : "";
    if (!isTradeAction(action) || typeof scheduledAt !== "string" || Number.isNaN(Date.parse(scheduledAt)) || note.length === 0 || note.length > 500) {
      throw errors.validation("交易计划提醒条件无效");
    }
    return { action, note, scheduledAt: new Date(scheduledAt).toISOString() };
  }

  private getAlertEvent(userId: string, id: string): AlertEvent {
    const row = this.database.get<AlertEventRow>("SELECT * FROM alert_events WHERE id = $id AND user_id = $userId", { id, userId });
    if (row === undefined) throw errors.notFound("提醒记录不存在");
    return this.toAlertEvent(row);
  }

  private getSuggestion(userId: string, id: string): AlertSuggestion {
    const row = this.database.get<AlertSuggestionRow>("SELECT * FROM alert_suggestions WHERE id = $id AND user_id = $userId", { id, userId });
    if (row === undefined) throw errors.notFound("系统建议不存在");
    return this.toAlertSuggestion(row);
  }

  private toSchedule(row: ScheduleRow): ScheduledJob {
    return { id: row.id, name: row.name, kind: row.kind, strategyId: row.strategy_id, intervalMinutes: row.interval_minutes, enabled: row.enabled === 1, lastRunAt: row.last_run_at, nextRunAt: row.next_run_at, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  private toAlertRule(row: AlertRuleRow): AlertRule {
    const condition = JSON.parse(row.condition_json) as AlertCondition;
    const threshold = "threshold" in condition ? condition.threshold : "targetPrice" in condition ? condition.targetPrice : null;
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      source: row.source,
      severity: row.severity,
      instrumentId: row.instrument_id,
      scopeType: row.scope_type,
      condition,
      cooldownMinutes: row.cooldown_minutes,
      enabled: row.enabled === 1,
      lastTriggeredAt: row.last_triggered_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      direction: "direction" in condition ? condition.direction : null,
      threshold
    };
  }

  private toAlertEvent(row: AlertEventRow): AlertEvent {
    return {
      id: row.id,
      alertId: row.rule_id,
      ruleId: row.rule_id,
      instrumentId: row.instrument_id,
      severity: row.severity,
      status: row.status,
      title: row.title,
      message: row.message,
      price: row.price,
      snapshot: JSON.parse(row.snapshot_json) as Record<string, unknown>,
      triggeredAt: row.triggered_at,
      readAt: row.read_at,
      acknowledgedAt: row.acknowledged_at,
      resolvedAt: row.resolved_at,
      snoozedUntil: row.snoozed_until,
      createdAt: row.created_at
    };
  }

  private toAlertSuggestion(row: AlertSuggestionRow): AlertSuggestion {
    return {
      id: row.id,
      source: row.source,
      instrumentId: row.instrument_id,
      title: row.title,
      message: row.message,
      severity: row.severity,
      ruleKind: row.rule_kind,
      condition: JSON.parse(row.condition_json) as AlertCondition,
      cooldownMinutes: row.cooldown_minutes,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      acceptedAt: row.accepted_at,
      ignoredAt: row.ignored_at
    };
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

function isDirection(value: unknown): value is AlertDirection {
  return value === "above" || value === "below";
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isTradeAction(value: unknown): value is "buy" | "sell" | "review" | "note" {
  return value === "buy" || value === "sell" || value === "review" || value === "note";
}

function tradeActionLabel(action: "buy" | "sell" | "review" | "note"): string {
  if (action === "buy") return "买入提醒";
  if (action === "sell") return "卖出提醒";
  if (action === "review") return "复盘提醒";
  return "记录提醒";
}

function formatPrice(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function normalizeSettings(value: unknown): AlertSettings {
  if (typeof value !== "object" || value === null) return defaultAlertSettings;
  const input = value as Partial<AlertSettings>;
  const systemMode = input.systemMode === "off" || input.systemMode === "auto" || input.systemMode === "suggest" ? input.systemMode : defaultAlertSettings.systemMode;
  const defaultCooldownMinutes = Number.isInteger(input.defaultCooldownMinutes) && input.defaultCooldownMinutes! >= 1 && input.defaultCooldownMinutes! <= 10_080 ? input.defaultCooldownMinutes! : defaultAlertSettings.defaultCooldownMinutes;
  const autoScanEnabled = typeof input.autoScanEnabled === "boolean" ? input.autoScanEnabled : defaultAlertSettings.autoScanEnabled;
  const scanIntervalMinutes = Number.isInteger(input.scanIntervalMinutes) && input.scanIntervalMinutes! >= 1 && input.scanIntervalMinutes! <= 10_080 ? input.scanIntervalMinutes! : defaultAlertSettings.scanIntervalMinutes;
  const quietHours = input.quietHours === null || input.quietHours === undefined ? null : isQuietHours(input.quietHours) ? input.quietHours : null;
  return { systemMode, defaultCooldownMinutes, autoScanEnabled, scanIntervalMinutes, quietHours };
}

function isQuietHours(value: unknown): value is { start: string; end: string } {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<{ start: string; end: string }>;
  return isClockTime(item.start) && isClockTime(item.end);
}

function isClockTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
