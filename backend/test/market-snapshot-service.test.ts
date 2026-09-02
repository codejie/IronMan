import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IronManDatabase } from "../src/db/database";
import type { Instrument, MarketDataProvider, PriceBar } from "../src/market/types";
import { AssetsService } from "../src/services/assets-service";
import { MarketService } from "../src/services/market-service";
import { MarketSnapshotService } from "../src/services/market-snapshot-service";
import { SettingsService } from "../src/services/settings-service";
import { TradingCalendarService } from "../src/services/trading-calendar-service";

let directory = "";
let database: IronManDatabase;
let settings: SettingsService;
let market: MarketService;
let snapshots: MarketSnapshotService;
let providerCalls = 0;

const tradingMorning = new Date("2026-07-31T02:00:00.000Z");
const mondayTradingMorning = new Date("2026-08-03T02:00:00.000Z");
const latestBar: PriceBar = {
  date: "2026-07-31",
  open: 10,
  close: 10.8,
  high: 11,
  low: 9.8,
  volume: 3200,
};
const mondayBar: PriceBar = { ...latestBar, date: "2026-08-03" };

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "ironman-market-snapshot-"));
  database = new IronManDatabase(join(directory, "ironman.sqlite"));
  settings = new SettingsService(database);
  const provider: MarketDataProvider = {
    source: "mock",
    history: async (_instrument: Instrument) => {
      providerCalls += 1;
      return [
        { date: "2026-07-30", open: 9.8, close: 10, high: 10.2, low: 9.7, volume: 2800 },
        latestBar,
      ];
    },
  };
  market = new MarketService(database, settings, [provider]);
  snapshots = new MarketSnapshotService(
    database,
    settings,
    new TradingCalendarService(settings),
    market,
  );
  providerCalls = 0;
});

afterEach(() => {
  database.close();
  rmSync(directory, { force: true, recursive: true });
});

function createUser(email: string): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  database.run(
    `INSERT INTO users (id, email, password_hash, display_name, role, status, created_at, updated_at)
     VALUES ($id, $email, 'not-used', $displayName, 'user', 'active', $createdAt, $updatedAt)`,
    { id, email, displayName: email.split("@")[0]!, createdAt: now, updatedAt: now },
  );
  market.setDataSourceConfig(id, { primary: "mock", fallback: "mock" });
  return id;
}

function addHolding(userId: string, assetType: "stock" | "fund" = "stock"): string {
  const instrument = market.upsertInstrument({
    code: assetType === "stock" ? `600${Math.floor(Math.random() * 900 + 100)}` : `5${Math.floor(Math.random() * 900000 + 100000)}`,
    exchange: assetType === "stock" ? "sh" : "fund",
    name: assetType === "stock" ? "快照股票" : "快照基金",
    assetType,
  });
  const now = new Date().toISOString();
  database.run(
    "INSERT INTO holdings (id, user_id, instrument_id, status, created_at, updated_at) VALUES ($id, $userId, $instrumentId, 'active', $createdAt, $updatedAt)",
    { id: crypto.randomUUID(), userId, instrumentId: instrument.id, createdAt: now, updatedAt: now },
  );
  return instrument.id;
}

function insertSnapshot(userId: string, instrumentId: string, tradeDate: string): void {
  const capturedAt = `${tradeDate}T02:00:00.000Z`;
  database.run(
    `INSERT INTO market_intraday_snapshots (
      id, user_id, instrument_id, captured_at, captured_minute, trade_date, source, capture_mode,
      open, close, high, low, volume, created_at
    ) VALUES (
      $id, $userId, $instrumentId, $capturedAt, $capturedMinute, $tradeDate, 'mock', 'auto',
      1, 1, 1, 1, 1, $capturedAt
    )`,
    { id: crypto.randomUUID(), userId, instrumentId, capturedAt, capturedMinute: `${tradeDate} 10:00`, tradeDate },
  );
}

