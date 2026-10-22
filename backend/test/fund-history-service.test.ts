import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IronManDatabase } from "../src/db/database";
import type { PriceBar } from "../src/market/types";
import {
  FundHistoryService,
  type FundHistoryCalendar,
  type FundHistoryMarket,
} from "../src/services/fund-history-service";

const userId = "00000000-0000-4000-8000-000000000001";
const instrumentId = "00000000-0000-4000-8000-000000000002";
const firstHoldingId = "00000000-0000-4000-8000-000000000003";
const secondHoldingId = "00000000-0000-4000-8000-000000000004";

let tempDirectory = "";
let database: IronManDatabase;

beforeEach(() => {
  tempDirectory = mkdtempSync(join(tmpdir(), "ironman-fund-history-"));
  database = new IronManDatabase(join(tempDirectory, "ironman.sqlite"));
  seedOwnerAndInstrument();
});

afterEach(() => {
  database.close();
  rmSync(tempDirectory, { force: true, recursive: true });
});

describe("FundHistoryService", () => {
  test("keeps realized profit after a full close and includes a later holding cycle", async () => {
    seedClosedAndReopenedPosition();
    const market = marketWithBars({
      [instrumentId]: [bar("2026-07-01", 10), bar("2026-07-02", 12), bar("2026-07-03", 11), bar("2026-07-06", 15)],
    });
    const service = new FundHistoryService(database, market, calendar("2026-07-01", "2026-07-02", "2026-07-03", "2026-07-06"));

    const result = await service.getHistory(userId, { startDate: "2026-07-01", endDate: "2026-07-06" });

    expect(result.points.map((point) => point.tradeDate)).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-06",
    ]);
    expect(result.points[0]).toMatchObject({
      cashAvailable: 500,
      principal: 1000,
      marketValue: 1000,
      totalAssets: 1500,
      cumulativeProfit: 500,
      dataStatus: "complete",
    });
    expect(result.points[1]).toMatchObject({
      cashAvailable: 520,
      marketValue: 1200,
      totalAssets: 1720,
      dailyProfit: 220,
      cumulativeProfit: 720,
    });
    expect(result.points[2]).toMatchObject({
      cashAvailable: 1620,
      marketValue: 0,
      totalAssets: 1620,
      dailyProfit: -100,
      cumulativeProfit: 620,
    });
    expect(result.points[3]).toMatchObject({
      cashAvailable: 1520,
      marketValue: 150,
      totalAssets: 1670,
      dailyProfit: 50,
      cumulativeProfit: 670,
    });
    expect(result.summary).toMatchObject({
      totalAssets: 1670,
      marketValue: 150,
      cashAvailable: 1520,
      cumulativeProfit: 670,
    });
    expect(result.events.map((event) => event.kind)).toEqual([
      "adjustment",
      "buy",
      "dividend",
      "close",
      "buy",
    ]);
    expect(result.events[3]).toMatchObject({
      tradeDate: "2026-07-03",
      label: "清仓 测试标的",
      amount: 1100,
    });
  });

  test("carries the most recent close for a missing bar and marks an unpriced holding partial", async () => {
    const unpricedInstrumentId = "00000000-0000-4000-8000-000000000005";
    const now = "2026-07-01T00:00:00.000Z";
    database.run(
      `INSERT INTO instruments (id, code, exchange, name, asset_type, created_at, updated_at)
       VALUES ($id, '600001', 'sh', '无行情标的', 'stock', $now, $now)`,
      { id: unpricedInstrumentId, now },
    );
    insertCash("cash-adjust", 1000, "adjustment", null, "2026-06-30T16:30:00.000Z");
    insertHolding(firstHoldingId, instrumentId, "active", now);
    insertTransaction("buy-priced", firstHoldingId, "buy", 10, 10, 0, "2026-07-01T01:30:00.000Z");
    insertCash("cash-buy-priced", -100, "buy", firstHoldingId, "2026-07-01T01:30:00.000Z", "buy-priced");
    insertHolding(secondHoldingId, unpricedInstrumentId, "active", now);
    insertTransaction("buy-unpriced", secondHoldingId, "buy", 5, 20, 0, "2026-07-01T02:00:00.000Z");
    insertCash("cash-buy-unpriced", -100, "buy", secondHoldingId, "2026-07-01T02:00:00.000Z", "buy-unpriced");
    const service = new FundHistoryService(
      database,
      marketWithBars({ [instrumentId]: [bar("2026-07-01", 11)] }),
      calendar("2026-07-01", "2026-07-02"),
    );

    const result = await service.getHistory(userId, { startDate: "2026-07-01", endDate: "2026-07-02" });

    expect(result.points[0]).toMatchObject({
      marketValue: 110,
      carriedPriceCount: 0,
      missingPriceCount: 1,
      dataStatus: "partial",
    });
    expect(result.points[1]).toMatchObject({
      marketValue: 110,
      carriedPriceCount: 1,
      missingPriceCount: 1,
      dataStatus: "partial",
    });
  });

  test("persists generated days, adds only missing coverage, and stops appending while dirty", async () => {
    seedClosedAndReopenedPosition();
    const market = marketWithBars({
      [instrumentId]: [bar("2026-07-01", 10), bar("2026-07-02", 12), bar("2026-07-03", 11), bar("2026-07-06", 15)],
    });
    const service = new FundHistoryService(database, market, calendar("2026-07-01", "2026-07-02", "2026-07-03", "2026-07-06"));

    await service.getHistory(userId, { startDate: "2026-07-01", endDate: "2026-07-02" });
    expect(metricDates()).toEqual(["2026-07-01", "2026-07-02"]);

    await service.getHistory(userId, { startDate: "2026-07-01", endDate: "2026-07-06" });
    expect(metricDates()).toEqual(["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-06"]);

    service.markDirty(userId, "2026-07-02");
    database.run("DELETE FROM fund_daily_metrics WHERE user_id = $userId AND trade_date = '2026-07-06'", { userId });
    const dirty = await service.getHistory(userId, { startDate: "2026-07-01", endDate: "2026-07-06" });

    expect(dirty.state.status).toBe("dirty");
    expect(dirty.state.dirtyFrom).toBe("2026-07-02");
    expect(metricDates()).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);
  });

  test("assigns a non-trading-day cash adjustment to the next trading day", async () => {
    insertCash("cash-initial", 1000, "adjustment", null, "2026-07-03T01:00:00.000Z");
    insertCash("cash-weekend", 200, "adjustment", null, "2026-07-04T01:00:00.000Z");
    const service = new FundHistoryService(
      database,
      marketWithBars({}),
      calendar("2026-07-03", "2026-07-06"),
    );

    const result = await service.getHistory(userId, { startDate: "2026-07-03", endDate: "2026-07-06" });

    expect(result.points[1]).toMatchObject({
      cashAvailable: 1200,
      principal: 1200,
      externalCashFlow: 200,
      dailyProfit: 0,
    });
  });

  test("recalculates only through the latest completed trading day", async () => {
    seedClosedAndReopenedPosition();
    const service = new FundHistoryService(
      database,
      marketWithBars({ [instrumentId]: [bar("2026-07-06", 15)] }),
      calendar("2026-07-30", "2026-07-31"),
      () => new Date("2026-07-31T04:00:00.000Z"),
    );

    const result = await service.recalculate(userId);

    expect(result.state.coveredTo).toBe("2026-07-30");
    expect(result.points.map((point) => point.tradeDate)).toEqual(["2026-07-30"]);
  });
});

