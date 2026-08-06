import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type IronManRuntime } from "../src/app";

interface ApiResponse<T> {
  code: number;
  message?: string;
  result: T;
}

interface Session {
  token: string;
  user: { id: string; role: "admin" | "user" };
}

let directory = "";
let runtime: IronManRuntime;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "ironman-holding-diagnosis-routes-"));
  runtime = createApp({
    databasePath: join(directory, "ironman.sqlite"),
    jwtSecret: "test-secret-that-is-long-enough",
    tokenTtlSeconds: 60 * 60,
  });
});

afterEach(() => {
  runtime.close();
  rmSync(directory, { force: true, recursive: true });
});

async function post(path: string, body: unknown, token?: string): Promise<Response> {
  return runtime.app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
}

async function register(email: string): Promise<Session> {
  const response = await post("/api/auth/register", {
    email,
    password: "a-strong-test-password",
    displayName: email.split("@")[0],
  });
  return ((await response.json()) as ApiResponse<Session>).result;
}

async function waitForReport(token: string, runId: string): Promise<string> {
  let last: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await post("/api/analysis/holding-diagnosis/runs/get", { id: runId }, token);
    const body = (await response.json()) as ApiResponse<{ status: string; reportId: string | null }>;
    last = body;
    if (body.result.reportId !== null) return body.result.reportId;
    await Bun.sleep(10);
  }
  throw new Error(`holding diagnosis did not produce a report: ${JSON.stringify(last)}`);
}

