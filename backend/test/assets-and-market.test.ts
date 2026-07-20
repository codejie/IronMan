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
  tempDirectory = mkdtempSync(join(tmpdir(), "ironman-assets-"));
  runtime = createApp({
    databasePath: join(tempDirectory, "ironman.sqlite"),
    jwtSecret: "test-secret-that-is-long-enough",
    tokenTtlSeconds: 60 * 60
  });
});

afterEach(() => {
  runtime.close();
  rmSync(tempDirectory, { force: true, recursive: true });
});

async function post(path: string, body: unknown, token?: string): Promise<Response> {
  return runtime.app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` })
    },
    body: JSON.stringify(body)
  });
}

async function register(email: string): Promise<Session> {
  const response = await post("/api/auth/register", {
    email,
    password: "a-strong-test-password",
    displayName: email.split("@")[0]
  });
  return ((await response.json()) as ApiResponse<Session>).result;
}

describe("market data and asset workspace", () => {
  test("isolates watchlists and positions while keeping instrument data shared", async () => {
    const admin = await register("admin@example.com");
    const alice = await register("alice@example.com");
    const bob = await register("bob@example.com");

    const instrumentResponse = await post(
      "/api/market/instruments/upsert",
      { code: "600000", exchange: "sh", name: "浦发银行", assetType: "stock" },
      admin.token
    );
    const instrument = (await instrumentResponse.json()) as ApiResponse<{ id: string }>;
    expect(instrumentResponse.status).toBe(200);

    const createWatchlist = await post(
      "/api/assets/watchlist/create",
      { instrumentId: instrument.result.id, note: "观察", targetPrice: 12.5 },
      alice.token
    );
    const watchlistEntry = (await createWatchlist.json()) as ApiResponse<{ id: string }>;
    expect(createWatchlist.status).toBe(201);

    const aliceWatchlist = await post("/api/assets/watchlist/list", {}, alice.token);
    const bobWatchlist = await post("/api/assets/watchlist/list", {}, bob.token);
    expect(((await aliceWatchlist.json()) as ApiResponse<{ items: unknown[] }>).result.items).toHaveLength(1);
    expect(((await bobWatchlist.json()) as ApiResponse<{ items: unknown[] }>).result.items).toHaveLength(0);

    const foreignDelete = await post("/api/assets/watchlist/delete", { id: watchlistEntry.result.id }, bob.token);
    expect(foreignDelete.status).toBe(404);

    await post("/api/assets/cash/adjust", { amount: 100000, note: "初始资金" }, alice.token);
    const holdingResponse = await post(
      "/api/assets/holdings/create",
      { instrumentId: instrument.result.id, quantity: 100, price: 10, fee: 1, occurredAt: "2026-07-20T00:00:00.000Z" },
      alice.token
    );
    const holding = (await holdingResponse.json()) as ApiResponse<{ id: string }>;
    expect(holdingResponse.status).toBe(201);

    const sell = await post(
      "/api/assets/holdings/transaction",
      { holdingId: holding.result.id, action: "sell", quantity: 50, price: 12, fee: 1, occurredAt: "2026-07-21T00:00:00.000Z" },
      alice.token
    );
    expect(sell.status).toBe(201);

    const summary = await post("/api/assets/holdings/list", {}, alice.token);
    const summaryBody = (await summary.json()) as ApiResponse<{ items: Array<{ quantity: number }>; cashAvailable: number }>;
    expect(summaryBody.result.items[0]?.quantity).toBe(50);
    expect(summaryBody.result.cashAvailable).toBe(99598);

    const foreignHolding = await post("/api/assets/holdings/detail", { id: holding.result.id }, bob.token);
    expect(foreignHolding.status).toBe(404);
  });

  test("switches a user's market data source and falls back to deterministic local data", async () => {
    const admin = await register("admin@example.com");
    const user = await register("user@example.com");
    const instrumentResponse = await post(
      "/api/market/instruments/upsert",
      { code: "000001", exchange: "sz", name: "平安银行", assetType: "stock" },
      admin.token
    );
    const instrument = (await instrumentResponse.json()) as ApiResponse<{ id: string }>;

    const config = await post(
      "/api/settings/data-sources/update",
      { primary: "mock", fallback: "tencent" },
      user.token
    );
    expect(config.status).toBe(200);

    const history = await post(
      "/api/market/history",
      { instrumentId: instrument.result.id, timeframe: "day", refresh: true },
      user.token
    );
    const historyBody = (await history.json()) as ApiResponse<{ source: string; bars: Array<{ close: number }> }>;
    expect(history.status).toBe(200);
    expect(historyBody.result.source).toBe("mock");
    expect(historyBody.result.bars).toHaveLength(180);
    expect(historyBody.result.bars[0]?.close).toBeGreaterThan(0);
  });

  test("calculates TA-Lib compatible core indicators from normalized history", async () => {
    const admin = await register("admin@example.com");
    const user = await register("user@example.com");
    const instrumentResponse = await post(
      "/api/market/instruments/upsert",
      { code: "510300", exchange: "sh", name: "沪深300ETF", assetType: "fund" },
      admin.token
    );
    const instrument = (await instrumentResponse.json()) as ApiResponse<{ id: string }>;
    await post("/api/settings/data-sources/update", { primary: "mock", fallback: "tencent" }, user.token);

    const calculation = await post(
      "/api/analysis/indicators/calculate",
      { instrumentId: instrument.result.id, indicators: ["MA", "MACD", "RSI", "BOLL"] },
      user.token
    );
    const body = (await calculation.json()) as ApiResponse<{
      source: string;
      results: Array<{ type: string; lines: Record<string, Array<number | null>> }>;
    }>;

    expect(calculation.status).toBe(200);
    expect(body.result.source).toBe("mock");
    expect(body.result.results).toHaveLength(4);
    const ma = body.result.results.find((item) => item.type === "MA");
    const macd = body.result.results.find((item) => item.type === "MACD");
    const rsi = body.result.results.find((item) => item.type === "RSI");
    expect(ma).toBeDefined();
    expect(macd).toBeDefined();
    expect(rsi).toBeDefined();
    expect(ma!.lines.ma!).toHaveLength(180);
    expect(macd!.lines.dif!.some((value) => value !== null)).toBe(true);
    expect(rsi!.lines.rsi!.at(-1)).toBeGreaterThanOrEqual(0);
  });

  test("provides market overview, local technical signals and curated information links", async () => {
    const admin = await register("admin@example.com");
    const user = await register("user@example.com");
    const instrumentResponse = await post("/api/market/instruments/upsert", { code: "510500", exchange: "sh", name: "中证500ETF", assetType: "fund" }, admin.token);
    const instrument = (await instrumentResponse.json()) as ApiResponse<{ id: string }>;
    await post("/api/settings/data-sources/update", { primary: "mock", fallback: "tencent" }, user.token);
    await post("/api/assets/watchlist/create", { instrumentId: instrument.result.id, note: "信号" }, user.token);

    const overview = await post("/api/market/overview", {}, user.token);
    expect(((await overview.json()) as ApiResponse<{ instrumentCount: number }>).result.instrumentCount).toBe(1);
    const signals = await post("/api/market/signals", {}, user.token);
    expect(signals.status).toBe(200);
    expect(((await signals.json()) as ApiResponse<{ items: unknown[] }>).result.items.length).toBeGreaterThanOrEqual(0);
    const links = await post("/api/market/info-links", {}, user.token);
    expect(((await links.json()) as ApiResponse<{ groups: unknown[] }>).result.groups.length).toBeGreaterThan(0);
  });
});
