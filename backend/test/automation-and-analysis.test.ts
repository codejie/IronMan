import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type IronManRuntime } from "../src/app";

interface ApiResponse<T> { code: number; result: T; message?: string }
interface Session { token: string }

let tempDirectory = "";
let runtime: IronManRuntime;

beforeEach(() => {
  tempDirectory = mkdtempSync(join(tmpdir(), "ironman-automation-"));
  runtime = createApp({ databasePath: join(tempDirectory, "ironman.sqlite"), jwtSecret: "test-secret-that-is-long-enough", tokenTtlSeconds: 3600 });
});

afterEach(() => { runtime.close(); rmSync(tempDirectory, { force: true, recursive: true }); });

async function post(path: string, body: unknown, token?: string): Promise<Response> {
  return runtime.app.request(path, { method: "POST", headers: { "content-type": "application/json", ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) }, body: JSON.stringify(body) });
}

async function register(email: string): Promise<Session> {
  const response = await post("/api/auth/register", { email, password: "a-strong-test-password", displayName: email.split("@")[0] });
  return ((await response.json()) as ApiResponse<Session>).result;
}

async function waitForTask(token: string, taskId: string): Promise<{ status: string }> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await post("/api/analysis/tasks/list", {}, token);
    const task = ((await response.json()) as ApiResponse<{ items: Array<{ id: string; status: string }> }>).result.items.find((item) => item.id === taskId);
    if (task?.status === "completed" || task?.status === "failed") return task;
    await Bun.sleep(15);
  }
  throw new Error("analysis task did not finish");
}

