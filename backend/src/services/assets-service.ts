import { IronManDatabase } from "../db/database";
import { errors } from "../errors";
import type { Instrument } from "../market/types";
import { MarketService } from "./market-service";

type HoldingAction = "buy" | "sell" | "dividend";

interface WatchlistRow {
  id: string;
  note: string;
  target_price: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  instrument_id: string;
  code: string;
  exchange: Instrument["exchange"];
  name: string;
  asset_type: Instrument["assetType"];
}

interface HoldingRow {
  id: string;
  status: "active" | "closed";
  instrument_id: string;
  code: string;
  exchange: Instrument["exchange"];
  name: string;
  asset_type: Instrument["assetType"];
  quantity: number;
  average_cost: number;
  updated_at: string;
}

export interface WatchlistEntry {
  id: string;
  note: string;
  targetPrice: number | null;
  sortOrder: number;
  instrument: Pick<Instrument, "id" | "code" | "exchange" | "name" | "assetType">;
}

export interface HoldingSummary {
  id: string;
  status: "active" | "closed";
  quantity: number;
  averageCost: number;
  instrument: Pick<Instrument, "id" | "code" | "exchange" | "name" | "assetType">;
  updatedAt: string;
}

export class AssetsService {
  constructor(
    private readonly database: IronManDatabase,
    private readonly market: MarketService
  ) {}

  createWatchlistEntry(userId: string, input: { instrumentId: string; note: string; targetPrice?: number | null }): WatchlistEntry {
    this.market.getInstrument(input.instrumentId);
    const existing = this.database.get<{ id: string }>(
      "SELECT id FROM watchlist_entries WHERE user_id = $userId AND instrument_id = $instrumentId",
      { userId, instrumentId: input.instrumentId }
    );
    if (existing !== undefined) {
      throw errors.alreadyExists("该标的已在自选列表中");
    }
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.database.run(
      `INSERT INTO watchlist_entries (id, user_id, instrument_id, note, target_price, sort_order, created_at, updated_at)
       VALUES ($id, $userId, $instrumentId, $note, $targetPrice, 0, $createdAt, $updatedAt)`,
      { id, userId, instrumentId: input.instrumentId, note: input.note.trim(), targetPrice: input.targetPrice ?? null, createdAt: now, updatedAt: now }
    );
    return this.listWatchlist(userId).find((entry) => entry.id === id) as WatchlistEntry;
  }

  listWatchlist(userId: string): WatchlistEntry[] {
    return this.database
      .all<WatchlistRow>(
        `SELECT watchlist_entries.*, instruments.code, instruments.exchange, instruments.name, instruments.asset_type
           FROM watchlist_entries
           JOIN instruments ON instruments.id = watchlist_entries.instrument_id
          WHERE watchlist_entries.user_id = $userId
          ORDER BY watchlist_entries.sort_order ASC, watchlist_entries.created_at DESC`,
        { userId }
      )
      .map((row) => this.toWatchlistEntry(row));
  }

  deleteWatchlistEntry(userId: string, id: string): void {
    const entry = this.database.get<{ id: string }>("SELECT id FROM watchlist_entries WHERE id = $id AND user_id = $userId", { id, userId });
    if (entry === undefined) {
      throw errors.notFound("自选记录不存在");
    }
    this.database.run("DELETE FROM watchlist_entries WHERE id = $id AND user_id = $userId", { id, userId });
  }

  adjustCash(userId: string, amount: number, note: string): number {
    return this.database.transaction(() => this.applyCash(userId, amount, "adjustment", null, note, new Date().toISOString()));
  }

  getCash(userId: string): number {
    return this.ensureCashAccount(userId).available;
  }

  createHolding(userId: string, input: { instrumentId: string; quantity: number; price: number; fee: number; occurredAt: string; note?: string }): HoldingSummary {
    this.market.getInstrument(input.instrumentId);
    return this.database.transaction(() => {
      const duplicate = this.database.get<{ id: string }>(
        "SELECT id FROM holdings WHERE user_id = $userId AND instrument_id = $instrumentId AND status = 'active'",
        { userId, instrumentId: input.instrumentId }
      );
      if (duplicate !== undefined) {
        throw errors.alreadyExists("该标的已有活动持仓");
      }
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      this.database.run(
        "INSERT INTO holdings (id, user_id, instrument_id, status, created_at, updated_at) VALUES ($id, $userId, $instrumentId, 'active', $createdAt, $updatedAt)",
        { id, userId, instrumentId: input.instrumentId, createdAt: now, updatedAt: now }
      );
      this.recordTransaction(userId, id, "buy", input.quantity, input.price, input.fee, input.occurredAt, input.note ?? "");
      return this.getHoldingSummary(userId, id);
    });
  }

