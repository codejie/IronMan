import { IronManDatabase } from "../db/database";
import { errors } from "../errors";
import type { IndicatorType } from "./indicator-service";
import { MarketService } from "./market-service";

interface StrategyRow {
  id: string;
  user_id: string;
  name: string;
  instrument_ids_json: string;
  indicators_json: string;
  created_at: string;
  updated_at: string;
}

export interface Strategy {
  id: string;
  name: string;
  instrumentIds: string[];
  indicators: IndicatorType[];
  createdAt: string;
  updatedAt: string;
}

export class StrategyService {
  constructor(
    private readonly database: IronManDatabase,
    private readonly market: MarketService
  ) {}

  create(userId: string, input: { name: string; instrumentIds: string[]; indicators: IndicatorType[] }): Strategy {
    const name = input.name.trim();
    if (input.instrumentIds.length === 0) throw errors.validation("策略至少需要一个标的");
    for (const instrumentId of input.instrumentIds) this.market.getInstrument(instrumentId);
    const duplicate = this.database.get<{ id: string }>("SELECT id FROM strategies WHERE user_id = $userId AND name = $name", { userId, name });
    if (duplicate !== undefined) throw errors.alreadyExists("同名策略已存在");
    const now = new Date().toISOString();
    const row: StrategyRow = { id: crypto.randomUUID(), user_id: userId, name, instrument_ids_json: JSON.stringify([...new Set(input.instrumentIds)]), indicators_json: JSON.stringify([...new Set(input.indicators)]), created_at: now, updated_at: now };
    this.database.run(
      `INSERT INTO strategies (id, user_id, name, instrument_ids_json, indicators_json, created_at, updated_at)
       VALUES ($id, $userId, $name, $instrumentIds, $indicators, $createdAt, $updatedAt)`,
      { id: row.id, userId, name, instrumentIds: row.instrument_ids_json, indicators: row.indicators_json, createdAt: now, updatedAt: now }
    );
    return this.toStrategy(row);
  }

  list(userId: string): Strategy[] {
    return this.database.all<StrategyRow>("SELECT * FROM strategies WHERE user_id = $userId ORDER BY updated_at DESC", { userId }).map((row) => this.toStrategy(row));
  }

  get(userId: string, id: string): Strategy {
    const row = this.database.get<StrategyRow>("SELECT * FROM strategies WHERE id = $id AND user_id = $userId", { id, userId });
    if (row === undefined) throw errors.notFound("策略不存在");
    return this.toStrategy(row);
  }

  private toStrategy(row: StrategyRow): Strategy {
    return { id: row.id, name: row.name, instrumentIds: JSON.parse(row.instrument_ids_json) as string[], indicators: JSON.parse(row.indicators_json) as IndicatorType[], createdAt: row.created_at, updatedAt: row.updated_at };
  }
}
