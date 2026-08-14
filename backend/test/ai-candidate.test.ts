import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type IronManRuntime } from "../src/app";

interface ApiResponse<T> { code: number; result: T; message?: string }
interface Session { token: string }

let directory = "";
let runtime: IronManRuntime;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "ironman-ai-candidate-"));
  runtime = createApp({ databasePath: join(directory, "ironman.sqlite"), jwtSecret: "test-secret-that-is-long-enough", tokenTtlSeconds: 3600 });
});

afterEach(() => {
  runtime.close();
  rmSync(directory, { force: true, recursive: true });
});

async function post<T>(path: string, body: unknown, token?: string): Promise<{ response: Response; body: ApiResponse<T> }> {
  const response = await runtime.app.request(path, { method: "POST", headers: { "content-type": "application/json", ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) }, body: JSON.stringify(body) });
  return { response, body: (await response.json()) as ApiResponse<T> };
}

async function register(email: string): Promise<Session> {
  const result = await post<Session>("/api/auth/register", { email, password: "a-strong-test-password", displayName: email.split("@")[0] });
  expect(result.response.status).toBe(201);
  return result.body.result;
}

function seedHistory(instrumentId: string, tradeDate: string): void {
  const database = new Database(join(directory, "ironman.sqlite"), { strict: true });
  const base = Date.parse(`${tradeDate}T00:00:00Z`);
  for (let index = 209; index >= -30; index -= 1) {
    const date = new Date(base - index * 86_400_000).toISOString().slice(0, 10);
    const close = 10 + (209 - index) * 0.12;
    database.query(
      `INSERT INTO market_bars (id, instrument_id, timeframe, source, trade_date, open, close, high, low, volume, amount, turnover_rate, created_at)
       VALUES ($id, $instrumentId, 'day', 'mock', $date, $open, $close, $high, $low, $volume, $amount, 3.2, $createdAt)`,
    ).run({ id: crypto.randomUUID(), instrumentId, date, open: close * 0.995, close, high: close * 1.01, low: close * 0.99, volume: 50_000_000, amount: 500_000_000, createdAt: new Date().toISOString() });
  }
  database.close();
}

async function waitForRun(token: string, id: string): Promise<ApiResponse<{ run: { id: string; status: string } }>> {
  let last: ApiResponse<{ run: { id: string; status: string } }> | null = null;
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const result = await post<{ run: { id: string; status: string } }>("/api/analysis/ai-candidates/runs/detail", { id }, token);
    last = result.body;
    if (["completed", "partial", "failed", "cancelled"].includes(result.body.result.run.status)) return result.body;
    await Bun.sleep(20);
  }
  throw new Error(`AI candidate run did not finish: ${JSON.stringify(last)}`);
}

