import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IronManDatabase } from "../src/db/database";
import type { MarketDataProvider } from "../src/market/types";
import { MarketService } from "../src/services/market-service";
import { SettingsService } from "../src/services/settings-service";

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

describe("listed ETF cache selection", () => {
  test("refreshes stale mock bars when Tencent becomes the selected source", async () => {
    let tencentCalls = 0;
    const tencent: MarketDataProvider = {
      source: "tencent",
      history: async () => {
        tencentCalls += 1;
        return [{ date: "2026-07-20", open: 1.04, close: 1.05, high: 1.06, low: 1.03, volume: 1000 }];
      }
    };
    const mock: MarketDataProvider = {
      source: "mock",
      history: async () => [{ date: "2026-07-20", open: 11.4, close: 11.491, high: 11.6, low: 11.3, volume: 1000 }]
    };
    database.run(
      `INSERT INTO users (id, email, password_hash, display_name, role, status, created_at, updated_at)
       VALUES ($id, $email, $passwordHash, $displayName, 'user', 'active', $createdAt, $updatedAt)`,
      {
        id: "user-id",
        email: "etf-cache@example.com",
        passwordHash: "not-used-in-this-test",
        displayName: "ETF Cache",
        createdAt: "2026-07-20T00:00:00.000Z",
        updatedAt: "2026-07-20T00:00:00.000Z"
      }
    );
    const settings = new SettingsService(database);
    const market = new MarketService(database, settings, [tencent, mock]);
    const instrument = market.upsertInstrument({ code: "563230", exchange: "fund", name: "卫星ETF富国", assetType: "fund" });

    market.setDataSourceConfig("user-id", { primary: "mock", fallback: "tencent" });
    await market.getHistory("user-id", instrument.id, "day", true);

    market.setDataSourceConfig("user-id", { primary: "tencent", fallback: "mock" });
    const result = await market.getHistory("user-id", instrument.id, "day", false);

    expect(tencentCalls).toBe(1);
    expect(result.source).toBe("tencent");
    expect(result.bars.at(-1)?.close).toBe(1.05);
  });
});
