import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IronManDatabase } from "../src/db/database";
import type { MarketDataProvider } from "../src/market/types";
import { MarketService } from "../src/services/market-service";
import { SettingsService } from "../src/services/settings-service";
import { FixtureMarketProvider } from "./helpers/fixture-market-provider";

let tempDirectory = "";
let database: IronManDatabase;

beforeEach(() => {
  tempDirectory = mkdtempSync(join(tmpdir(), "ironman-etf-cache-"));
  database = new IronManDatabase(join(tempDirectory, "ironman.sqlite"));
});

afterEach(() => {
  database.close();
  rmSync(tempDirectory, { force: true, recursive: true });
});

async function prepare(userId: string): Promise<{ market: MarketService; instrumentId: string }> {
  database.run(
    `INSERT INTO users (id, email, password_hash, display_name, role, status, created_at, updated_at)
     VALUES ($id, $email, $passwordHash, $displayName, 'user', 'active', $createdAt, $updatedAt)`,
    {
      id: userId,
      email: `${userId}@example.com`,
      passwordHash: "not-used-in-this-test",
      displayName: "ETF Cache",
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z"
    }
  );
  const settings = new SettingsService(database);
  const eastmoney: MarketDataProvider = {
    source: "eastmoney",
    history: async () => [{ date: "2026-07-20", open: 1.04, close: 1.05, high: 1.06, low: 1.03, volume: 1000 }]
  };
  let tencentCalls = 0;
  const tencent: MarketDataProvider = {
    source: "tencent",
    history: async () => {
      tencentCalls += 1;
      return [{ date: "2026-07-20", open: 1.04, close: 1.05, high: 1.06, low: 1.03, volume: 1000 }];
    }
  };
  const market = new MarketService(database, settings, [eastmoney, tencent]);
  const instrument = market.upsertInstrument({ code: "563230", exchange: "fund", name: "卫星ETF富国", assetType: "fund" });
  return { market, instrumentId: instrument.id };
}

describe("listed fund cache selection", () => {
  test("serves recent cached bars without refetching", async () => {
    const { market, instrumentId } = await prepare("cache-hit-user");
    market.setDataSourceConfig("cache-hit-user", { primary: "eastmoney", fallback: "tencent" });
    await market.getHistory("cache-hit-user", instrumentId, "day", true, 1);

    const result = await market.getHistory("cache-hit-user", instrumentId, "day", false, 1);
    expect(result.source).toBe("eastmoney");
    expect(result.bars).toHaveLength(1);
  });

  test("reuses fallback-source cache for a listed fund while the primary source is unavailable", async () => {
    const unavailablePrimary: MarketDataProvider = {
      source: "tencent",
      history: async () => {
        throw new Error("tencent unavailable");
      }
    };
    let eastmoneyCalls = 0;
    const eastmoney: MarketDataProvider = {
      source: "eastmoney",
      history: async () => {
        eastmoneyCalls += 1;
        return [{ date: "2026-07-20", open: 1.04, close: 1.05, high: 1.06, low: 1.03, volume: 1000 }];
      }
    };
    database.run(
      `INSERT INTO users (id, email, password_hash, display_name, role, status, created_at, updated_at)
       VALUES ($id, $email, $passwordHash, $displayName, 'user', 'active', $createdAt, $updatedAt)`,
      {
        id: "fallback-user",
        email: "fallback@example.com",
        passwordHash: "not-used-in-this-test",
        displayName: "Fallback",
        createdAt: "2026-07-20T00:00:00.000Z",
        updatedAt: "2026-07-20T00:00:00.000Z"
      }
    );
    const settings = new SettingsService(database);
    const market = new MarketService(database, settings, [eastmoney, unavailablePrimary]);
    const instrument = market.upsertInstrument({ code: "563230", exchange: "fund", name: "卫星ETF富国", assetType: "fund" });
    market.setDataSourceConfig("fallback-user", { primary: "tencent", fallback: "eastmoney" });

    const refreshed = await market.getHistory("fallback-user", instrument.id, "day", true, 1);
    const cached = await market.getHistory("fallback-user", instrument.id, "day", false, 1);

    expect(eastmoneyCalls).toBe(1);
    expect(refreshed.source).toBe("eastmoney");
    expect(cached.source).toBe("eastmoney");
    expect(cached.bars.at(-1)?.close).toBe(1.05);
  });
});
