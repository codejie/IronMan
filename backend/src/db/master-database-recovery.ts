import { Database } from "bun:sqlite";
import { constants, copyFileSync, existsSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { IronManDatabase, LATEST_SCHEMA_VERSION } from "./database";

type SqlValue = string | number | bigint | boolean | null | Uint8Array;
type SqlRow = Record<string, SqlValue | undefined>;

interface TableColumn {
  name: string;
  notnull: number;
  dflt_value: SqlValue | null;
  pk: number;
}

interface SourceLedgerRow {
  id: string;
  user_id: string;
  type: string;
  related_transaction_id: string | null;
  amount: number;
  note: string | null;
  occurred_at: string;
  created_at: string;
}

interface HoldingTransactionRow {
  id: string;
  holding_id: string;
}

export interface MasterRecoveryInput {
  sourcePath: string;
  targetPath: string;
}

export interface MasterRecoverySummary {
  sourceLedgerCount: number;
  targetLedgerCount: number;
  migratedTableCounts: Record<string, number>;
}

export interface MasterRecoveryActivationInput extends MasterRecoveryInput {
  backupPath: string;
}

const compatibleTableOrder = [
  "users",
  "sessions",
  "user_settings",
  "audit_logs",
  "instruments",
  "market_bars",
  "watchlist_entries",
  "cash_accounts",
  "holdings",
  "holding_transactions",
  "strategies",
  "analysis_tasks",
  "analysis_reports",
  "scheduled_jobs",
  "task_logs",
  "notes",
  "assistant_conversations",
  "assistant_messages",
  "trend_strategies",
  "trend_strategy_targets",
  "trend_strategy_indicators",
  "trend_runs",
  "trend_run_reports",
  "trend_run_logs",
  "trend_run_report_interpretations",
  "legacy_alerts",
  "legacy_alert_events",
  "alert_rules",
  "alert_events",
  "alert_suggestions",
  "fund_daily_metrics",
  "fund_history_state",
  "market_intraday_snapshots",
  "market_snapshot_states",
  "holding_diagnosis_runs",
  "holding_diagnosis_reports",
  "holding_diagnosis_items",
  "holding_diagnosis_sources",
] as const;

const requiredSourceTables = ["users", "instruments", "cash_accounts", "holdings", "holding_transactions", "cash_ledger"] as const;
const supportedLedgerTypes = new Set(["adjustment", "buy", "sell", "dividend"]);

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_]+$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function listTables(database: Database): Set<string> {
  return new Set(
    (database.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>)
      .map((row) => row.name),
  );
}

