import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IronManDatabase } from "../src/db/database";
import { importBatmanWatchlist } from "../src/maintenance/batman-watchlist-import";

let tempDirectory = "";
let targetDatabase: IronManDatabase;
let sourceDatabasePath = "";

beforeEach(() => {
  tempDirectory = mkdtempSync(join(tmpdir(), "ironman-batman-watchlist-"));
  targetDatabase = new IronManDatabase(join(tempDirectory, "ironman.sqlite"));
  sourceDatabasePath = join(tempDirectory, "batman.sqlite");

  const source = new Database(sourceDatabasePath, { create: true });
  try {
    source.exec(`
      CREATE TABLE user_customized_record (
        id INTEGER PRIMARY KEY,
        uid INTEGER NOT NULL,
        type INTEGER NOT NULL,
        code TEXT NOT NULL,
        target REAL,
        "order" INTEGER NOT NULL,
        comment TEXT
      );
      CREATE TABLE item_info_table (
        type INTEGER NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        market INTEGER,
        PRIMARY KEY (type, code)
      );
    `);
    source.run("INSERT INTO item_info_table (type, code, name, market) VALUES (2, '000981', '山子高科', 0), (2, '601138', '工业富联', 0), (2, '603122', '合富中国', 0), (3, '563230', '卫星ETF富国', 1)");
    source.run("INSERT INTO user_customized_record (uid, type, code, target, \"order\", comment) VALUES (99, 2, '000981', 5.3, 11, '观察突破'), (99, 2, '601138', 63.46, 12, NULL), (99, 2, '603122', 24.56, 13, '等待确认'), (99, 3, '563230', NULL, 14, '')");
  } finally {
    source.close();
  }

  const now = new Date().toISOString();
  targetDatabase.run(
    `INSERT INTO users (id, email, password_hash, display_name, role, status, created_at, updated_at)
     VALUES ($id, $email, 'not-used', 'Batman', 'user', 'active', $createdAt, $updatedAt)`,
    { id: "batman-user", email: "batman@stark.com", createdAt: now, updatedAt: now }
  );
});

afterEach(() => {
  targetDatabase.close();
  rmSync(tempDirectory, { force: true, recursive: true });
});

describe("Batman watchlist import", () => {
  test("imports source records for only the selected IronMan account and preserves metadata", () => {
    const summary = importBatmanWatchlist({
      sourceDatabasePath,
      targetDatabase,
      targetEmail: "batman@stark.com"
    });

    expect(summary).toEqual({ sourceRecords: 4, createdInstruments: 4, importedWatchlistEntries: 4, skippedWatchlistEntries: 0 });
    const entries = targetDatabase.all<{ code: string; exchange: string; asset_type: string; target_price: number | null; note: string; sort_order: number }>(
      `SELECT instruments.code, instruments.exchange, instruments.asset_type, watchlist_entries.target_price, watchlist_entries.note, watchlist_entries.sort_order
         FROM watchlist_entries JOIN instruments ON instruments.id = watchlist_entries.instrument_id
        WHERE watchlist_entries.user_id = 'batman-user' ORDER BY watchlist_entries.sort_order ASC`
    );
    expect(entries).toEqual([
      { code: "000981", exchange: "sz", asset_type: "stock", target_price: 5.3, note: "观察突破", sort_order: 11 },
      { code: "601138", exchange: "sh", asset_type: "stock", target_price: 63.46, note: "", sort_order: 12 },
      { code: "603122", exchange: "sh", asset_type: "stock", target_price: 24.56, note: "等待确认", sort_order: 13 },
      { code: "563230", exchange: "fund", asset_type: "fund", target_price: null, note: "", sort_order: 14 }
    ]);
    expect(targetDatabase.get<{ action: string; metadata_json: string }>("SELECT action, metadata_json FROM audit_logs ORDER BY created_at DESC LIMIT 1")).toMatchObject({ action: "maintenance.batman-watchlist-import" });
  });

  test("is idempotent and leaves pre-existing IronMan entries unchanged", () => {
    importBatmanWatchlist({ sourceDatabasePath, targetDatabase, targetEmail: "batman@stark.com" });
    targetDatabase.run(
      "UPDATE watchlist_entries SET note = 'IronMan 保留备注', target_price = 99 WHERE user_id = 'batman-user' AND instrument_id = (SELECT id FROM instruments WHERE code = '000981' AND exchange = 'sz')"
    );

    const summary = importBatmanWatchlist({ sourceDatabasePath, targetDatabase, targetEmail: "batman@stark.com" });

    expect(summary).toEqual({ sourceRecords: 4, createdInstruments: 0, importedWatchlistEntries: 0, skippedWatchlistEntries: 4 });
    expect(targetDatabase.get<{ note: string; target_price: number }>(
      "SELECT note, target_price FROM watchlist_entries WHERE user_id = 'batman-user' AND instrument_id = (SELECT id FROM instruments WHERE code = '000981' AND exchange = 'sz')"
    )).toEqual({ note: "IronMan 保留备注", target_price: 99 });
  });

  test("rejects an unknown target account before writing imported data", () => {
    expect(() => importBatmanWatchlist({ sourceDatabasePath, targetDatabase, targetEmail: "missing@example.com" })).toThrow("目标账户不存在");
    expect(targetDatabase.get<{ count: number }>("SELECT COUNT(*) AS count FROM instruments")?.count).toBe(0);
    expect(targetDatabase.get<{ count: number }>("SELECT COUNT(*) AS count FROM watchlist_entries")?.count).toBe(0);
  });

  test("rejects a source database whose text encoding is not UTF-8", () => {
    const utf16Path = join(tempDirectory, "batman-utf16.sqlite");
    const source = new Database(utf16Path, { create: true });
    try {
      source.exec("PRAGMA encoding = 'UTF-16le'");
      source.exec(`
        CREATE TABLE user_customized_record (
          id INTEGER PRIMARY KEY,
          uid INTEGER NOT NULL,
          type INTEGER NOT NULL,
          code TEXT NOT NULL,
          target REAL,
          "order" INTEGER NOT NULL,
          comment TEXT
        );
        CREATE TABLE item_info_table (
          type INTEGER NOT NULL,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          market INTEGER,
          PRIMARY KEY (type, code)
        );
      `);
    } finally {
      source.close();
    }

    expect(() => importBatmanWatchlist({ sourceDatabasePath: utf16Path, targetDatabase, targetEmail: "batman@stark.com" })).toThrow("源数据库编码");
    expect(targetDatabase.get<{ count: number }>("SELECT COUNT(*) AS count FROM instruments")?.count).toBe(0);
  });
});