  recordHoldingTransaction(userId: string, input: { holdingId: string; action: HoldingAction; quantity: number; price: number; fee: number; occurredAt: string; note?: string }): { id: string } {
    return this.database.transaction(() => {
      const holding = this.database.get<{ id: string }>(
        "SELECT id FROM holdings WHERE id = $id AND user_id = $userId AND status = 'active'",
        { id: input.holdingId, userId }
      );
      if (holding === undefined) {
        throw errors.notFound("活动持仓不存在");
      }
      if (input.action === "sell" && input.quantity > this.getPositionQuantity(userId, input.holdingId)) {
        throw errors.validation("卖出数量超过当前持仓");
      }
      const id = this.recordTransaction(userId, input.holdingId, input.action, input.quantity, input.price, input.fee, input.occurredAt, input.note ?? "");
      if (input.action === "sell" && this.getPositionQuantity(userId, input.holdingId) === 0) {
        this.database.run("UPDATE holdings SET status = 'closed', updated_at = $updatedAt WHERE id = $id AND user_id = $userId", {
          id: input.holdingId,
          userId,
          updatedAt: new Date().toISOString()
        });
      }
      return { id };
    });
  }

  listHoldings(userId: string): { items: HoldingSummary[]; cashAvailable: number } {
    const rows = this.database.all<HoldingRow>(
      `SELECT holdings.id, holdings.status, holdings.instrument_id, holdings.updated_at, instruments.code, instruments.exchange, instruments.name, instruments.asset_type,
              COALESCE(SUM(CASE holding_transactions.action WHEN 'buy' THEN holding_transactions.quantity WHEN 'sell' THEN -holding_transactions.quantity ELSE 0 END), 0) AS quantity,
              COALESCE(SUM(CASE WHEN holding_transactions.action = 'buy' THEN holding_transactions.quantity * holding_transactions.price + holding_transactions.fee ELSE 0 END) /
                NULLIF(SUM(CASE WHEN holding_transactions.action = 'buy' THEN holding_transactions.quantity ELSE 0 END), 0), 0) AS average_cost
         FROM holdings
         JOIN instruments ON instruments.id = holdings.instrument_id
         LEFT JOIN holding_transactions ON holding_transactions.holding_id = holdings.id AND holding_transactions.user_id = holdings.user_id
        WHERE holdings.user_id = $userId
        GROUP BY holdings.id
        ORDER BY CASE holdings.status WHEN 'active' THEN 0 ELSE 1 END, holdings.updated_at DESC`,
      { userId }
    );
    return { items: rows.map((row) => this.toHoldingSummary(row)), cashAvailable: this.getCash(userId) };
  }

  getHoldingDetail(userId: string, id: string): { holding: HoldingSummary; transactions: Array<{ id: string; action: HoldingAction; quantity: number; price: number; fee: number; occurredAt: string; note: string }> } {
    const holding = this.getHoldingSummary(userId, id);
    const transactions = this.database.all<{
      id: string;
      action: HoldingAction;
      quantity: number;
      price: number;
      fee: number;
      occurred_at: string;
      note: string;
    }>(
      `SELECT id, action, quantity, price, fee, occurred_at, note FROM holding_transactions
        WHERE holding_id = $id AND user_id = $userId ORDER BY occurred_at ASC, created_at ASC`,
      { id, userId }
    );
    return {
      holding,
      transactions: transactions.map((transaction) => ({
        id: transaction.id,
        action: transaction.action,
        quantity: transaction.quantity,
        price: transaction.price,
        fee: transaction.fee,
        occurredAt: transaction.occurred_at,
        note: transaction.note
      }))
    };
  }

