import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IronManDatabase } from "../src/db/database";
import { MarketService } from "../src/services/market-service";
import { SettingsService } from "../src/services/settings-service";
import {
  buildLimitUpPoolTable,
  filterRankingRows,
  parseThsRankingTable,
  ThirdPartyDataService,
  thirdPartyInfoLinks
} from "../src/services/third-party-data-service";

const unavailableAkShare = { technical: async () => Promise.reject(new Error("AKShare unavailable")) };

describe("third-party market data adapters", () => {
  test("parses a Tonghuashun ranking table into stable columns and rows", () => {
    const table = parseThsRankingTable(`
      <table><thead><tr><th>序号</th><th>股票代码</th><th>股票简称</th><th>连涨天数</th></tr></thead>
      <tbody><tr><td>1</td><td><a>600000</a></td><td>浦发银行</td><td>4</td></tr></tbody></table>
    `);

    expect(table.columns).toEqual(["序号", "股票代码", "股票简称", "连涨天数"]);
    expect(table.rows).toEqual([{ "序号": "1", "股票代码": "600000", "股票简称": "浦发银行", "连涨天数": "4" }]);
  });

  test("filters day-based technical rankings without depending on a column order", () => {
    const rows = filterRankingRows(
      [
        { "股票代码": "600000", "连涨天数": "2" },
        { "股票代码": "000001", "连涨天数": "5" }
      ],
      "连涨天数",
      3
    );

    expect(rows).toEqual([{ "股票代码": "000001", "连涨天数": "5" }]);
  });

  test("maps the Eastmoney limit-up pool fields into readable table values", () => {
    const table = buildLimitUpPoolTable({
      data: {
        pool: [
          {
            f2: 10.52,
            f3: 10.01,
            f6: 123_000_000,
            f8: 4.21,
            f12: "600000",
            f14: "浦发银行",
            f20: 280_000_000_000,
            f21: 190_000_000_000,
            f62: 21_000_000
          }
        ]
      }
    });

    expect(table.columns).toContain("代码");
    expect(table.rows[0]).toMatchObject({ 代码: "600000", 名称: "浦发银行", 最新价: 10.52, 涨跌幅: 10.01 });
  });

  test("keeps Batman's information-link groups while adding code-aware destinations", () => {
    const groups = thirdPartyInfoLinks();
    expect(groups.map((group) => group.label)).toEqual(expect.arrayContaining(["热度信息", "行情数据", "财经资讯", "个股数据"]));
    expect(groups.find((group) => group.label === "个股数据")?.links.some((link) => link.needCode)).toBe(true);
  });

  test("falls back to only the current user's cached instruments when an upstream ranking is unavailable", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ironman-third-party-"));
    const database = new IronManDatabase(join(directory, "ironman.sqlite"));
    try {
      const userId = crypto.randomUUID();
      const now = new Date().toISOString();
      database.run(
        `INSERT INTO users (id, email, password_hash, display_name, role, status, created_at, updated_at)
         VALUES ($id, $email, $passwordHash, $displayName, 'user', 'active', $createdAt, $updatedAt)`,
        { id: userId, email: "third-party@example.com", passwordHash: "not-used-in-this-test", displayName: "Third Party", createdAt: now, updatedAt: now }
      );
      const market = new MarketService(database, new SettingsService(database));
      const instrument = market.upsertInstrument({ code: "600000", exchange: "sh", name: "浦发银行", assetType: "stock" });
      database.run(
        `INSERT INTO watchlist_entries (id, user_id, instrument_id, note, target_price, sort_order, created_at, updated_at)
         VALUES ($id, $userId, $instrumentId, '', NULL, 0, $createdAt, $updatedAt)`,
        { id: crypto.randomUUID(), userId, instrumentId: instrument.id, createdAt: now, updatedAt: now }
      );
      for (const [date, close] of [["2026-07-20", 10], ["2026-07-21", 10.5], ["2026-07-22", 11]] as const) {
        database.run(
          `INSERT INTO market_bars (id, instrument_id, timeframe, source, trade_date, open, close, high, low, volume, created_at)
           VALUES ($id, $instrumentId, 'day', 'mock', $date, $open, $close, $high, $low, $volume, $createdAt)`,
          { id: crypto.randomUUID(), instrumentId: instrument.id, date, open: close, close, high: close, low: close, volume: 1000, createdAt: now }
        );
      }
      const service = new ThirdPartyDataService(database, market, async () => {
        throw new Error("third-party unavailable");
      }, unavailableAkShare);

      const table = await service.technical(userId, { kind: "uptrend", days: 2 });
      expect(table.source).toBe("local");
      expect(table.notice).toContain("本地计算结果");
      expect(table.rows[0]?.values).toMatchObject({ 代码: "600000", 连涨天数: 2 });
      expect(table.rows[0]?.instrument?.id).toBe(instrument.id);
    } finally {
      database.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("uses the local AKShare Provider before public scraping and attaches instruments", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ironman-third-party-akshare-"));
    const database = new IronManDatabase(join(directory, "ironman.sqlite"));
    try {
      const market = new MarketService(database, new SettingsService(database));
      const service = new ThirdPartyDataService(
        database,
        market,
        async () => {
          throw new Error("public fallback must not run");
        },
        {
          technical: async () => ({
            columns: ["代码", "名称", "连涨天数"],
            rows: [{ "代码": "600000", "名称": "浦发银行", "连涨天数": 4 }]
          })
        }
      );

      const table = await service.technical(crypto.randomUUID(), { kind: "uptrend", days: 3 });
      expect(table.source).toBe("akshare");
      expect(table.rows).toHaveLength(1);
      expect(table.rows[0]?.instrument).toMatchObject({ code: "600000", name: "浦发银行", assetType: "stock" });
    } finally {
      database.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