describe("holding diagnosis routes", () => {
  test("stores isolated settings and serves generated reports with source URLs", async () => {
    const admin = await register("admin-diagnosis-routes@example.com");
    const alice = await register("alice-diagnosis-routes@example.com");
    const bob = await register("bob-diagnosis-routes@example.com");

    const catalogResponse = await post(
      "/api/analysis/holding-diagnosis/sources/catalog",
      {},
      alice.token,
    );
    const catalog = (await catalogResponse.json()) as ApiResponse<{
      items: Array<{ id: string }>;
    }>;
    expect(catalog.result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "market" }),
        expect.objectContaining({ id: "cninfo" }),
      ]),
    );

    const update = await post(
      "/api/analysis/holding-diagnosis/settings/update",
      {
        enabled: true,
        scheduledTime: "15:30",
        sourceIds: ["market", "cninfo"],
        reportPreference: "优先显示风险、趋势和需要进一步确认的资料。",
        lookbackTradingDays: 60,
        maxFunctionBatches: 2,
        maxExternalSourcesPerHolding: 3,
      },
      alice.token,
    );
    expect(update.status).toBe(200);

    const bobSettingsResponse = await post(
      "/api/analysis/holding-diagnosis/settings/get",
      {},
      bob.token,
    );
    const bobSettings = (await bobSettingsResponse.json()) as ApiResponse<{
      enabled: boolean;
      sourceIds: string[];
    }>;
    expect(bobSettings.result).toEqual(
      expect.objectContaining({ enabled: false, sourceIds: ["all"] }),
    );

    const instrumentResponse = await post(
      "/api/market/instruments/upsert",
      { code: "600000", exchange: "sh", name: "浦发银行", assetType: "stock" },
      admin.token,
    );
    const instrument = (await instrumentResponse.json()) as ApiResponse<{ id: string }>;
    await post("/api/settings/data-sources/update", { primary: "mock", fallback: "mock" }, alice.token);
    const adjusted = await post(
      "/api/assets/cash/adjust",
      { amount: 2_000, note: "diagnosis route test" },
      alice.token,
    );
    expect(adjusted.status).toBe(200);
    const holding = await post(
      "/api/assets/holdings/create",
      {
        instrumentId: instrument.result.id,
        quantity: 100,
        price: 10,
        fee: 0,
        occurredAt: "2026-08-03T00:00:00.000Z",
      },
      alice.token,
    );
    expect(holding.status).toBe(201);

    const startResponse = await post(
      "/api/analysis/holding-diagnosis/start",
      {},
      alice.token,
    );
    expect(startResponse.status).toBe(202);
    const start = (await startResponse.json()) as ApiResponse<{ id: string }>;
    const reportId = await waitForReport(alice.token, start.result.id);

    const reportResponse = await post(
      "/api/analysis/holding-diagnosis/reports/get",
      { id: reportId },
      alice.token,
    );
    const report = (await reportResponse.json()) as ApiResponse<{
      body: string;
      aiStatus: { state: string; model: { name: string } };
      sources: Array<{ sourceId: string; url: string; summary: string | null; highlights: string[] }>;
    }>;
    expect(report.result.body.length).toBeLessThanOrEqual(600);
    expect(report.result.aiStatus).toEqual(expect.objectContaining({ state: "local" }));
    expect(report.result.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: "cninfo",
          url: expect.stringContaining("cninfo.com.cn"),
          summary: expect.stringContaining("未读取或保存公告正文"),
          highlights: expect.arrayContaining([expect.stringContaining("仅提供检索入口")]),
        }),
      ]),
    );

    const denied = await post(
      "/api/analysis/holding-diagnosis/reports/get",
      { id: reportId },
      bob.token,
    );
    expect(denied.status).toBe(404);

    const deleted = await post(
      "/api/analysis/holding-diagnosis/reports/delete-batch",
      { reportIds: [reportId] },
      alice.token,
    );
    expect(deleted.status).toBe(200);
    expect((await deleted.json()) as ApiResponse<{ deleted: number }>).toEqual(
      expect.objectContaining({ result: { deleted: 1 } }),
    );

    const secondStartResponse = await post(
      "/api/analysis/holding-diagnosis/start",
      {},
      alice.token,
    );
    const secondStart = (await secondStartResponse.json()) as ApiResponse<{ id: string }>;
    await waitForReport(alice.token, secondStart.result.id);
    const cleared = await post(
      "/api/analysis/holding-diagnosis/reports/delete-all",
      {},
      alice.token,
    );
    expect(cleared.status).toBe(200);
    expect((await cleared.json()) as ApiResponse<{ deleted: number }>).toEqual(
      expect.objectContaining({ result: { deleted: 1 } }),
    );
  });

  test("completes a remote diagnosis after returning every tool result in a batch", async () => {
    const admin = await register("admin-diagnosis-tools@example.com");
    const alice = await register("alice-diagnosis-tools@example.com");
    const instrumentResponse = await post(
      "/api/market/instruments/upsert",
      { code: "600000", exchange: "sh", name: "浦发银行", assetType: "stock" },
      admin.token,
    );
    const instrument = (await instrumentResponse.json()) as ApiResponse<{ id: string }>;
    await post("/api/settings/data-sources/update", { primary: "mock", fallback: "mock" }, alice.token);
    const adjusted = await post(
      "/api/assets/cash/adjust",
      { amount: 2_000, note: "diagnosis tools test" },
      alice.token,
    );
    expect(adjusted.status).toBe(200);
    const holding = await post(
      "/api/assets/holdings/create",
      { instrumentId: instrument.result.id, quantity: 100, price: 10, fee: 0, occurredAt: "2026-08-03T00:00:00.000Z" },
      alice.token,
    );
    expect(holding.status).toBe(201);
    await post(
      "/api/settings/ai/update",
      {
        models: [{
          id: "diagnosis-tools",
          name: "诊断工具模型",
          provider: "deepseek",
          baseUrl: "http://diagnosis-model.local/v1",
          model: "diagnosis-test",
          apiKey: "diagnosis-test-key",
          enabled: true,
          default: true,
        }],
      },
      alice.token,
    );

    let requestCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      requestCount += 1;
      const request = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{ role: string; tool_call_id?: string }>;
        response_format?: { type?: string };
        max_tokens?: number;
      };
      expect(request.response_format).toEqual({ type: "json_object" });
      expect(request.max_tokens).toBe(3_000);
      if (requestCount === 1) {
        return Response.json({
          choices: [{
            message: {
              content: null,
              tool_calls: [
                {
                  id: "diagnosis-macd",
                  function: {
                    name: "calculate_local_algorithms",
                    arguments: JSON.stringify({
                      instrumentId: instrument.result.id,
                      selections: [{ indicatorId: "MACD" }],
                    }),
                  },
                },
                {
                  id: "diagnosis-ma",
                  function: {
                    name: "calculate_local_algorithms",
                    arguments: JSON.stringify({
                      instrumentId: instrument.result.id,
                      selections: [
                        { indicatorId: "MA", parameters: { period: 5 } },
                        { indicatorId: "MA", parameters: { period: 10 } },
                      ],
                    }),
                  },
                },
              ],
            },
          }],
        });
      }

      expect(request.messages?.filter((message) => message.role === "tool").map((message) => message.tool_call_id)).toEqual([
        "diagnosis-macd",
        "diagnosis-ma",
      ]);
      return Response.json({
        choices: [{
          message: {
            content: JSON.stringify({
              body: "趋势与波动已结合本地指标校验，建议关注关键价格附近的确认。",
              items: [{
                instrumentId: instrument.result.id,
                analysis: "本地趋势指标显示价格仍需结合后续量能确认。",
                recommendation: {
                  direction: "observe",
                  timing: "下一交易日确认后",
                  referencePriceLow: 9.8,
                  referencePriceHigh: 10.4,
                  invalidationPrice: 9.5,
                  validUntil: null,
                  uncertainty: "测试数据仅用于验证诊断工具调用流程。",
                },
              }],
            }),
          },
        }],
      });
    }) as typeof fetch;

    try {
      const started = await post("/api/analysis/holding-diagnosis/start", {}, alice.token);
      const start = (await started.json()) as ApiResponse<{ id: string }>;
      const reportId = await waitForReport(alice.token, start.result.id);
      const reportResponse = await post(
        "/api/analysis/holding-diagnosis/reports/get",
        { id: reportId },
        alice.token,
      );
      const report = (await reportResponse.json()) as ApiResponse<{
        aiStatus: { state: string; model: { id: string } };
      }>;

      expect(requestCount).toBe(2);
      expect(report.result.aiStatus).toEqual(expect.objectContaining({
        state: "completed",
        model: expect.objectContaining({ id: "diagnosis-tools" }),
      }));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