  private recordTransaction(userId: string, holdingId: string, action: HoldingAction, quantity: number, price: number, fee: number, occurredAt: string, note: string): string {
    const amount = action === "buy" ? -(quantity * price + fee) : action === "sell" ? quantity * price - fee : price - fee;
    this.applyCash(userId, amount, action, holdingId, note, occurredAt);
    const id = crypto.randomUUID();
    this.database.run(
      `INSERT INTO holding_transactions (id, user_id, holding_id, action, quantity, price, fee, note, occurred_at, created_at)
       VALUES ($id, $userId, $holdingId, $action, $quantity, $price, $fee, $note, $occurredAt, $createdAt)`,
      { id, userId, holdingId, action, quantity, price, fee, note, occurredAt, createdAt: new Date().toISOString() }
    );
    this.database.run("UPDATE holdings SET updated_at = $updatedAt WHERE id = $id AND user_id = $userId", {
      id: holdingId,
      userId,
      updatedAt: new Date().toISOString()
    });
    return id;
  }

  private applyCash(userId: string, amount: number, category: "adjustment" | HoldingAction, referenceId: string | null, note: string, occurredAt: string): number {
    const current = this.ensureCashAccount(userId).available;
    const next = Number((current + amount).toFixed(6));
    if (next < 0) {
      throw errors.validation("可用资金不足");
    }
    this.database.run("UPDATE cash_accounts SET available = $available, updated_at = $updatedAt WHERE user_id = $userId", {
      userId,
      available: next,
      updatedAt: new Date().toISOString()
    });
    this.database.run(
      `INSERT INTO cash_ledger (id, user_id, amount, category, reference_id, note, occurred_at, created_at)
       VALUES ($id, $userId, $amount, $category, $referenceId, $note, $occurredAt, $createdAt)`,
      { id: crypto.randomUUID(), userId, amount, category, referenceId, note, occurredAt, createdAt: new Date().toISOString() }
    );
    return next;
  }

  private ensureCashAccount(userId: string): { available: number } {
    const existing = this.database.get<{ available: number }>("SELECT available FROM cash_accounts WHERE user_id = $userId", { userId });
    if (existing !== undefined) return existing;
    this.database.run("INSERT INTO cash_accounts (user_id, available, updated_at) VALUES ($userId, 0, $updatedAt)", {
      userId,
      updatedAt: new Date().toISOString()
    });
    return { available: 0 };
  }

  private getPositionQuantity(userId: string, holdingId: string): number {
    return this.database.get<{ quantity: number }>(
      `SELECT COALESCE(SUM(CASE action WHEN 'buy' THEN quantity WHEN 'sell' THEN -quantity ELSE 0 END), 0) AS quantity
         FROM holding_transactions WHERE holding_id = $holdingId AND user_id = $userId`,
      { holdingId, userId }
    )?.quantity ?? 0;
  }

  private getHoldingSummary(userId: string, id: string): HoldingSummary {
    const row = this.database.get<HoldingRow>(
      `SELECT holdings.id, holdings.status, holdings.instrument_id, holdings.updated_at, instruments.code, instruments.exchange, instruments.name, instruments.asset_type,
              COALESCE(SUM(CASE holding_transactions.action WHEN 'buy' THEN holding_transactions.quantity WHEN 'sell' THEN -holding_transactions.quantity ELSE 0 END), 0) AS quantity,
              COALESCE(SUM(CASE WHEN holding_transactions.action = 'buy' THEN holding_transactions.quantity * holding_transactions.price + holding_transactions.fee ELSE 0 END) /
                NULLIF(SUM(CASE WHEN holding_transactions.action = 'buy' THEN holding_transactions.quantity ELSE 0 END), 0), 0) AS average_cost
         FROM holdings
         JOIN instruments ON instruments.id = holdings.instrument_id
         LEFT JOIN holding_transactions ON holding_transactions.holding_id = holdings.id AND holding_transactions.user_id = holdings.user_id
        WHERE holdings.id = $id AND holdings.user_id = $userId
        GROUP BY holdings.id`,
      { id, userId }
    );
    if (row === undefined) {
      throw errors.notFound("持仓不存在");
    }
    return this.toHoldingSummary(row);
  }

  private toWatchlistEntry(row: WatchlistRow): WatchlistEntry {
    return {
      id: row.id,
      note: row.note,
      targetPrice: row.target_price,
      sortOrder: row.sort_order,
      instrument: { id: row.instrument_id, code: row.code, exchange: row.exchange, name: row.name, assetType: row.asset_type }
    };
  }

  private toHoldingSummary(row: HoldingRow): HoldingSummary {
    return {
      id: row.id,
      status: row.status,
      quantity: Number(row.quantity),
      averageCost: Number(row.average_cost),
      instrument: { id: row.instrument_id, code: row.code, exchange: row.exchange, name: row.name, assetType: row.asset_type },
      updatedAt: row.updated_at
    };
  }
}