function listSourceColumns(database: Database, tableName: string): TableColumn[] {
  return database.query(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all() as TableColumn[];
}

function listTargetColumns(database: IronManDatabase, tableName: string): TableColumn[] {
  return database.all<TableColumn>(`PRAGMA table_info(${quoteIdentifier(tableName)})`);
}

function countRows(database: Database, tableName: string): number {
  return (database.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`).get() as { count: number }).count;
}

function countTargetRows(database: IronManDatabase, tableName: string): number {
  return database.get<{ count: number }>(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`)?.count ?? 0;
}

function copyCompatibleTable(source: Database, target: IronManDatabase, tableName: string): number {
  const sourceColumns = listSourceColumns(source, tableName);
  const sourceColumnNames = new Set(sourceColumns.map((column) => column.name));
  const targetColumns = listTargetColumns(target, tableName);
  const transferableColumns = targetColumns.filter((column) => sourceColumnNames.has(column.name)).map((column) => column.name);
  const missingRequiredColumns = targetColumns.filter(
    (column) => !sourceColumnNames.has(column.name) && column.notnull === 1 && column.dflt_value === null && column.pk === 0,
  );
  const sourceCount = countRows(source, tableName);
  if (sourceCount > 0 && missingRequiredColumns.length > 0) {
    throw new Error(`Cannot migrate ${tableName}: missing required columns ${missingRequiredColumns.map((column) => column.name).join(", ")}`);
  }
  if (transferableColumns.length === 0) {
    return 0;
  }

  const quotedColumns = transferableColumns.map(quoteIdentifier).join(", ");
  const parameterNames = transferableColumns.map((column) => `$${column}`).join(", ");
  const rows = source.query(`SELECT ${quotedColumns} FROM ${quoteIdentifier(tableName)}`).all() as SqlRow[];
  const insert = `INSERT INTO ${quoteIdentifier(tableName)} (${quotedColumns}) VALUES (${parameterNames})`;
  for (const row of rows) {
    const values: Record<string, SqlValue> = {};
    for (const column of transferableColumns) {
      values[column] = row[column] ?? null;
    }
    target.run(insert, values);
  }
  return rows.length;
}

function sourceLedgerRows(source: Database): SourceLedgerRow[] {
  const sourceColumnNames = new Set(listSourceColumns(source, "cash_ledger").map((column) => column.name));
  const transactionColumn = sourceColumnNames.has("related_transaction_id")
    ? "related_transaction_id"
    : sourceColumnNames.has("holding_transaction_id")
      ? "holding_transaction_id"
      : undefined;
  if (!sourceColumnNames.has("type") || transactionColumn === undefined) {
    throw new Error("Source cash_ledger does not have the forward ledger fields required for master recovery");
  }
  const noteExpression = sourceColumnNames.has("reason")
    ? `${quoteIdentifier("reason")} AS note`
    : sourceColumnNames.has("note")
      ? `${quoteIdentifier("note")} AS note`
      : "'' AS note";
  return source.query(
    `SELECT id, user_id, type, ${quoteIdentifier(transactionColumn)} AS related_transaction_id, amount, ${noteExpression}, occurred_at, created_at
       FROM cash_ledger ORDER BY occurred_at, created_at, id`,
  ).all() as SourceLedgerRow[];
}

function copyLedger(source: Database, target: IronManDatabase): number {
  const transactions = new Map(
    (source.query("SELECT id, holding_id FROM holding_transactions").all() as HoldingTransactionRow[])
      .map((transaction) => [transaction.id, transaction.holding_id]),
  );
  const ledgerRows = sourceLedgerRows(source);
  const insert = `INSERT INTO cash_ledger (
    id, user_id, amount, category, reference_id, holding_transaction_id, note, occurred_at, created_at
  ) VALUES ($id, $userId, $amount, $category, $referenceId, $holdingTransactionId, $note, $occurredAt, $createdAt)`;
  for (const row of ledgerRows) {
    if (!supportedLedgerTypes.has(row.type)) {
      throw new Error(`Cannot migrate cash ledger ${row.id}: unsupported type ${row.type}`);
    }
    const requiresTransaction = row.type !== "adjustment";
    const holdingId = row.related_transaction_id === null ? undefined : transactions.get(row.related_transaction_id);
    if (requiresTransaction && holdingId === undefined) {
      throw new Error(`Cannot migrate cash ledger ${row.id}: related transaction is missing`);
    }
    target.run(insert, {
      id: row.id,
      userId: row.user_id,
      amount: row.amount,
      category: row.type,
      referenceId: holdingId ?? null,
      holdingTransactionId: row.related_transaction_id,
      note: row.note ?? "",
      occurredAt: row.occurred_at,
      createdAt: row.created_at,
    });
  }
  return ledgerRows.length;
}

function validateRecovery(source: Database, target: IronManDatabase, migratedTableCounts: Record<string, number>, sourceLedgerCount: number): void {
  for (const [tableName, expectedCount] of Object.entries(migratedTableCounts)) {
    const actualCount = countTargetRows(target, tableName);
    if (actualCount !== expectedCount) {
      throw new Error(`Recovered ${tableName} count ${actualCount} does not match source count ${expectedCount}`);
    }
  }
  const targetLedgerCount = countTargetRows(target, "cash_ledger");
  if (targetLedgerCount !== sourceLedgerCount) {
    throw new Error(`Recovered cash_ledger count ${targetLedgerCount} does not match source count ${sourceLedgerCount}`);
  }
  const invalidLedgerTypes = target.all<{ category: string }>(
    "SELECT DISTINCT category FROM cash_ledger WHERE category NOT IN ('adjustment', 'buy', 'sell', 'dividend')",
  );
  if (invalidLedgerTypes.length > 0) {
    throw new Error("Recovered cash_ledger contains unsupported legacy categories");
  }
  const foreignKeyViolations = target.all<Record<string, SqlValue>>("PRAGMA foreign_key_check");
  if (foreignKeyViolations.length > 0) {
    throw new Error(`Recovered database has ${foreignKeyViolations.length} foreign-key violation(s)`);
  }
  for (const tableName of requiredSourceTables) {
    if (!listTables(source).has(tableName)) {
      throw new Error(`Source database is missing required table ${tableName}`);
    }
  }
}

export function recoverDatabaseForMaster({ sourcePath, targetPath }: MasterRecoveryInput): MasterRecoverySummary {
  if (!existsSync(sourcePath)) {
    throw new Error(`Source database does not exist: ${sourcePath}`);
  }
  if (existsSync(targetPath)) {
    throw new Error(`Recovery target already exists: ${targetPath}`);
  }

  const source = new Database(sourcePath, { readonly: true, strict: true });
  let target: IronManDatabase | undefined;
  try {
    const sourceTables = listTables(source);
    for (const tableName of requiredSourceTables) {
      if (!sourceTables.has(tableName)) {
        throw new Error(`Source database is missing required table ${tableName}`);
      }
    }
    target = new IronManDatabase(targetPath);
    const migratedTableCounts: Record<string, number> = {};
    target.transaction(() => {
      for (const tableName of compatibleTableOrder) {
        if (sourceTables.has(tableName)) {
          migratedTableCounts[tableName] = copyCompatibleTable(source, target!, tableName);
        }
      }
      copyLedger(source, target!);
    });
    const sourceLedgerCount = countRows(source, "cash_ledger");
    validateRecovery(source, target, migratedTableCounts, sourceLedgerCount);
    return {
      sourceLedgerCount,
      targetLedgerCount: countTargetRows(target, "cash_ledger"),
      migratedTableCounts,
    };
  } finally {
    source.close();
    target?.close();
  }
}

export function createDatabaseBackup(sourcePath: string, backupPath: string): void {
  if (!existsSync(sourcePath)) {
    throw new Error(`Source database does not exist: ${sourcePath}`);
  }
  if (existsSync(backupPath)) {
    throw new Error(`Backup destination already exists: ${backupPath}`);
  }
  const source = new Database(sourcePath, { strict: true });
  try {
    source.run("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    source.close();
  }
  copyFileSync(sourcePath, backupPath, constants.COPYFILE_EXCL);
  const backup = new Database(backupPath, { strict: true });
  try {
    // A copied WAL database needs its own journal mode before it can be reopened independently.
    backup.run("PRAGMA journal_mode = DELETE");
    const integrity = backup.query("PRAGMA integrity_check").get() as { integrity_check: string } | null;
    if (integrity?.integrity_check !== "ok") {
      throw new Error(`Backup integrity check failed: ${integrity?.integrity_check ?? "no result"}`);
    }
  } finally {
    backup.close();
  }
}

export function recoverAndActivateMasterDatabase(input: MasterRecoveryActivationInput): MasterRecoverySummary {
  if (dirname(input.sourcePath) !== dirname(input.targetPath) || dirname(input.sourcePath) !== dirname(input.backupPath)) {
    throw new Error("Source, backup, and recovery target must be on the same filesystem for an atomic activation");
  }
  createDatabaseBackup(input.sourcePath, input.backupPath);
  const summary = recoverDatabaseForMaster(input);
  const movedSidecars: Array<{ source: string; backup: string }> = [];
  try {
    for (const suffix of ["-wal", "-shm"]) {
      const sidecarPath = `${input.sourcePath}${suffix}`;
      if (existsSync(sidecarPath)) {
        // The backup verification may create its own transient sidecar files.
        // Preserve the source sidecars under a separate archival name instead.
        const backupSidecarPath = `${input.backupPath}.source${suffix}`;
        if (existsSync(backupSidecarPath)) {
          throw new Error(`Backup sidecar destination already exists: ${backupSidecarPath}`);
        }
        renameSync(sidecarPath, backupSidecarPath);
        movedSidecars.push({ source: sidecarPath, backup: backupSidecarPath });
      }
    }
    renameSync(input.targetPath, input.sourcePath);
  } catch (error) {
    for (const sidecar of movedSidecars.reverse()) {
      if (existsSync(sidecar.backup) && !existsSync(sidecar.source)) {
        renameSync(sidecar.backup, sidecar.source);
      }
    }
    throw error;
  }
  return summary;
}

export function currentMasterSchemaVersion(): number {
  return LATEST_SCHEMA_VERSION;
}
