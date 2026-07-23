import { Database } from "bun:sqlite";
import { basename } from "node:path";
import { IronManDatabase } from "../db/database";
import type { AssetType, Exchange } from "../market/types";

interface BatmanWatchlistRow {
  type: number;
  code: string;
  name: string;
  target: number | null;
  order: number;
  comment: string | null;
}

interface TargetUserRow {
  id: string;
}

interface InstrumentRow {
  id: string;
}

export interface BatmanWatchlistImportInput {
  sourceDatabasePath: string;
  targetDatabase: IronManDatabase;
  targetEmail: string;
  sourceUserId?: number;
}

export interface BatmanWatchlistImportSummary {
  sourceRecords: number;
  createdInstruments: number;
  importedWatchlistEntries: number;
  skippedWatchlistEntries: number;
}

interface MappedInstrument {
  code: string;
  exchange: Exchange;
  name: string;
  assetType: AssetType;
  targetPrice: number | null;
  note: string;
  sortOrder: number;
}

export function importBatmanWatchlist(input: BatmanWatchlistImportInput): BatmanWatchlistImportSummary {
  const source = new Database(input.sourceDatabasePath, { readonly: true, strict: true });
  try {
    const sourceRows = source
      .query(
        `SELECT customized.type, customized.code, info.name, customized.target, customized."order" AS "order", customized.comment
           FROM user_customized_record AS customized
           JOIN item_info_table AS info ON info.type = customized.type AND info.code = customized.code
          WHERE customized.uid = $sourceUserId
          ORDER BY customized."order" ASC, customized.id ASC`
      )
      .all({ sourceUserId: input.sourceUserId ?? 99 }) as BatmanWatchlistRow[];
    const mappedRows = sourceRows.map(mapBatmanRow);
    const targetEmail = input.targetEmail.trim().toLowerCase();

    return input.targetDatabase.transaction(() => {
      const targetUser = input.targetDatabase.get<TargetUserRow>("SELECT id FROM users WHERE email = $email AND status = 'active'", { email: targetEmail });
      if (targetUser === undefined) {
        throw new Error(`目标账户不存在或不可用: ${targetEmail}`);
      }

      const summary: BatmanWatchlistImportSummary = {
        sourceRecords: mappedRows.length,
        createdInstruments: 0,
        importedWatchlistEntries: 0,
        skippedWatchlistEntries: 0
      };
      const now = new Date().toISOString();

      for (const row of mappedRows) {
        let instrument = input.targetDatabase.get<InstrumentRow>(
          "SELECT id FROM instruments WHERE code = $code AND exchange = $exchange",
          { code: row.code, exchange: row.exchange }
        );
        if (instrument === undefined) {
          instrument = { id: crypto.randomUUID() };
          input.targetDatabase.run(
            `INSERT INTO instruments (id, code, exchange, name, asset_type, created_at, updated_at)
             VALUES ($id, $code, $exchange, $name, $assetType, $createdAt, $updatedAt)`,
            {
              id: instrument.id,
              code: row.code,
              exchange: row.exchange,
              name: row.name,
              assetType: row.assetType,
              createdAt: now,
              updatedAt: now
            }
          );
          summary.createdInstruments += 1;
        }

        const existing = input.targetDatabase.get<{ id: string }>(
          "SELECT id FROM watchlist_entries WHERE user_id = $userId AND instrument_id = $instrumentId",
          { userId: targetUser.id, instrumentId: instrument.id }
        );
        if (existing !== undefined) {
          summary.skippedWatchlistEntries += 1;
          continue;
        }

        input.targetDatabase.run(
          `INSERT INTO watchlist_entries (id, user_id, instrument_id, note, target_price, sort_order, created_at, updated_at)
           VALUES ($id, $userId, $instrumentId, $note, $targetPrice, $sortOrder, $createdAt, $updatedAt)`,
          {
            id: crypto.randomUUID(),
            userId: targetUser.id,
            instrumentId: instrument.id,
            note: row.note,
            targetPrice: row.targetPrice,
            sortOrder: row.sortOrder,
            createdAt: now,
            updatedAt: now
          }
        );
        summary.importedWatchlistEntries += 1;
      }

      input.targetDatabase.run(
        "INSERT INTO audit_logs (id, actor_id, action, metadata_json, created_at) VALUES ($id, $actorId, $action, $metadata, $createdAt)",
        {
          id: crypto.randomUUID(),
          actorId: targetUser.id,
          action: "maintenance.batman-watchlist-import",
          metadata: JSON.stringify({
            sourceDatabase: basename(input.sourceDatabasePath),
            sourceUserId: input.sourceUserId ?? 99,
            targetEmail,
            ...summary
          }),
          createdAt: now
        }
      );
      return summary;
    });
  } finally {
    source.close();
  }
}

function mapBatmanRow(row: BatmanWatchlistRow): MappedInstrument {
  const code = row.code.trim();
  const name = row.name.trim();
  if (code.length === 0 || name.length === 0) {
    throw new Error("Batman 自选记录包含空代码或名称");
  }

  if (row.type === 3) {
    return { code, exchange: "fund", name, assetType: "fund", targetPrice: row.target, note: row.comment?.trim() ?? "", sortOrder: row.order };
  }
  if (row.type === 2) {
    return { code, exchange: inferStockExchange(code), name, assetType: "stock", targetPrice: row.target, note: row.comment?.trim() ?? "", sortOrder: row.order };
  }
  if (row.type === 1) {
    return { code, exchange: code.startsWith("399") ? "sz" : "sh", name, assetType: "index", targetPrice: row.target, note: row.comment?.trim() ?? "", sortOrder: row.order };
  }
  throw new Error(`不支持的 Batman 标的类型: ${row.type} (${code})`);
}

function inferStockExchange(code: string): Extract<Exchange, "sh" | "sz" | "bj"> {
  if (/^(4|8)/.test(code)) return "bj";
  if (/^(5|6|9)/.test(code)) return "sh";
  if (/^(0|1|2|3)/.test(code)) return "sz";
  throw new Error(`无法识别股票交易所: ${code}`);
}