describe("AI candidate research workspace", () => {
  test("creates a deterministic trend candidate, stores evidence, and evaluates 5/10/20 horizons", async () => {
    const admin = await register("admin@example.com");
    const alice = await register("alice@example.com");
    const bob = await register("bob@example.com");
    const instrument = await post<{ id: string }>("/api/market/instruments/upsert", { code: "600000", exchange: "sh", name: "浦发银行", assetType: "stock" }, admin.token);
    const tradeDate = "2026-08-11";
    seedHistory(instrument.body.result.id, tradeDate);

    const settings = await post<{ topN: number }>("/api/analysis/ai-candidates/settings/get", {}, alice.token);
    expect(settings.response.status).toBe(200);
    expect(settings.body.result.topN).toBe(10);

    const started = await post<{ id: string; status: string }>("/api/analysis/ai-candidates/runs/create", { tradeDate, topN: 5, strategies: ["trend_event"] }, alice.token);
    expect(started.response.status).toBe(202);
    const run = await waitForRun(alice.token, started.body.result.id);
    expect(run.result.run.status).toBe("completed");

    const detail = await post<{ items: Array<{ selected: boolean; explanation: { action: string } | null; evidenceSnapshot: unknown[] }>; evaluations: Array<{ horizon: number; state: string; entryPrice: number | null; exitPrice: number | null }> }>("/api/analysis/ai-candidates/runs/detail", { id: started.body.result.id }, alice.token);
    expect(detail.response.status).toBe(200);
    expect(detail.body.result.items).toHaveLength(1);
    expect(detail.body.result.items[0]?.selected).toBe(true);
    expect(detail.body.result.items[0]?.explanation?.action).toBeDefined();
    expect(detail.body.result.items[0]?.evidenceSnapshot.length).toBeGreaterThan(0);
    expect(detail.body.result.evaluations.filter((evaluation) => evaluation.state === "matured")).toHaveLength(3);
    expect(detail.body.result.evaluations.every((evaluation) => evaluation.entryPrice !== null && evaluation.exitPrice !== null)).toBe(true);

    const latest = await post<{ items: unknown[] }>("/api/analysis/ai-candidates/latest", { tradeDate }, alice.token);
    expect(latest.body.result.items).toHaveLength(1);
    const noThresholdDatabase = new Database(join(directory, "ironman.sqlite"), { strict: true });
    noThresholdDatabase.query("UPDATE ai_candidate_items SET selected = 0 WHERE run_id = $runId").run({ runId: started.body.result.id });
    noThresholdDatabase.close();
    const fallbackLatest = await post<{ items: unknown[] }>("/api/analysis/ai-candidates/latest", { tradeDate }, alice.token);
    expect(fallbackLatest.body.result.items).toHaveLength(1);
    const noDateLatest = await post<{ run: { tradeDate: string } | null; items: unknown[] }>("/api/analysis/ai-candidates/latest", {}, alice.token);
    expect(noDateLatest.body.result.run).toBeNull();
    const refreshed = await post<{ id: string; status: string }>("/api/analysis/ai-candidates/runs/create", { tradeDate, topN: 5, strategies: ["trend_event"] }, alice.token);
    expect(refreshed.body.result.id).not.toBe(started.body.result.id);
    const refreshedRun = await waitForRun(alice.token, refreshed.body.result.id);
    expect(refreshedRun.result.run.status).toBe("completed");
    const dailyHistory = await post<{ items: Array<{ id: string; tradeDate: string }> }>("/api/analysis/ai-candidates/runs/list", {}, alice.token);
    expect(dailyHistory.body.result.items.filter((item) => item.tradeDate === tradeDate)).toHaveLength(1);
    expect(dailyHistory.body.result.items.find((item) => item.tradeDate === tradeDate)?.id).toBe(refreshed.body.result.id);
    const refreshedLatest = await post<{ run: { id: string } | null; items: unknown[] }>("/api/analysis/ai-candidates/latest", { tradeDate }, alice.token);
    expect(refreshedLatest.body.result.run?.id).toBe(refreshed.body.result.id);
    const otherDate = await post<{ id: string; status: string }>("/api/analysis/ai-candidates/runs/create", { tradeDate: "2026-08-12", topN: 5, strategies: ["trend_event"] }, alice.token);
    const otherDateRun = await waitForRun(alice.token, otherDate.body.result.id);
    expect(otherDateRun.result.run.status).toBe("completed");
    const stillToday = await post<{ run: { tradeDate: string } | null; items: unknown[] }>("/api/analysis/ai-candidates/latest", { tradeDate }, alice.token);
    expect(stillToday.body.result.run?.tradeDate).toBe(tradeDate);
    const foreign = await post("/api/analysis/ai-candidates/runs/detail", { id: started.body.result.id }, bob.token);
    expect(foreign.response.status).toBe(404);

    const summary = await post<{ horizons: Record<string, { total: number }> }>("/api/analysis/ai-candidates/evaluations/summary", {}, alice.token);
    expect(summary.response.status).toBe(200);
    expect(summary.body.result.horizons["5"]?.total).toBe(2);
    expect(summary.body.result.horizons["10"]?.total).toBe(2);
    expect(summary.body.result.horizons["20"]?.total).toBe(2);

    const deletedOtherDate = await post<{ deleted: true }>("/api/analysis/ai-candidates/runs/delete", { tradeDate: "2026-08-12" }, alice.token);
    expect(deletedOtherDate.response.status).toBe(200);
    const afterOtherDelete = await post<{ items: Array<{ tradeDate: string }> }>("/api/analysis/ai-candidates/runs/list", {}, alice.token);
    expect(afterOtherDelete.body.result.items.some((item) => item.tradeDate === "2026-08-12")).toBe(false);
    const deletedCurrentDate = await post<{ deleted: true }>("/api/analysis/ai-candidates/runs/delete", { tradeDate }, alice.token);
    expect(deletedCurrentDate.response.status).toBe(200);
    const deletedDetail = await post("/api/analysis/ai-candidates/runs/detail", { id: refreshed.body.result.id }, alice.token);
    expect(deletedDetail.response.status).toBe(404);
  }, 30_000);

  test("does not expose another user's candidate settings or history", async () => {
    const alice = await register("alice-isolated@example.com");
    const bob = await register("bob-isolated@example.com");
    const updated = await post<{ topN: number }>("/api/analysis/ai-candidates/settings/update", { topN: 20 }, alice.token);
    expect(updated.body.result.topN).toBe(20);
    const retentionUpdated = await post<{ retentionDays: number }>("/api/analysis/ai-candidates/settings/update", { retentionDays: 7 }, alice.token);
    expect(retentionUpdated.body.result.retentionDays).toBe(7);
    const bobSettings = await post<{ topN: number }>("/api/analysis/ai-candidates/settings/get", {}, bob.token);
    expect(bobSettings.body.result.topN).toBe(10);
    expect((await post<{ retentionDays: number }>("/api/analysis/ai-candidates/settings/get", {}, bob.token)).body.result.retentionDays).toBe(30);
    const runs = await post<{ items: unknown[] }>("/api/analysis/ai-candidates/runs/list", {}, bob.token);
    expect(runs.body.result.items).toHaveLength(0);
  });

  test("prunes date records outside the configured retention window", async () => {
    const alice = await register("retention@example.com");
    const updated = await post<{ retentionDays: number }>("/api/analysis/ai-candidates/settings/update", { retentionDays: 1 }, alice.token);
    expect(updated.body.result.retentionDays).toBe(1);
    const oldRun = await post<{ id: string }>("/api/analysis/ai-candidates/runs/create", { tradeDate: "2026-08-13", strategies: ["trend_event"] }, alice.token);
    await waitForRun(alice.token, oldRun.body.result.id);
    const currentRun = await post<{ id: string }>("/api/analysis/ai-candidates/runs/create", { tradeDate: "2026-08-14", strategies: ["trend_event"] }, alice.token);
    await waitForRun(alice.token, currentRun.body.result.id);
    const records = await post<{ items: Array<{ tradeDate: string }> }>("/api/analysis/ai-candidates/runs/list", {}, alice.token);
    expect(records.body.result.items.map((item) => item.tradeDate)).toEqual(["2026-08-14"]);
  });
});
