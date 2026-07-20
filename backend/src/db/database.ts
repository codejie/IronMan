import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

type SqlParameters = Record<string, string | number | bigint | boolean | null | Uint8Array> | Array<string | number | bigint | boolean | null | Uint8Array>;

interface Migration {
  version: number;
  sql: string;
}

const migrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
        status TEXT NOT NULL CHECK (status IN ('active', 'disabled')) DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id, expires_at);

      CREATE TABLE IF NOT EXISTS user_settings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        setting_key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, setting_key)
      );
      CREATE INDEX IF NOT EXISTS user_settings_owner_idx ON user_settings(user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs(actor_id, created_at DESC);
    `
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS instruments (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        exchange TEXT NOT NULL CHECK (exchange IN ('sh', 'sz', 'bj', 'fund')),
        name TEXT NOT NULL,
        asset_type TEXT NOT NULL CHECK (asset_type IN ('stock', 'index', 'fund')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(code, exchange)
      );
      CREATE INDEX IF NOT EXISTS instruments_search_idx ON instruments(code, name);

      CREATE TABLE IF NOT EXISTS market_bars (
        id TEXT PRIMARY KEY,
        instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
        timeframe TEXT NOT NULL CHECK (timeframe IN ('day', 'week', 'month')),
        source TEXT NOT NULL,
        trade_date TEXT NOT NULL,
        open REAL NOT NULL,
        close REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        volume REAL NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(instrument_id, timeframe, source, trade_date)
      );
      CREATE INDEX IF NOT EXISTS market_bars_lookup_idx ON market_bars(instrument_id, timeframe, source, trade_date DESC);

      CREATE TABLE IF NOT EXISTS watchlist_entries (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE RESTRICT,
        note TEXT NOT NULL DEFAULT '',
        target_price REAL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, instrument_id)
      );
      CREATE INDEX IF NOT EXISTS watchlist_entries_owner_idx ON watchlist_entries(user_id, sort_order, created_at DESC);

      CREATE TABLE IF NOT EXISTS cash_accounts (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        available REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cash_ledger (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount REAL NOT NULL,
        category TEXT NOT NULL CHECK (category IN ('adjustment', 'buy', 'sell', 'dividend')),
        reference_id TEXT,
        note TEXT NOT NULL DEFAULT '',
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS cash_ledger_owner_idx ON cash_ledger(user_id, occurred_at DESC);

      CREATE TABLE IF NOT EXISTS holdings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE RESTRICT,
        status TEXT NOT NULL CHECK (status IN ('active', 'closed')) DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS holdings_active_unique_idx ON holdings(user_id, instrument_id) WHERE status = 'active';
      CREATE INDEX IF NOT EXISTS holdings_owner_idx ON holdings(user_id, status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS holding_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        holding_id TEXT NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
        action TEXT NOT NULL CHECK (action IN ('buy', 'sell', 'dividend')),
        quantity REAL NOT NULL DEFAULT 0,
        price REAL NOT NULL DEFAULT 0,
        fee REAL NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS holding_transactions_owner_idx ON holding_transactions(user_id, holding_id, occurred_at ASC);
    `
  },
  {
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS strategies (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        instrument_ids_json TEXT NOT NULL,
        indicators_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, name)
      );
      CREATE INDEX IF NOT EXISTS strategies_owner_idx ON strategies(user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS analysis_tasks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        strategy_id TEXT NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
        error_message TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS analysis_tasks_owner_idx ON analysis_tasks(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS analysis_reports (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES analysis_tasks(id) ON DELETE CASCADE,
        instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE RESTRICT,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(task_id, instrument_id)
      );
      CREATE INDEX IF NOT EXISTS analysis_reports_owner_idx ON analysis_reports(user_id, task_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('analysis', 'alert-scan')),
        strategy_id TEXT REFERENCES strategies(id) ON DELETE SET NULL,
        interval_minutes INTEGER NOT NULL CHECK (interval_minutes BETWEEN 1 AND 10080),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        last_run_at TEXT,
        next_run_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS scheduled_jobs_due_idx ON scheduled_jobs(enabled, next_run_at);
      CREATE INDEX IF NOT EXISTS scheduled_jobs_owner_idx ON scheduled_jobs(user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE RESTRICT,
        direction TEXT NOT NULL CHECK (direction IN ('above', 'below')),
        threshold REAL NOT NULL,
        cooldown_minutes INTEGER NOT NULL DEFAULT 60 CHECK (cooldown_minutes BETWEEN 1 AND 10080),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        last_triggered_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS alerts_owner_idx ON alerts(user_id, enabled, updated_at DESC);

      CREATE TABLE IF NOT EXISTS alert_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        alert_id TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
        price REAL NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS alert_events_owner_idx ON alert_events(user_id, created_at DESC);
    `
  },
  {
    version: 4,
    sql: `
      CREATE TABLE IF NOT EXISTS task_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES analysis_tasks(id) ON DELETE CASCADE,
        level TEXT NOT NULL CHECK (level IN ('info', 'error')),
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS task_logs_owner_idx ON task_logs(user_id, task_id, created_at ASC);
    `
  },
  {
    version: 5,
    sql: `
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        instrument_id TEXT REFERENCES instruments(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS notes_owner_idx ON notes(user_id, updated_at DESC);
    `
  }
];

export class IronManDatabase {
  private readonly connection: Database;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.connection = new Database(databasePath, { create: true, strict: true });
    this.connection.run("PRAGMA foreign_keys = ON");
    this.connection.run("PRAGMA journal_mode = WAL");
    this.connection.run("PRAGMA busy_timeout = 5000");
    this.migrate();
  }

  all<T>(sql: string, parameters: SqlParameters = {}): T[] {
    return this.connection.query(sql).all(parameters as never) as T[];
  }

  get<T>(sql: string, parameters: SqlParameters = {}): T | undefined {
    return (this.connection.query(sql).get(parameters as never) as T | null) ?? undefined;
  }

  run(sql: string, parameters: SqlParameters = {}): void {
    this.connection.query(sql).run(parameters as never);
  }

  transaction<T>(work: () => T): T {
    return this.connection.transaction(work)();
  }

  getAppliedMigrationVersions(): number[] {
    return this.all<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version ASC").map((row) => row.version);
  }

  close(): void {
    this.connection.run("PRAGMA wal_checkpoint(TRUNCATE)");
    this.connection.close();
  }

  private migrate(): void {
    this.connection.run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);

    const applied = new Set(this.all<{ version: number }>("SELECT version FROM schema_migrations").map((row) => row.version));
    for (const migration of migrations) {
      if (applied.has(migration.version)) {
        continue;
      }

      this.transaction(() => {
        this.connection.run(migration.sql);
        this.connection.query("INSERT INTO schema_migrations (version, applied_at) VALUES ($version, $appliedAt)").run({
          version: migration.version,
          appliedAt: new Date().toISOString()
        });
      });
    }
  }
}
