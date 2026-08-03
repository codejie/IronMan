import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type IronManRuntime } from "../src/app";
import { IronManDatabase, LATEST_SCHEMA_VERSION } from "../src/db/database";
import { recoverAndActivateMasterDatabase, recoverDatabaseForMaster } from "../src/db/master-database-recovery";

interface ApiResponse<T> {
  code: number;
  message?: string;
  result: T;
}

let temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
  temporaryDirectories = [];
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "ironman-master-recovery-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function createForwardDatabase(databasePath: string): Promise<void> {
  const database = new Database(databasePath, { create: true, strict: true });
  const passwordHash = await Bun.password.hash("a-strong-test-password");
  database.run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE instruments (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      exchange TEXT NOT NULL,
      name TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE cash_accounts (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      available REAL NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE holdings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      instrument_id TEXT NOT NULL REFERENCES instruments(id),
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE holding_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      holding_id TEXT NOT NULL REFERENCES holdings(id),
      action TEXT NOT NULL,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      fee REAL NOT NULL,
      note TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE cash_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      purpose TEXT NOT NULL,
      source TEXT NOT NULL,
      external_ref TEXT,
      import_batch_id TEXT,
      related_transaction_id TEXT,
      amount REAL NOT NULL,
      balance_after REAL NOT NULL,
      reason TEXT,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      idempotency_key TEXT
    );
  `);
  const now = "2026-08-03T00:00:00.000Z";
  for (let version = 1; version <= 14; version += 1) {
    database.query("INSERT INTO schema_migrations (version, applied_at) VALUES ($version, $now)").run({ version, now });
  }
  database.query(
    `INSERT INTO users (id, email, password_hash, display_name, role, status, created_at, updated_at)
     VALUES ($id, $email, $passwordHash, $displayName, 'user', 'active', $now, $now)`,
  ).run({ id: "alice", email: "alice@example.com", passwordHash, displayName: "Alice", now });
  database.query(
    `INSERT INTO users (id, email, password_hash, display_name, role, status, created_at, updated_at)
     VALUES ($id, $email, $passwordHash, $displayName, 'user', 'active', $now, $now)`,
  ).run({ id: "bob", email: "bob@example.com", passwordHash, displayName: "Bob", now });
  database.query(
    `INSERT INTO instruments (id, code, exchange, name, asset_type, created_at, updated_at)
     VALUES ('instrument-1', '600000', 'sh', '浦发银行', 'stock', $now, $now)`,
  ).run({ now });
  database.query("INSERT INTO cash_accounts (user_id, available, updated_at) VALUES ('alice', 1270, $now)").run({ now });
  database.query("INSERT INTO cash_accounts (user_id, available, updated_at) VALUES ('bob', 0, $now)").run({ now });
  database.query(
    `INSERT INTO holdings (id, user_id, instrument_id, status, created_at, updated_at)
     VALUES ('holding-1', 'alice', 'instrument-1', 'active', $now, $now)`,
  ).run({ now });
  const transaction = database.query(
    `INSERT INTO holding_transactions (id, user_id, holding_id, action, quantity, price, fee, note, occurred_at, created_at)
     VALUES ($id, 'alice', 'holding-1', $action, $quantity, $price, 0, '', $now, $now)`,
  );
  transaction.run({ id: "transaction-buy", action: "buy", quantity: 100, price: 10, now });
  transaction.run({ id: "transaction-sell", action: "sell", quantity: 20, price: 11, now });
  transaction.run({ id: "transaction-dividend", action: "dividend", quantity: 0, price: 50, now });
  const ledger = database.query(
    `INSERT INTO cash_ledger (
       id, user_id, type, purpose, source, related_transaction_id, amount, balance_after, reason, occurred_at, created_at
     ) VALUES ($id, 'alice', $type, 'investable', 'manual', $transactionId, $amount, $balanceAfter, $reason, $now, $now)`,
  );
  ledger.run({ id: "ledger-adjustment", type: "adjustment", transactionId: null, amount: 2000, balanceAfter: 2000, reason: "本金", now });
  ledger.run({ id: "ledger-buy", type: "buy", transactionId: "transaction-buy", amount: -1000, balanceAfter: 1000, reason: "买入", now });
  ledger.run({ id: "ledger-sell", type: "sell", transactionId: "transaction-sell", amount: 220, balanceAfter: 1220, reason: "卖出", now });
  ledger.run({ id: "ledger-dividend", type: "dividend", transactionId: "transaction-dividend", amount: 50, balanceAfter: 1270, reason: "分红", now });
  database.close();
}

async function post(runtime: IronManRuntime, path: string, body: unknown, token?: string): Promise<Response> {
  return runtime.app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  });
}

describe("master database recovery", () => {
  test("rebuilds a master-compatible ledger and serves the holdings workspace", async () => {
    const directory = temporaryDirectory();
    const sourcePath = join(directory, "forward.sqlite");
    const targetPath = join(directory, "master.sqlite");
    await createForwardDatabase(sourcePath);

    const recovery = recoverDatabaseForMaster({ sourcePath, targetPath });
    expect(recovery.sourceLedgerCount).toBe(4);
    expect(recovery.targetLedgerCount).toBe(4);

    const source = new Database(sourcePath, { readonly: true, strict: true });
    const target = new Database(targetPath, { readonly: true, strict: true });
    expect(source.query<{ type: string }, []>("SELECT type FROM cash_ledger WHERE id = 'ledger-buy'").get()?.type).toBe("buy");
    expect(target.query<{ category: string; reference_id: string | null; holding_transaction_id: string | null; note: string }, []>(
      "SELECT category, reference_id, holding_transaction_id, note FROM cash_ledger WHERE id = 'ledger-buy'",
    ).get()).toEqual({ category: "buy", reference_id: "holding-1", holding_transaction_id: "transaction-buy", note: "买入" });
    expect(target.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM pragma_foreign_key_check").get()?.count).toBe(0);
    expect(target.query<{ version: number }, []>("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get()?.version).toBe(LATEST_SCHEMA_VERSION);
    source.close();
    target.close();

    const runtime = createApp({ databasePath: targetPath, jwtSecret: "test-secret-that-is-long-enough", tokenTtlSeconds: 3600 });
    try {
      const login = await post(runtime, "/api/auth/login", { email: "alice@example.com", password: "a-strong-test-password" });
      const token = ((await login.json()) as ApiResponse<{ token: string }>).result.token;
      const workspace = await post(runtime, "/api/assets/holdings/batman-workspace", { refresh: false }, token);
      expect(workspace.status).toBe(200);
      expect(((await workspace.json()) as ApiResponse<{ active: unknown[] }>).result.active).toHaveLength(1);

      const bobLogin = await post(runtime, "/api/auth/login", { email: "bob@example.com", password: "a-strong-test-password" });
      const bobToken = ((await bobLogin.json()) as ApiResponse<{ token: string }>).result.token;
      const bobWorkspace = await post(runtime, "/api/assets/holdings/batman-workspace", { refresh: false }, bobToken);
      expect(((await bobWorkspace.json()) as ApiResponse<{ active: unknown[] }>).result.active).toHaveLength(0);
    } finally {
      runtime.close();
    }
  });

  test("rejects a database whose migration version is newer than the current application", () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, "forward-version.sqlite");
    const database = new Database(databasePath, { create: true, strict: true });
    database.run("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    database.query("INSERT INTO schema_migrations (version, applied_at) VALUES ($version, '2026-08-03T00:00:00.000Z')").run({ version: LATEST_SCHEMA_VERSION + 1 });
    database.close();

    expect(() => new IronManDatabase(databasePath)).toThrow("newer than this application supports");
  });

  test("backs up and atomically activates a verified master database", async () => {
    const directory = temporaryDirectory();
    const sourcePath = join(directory, "ironman.sqlite");
    const targetPath = join(directory, "ironman.master-recovery.sqlite");
    const backupPath = join(directory, "ironman.before-master-recovery.sqlite");
    await createForwardDatabase(sourcePath);
    const source = new Database(sourcePath, { strict: true });
    source.run("PRAGMA journal_mode = WAL");
    source.query("UPDATE users SET updated_at = updated_at").run();
    source.close();

    const recovery = recoverAndActivateMasterDatabase({ sourcePath, targetPath, backupPath });
    expect(recovery.targetLedgerCount).toBe(4);
    expect(existsSync(backupPath)).toBe(true);

    const active = new Database(sourcePath, { strict: true });
    const backup = new Database(backupPath, { readonly: true, strict: true });
    expect(active.query<{ category: string }, []>("SELECT category FROM cash_ledger WHERE id = 'ledger-buy'").get()?.category).toBe("buy");
    expect(backup.query<{ type: string }, []>("SELECT type FROM cash_ledger WHERE id = 'ledger-buy'").get()?.type).toBe("buy");
    active.close();
    backup.close();
  });
});
