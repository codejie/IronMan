import { IronManDatabase } from "../db/database";

interface SettingRow {
  setting_key: string;
  value_json: string;
  updated_at: string;
}

export interface UserSetting {
  key: string;
  value: unknown;
  updatedAt: string;
}

export class SettingsService {
  constructor(private readonly database: IronManDatabase) {}

  list(userId: string): UserSetting[] {
    return this.database
      .all<SettingRow>(
        "SELECT setting_key, value_json, updated_at FROM user_settings WHERE user_id = $userId ORDER BY setting_key ASC",
        { userId }
      )
      .map((row) => ({ key: row.setting_key, value: JSON.parse(row.value_json), updatedAt: row.updated_at }));
  }

  get(userId: string, key: string): UserSetting | undefined {
    const row = this.database.get<SettingRow>(
      "SELECT setting_key, value_json, updated_at FROM user_settings WHERE user_id = $userId AND setting_key = $key",
      { userId, key }
    );
    return row === undefined ? undefined : { key: row.setting_key, value: JSON.parse(row.value_json), updatedAt: row.updated_at };
  }

  upsert(userId: string, key: string, value: unknown): UserSetting {
    const now = new Date().toISOString();
    this.database.run(
      `INSERT INTO user_settings (id, user_id, setting_key, value_json, created_at, updated_at)
       VALUES ($id, $userId, $key, $valueJson, $createdAt, $updatedAt)
       ON CONFLICT(user_id, setting_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      {
        id: crypto.randomUUID(),
        userId,
        key,
        valueJson: JSON.stringify(value),
        createdAt: now,
        updatedAt: now
      }
    );
    return { key, value, updatedAt: now };
  }
}
