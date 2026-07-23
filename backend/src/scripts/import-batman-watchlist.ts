import { resolve } from "node:path";
import { loadRuntimeConfig } from "../config";
import { IronManDatabase } from "../db/database";
import { importBatmanWatchlist } from "../maintenance/batman-watchlist-import";

const argumentsByName = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  const value = process.argv[index + 1];
  if (name?.startsWith("--") && value !== undefined) {
    argumentsByName.set(name.slice(2), value);
  }
}

const sourceDatabasePath = argumentsByName.get("source");
const targetEmail = argumentsByName.get("target-email");
if (sourceDatabasePath === undefined || targetEmail === undefined) {
  throw new Error("用法: bun run import:batman-watchlist -- --source /path/to/batman.db --target-email batman@stark.com [--target-db /path/to/ironman.sqlite]");
}

const runtime = loadRuntimeConfig({ ...process.env, DATABASE_PATH: argumentsByName.get("target-db") ?? process.env.DATABASE_PATH });
const targetDatabase = new IronManDatabase(resolve(runtime.databasePath));
try {
  const summary = importBatmanWatchlist({
    sourceDatabasePath: resolve(sourceDatabasePath),
    targetDatabase,
    targetEmail
  });
  console.log(JSON.stringify(summary));
} finally {
  targetDatabase.close();
}
