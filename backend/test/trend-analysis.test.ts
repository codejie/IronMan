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
  tempDirectory = mkdtempSync(join(tmpdir(), "ironman-trend-"));
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
async function waitForRun(token: string, runId: string): Promise<{ status: string }> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await post("/api/analysis/trend/runs/get", { runId }, token);
    const run = ((await response.json()) as ApiResponse<{ status: string }>).result;
    if (["completed", "failed", "cancelled"].includes(run.status)) return run;
    await Bun.sleep(20);
  }
  throw new Error("trend run did not finish");
}

describe("trend analysis", () => {
  test("keeps strategies and reports isolated while persisting an executed custom run", async () => {
    const admin = await register("admin@example.com");
    const alice = await register("alice@example.com");
    const bob = await register("bob@example.com");
    const instrumentResponse = await post("/api/market/instruments/upsert", { code: "000300", exchange: "sh", name: "沪深300", assetType: "index" }, admin.token);
    const instrument = (await instrumentResponse.json()) as ApiResponse<{ id: string }>;
    await post("/api/settings/data-sources/update", { primary: "mock", fallback: "tencent" }, alice.token);

    const created = await post("/api/analysis/trend/strategies/create", {
      name: "趋势观察",
      targetScope: "custom",
      dataRange: { preset: "3m" },
      reportWindow: "7d",
      customInstrumentIds: [instrument.result.id],
      indicators: [{ indicatorId: "MA", parameters: { period: 20 } }, { indicatorId: "MACD" }, { indicatorId: "RSI" }]
    }, alice.token);
    expect(created.status).toBe(201);
    const strategy = (await created.json()) as ApiResponse<{ id: string; indicators: unknown[] }>;
    expect(strategy.result.indicators).toHaveLength(3);

    const hidden = await post("/api/analysis/trend/strategies/get", { id: strategy.result.id }, bob.token);
    expect(hidden.status).toBe(404);

    const targets = await post("/api/analysis/trend/strategies/targets/list", { strategyId: strategy.result.id }, alice.token);
    const targetsBody = (await targets.json()) as ApiResponse<{ targetScope: string; items: Array<{ instrument: { id: string; code: string }; currentPrice: number | null }> }>;
    expect(targets.status).toBe(200);
    expect(targetsBody.result.targetScope).toBe("custom");
    expect(targetsBody.result.items).toHaveLength(1);
    expect(targetsBody.result.items[0]).toMatchObject({ instrument: { id: instrument.result.id, code: "000300" } });
    expect(targetsBody.result.items[0]?.currentPrice).toBeGreaterThan(0);

    const started = await post("/api/analysis/trend/runs/start", { strategyId: strategy.result.id }, alice.token);
    expect(started.status).toBe(202);
    const run = (await started.json()) as ApiResponse<{ id: string }>;
    expect((await waitForRun(alice.token, run.result.id)).status).toBe("completed");

    const reports = await post("/api/analysis/trend/reports/list", { runId: run.result.id }, alice.token);
    const reportBody = (await reports.json()) as ApiResponse<{ items: Array<{ id: string; result: { bars: unknown[]; indicators: unknown[]; risk: { evidence: string[]; reminder: { threshold: number } | null }; error: string | null } }> }>;
    expect(reports.status).toBe(200);
    expect(reportBody.result.items).toHaveLength(1);
    expect(reportBody.result.items[0]?.result.bars.length).toBeGreaterThan(0);
    expect(reportBody.result.items[0]?.result.indicators).toHaveLength(3);
    expect(reportBody.result.items[0]?.result.risk.evidence.length).toBeGreaterThan(0);
    expect(reportBody.result.items[0]?.result.error).toBeNull();

    const summary = await post("/api/analysis/trend/runs/summary", { runId: run.result.id }, alice.token);
    const summaryBody = (await summary.json()) as ApiResponse<{ total: number; risk: { high: number; medium: number; low: number }; turningPointCount: number }>;
    expect(summary.status).toBe(200);
    expect(summaryBody.result.total).toBe(1);
    expect(summaryBody.result.risk.high + summaryBody.result.risk.medium + summaryBody.result.risk.low).toBe(1);

    const runs = await post("/api/analysis/trend/runs/list", { strategyId: strategy.result.id }, alice.token);
    const runsBody = (await runs.json()) as ApiResponse<{ items: Array<{ id: string; overallDirection: "bullish" | "bearish" | "neutral" | null }> }>;
    expect(runs.status).toBe(200);
    expect(runsBody.result.items.find((item) => item.id === run.result.id)?.overallDirection).not.toBeNull();

    const interpretation = await post("/api/analysis/trend/reports/interpret", { runId: run.result.id, reportId: reportBody.result.items[0]!.id }, alice.token);
    const interpretationBody = (await interpretation.json()) as ApiResponse<{ provider: string; content: string }>;
    expect(interpretation.status).toBe(200);
    expect(interpretationBody.result.content.length).toBeGreaterThan(0);

    const privateReports = await post("/api/analysis/trend/reports/list", { runId: run.result.id }, bob.token);
    expect(privateReports.status).toBe(404);
    const privateInterpretation = await post("/api/analysis/trend/reports/interpret", { runId: run.result.id, reportId: reportBody.result.items[0]!.id }, bob.token);
    expect(privateInterpretation.status).toBe(404);

    const privateDelete = await post("/api/analysis/trend/runs/delete", { runId: run.result.id }, bob.token);
    expect(privateDelete.status).toBe(404);
    const deleted = await post("/api/analysis/trend/runs/delete", { runId: run.result.id }, alice.token);
    expect(deleted.status).toBe(200);
    expect(((await deleted.json()) as ApiResponse<{ deleted: boolean }>).result.deleted).toBe(true);
    const removedReports = await post("/api/analysis/trend/reports/list", { runId: run.result.id }, alice.token);
    expect(removedReports.status).toBe(404);
  });

  test("requires an explicit estimate confirmation for all-instruments runs", async () => {
    const admin = await register("admin2@example.com");
    const alice = await register("alice2@example.com");
    const instrumentResponse = await post("/api/market/instruments/upsert", { code: "510300", exchange: "sh", name: "沪深300ETF", assetType: "fund" }, admin.token);
    const instrument = (await instrumentResponse.json()) as ApiResponse<{ id: string }>;
    expect(instrument.result.id).toBeDefined();
    await post("/api/settings/data-sources/update", { primary: "mock", fallback: "tencent" }, alice.token);
    const created = await post("/api/analysis/trend/strategies/create", { name: "全市场", targetScope: "all", dataRange: { preset: "3m" }, reportWindow: "all", indicators: [{ indicatorId: "BOLL" }] }, alice.token);
    const strategy = (await created.json()) as ApiResponse<{ id: string }>;
    const blocked = await post("/api/analysis/trend/runs/start", { strategyId: strategy.result.id }, alice.token);
    expect(blocked.status).toBe(400);
    const estimate = await post("/api/analysis/trend/runs/estimate", { strategyId: strategy.result.id }, alice.token);
    const estimateBody = (await estimate.json()) as ApiResponse<{ targetTotal: number; confirmationToken: string | null }>;
    expect(estimateBody.result.targetTotal).toBeGreaterThan(0);
    expect(estimateBody.result.confirmationToken).not.toBeNull();
    const started = await post("/api/analysis/trend/runs/start", { strategyId: strategy.result.id, confirmationToken: estimateBody.result.confirmationToken }, alice.token);
    expect(started.status).toBe(202);
  });

  test("replays a terminal event when subscribing after a run has completed", async () => {
    const admin = await register("admin-stream@example.com");
    const alice = await register("alice-stream@example.com");
    const instrumentResponse = await post("/api/market/instruments/upsert", { code: "000001", exchange: "sz", name: "平安银行", assetType: "stock" }, admin.token);
    const instrument = (await instrumentResponse.json()) as ApiResponse<{ id: string }>;
    await post("/api/settings/data-sources/update", { primary: "mock", fallback: "tencent" }, alice.token);
    const created = await post("/api/analysis/trend/strategies/create", {
      name: "SSE 完成回放",
      targetScope: "custom",
      dataRange: { preset: "3m" },
      reportWindow: "7d",
      customInstrumentIds: [instrument.result.id],
      indicators: [{ indicatorId: "MA", parameters: { period: 20 } }]
    }, alice.token);
    const strategy = (await created.json()) as ApiResponse<{ id: string }>;
    const started = await post("/api/analysis/trend/runs/start", { strategyId: strategy.result.id }, alice.token);
    const run = (await started.json()) as ApiResponse<{ id: string }>;
    expect((await waitForRun(alice.token, run.result.id)).status).toBe("completed");

    const response = await runtime.app.request(`/api/analysis/trend/runs/${run.result.id}/events?token=${encodeURIComponent(alice.token)}`);
    const events = await response.text();
    expect(events).toContain("event: snapshot");
    expect(events).toContain("event: completed");
  });
});