function seedOwnerAndInstrument(): void {
  const now = "2026-07-01T00:00:00.000Z";
  database.run(
    `INSERT INTO users (id, email, password_hash, display_name, role, status, created_at, updated_at)
     VALUES ($id, 'fund-history@example.com', 'not-used', 'Fund History', 'user', 'active', $now, $now)`,
    { id: userId, now },
  );
  database.run(
    `INSERT INTO instruments (id, code, exchange, name, asset_type, created_at, updated_at)
     VALUES ($id, '600000', 'sh', '测试标的', 'stock', $now, $now)`,
    { id: instrumentId, now },
  );
}

function seedClosedAndReopenedPosition(): void {
  const now = "2026-07-01T00:00:00.000Z";
  insertCash("cash-adjust", 1000, "adjustment", null, "2026-06-30T16:30:00.000Z");
  insertHolding(firstHoldingId, instrumentId, "closed", now);
  insertTransaction("buy-1", firstHoldingId, "buy", 100, 5, 0, "2026-07-01T01:30:00.000Z");
  insertCash("cash-buy-1", -500, "buy", firstHoldingId, "2026-07-01T01:30:00.000Z", "buy-1");
  insertTransaction("dividend-1", firstHoldingId, "dividend", 0, 20, 0, "2026-07-02T02:00:00.000Z");
  insertCash("cash-dividend-1", 20, "dividend", firstHoldingId, "2026-07-02T02:00:00.000Z", "dividend-1");
  insertTransaction("sell-1", firstHoldingId, "sell", 100, 11, 0, "2026-07-03T06:00:00.000Z");
  insertCash("cash-sell-1", 1100, "sell", firstHoldingId, "2026-07-03T06:00:00.000Z", "sell-1");
  insertHolding(secondHoldingId, instrumentId, "active", "2026-07-06T00:00:00.000Z");
  insertTransaction("buy-2", secondHoldingId, "buy", 10, 10, 0, "2026-07-06T01:30:00.000Z");
  insertCash("cash-buy-2", -100, "buy", secondHoldingId, "2026-07-06T01:30:00.000Z", "buy-2");
}

