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

let tempDirectory = "";
let runtime: IronManRuntime;

beforeEach(() => {
  tempDirectory = mkdtempSync(join(tmpdir(), "ironman-system-configuration-"));
  runtime = createApp({
    databasePath: join(tempDirectory, "ironman.sqlite"),
    jwtSecret: "test-secret-that-is-long-enough",
    tokenTtlSeconds: 60 * 60,
  });
});

afterEach(() => {
  runtime.close();
  rmSync(tempDirectory, { force: true, recursive: true });
});

async function post(
  path: string,
  body: unknown,
  token?: string,
): Promise<Response> {
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

describe("system configuration", () => {
  test("keeps yearly trading-calendar overrides isolated by user", async () => {
    const admin = await register("admin@example.com");
    const user = await register("user@example.com");
    const update = await post(
      "/api/settings/trading-calendar/update",
      { year: 2026, tradeDays: ["2026-01-03"] },
      user.token,
    );
    expect(update.status).toBe(200);

    const userCalendar = await post(
      "/api/settings/trading-calendar/get",
      { year: 2026 },
      user.token,
    );
    const userBody = (await userCalendar.json()) as ApiResponse<{
      tradeDays: string[];
      nonTradingDays: string[];
    }>;
    expect(userBody.result.tradeDays).toContain("2026-01-03");
    expect(userBody.result.nonTradingDays).toContain("2026-01-02");

    const adminCalendar = await post(
      "/api/settings/trading-calendar/get",
      { year: 2026 },
      admin.token,
    );
    const adminBody = (await adminCalendar.json()) as ApiResponse<{
      tradeDays: string[];
      nonTradingDays: string[];
    }>;
    expect(adminBody.result.tradeDays).toContain("2026-01-02");
    expect(adminBody.result.nonTradingDays).not.toContain("2026-01-02");
  });

  test("stores a user-scoped AI system prompt while masking API keys on reads", async () => {
    const user = await register("user@example.com");
    const anotherUser = await register("another-user@example.com");
    const response = await post(
      "/api/settings/ai/update",
      {
        systemPrompt: "仅基于本地工具返回的数据分析，并明确说明不确定性。",
        models: [
          {
            id: "deepseek",
            name: "DeepSeek",
            provider: "deepseek",
            baseUrl: "https://api.deepseek.com",
            model: "deepseek-chat",
            apiKey: "deepseek-secret",
            enabled: true,
            default: true,
          },
          {
            id: "ollama",
            name: "Ollama",
            provider: "ollama",
            baseUrl: "http://localhost:11434/v1",
            model: "qwen2.5:7b",
            enabled: true,
            default: false,
          },
        ],
      },
      user.token,
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as ApiResponse<{
      models: Array<{ id: string; apiKey?: string; apiKeyConfigured: boolean }>;
      systemPrompt: string;
      defaultSystemPrompt: string;
    }>;
    expect(body.result.models).toHaveLength(2);
    expect(body.result.models[0]).toEqual(
      expect.objectContaining({ id: "deepseek", apiKeyConfigured: true }),
    );
    expect(body.result.models[0]?.apiKey).toBeUndefined();
    expect(body.result.systemPrompt).toBe(
      "仅基于本地工具返回的数据分析，并明确说明不确定性。",
    );
    expect(body.result.defaultSystemPrompt).toContain("IronMan 数据分析工作台");

    const anotherUserConfig = await post(
      "/api/settings/ai/get",
      {},
      anotherUser.token,
    );
    const anotherUserBody = (await anotherUserConfig.json()) as ApiResponse<{
      systemPrompt: string;
    }>;
    expect(anotherUserBody.result.systemPrompt).toContain(
      "IronMan 数据分析工作台",
    );
    expect(anotherUserBody.result.systemPrompt).not.toContain(
      "仅基于本地工具返回的数据分析",
    );

    const invalid = await post(
      "/api/settings/ai/update",
      { models: body.result.models, systemPrompt: "   " },
      user.token,
    );
    expect(invalid.status).toBe(400);
  });

  test("refreshes only instruments referenced by the current user", async () => {
    const admin = await register("admin@example.com");
    const alice = await register("alice@example.com");
    const bob = await register("bob@example.com");
    const instrumentResponse = await post(
      "/api/market/instruments/upsert",
      { code: "600000", exchange: "sh", name: "浦发银行", assetType: "stock" },
      admin.token,
    );
    const instrument = (await instrumentResponse.json()) as ApiResponse<{
      id: string;
    }>;
    await post(
      "/api/settings/data-sources/update",
      { primary: "mock", fallback: "tencent" },
      alice.token,
    );
    await post(
      "/api/assets/watchlist/create",
      { instrumentId: instrument.result.id, note: "", targetPrice: null },
      alice.token,
    );

    const refreshed = await post(
      "/api/settings/market/refresh",
      {},
      alice.token,
    );
    const refreshBody = (await refreshed.json()) as ApiResponse<{
      requested: number;
      refreshed: number;
      failed: number;
    }>;
    expect(refreshBody.result).toEqual({
      requested: 1,
      refreshed: 1,
      failed: 0,
    });

    const bobRefresh = await post(
      "/api/settings/market/refresh",
      {},
      bob.token,
    );
    const bobBody = (await bobRefresh.json()) as ApiResponse<{
      requested: number;
      refreshed: number;
      failed: number;
    }>;
    expect(bobBody.result).toEqual({ requested: 0, refreshed: 0, failed: 0 });
  });

  test("allows the local AKShare provider as a user-selected data source", async () => {
    const user = await register("akshare-source@example.com");

    const update = await post(
      "/api/settings/data-sources/update",
      { primary: "akshare", fallback: "eastmoney" },
      user.token,
    );
    expect(update.status).toBe(200);

    const current = await post(
      "/api/settings/data-sources/get",
      {},
      user.token,
    );
    const body = (await current.json()) as ApiResponse<{
      primary: string;
      fallback: string;
    }>;
    expect(body.result).toEqual({ primary: "akshare", fallback: "eastmoney" });
  });

  test("stores and validates intraday snapshot settings for the current user only", async () => {
    const alice = await register("alice-snapshots@example.com");
    const bob = await register("bob-snapshots@example.com");
    const update = await post(
      "/api/settings/market-snapshots/update",
      {
        enabled: true,
        mode: "manual",
        startTime: "09:30",
        endTime: "15:00",
        intervalMinutes: 5,
        scope: "holdings_watchlist",
        retentionDays: 10,
      },
      alice.token,
    );
    expect(update.status).toBe(200);

    const aliceSettings = await post(
      "/api/settings/market-snapshots/get",
      {},
      alice.token,
    );
    expect(((await aliceSettings.json()) as ApiResponse<{ intervalMinutes: number }>).result.intervalMinutes).toBe(5);

    const bobSettings = await post(
      "/api/settings/market-snapshots/get",
      {},
      bob.token,
    );
    expect(((await bobSettings.json()) as ApiResponse<{ enabled: boolean }>).result.enabled).toBe(false);

    const invalid = await post(
      "/api/settings/market-snapshots/update",
      { enabled: true, startTime: "15:00", endTime: "09:30" },
      alice.token,
    );
    expect(invalid.status).toBe(400);
  });

  test("only administrators can clear the shared market cache", async () => {
    const admin = await register("admin@example.com");
    const user = await register("user@example.com");
    const instrumentResponse = await post(
      "/api/market/instruments/upsert",
      { code: "600001", exchange: "sh", name: "缓存测试", assetType: "stock" },
      admin.token,
    );
    const instrument = (await instrumentResponse.json()) as ApiResponse<{
      id: string;
    }>;
    await post(
      "/api/settings/data-sources/update",
      { primary: "mock", fallback: "tencent" },
      user.token,
    );
    await post(
      "/api/market/history",
      { instrumentId: instrument.result.id, timeframe: "day", refresh: true },
      user.token,
    );

    const denied = await post("/api/admin/market/cache/clear", {}, user.token);
    expect(denied.status).toBe(403);

    const cleared = await post(
      "/api/admin/market/cache/clear",
      {},
      admin.token,
    );
    const clearBody = (await cleared.json()) as ApiResponse<{
      deletedBars: number;
    }>;
    expect(clearBody.result.deletedBars).toBeGreaterThan(0);

    const overview = await post("/api/market/overview", {}, admin.token);
    const overviewBody = (await overview.json()) as ApiResponse<{
      cachedBarCount: number;
    }>;
    expect(overviewBody.result.cachedBarCount).toBe(0);
  });
});