describe("market intraday snapshots", () => {
  test("writes the bar returned by a manual holding refresh without a second provider request", async () => {
    const userId = createUser("workspace-refresh@example.com");
    const instrumentId = addHolding(userId);
    const clockSnapshots = new MarketSnapshotService(
      database,
      settings,
      new TradingCalendarService(settings),
      market,
      () => tradingMorning,
    );
    const assets = new AssetsService(database, market, undefined, clockSnapshots);
    clockSnapshots.updateSettings(userId, {
      enabled: true,
      mode: "manual",
      startTime: "09:30",
      endTime: "15:00",
      intervalMinutes: 15,
      scope: "holdings",
      retentionDays: 5,
    });

    await assets.getHoldingWorkspace(userId, true);

    expect(providerCalls).toBe(1);
    expect(clockSnapshots.listSeries(userId, instrumentId, "2026-07-31T00:00:00.000Z", "2026-08-01T00:00:00.000Z")).toHaveLength(1);
  });

  test("stores manual refreshed bars only while the enabled manual configuration is in a trading session", () => {
    const userId = createUser("manual@example.com");
    const instrumentId = addHolding(userId);
    snapshots.updateSettings(userId, {
      enabled: true,
      mode: "manual",
      startTime: "09:30",
      endTime: "15:00",
      intervalMinutes: 15,
      scope: "holdings",
      retentionDays: 5,
    });

    expect(snapshots.captureFromManualRefresh(userId, "holdings", instrumentId, "mock", latestBar, tradingMorning)).toBe(true);
    expect(snapshots.captureFromManualRefresh(userId, "holdings", instrumentId, "mock", latestBar, new Date("2026-08-01T02:00:00.000Z"))).toBe(false);

    const items = snapshots.listSeries(userId, instrumentId, "2026-07-31T00:00:00.000Z", "2026-08-01T00:00:00.000Z");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ close: 10.8, volume: 3200, captureMode: "manual", tradeDate: "2026-07-31" });
    expect(snapshots.getStatus(userId)).toMatchObject({ totalCount: 1, lastCaptureMode: "manual", lastCapturedCount: 1 });
  });

  test("automatically refreshes scoped stock data, cleans expired records, and leaves fund data alone", async () => {
    const userId = createUser("auto@example.com");
    const stockId = addHolding(userId);
    const fundId = addHolding(userId, "fund");
    snapshots.updateSettings(userId, {
      enabled: true,
      mode: "auto",
      startTime: "09:30",
      endTime: "15:00",
      intervalMinutes: 15,
      scope: "holdings",
      retentionDays: 5,
    });
    database.run(
      `INSERT INTO market_intraday_snapshots (
        id, user_id, instrument_id, captured_at, captured_minute, trade_date, source, capture_mode,
        open, close, high, low, volume, created_at
      ) VALUES (
        $id, $userId, $instrumentId, '2026-07-20T02:00:00.000Z', '2026-07-20 10:00', '2026-07-20', 'mock', 'auto',
        1, 1, 1, 1, 1, '2026-07-20T02:00:00.000Z'
      )`,
      { id: crypto.randomUUID(), userId, instrumentId: stockId },
    );

    await snapshots.captureDueAutomatic(tradingMorning);

    expect(snapshots.listSeries(userId, stockId, "2026-07-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z")).toHaveLength(1);
    expect(snapshots.listSeries(userId, fundId, "2026-07-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z")).toHaveLength(0);
    expect(snapshots.getStatus(userId)).toMatchObject({ totalCount: 1, lastCaptureMode: "auto", lastTargetCount: 1, lastCapturedCount: 1 });
  });

  test("retains the configured number of trading dates across a weekend during automatic collection", async () => {
    const userId = createUser("trading-day-auto@example.com");
    const instrumentId = addHolding(userId);
    const mondayMarket = new MarketService(database, settings, [{
      source: "mock",
      history: async () => [mondayBar],
    }]);
    const mondaySnapshots = new MarketSnapshotService(
      database,
      settings,
      new TradingCalendarService(settings),
      mondayMarket,
    );
    mondaySnapshots.updateSettings(userId, {
      enabled: true,
      mode: "auto",
      startTime: "09:30",
      endTime: "15:00",
      intervalMinutes: 15,
      scope: "holdings",
      retentionDays: 5,
    });
    for (const tradeDate of ["2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31"]) {
      insertSnapshot(userId, instrumentId, tradeDate);
    }

    await mondaySnapshots.captureDueAutomatic(mondayTradingMorning);

    expect(mondaySnapshots.listSeries(userId, instrumentId, "2026-07-01T00:00:00.000Z", "2026-08-04T00:00:00.000Z").map((item) => item.tradeDate)).toEqual([
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
      "2026-08-03",
    ]);
  });

  test("applies trading-day cleanup before a manual refresh stores its point", () => {
    const userId = createUser("trading-day-manual@example.com");
    const instrumentId = addHolding(userId);
    snapshots.updateSettings(userId, {
      enabled: true,
      mode: "manual",
      startTime: "09:30",
      endTime: "15:00",
      intervalMinutes: 15,
      scope: "holdings",
      retentionDays: 5,
    });
    for (const tradeDate of ["2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31"]) {
      insertSnapshot(userId, instrumentId, tradeDate);
    }

    expect(snapshots.captureFromManualRefresh(userId, "holdings", instrumentId, "mock", mondayBar, mondayTradingMorning)).toBe(true);
    expect(snapshots.listSeries(userId, instrumentId, "2026-07-01T00:00:00.000Z", "2026-08-04T00:00:00.000Z").map((item) => item.tradeDate)).toEqual([
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
      "2026-08-03",
    ]);
  });

  test("indexes snapshots by user and trading date for retention cleanup", () => {
    const indexes = database.all<{ name: string }>("PRAGMA index_list('market_intraday_snapshots')");

    expect(indexes.map((index) => index.name)).toContain("market_intraday_snapshots_trade_date_idx");
  });

  test("keeps snapshot storage and deletion isolated by user", () => {
    const alice = createUser("alice-snapshot@example.com");
    const bob = createUser("bob-snapshot@example.com");
    const aliceInstrument = addHolding(alice);
    const bobInstrument = addHolding(bob);
    for (const [userId, instrumentId] of [[alice, aliceInstrument], [bob, bobInstrument]] as const) {
      snapshots.updateSettings(userId, {
        enabled: true,
        mode: "manual",
        startTime: "09:30",
        endTime: "15:00",
        intervalMinutes: 15,
        scope: "holdings",
        retentionDays: 5,
      });
      snapshots.captureFromManualRefresh(userId, "holdings", instrumentId, "mock", latestBar, tradingMorning);
    }

    expect(snapshots.deleteSnapshots(alice)).toEqual({ deleted: 1 });
    expect(snapshots.getStatus(alice).totalCount).toBe(0);
    expect(snapshots.getStatus(bob).totalCount).toBe(1);
  });
});
