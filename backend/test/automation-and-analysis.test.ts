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
});
