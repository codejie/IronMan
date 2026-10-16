import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type IronManRuntime } from "../src/app";
import { IronManDatabase } from "../src/db/database";
import type { MarketDataProvider } from "../src/market/types";
import { MarketService } from "../src/services/market-service";
import { SettingsService } from "../src/services/settings-service";

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

  test("returns the requested chart range and rejects limits beyond the supported maximum", async () => {
    const admin = await register("chart-admin@example.com");
    const user = await register("chart-user@example.com");
    const instrumentResponse = await post(
      "/api/market/instruments/upsert",
      { code: "600519", exchange: "sh", name: "贵州茅台", assetType: "stock" },
      admin.token
    );
    const instrument = (await instrumentResponse.json()) as ApiResponse<{ id: string }>;
    await post("/api/settings/data-sources/update", { primary: "mock", fallback: "tencent" }, user.token);

    const history = await post(
      "/api/market/history",
      { instrumentId: instrument.result.id, timeframe: "day", refresh: true, limit: 520 },
      user.token
    );
    const historyBody = (await history.json()) as ApiResponse<{ bars: Array<{ date: string }> }>;
    expect(history.status).toBe(200);
    expect(historyBody.result.bars).toHaveLength(520);

    const indicators = await post(
      "/api/analysis/indicators/calculate",
      { instrumentId: instrument.result.id, indicators: ["MACD"], limit: 520 },
      user.token
    );
    const indicatorsBody = (await indicators.json()) as ApiResponse<{ bars: unknown[]; results: Array<{ type: string; lines: Record<string, unknown[]> }> }>;
    expect(indicators.status).toBe(200);
    expect(indicatorsBody.result.bars).toHaveLength(520);
    expect(indicatorsBody.result.results[0]).toMatchObject({ type: "MACD" });
    expect(indicatorsBody.result.results[0]?.lines.dif).toHaveLength(520);
    expect(indicatorsBody.result.results[0]?.lines.dea).toHaveLength(520);
    expect(indicatorsBody.result.results[0]?.lines.hist).toHaveLength(520);

    const invalid = await post(
      "/api/market/history",
      { instrumentId: instrument.result.id, timeframe: "day", limit: 641 },
      user.token
    );
    expect(invalid.status).toBe(400);
  });

  test("reuses a fallback-source cache before trying an unavailable primary source", async () => {
    const database = new IronManDatabase(join(tempDirectory, "market-cache.sqlite"));
    try {
      const userId = crypto.randomUUID();
      const now = new Date().toISOString();
      database.run(
        "INSERT INTO users (id, email, password_hash, display_name, role, status, created_at, updated_at) VALUES ($id, $email, $passwordHash, $displayName, 'user', 'active', $createdAt, $updatedAt)",
        { id: userId, email: "cache@example.com", passwordHash: "not-used", displayName: "cache", createdAt: now, updatedAt: now }
      );
      const unavailablePrimary: MarketDataProvider = { source: "tencent", history: async () => { throw new Error("unavailable"); } };
      let fallbackCalls = 0;
      const fallback: MarketDataProvider = {
        source: "mock",
        history: async () => {
          fallbackCalls += 1;
          return [
            { date: "2026-01-01", open: 10, close: 11, high: 12, low: 9, volume: 100 },
            { date: "2026-01-02", open: 11, close: 12, high: 13, low: 10, volume: 120 }
          ];
        }
      };
      const settings = new SettingsService(database);
      const market = new MarketService(database, settings, [unavailablePrimary, fallback]);
      const instrument = market.upsertInstrument({ code: "600001", exchange: "sh", name: "缓存测试", assetType: "stock" });
      market.setDataSourceConfig(userId, { primary: "tencent", fallback: "mock" });

      const refreshed = await market.getHistory(userId, instrument.id, "day", true, 2);
      const cached = await market.getHistory(userId, instrument.id, "day", false, 2);
      expect(refreshed.source).toBe("mock");
      expect(cached.source).toBe("mock");
      expect(cached.bars).toHaveLength(2);
      expect(fallbackCalls).toBe(1);
    } finally {
      database.close();
    }
  });

  test("maintains Batman-style holding child records with cash rollback and closed records", async () => {
    const admin = await register("admin@example.com");
    const alice = await register("alice@example.com");
    const bob = await register("bob@example.com");
    const instrumentResponse = await post(
      "/api/market/instruments/upsert",
      { code: "600519", exchange: "sh", name: "贵州茅台", assetType: "stock" },
      admin.token
    );
    const instrument = (await instrumentResponse.json()) as ApiResponse<{ id: string }>;
    await post("/api/settings/data-sources/update", { primary: "mock", fallback: "tencent" }, alice.token);
    await post("/api/assets/cash/adjust", { amount: 10000, note: "本金" }, alice.token);

    const createResponse = await post(
      "/api/assets/holdings/create",
      { instrumentId: instrument.result.id, quantity: 100, price: 10, fee: 0, occurredAt: "2026-01-01T00:00:00.000Z" },
      alice.token
    );
    const holding = (await createResponse.json()) as ApiResponse<{ id: string }>;
    expect(createResponse.status).toBe(201);

    const interest = await post(
      "/api/assets/holdings/transaction",
      { holdingId: holding.result.id, action: "interest", quantity: 100, price: 0.5, fee: 0, occurredAt: "2026-01-02T00:00:00.000Z", note: "分红" },
      alice.token
    );
    const interestBody = (await interest.json()) as ApiResponse<{ id: string }>;
    expect(interest.status).toBe(201);

    const partialSell = await post(
      "/api/assets/holdings/transaction",
      { holdingId: holding.result.id, action: "sell", quantity: 25, price: 12, fee: 0, occurredAt: "2026-01-03T00:00:00.000Z" },
      alice.token
    );
    const partialSellBody = (await partialSell.json()) as ApiResponse<{ id: string }>;
    expect(partialSell.status).toBe(201);

    const detail = await post("/api/assets/holdings/detail", { id: holding.result.id }, alice.token);
    const detailBody = (await detail.json()) as ApiResponse<{ holding: { quantity: number; cost: number }; transactions: Array<{ action: string; quantity: number; price: number; fee: number; cashImpact: number }> }>;
    expect(detailBody.result.holding.quantity).toBe(75);
    expect(detailBody.result.holding.cost).toBe(650);
    expect(detailBody.result.transactions.map((transaction) => transaction.action)).toEqual(["sell", "interest", "buy"]);
    expect(detailBody.result.transactions[0]?.quantity).toBe(-25);
    expect(detailBody.result.transactions[1]).toMatchObject({ action: "interest", quantity: 100, price: 0.5, fee: 0, cashImpact: 50 });

    const foreignDelete = await post(
      "/api/assets/holdings/transaction/delete",
      { holdingId: holding.result.id, transactionId: interestBody.result.id },
      bob.token
    );
    expect(foreignDelete.status).toBe(404);

    const removeInterest = await post(
      "/api/assets/holdings/transaction/delete",
      { holdingId: holding.result.id, transactionId: interestBody.result.id },
      alice.token
    );
    expect(removeInterest.status).toBe(200);
    const removePartialSell = await post(
      "/api/assets/holdings/transaction/delete",
      { holdingId: holding.result.id, transactionId: partialSellBody.result.id },
      alice.token
    );
    expect(removePartialSell.status).toBe(200);

    const close = await post(
      "/api/assets/holdings/transaction",
      { holdingId: holding.result.id, action: "sell", quantity: 100, price: 11, fee: 0, occurredAt: "2026-01-04T00:00:00.000Z" },
      alice.token
    );
    expect(close.status).toBe(201);

    const workspace = await post("/api/assets/holdings/workspace", { refresh: false }, alice.token);
    const workspaceBody = (await workspace.json()) as ApiResponse<{ active: unknown[]; closed: Array<{ id: string }>; summary: { principal: number; profit: number } }>;
    expect(workspace.status).toBe(200);
    expect(workspaceBody.result.active).toHaveLength(0);
    expect(workspaceBody.result.closed.map((item) => item.id)).toContain(holding.result.id);
    expect(workspaceBody.result.summary.principal).toBe(10000);
    expect(workspaceBody.result.summary.profit).toBe(100);

    const deleteHolding = await post("/api/assets/holdings/delete", { id: holding.result.id }, alice.token);
    expect(deleteHolding.status).toBe(200);
    const cash = await post("/api/assets/cash/summary", {}, alice.token);
    expect(((await cash.json()) as ApiResponse<{ available: number }>).result.available).toBe(10000);
  });

  test("builds an isolated daily holding chart from transactions and market history", async () => {
    const admin = await register("chart-detail-admin@example.com");
    const alice = await register("chart-detail-alice@example.com");
    const bob = await register("chart-detail-bob@example.com");
    const instrumentResponse = await post(
      "/api/market/instruments/upsert",
      { code: "600036", exchange: "sh", name: "招商银行", assetType: "stock" },
      admin.token
    );
    const instrument = (await instrumentResponse.json()) as ApiResponse<{ id: string }>;
    await post("/api/settings/data-sources/update", { primary: "mock", fallback: "tencent" }, alice.token);
    await post("/api/assets/cash/adjust", { amount: 10000, note: "本金" }, alice.token);
    const created = await post(
      "/api/assets/holdings/create",
      { instrumentId: instrument.result.id, quantity: 100, price: 10, fee: 0, occurredAt: "2026-07-18T09:30:00.000Z" },
      alice.token
    );
    const holding = (await created.json()) as ApiResponse<{ id: string }>;
    await post(
      "/api/assets/holdings/transaction",
      { holdingId: holding.result.id, action: "interest", quantity: 100, price: 0.2, fee: 0, occurredAt: "2026-07-19T09:30:00.000Z" },
      alice.token
    );
    await post(
      "/api/assets/holdings/transaction",
      { holdingId: holding.result.id, action: "sell", quantity: 25, price: 12, fee: 0, occurredAt: "2026-07-20T09:30:00.000Z" },
      alice.token
    );

    const chart = await post("/api/assets/holdings/detail/chart", { id: holding.result.id }, alice.token);
    const chartBody = (await chart.json()) as ApiResponse<{
      holding: { id: string; quantity: number; cost: number };
      transactions: Array<{ action: string; quantity: number }>;
      bars: Array<{ date: string }>;
      trace: Array<{ date: string; quantity: number; netCost: number; marketValue: number; profit: number }>;
      macdLines: { hist: Array<number | null> };
    }>;
    expect(chart.status).toBe(200);
    expect(chartBody.result.holding).toMatchObject({ id: holding.result.id, quantity: 75, cost: 680 });
    expect(chartBody.result.transactions.map((transaction) => transaction.action)).toEqual(["buy", "interest", "sell"]);
    expect(chartBody.result.bars[0]).toBeDefined();
    const minimumChartStart = new Date();
    minimumChartStart.setUTCMonth(minimumChartStart.getUTCMonth() - 3);
    expect(chartBody.result.bars[0]!.date <= minimumChartStart.toISOString().slice(0, 10)).toBe(true);
    expect(chartBody.result.bars.length).toBeGreaterThanOrEqual(90);
    expect(chartBody.result.trace[0]).toMatchObject({ date: "2026-07-18", quantity: 100, netCost: 1000 });
    expect(chartBody.result.trace.at(-1)?.quantity).toBe(75);
    expect(chartBody.result.trace.at(-1)?.netCost).toBe(680);
    expect(chartBody.result.trace.at(-1)?.marketValue).toBeGreaterThan(0);
    expect(chartBody.result.macdLines.hist ?? []).toHaveLength(chartBody.result.bars.length);

    const foreign = await post("/api/assets/holdings/detail/chart", { id: holding.result.id }, bob.token);
    expect(foreign.status).toBe(404);
  });

  test("keeps legacy lump-sum dividend records readable and deletable", async () => {
    const admin = await register("legacy-admin@example.com");
    const alice = await register("legacy-alice@example.com");
    const instrumentResponse = await post(
      "/api/market/instruments/upsert",
      { code: "601318", exchange: "sh", name: "中国平安", assetType: "stock" },
      admin.token
    );
    const instrument = (await instrumentResponse.json()) as ApiResponse<{ id: string }>;
    await post("/api/settings/data-sources/update", { primary: "mock", fallback: "tencent" }, alice.token);
    await post("/api/assets/cash/adjust", { amount: 10000, note: "本金" }, alice.token);
    const created = await post(
      "/api/assets/holdings/create",
      { instrumentId: instrument.result.id, quantity: 100, price: 10, fee: 0, occurredAt: "2026-07-18T09:30:00.000Z" },
      alice.token
    );
    const holding = (await created.json()) as ApiResponse<{ id: string }>;

    const legacy = new IronManDatabase(join(tempDirectory, "ironman.sqlite"));
    const transactionId = crypto.randomUUID();
    const occurredAt = "2026-07-19T09:30:00.000Z";
    const now = new Date().toISOString();
    legacy.run(
      `INSERT INTO holding_transactions (id, user_id, holding_id, action, quantity, price, fee, note, occurred_at, created_at)
       VALUES ($id, $userId, $holdingId, 'dividend', 0, 50, 0, '历史分红', $occurredAt, $createdAt)`,
      { id: transactionId, userId: alice.user.id, holdingId: holding.result.id, occurredAt, createdAt: now }
    );
    legacy.run(
      `INSERT INTO cash_ledger (id, user_id, amount, category, reference_id, holding_transaction_id, note, occurred_at, created_at)
       VALUES ($id, $userId, 50, 'dividend', $holdingId, $transactionId, '历史分红', $occurredAt, $createdAt)`,
      { id: crypto.randomUUID(), userId: alice.user.id, holdingId: holding.result.id, transactionId, occurredAt, createdAt: now }
    );
    legacy.run("UPDATE cash_accounts SET available = available + 50, updated_at = $updatedAt WHERE user_id = $userId", {
      updatedAt: now,
      userId: alice.user.id
    });
    legacy.close();

    const detail = await post("/api/assets/holdings/detail", { id: holding.result.id }, alice.token);
    const detailBody = (await detail.json()) as ApiResponse<{ transactions: Array<{ id: string; action: string; quantity: number; price: number; fee: number; cashImpact: number }> }>;
    expect(detail.status).toBe(200);
    expect(detailBody.result.transactions[0]).toMatchObject({ id: transactionId, action: "interest", quantity: 0, price: 50, fee: 0, cashImpact: 50 });
    expect(detailBody.result.transactions.map((transaction) => transaction.action)).toEqual(["interest", "buy"]);

    const remove = await post(
      "/api/assets/holdings/transaction/delete",
      { holdingId: holding.result.id, transactionId },
      alice.token
    );
    expect(remove.status).toBe(200);

    const cash = await post("/api/assets/cash/summary", {}, alice.token);
    expect(((await cash.json()) as ApiResponse<{ available: number }>).result.available).toBe(9000);
  });

  test("builds a Batman-style watchlist workspace and isolates target-price updates", async () => {
    const admin = await register("admin@example.com");
    const alice = await register("alice@example.com");
    const bob = await register("bob@example.com");
    const instrumentResponse = await post(
      "/api/market/instruments/upsert",
      { code: "600036", exchange: "sh", name: "招商银行", assetType: "stock" },
      admin.token
    );
    const instrument = (await instrumentResponse.json()) as ApiResponse<{ id: string }>;
    await post("/api/settings/data-sources/update", { primary: "mock", fallback: "tencent" }, alice.token);
    const create = await post(
      "/api/assets/watchlist/create",
      { instrumentId: instrument.result.id, note: "等待回调", targetPrice: 42 },
      alice.token
    );
    const entry = (await create.json()) as ApiResponse<{ id: string }>;
    await post("/api/assets/cash/adjust", { amount: 10000, note: "本金" }, alice.token);
    await post(
      "/api/assets/holdings/create",
      { instrumentId: instrument.result.id, quantity: 100, price: 10, fee: 0, occurredAt: "2026-01-01T00:00:00.000Z" },
      alice.token
    );

    const workspace = await post("/api/assets/watchlist/workspace", { refresh: false }, alice.token);
    const workspaceBody = (await workspace.json()) as ApiResponse<{
      items: Array<{
        id: string;
        isHeld: boolean;
        latestPrice: number | null;
        previousClose: number | null;
        openPrice: number | null;
        highPrice: number | null;
        lowPrice: number | null;
        priceChange: number | null;
        priceChangeRate: number | null;
        amplitudeRate: number | null;
        volumeRatio: number | null;
        turnoverRate: number | null;
        targetPrice: number | null;
        targetPriceDifference: number | null;
      }>;
    }>;
    expect(workspace.status).toBe(200);
    expect(workspaceBody.result.items).toHaveLength(1);
    const item = workspaceBody.result.items[0]!;
    expect(item.id).toBe(entry.result.id);
    expect(item.isHeld).toBe(true);
    expect(item.latestPrice).toBeGreaterThan(0);
    expect(item.previousClose).toBeGreaterThan(0);
    expect(item.openPrice).toBeGreaterThan(0);
    expect(item.highPrice).toBeGreaterThan(0);
    expect(item.lowPrice).toBeGreaterThan(0);
    expect(item.priceChange).not.toBeNull();
    expect(item.priceChangeRate).not.toBeNull();
    expect(item.amplitudeRate).not.toBeNull();
    expect(item.volumeRatio).not.toBeNull();
    expect(item.turnoverRate).toBeNull();
    expect(item.targetPriceDifference).toBeCloseTo((item.latestPrice ?? 0) - 42, 6);

    const foreignUpdate = await post("/api/assets/watchlist/update", { id: entry.result.id, targetPrice: 45 }, bob.token);
    expect(foreignUpdate.status).toBe(404);
    const update = await post("/api/assets/watchlist/update", { id: entry.result.id, targetPrice: 45, note: "等待突破" }, alice.token);
    const updateBody = (await update.json()) as ApiResponse<{ targetPrice: number | null; note: string }>;
    expect(update.status).toBe(200);
    expect(updateBody.result).toMatchObject({ targetPrice: 45, note: "等待突破" });
  });

  test("builds a Batman-style holding workspace with display ratios and price deltas", async () => {
    const admin = await register("admin@example.com");
    const alice = await register("alice@example.com");
    const bob = await register("bob@example.com");
    const firstInstrumentResponse = await post(
      "/api/market/instruments/upsert",
      { code: "600010", exchange: "sh", name: "包钢股份", assetType: "stock" },
      admin.token
    );
    const secondInstrumentResponse = await post(
      "/api/market/instruments/upsert",
      { code: "600011", exchange: "sh", name: "华能国际", assetType: "stock" },
      admin.token
    );
    const firstInstrument = (await firstInstrumentResponse.json()) as ApiResponse<{ id: string }>;
    const secondInstrument = (await secondInstrumentResponse.json()) as ApiResponse<{ id: string }>;
    await post("/api/settings/data-sources/update", { primary: "mock", fallback: "tencent" }, alice.token);
    await post("/api/assets/cash/adjust", { amount: 10000, note: "本金" }, alice.token);
    await post("/api/assets/holdings/create", { instrumentId: firstInstrument.result.id, quantity: 100, price: 10, fee: 0, occurredAt: "2026-01-01T00:00:00.000Z" }, alice.token);
    await post("/api/assets/holdings/create", { instrumentId: secondInstrument.result.id, quantity: 200, price: 5, fee: 0, occurredAt: "2026-01-01T00:00:00.000Z" }, alice.token);

    const workspace = await post("/api/assets/holdings/batman-workspace", { refresh: false }, alice.token);
    const workspaceBody = (await workspace.json()) as ApiResponse<{
      active: Array<{
        quantity: number;
        cost: number;
        costCashFlow: number;
        quantityRatio: number | null;
        costRatio: number | null;
        marketValueRatio: number | null;
        averagePriceDifference: number | null;
        dailyDifference: number | null;
        dailyDifferenceRate: number | null;
      }>;
    }>;
    expect(workspace.status).toBe(200);
    expect(workspaceBody.result.active).toHaveLength(2);
    const first = workspaceBody.result.active.find((item) => item.quantity === 100)!;
    expect(first.cost).toBe(1000);
    expect(first.costCashFlow).toBe(-1000);
    expect(first.quantityRatio).toBeCloseTo(100 / 300 * 100, 4);
    expect(first.costRatio).toBeCloseTo(50, 4);
    expect(first.marketValueRatio).not.toBeNull();
    expect(first.averagePriceDifference).not.toBeNull();
    expect(first.dailyDifference).not.toBeNull();
    expect(first.dailyDifferenceRate).not.toBeNull();

    const foreignWorkspace = await post("/api/assets/holdings/batman-workspace", { refresh: false }, bob.token);
    expect(((await foreignWorkspace.json()) as ApiResponse<{ active: unknown[] }>).result.active).toHaveLength(0);
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