function insertHolding(id: string, targetInstrumentId: string, status: "active" | "closed", occurredAt: string): void {
  database.run(
    `INSERT INTO holdings (id, user_id, instrument_id, status, created_at, updated_at)
     VALUES ($id, $userId, $instrumentId, $status, $occurredAt, $occurredAt)`,
    { id, userId, instrumentId: targetInstrumentId, status, occurredAt },
  );
}

function insertTransaction(id: string, holdingId: string, action: "buy" | "sell" | "dividend", quantity: number, price: number, fee: number, occurredAt: string): void {
  database.run(
    `INSERT INTO holding_transactions (id, user_id, holding_id, action, quantity, price, fee, note, occurred_at, created_at)
     VALUES ($id, $userId, $holdingId, $action, $quantity, $price, $fee, '', $occurredAt, $occurredAt)`,
    { id, userId, holdingId, action, quantity, price, fee, occurredAt },
  );
}

function insertCash(id: string, amount: number, category: "adjustment" | "buy" | "sell" | "dividend", referenceId: string | null, occurredAt: string, transactionId: string | null = null): void {
  database.run(
    `INSERT INTO cash_ledger (id, user_id, amount, category, reference_id, holding_transaction_id, note, occurred_at, created_at)
     VALUES ($id, $userId, $amount, $category, $referenceId, $transactionId, '', $occurredAt, $occurredAt)`,
    { id, userId, amount, category, referenceId, transactionId, occurredAt },
  );
}

function bar(date: string, close: number): PriceBar {
  return { date, open: close, close, high: close, low: close, volume: 100 };
}

function marketWithBars(items: Record<string, PriceBar[]>): FundHistoryMarket {
  return {
    getHistoryRange: async (_userId, targetInstrumentId, _timeframe, startDate, endDate) => ({
      source: "tencent",
      bars: (items[targetInstrumentId] ?? []).filter((item) => item.date >= startDate && item.date <= endDate),
    }),
  };
}

function calendar(...tradeDays: string[]): FundHistoryCalendar {
  return {
    getTradeDays: (_userId, startDate, endDate) => tradeDays.filter((date) => date >= startDate && date <= endDate),
  };
}

function metricDates(): string[] {
  return database
    .all<{ trade_date: string }>("SELECT trade_date FROM fund_daily_metrics WHERE user_id = $userId ORDER BY trade_date", { userId })
    .map((row) => row.trade_date);
}