describe("strategy analysis and automation", () => {
  test("runs a user-owned analysis strategy and records reports", async () => {
    const admin = await register("admin@example.com");
    const alice = await register("alice@example.com");
    const bob = await register("bob@example.com");
    const instrumentResponse = await post("/api/market/instruments/upsert", { code: "000300", exchange: "sh", name: "沪深300", assetType: "index" }, admin.token);
    const instrument = (await instrumentResponse.json()) as ApiResponse<{ id: string }>;
    await post("/api/settings/data-sources/update", { primary: "mock", fallback: "tencent" }, alice.token);

    const strategyResponse = await post(
      "/api/analysis/strategies/create",
      { name: "趋势观察", instrumentIds: [instrument.result.id], indicators: ["MA", "RSI"] },
      alice.token
    );
    const strategy = (await strategyResponse.json()) as ApiResponse<{ id: string }>;
    expect(strategyResponse.status).toBe(201);

    const forbidden = await post("/api/analysis/tasks/start", { strategyId: strategy.result.id }, bob.token);
    expect(forbidden.status).toBe(404);

    const start = await post("/api/analysis/tasks/start", { strategyId: strategy.result.id }, alice.token);
    const task = (await start.json()) as ApiResponse<{ id: string }>;
    expect(start.status).toBe(202);
    expect((await waitForTask(alice.token, task.result.id)).status).toBe("completed");

    const reports = await post("/api/analysis/reports/list", { taskId: task.result.id }, alice.token);
    const reportBody = (await reports.json()) as ApiResponse<{ items: Array<{ instrumentId: string; result: { results: unknown[] } }> }>;
    expect(reports.status).toBe(200);
    expect(reportBody.result.items).toHaveLength(1);
    expect(reportBody.result.items[0]?.result.results).toHaveLength(2);

    const logs = await post("/api/analysis/tasks/logs/list", { taskId: task.result.id }, alice.token);
    const logBody = (await logs.json()) as ApiResponse<{ items: Array<{ level: string; message: string }> }>;
    expect(logs.status).toBe(200);
    expect(logBody.result.items.some((item) => item.level === "info" && item.message.includes("完成"))).toBe(true);
  });

  test("persists schedules and emits deduplicated user alert events", async () => {
    const admin = await register("admin@example.com");
    const alice = await register("alice@example.com");
    const bob = await register("bob@example.com");
    const instrumentResponse = await post("/api/market/instruments/upsert", { code: "159919", exchange: "sz", name: "沪深300ETF", assetType: "fund" }, admin.token);
    const instrument = (await instrumentResponse.json()) as ApiResponse<{ id: string }>;
    await post("/api/settings/data-sources/update", { primary: "mock", fallback: "tencent" }, alice.token);

    const schedule = await post("/api/automation/schedules/create", { name: "每日策略", kind: "analysis", intervalMinutes: 30, strategyId: null }, alice.token);
    expect(schedule.status).toBe(201);
    const schedules = await post("/api/automation/schedules/list", {}, alice.token);
    expect(((await schedules.json()) as ApiResponse<{ items: unknown[] }>).result.items).toHaveLength(1);

    const alertResponse = await post(
      "/api/automation/alerts/create",
      { instrumentId: instrument.result.id, direction: "above", threshold: 0.01, cooldownMinutes: 60 },
      alice.token
    );
    const alert = (await alertResponse.json()) as ApiResponse<{ id: string }>;
    expect(alertResponse.status).toBe(201);

    const evaluation = await post("/api/automation/alerts/evaluate", {}, alice.token);
    expect(((await evaluation.json()) as ApiResponse<{ triggered: number }>).result.triggered).toBe(1);
    const repeat = await post("/api/automation/alerts/evaluate", {}, alice.token);
    expect(((await repeat.json()) as ApiResponse<{ triggered: number }>).result.triggered).toBe(0);

    const events = await post("/api/automation/alerts/events/list", {}, alice.token);
    expect(((await events.json()) as ApiResponse<{ items: Array<{ alertId: string }> }>).result.items[0]?.alertId).toBe(alert.result.id);
    const foreignEvents = await post("/api/automation/alerts/events/list", {}, bob.token);
    expect(((await foreignEvents.json()) as ApiResponse<{ items: unknown[] }>).result.items).toHaveLength(0);
  });

  test("manages generic alert rules, reminder state, settings and system suggestions", async () => {
    const admin = await register("admin-rules@example.com");
    const alice = await register("alice-rules@example.com");
    const bob = await register("bob-rules@example.com");
    const instrumentResponse = await post("/api/market/instruments/upsert", { code: "510300", exchange: "sh", name: "沪深300ETF", assetType: "fund" }, admin.token);
    const instrument = (await instrumentResponse.json()) as ApiResponse<{ id: string }>;
    await post("/api/settings/data-sources/update", { primary: "mock", fallback: "tencent" }, alice.token);

    const settings = await post("/api/automation/alerts/settings/get", {}, alice.token);
    expect(settings.status).toBe(200);
    const defaultSettings = (await settings.json()) as ApiResponse<{ systemMode: string; autoScanEnabled: boolean; scanIntervalMinutes: number }>;
    expect(defaultSettings.result.systemMode).toBe("suggest");
    expect(defaultSettings.result.autoScanEnabled).toBe(false);
    expect(defaultSettings.result.scanIntervalMinutes).toBe(5);

    const updatedSettings = await post("/api/automation/alerts/settings/update", { systemMode: "auto", defaultCooldownMinutes: 120, autoScanEnabled: true, scanIntervalMinutes: 15 }, alice.token);
    expect(updatedSettings.status).toBe(200);
    const updatedSettingsBody = (await updatedSettings.json()) as ApiResponse<{ defaultCooldownMinutes: number; autoScanEnabled: boolean; scanIntervalMinutes: number }>;
    expect(updatedSettingsBody.result.defaultCooldownMinutes).toBe(120);
    expect(updatedSettingsBody.result.autoScanEnabled).toBe(true);
    expect(updatedSettingsBody.result.scanIntervalMinutes).toBe(15);

    const scanSchedules = await post("/api/automation/schedules/list", {}, alice.token);
    const scanScheduleBody = (await scanSchedules.json()) as ApiResponse<{ items: Array<{ kind: string; intervalMinutes: number; enabled: boolean }> }>;
    expect(scanScheduleBody.result.items.some((schedule) => schedule.kind === "alert-scan" && schedule.intervalMinutes === 15 && schedule.enabled)).toBe(true);

    const disabledSettings = await post("/api/automation/alerts/settings/update", { autoScanEnabled: false }, alice.token);
    expect(disabledSettings.status).toBe(200);
    const disabledSchedules = await post("/api/automation/schedules/list", {}, alice.token);
    const disabledScheduleBody = (await disabledSchedules.json()) as ApiResponse<{ items: Array<{ kind: string; enabled: boolean }> }>;
    expect(disabledScheduleBody.result.items.some((schedule) => schedule.kind === "alert-scan" && schedule.enabled === false)).toBe(true);

    const ruleResponse = await post(
      "/api/automation/alerts/rules/create",
      {
        name: "突破观察",
        kind: "price_threshold",
        instrumentId: instrument.result.id,
        condition: { direction: "above", threshold: 0.01 },
        severity: "warning",
        cooldownMinutes: 60
      },
      alice.token
    );
    expect(ruleResponse.status).toBe(201);
    const rule = (await ruleResponse.json()) as ApiResponse<{ id: string; kind: string; source: string; condition: { direction: string; threshold: number } }>;
    expect(rule.result.kind).toBe("price_threshold");
    expect(rule.result.source).toBe("manual");
    expect(rule.result.condition.direction).toBe("above");

    const evaluation = await post("/api/automation/alerts/evaluate", {}, alice.token);
    expect(((await evaluation.json()) as ApiResponse<{ triggered: number }>).result.triggered).toBe(1);

    const events = await post("/api/automation/alerts/events/list", { status: "unread" }, alice.token);
    const eventBody = (await events.json()) as ApiResponse<{ items: Array<{ id: string; ruleId: string; status: string; title: string; severity: string }> }>;
    expect(events.status).toBe(200);
    expect(eventBody.result.items[0]?.ruleId).toBe(rule.result.id);
    expect(eventBody.result.items[0]?.status).toBe("unread");
    expect(eventBody.result.items[0]?.title).toContain("沪深300ETF");

    const acknowledged = await post("/api/automation/alerts/events/update-status", { id: eventBody.result.items[0]?.id, status: "acknowledged" }, alice.token);
    expect(acknowledged.status).toBe(200);
    const acknowledgedBody = (await acknowledged.json()) as ApiResponse<{ status: string; readAt: string | null; acknowledgedAt: string | null }>;
    expect(acknowledgedBody.result.status).toBe("acknowledged");
    expect(acknowledgedBody.result.readAt).not.toBeNull();
    expect(acknowledgedBody.result.acknowledgedAt).not.toBeNull();

    const foreignEvents = await post("/api/automation/alerts/events/list", {}, bob.token);
    expect(((await foreignEvents.json()) as ApiResponse<{ items: unknown[] }>).result.items).toHaveLength(0);

    const foreignDelete = await post("/api/automation/alerts/rules/delete", { id: rule.result.id }, bob.token);
    expect(foreignDelete.status).toBe(404);

    const deleted = await post("/api/automation/alerts/rules/delete", { id: rule.result.id }, alice.token);
    expect(deleted.status).toBe(200);
    expect(((await deleted.json()) as ApiResponse<{ deleted: boolean }>).result.deleted).toBe(true);

    const remainingRules = await post("/api/automation/alerts/rules/list", {}, alice.token);
    expect(((await remainingRules.json()) as ApiResponse<{ items: unknown[] }>).result.items).toHaveLength(0);
    const retainedEvents = await post("/api/automation/alerts/events/list", {}, alice.token);
    const retainedEventBody = (await retainedEvents.json()) as ApiResponse<{ items: Array<{ ruleId: string | null }> }>;
    expect(retainedEventBody.result.items).toHaveLength(1);
    expect(retainedEventBody.result.items[0]?.ruleId).toBeNull();

    const suggestionResponse = await post(
      "/api/automation/alerts/suggestions/create",
      {
        source: "trend",
        instrumentId: instrument.result.id,
        title: "趋势风险提醒",
        message: "趋势计算发现关键价位需要观察",
        severity: "risk",
        ruleKind: "price_threshold",
        condition: { direction: "below", threshold: 0.02 },
        cooldownMinutes: 240
      },
      alice.token
    );
    expect(suggestionResponse.status).toBe(201);
    const suggestion = (await suggestionResponse.json()) as ApiResponse<{ id: string; status: string }>;
    expect(suggestion.result.status).toBe("pending");

    const foreignSuggestions = await post("/api/automation/alerts/suggestions/list", {}, bob.token);
    expect(((await foreignSuggestions.json()) as ApiResponse<{ items: unknown[] }>).result.items).toHaveLength(0);

    const accepted = await post("/api/automation/alerts/suggestions/accept", { id: suggestion.result.id }, alice.token);
    expect(accepted.status).toBe(200);
    const acceptedBody = (await accepted.json()) as ApiResponse<{ suggestion: { status: string }; rule: { source: string; severity: string } }>;
    expect(acceptedBody.result.suggestion.status).toBe("accepted");
    expect(acceptedBody.result.rule.source).toBe("system");
    expect(acceptedBody.result.rule.severity).toBe("risk");
  });
});
