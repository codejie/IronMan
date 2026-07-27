import { IronManDatabase } from "../db/database";
import { errors } from "../errors";

type ExportRecord = Record<string, string | number | boolean | null>;
export interface UserExport {
  version: 1;
  exportedAt: string;
  data: Record<string, ExportRecord[]>;
}

interface TableSpec {
  name: string;
  columns: string[];
  userOwned?: boolean;
}

const exportTables: TableSpec[] = [
  { name: "user_settings", columns: ["id", "setting_key", "value_json", "created_at", "updated_at"] },
  { name: "assistant_conversations", columns: ["id", "title", "created_at", "updated_at"] },
  { name: "assistant_messages", columns: ["id", "conversation_id", "role", "content", "result_json", "created_at"] },
  { name: "notes", columns: ["id", "instrument_id", "title", "content", "tags_json", "created_at", "updated_at"] },
  { name: "watchlist_entries", columns: ["id", "instrument_id", "note", "target_price", "sort_order", "created_at", "updated_at"] },
  { name: "cash_accounts", columns: ["available", "updated_at"], userOwned: false },
  { name: "cash_ledger", columns: ["id", "amount", "category", "reference_id", "note", "occurred_at", "created_at"] },
  { name: "holdings", columns: ["id", "instrument_id", "status", "created_at", "updated_at"] },
  { name: "holding_transactions", columns: ["id", "holding_id", "action", "quantity", "price", "fee", "note", "occurred_at", "created_at"] },
  { name: "strategies", columns: ["id", "name", "instrument_ids_json", "indicators_json", "created_at", "updated_at"] },
  { name: "analysis_tasks", columns: ["id", "strategy_id", "status", "progress", "error_message", "created_at", "started_at", "completed_at"] },
  { name: "analysis_reports", columns: ["id", "task_id", "instrument_id", "result_json", "created_at"] },
  { name: "task_logs", columns: ["id", "task_id", "level", "message", "created_at"] },
  { name: "scheduled_jobs", columns: ["id", "name", "kind", "strategy_id", "interval_minutes", "enabled", "last_run_at", "next_run_at", "created_at", "updated_at"] },
  { name: "alerts", columns: ["id", "instrument_id", "direction", "threshold", "cooldown_minutes", "enabled", "last_triggered_at", "created_at", "updated_at"] },
  { name: "alert_events", columns: ["id", "alert_id", "price", "message", "created_at"] }
];

const deletionOrder = ["task_logs", "analysis_reports", "analysis_tasks", "scheduled_jobs", "alert_events", "alerts", "strategies", "holding_transactions", "holdings", "cash_ledger", "cash_accounts", "watchlist_entries", "notes", "assistant_messages", "assistant_conversations", "user_settings"];

export class BackupService {
  constructor(private readonly database: IronManDatabase) {}

  exportUserData(userId: string): UserExport {
    const data: Record<string, ExportRecord[]> = {};
    for (const spec of exportTables) {
      const columns = spec.columns.join(", ");
      const filter = spec.name === "user_settings" ? "user_id = $userId AND setting_key NOT LIKE 'ai.%'" : "user_id = $userId";
      data[this.exportName(spec.name)] = this.database.all<ExportRecord>(`SELECT ${columns} FROM ${spec.name} WHERE ${filter}`, { userId });
    }
    data.settings = data.settings?.map((setting) => ({ ...setting, key: setting.setting_key ?? null })) ?? [];
    return { version: 1, exportedAt: new Date().toISOString(), data };
  }

  importUserData(userId: string, payload: unknown): void {
    if (!isUserExport(payload)) throw errors.validation("导入文件格式无效");
    this.database.transaction(() => {
      for (const table of deletionOrder) this.database.run(`DELETE FROM ${table} WHERE user_id = $userId`, { userId });
      for (const spec of exportTables) {
        const entries = payload.data[this.exportName(spec.name)] ?? [];
        for (const entry of entries) this.insert(userId, spec, entry);
      }
    });
  }

  private insert(userId: string, spec: TableSpec, entry: ExportRecord): void {
    const columns = spec.userOwned === false ? ["user_id", ...spec.columns] : ["user_id", ...spec.columns];
    const values = columns.map((column) => `$${column}`);
    const parameters: Record<string, string | number | boolean | null> = { user_id: userId };
    for (const column of spec.columns) {
      const value = entry[column];
      if (value === undefined) throw errors.validation(`导入数据缺少 ${spec.name}.${column}`);
      parameters[column] = value;
    }
    const conflict = spec.name === "cash_accounts" ? " ON CONFLICT(user_id) DO UPDATE SET available = excluded.available, updated_at = excluded.updated_at" : "";
    this.database.run(`INSERT INTO ${spec.name} (${columns.join(", ")}) VALUES (${values.join(", ")})${conflict}`, parameters);
  }

  private exportName(table: string): string {
    return table === "user_settings" ? "settings" : table;
  }
}

function isUserExport(payload: unknown): payload is UserExport {
  if (typeof payload !== "object" || payload === null) return false;
  const value = payload as Partial<UserExport>;
  return value.version === 1 && typeof value.exportedAt === "string" && typeof value.data === "object" && value.data !== null;
}
