import { IronManDatabase } from "../db/database";
import { errors } from "../errors";
import type { Instrument } from "../market/types";
import { IndicatorService } from "./indicator-service";
import { MarketService } from "./market-service";

type StoredHoldingAction = "buy" | "sell" | "dividend";
export type HoldingAction = "buy" | "sell" | "interest";

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
  created_at: string;
  code: string;
  exchange: Instrument["exchange"];
  name: string;
  asset_type: Instrument["assetType"];
  quantity: number;
  cost: number;
  updated_at: string;
}

interface TransactionRow {
  id: string;
  holding_id: string;
  action: StoredHoldingAction;
  quantity: number;
  price: number;
  fee: number;
  note: string;
  occurred_at: string;
}

interface HoldingRecord {
  id: string;
  status: "active" | "closed";
  instrument_id: string;
}

export interface WatchlistEntry {
  id: string;
  note: string;
  targetPrice: number | null;
  sortOrder: number;
  instrument: Pick<Instrument, "id" | "code" | "exchange" | "name" | "assetType">;
}

export interface WatchlistWorkspaceEntry extends WatchlistEntry {
  isHeld: boolean;
  latestPrice: number | null;
  quoteDate: string | null;
  previousClose: number | null;
  openPrice: number | null;
  highPrice: number | null;
  lowPrice: number | null;
  priceChange: number | null;
  priceChangeRate: number | null;
  amplitudeRate: number | null;
  volumeRatio: number | null;
  turnoverRate: number | null;
  targetPriceDifference: number | null;
}

export interface WatchlistWorkspace {
  items: WatchlistWorkspaceEntry[];
}

export interface HoldingSummary {
  id: string;
  status: "active" | "closed";
  quantity: number;
  cost: number;
  averageCost: number;
  instrument: Pick<Instrument, "id" | "code" | "exchange" | "name" | "assetType">;
  createdAt: string;
  updatedAt: string;
}

export interface HoldingOperation {
  id: string;
  action: HoldingAction;
  quantity: number;
  price: number;
  fee: number;
  cashImpact: number;
  occurredAt: string;
  note: string;
}

export interface HoldingChartTrace {
  date: string;
  quantity: number;
  netCost: number;
  averageCost: number | null;
  marketValue: number;
  profit: number;
}

export interface HoldingChartData {
  holding: HoldingSummary;
  transactions: HoldingOperation[];
  bars: Array<{ date: string; open: number; close: number; high: number; low: number; volume: number }>;
  trace: HoldingChartTrace[];
  macdLines: Record<string, Array<number | null>>;
}

export interface HoldingWorkspaceRecord extends HoldingSummary {
  currentPrice: number | null;
  quoteDate: string | null;
  priceChange: number | null;
  priceChangeRate: number | null;
  marketValue: number | null;
  profit: number | null;
  profitRate: number | null;
}

export interface HoldingWorkspace {
  summary: {
    cashAvailable: number;
    totalCost: number;
    totalMarketValue: number;
    totalAssets: number;
    principal: number;
    profit: number;
    profitRate: number | null;
  };
  active: HoldingWorkspaceRecord[];
  closed: HoldingWorkspaceRecord[];
}

export interface BatmanHoldingWorkspaceRecord extends HoldingWorkspaceRecord {
  costCashFlow: number;
  quantityRatio: number | null;
  costRatio: number | null;
  averagePriceDifference: number | null;
  marketValueRatio: number | null;
  profitRatio: number | null;
  dailyDifference: number | null;
  dailyDifferenceRate: number | null;
}

export interface BatmanHoldingWorkspace {
  summary: HoldingWorkspace["summary"];
  active: BatmanHoldingWorkspaceRecord[];
  closed: BatmanHoldingWorkspaceRecord[];
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

  listReferencedInstrumentIds(userId: string): string[] {
    return this.database
      .all<{ instrument_id: string }>(
        `SELECT instrument_id FROM watchlist_entries WHERE user_id = $userId
         UNION
         SELECT instrument_id FROM holdings WHERE user_id = $userId`,
        { userId }
      )
      .map((row) => row.instrument_id);
  }

  deleteWatchlistEntry(userId: string, id: string): void {
    const entry = this.database.get<{ id: string }>("SELECT id FROM watchlist_entries WHERE id = $id AND user_id = $userId", { id, userId });
    if (entry === undefined) {
      throw errors.notFound("自选记录不存在");
    }
    this.database.run("DELETE FROM watchlist_entries WHERE id = $id AND user_id = $userId", { id, userId });
  }

  updateWatchlistEntry(userId: string, input: { id: string; note?: string; targetPrice?: number | null }): WatchlistEntry {
    const entry = this.database.get<{ id: string }>("SELECT id FROM watchlist_entries WHERE id = $id AND user_id = $userId", { id: input.id, userId });
    if (entry === undefined) {
      throw errors.notFound("自选记录不存在");
    }
    const current = this.listWatchlist(userId).find((item) => item.id === input.id) as WatchlistEntry;
    const note = input.note === undefined ? current.note : input.note.trim();
    const targetPrice = input.targetPrice === undefined ? current.targetPrice : input.targetPrice;
    this.database.run(
      "UPDATE watchlist_entries SET note = $note, target_price = $targetPrice, updated_at = $updatedAt WHERE id = $id AND user_id = $userId",
      { id: input.id, userId, note, targetPrice, updatedAt: new Date().toISOString() }
    );
    return this.listWatchlist(userId).find((item) => item.id === input.id) as WatchlistEntry;
  }

  async getWatchlistWorkspace(userId: string, refresh: boolean): Promise<WatchlistWorkspace> {
    const activeHoldings = new Set(
      this.database
        .all<{ instrument_id: string }>("SELECT instrument_id FROM holdings WHERE user_id = $userId AND status = 'active'", { userId })
        .map((holding) => holding.instrument_id)
    );
    const items = await Promise.all(
      this.listWatchlist(userId).map(async (entry) => {
        const quote = await this.getWatchlistQuote(userId, entry.instrument.id, refresh);
        return {
          ...entry,
          isHeld: activeHoldings.has(entry.instrument.id),
          ...quote,
          targetPriceDifference: entry.targetPrice === null || quote.latestPrice === null ? null : fixed(quote.latestPrice - entry.targetPrice)
        } satisfies WatchlistWorkspaceEntry;
      })
    );
    return { items };
  }

  private async getWatchlistQuote(
    userId: string,
    instrumentId: string,
    refresh: boolean
  ): Promise<Pick<WatchlistWorkspaceEntry, "latestPrice" | "quoteDate" | "previousClose" | "openPrice" | "highPrice" | "lowPrice" | "priceChange" | "priceChangeRate" | "amplitudeRate" | "volumeRatio" | "turnoverRate">> {
    const emptyQuote = {
      latestPrice: null,
      quoteDate: null,
      previousClose: null,
      openPrice: null,
      highPrice: null,
      lowPrice: null,
      priceChange: null,
      priceChangeRate: null,
      amplitudeRate: null,
      volumeRatio: null,
      turnoverRate: null
    };
    try {
      const history = await this.market.getHistory(userId, instrumentId, "day", refresh);
      const latest = history.bars.at(-1);
      const previous = history.bars.at(-2);
      if (latest === undefined) return emptyQuote;
      const latestPrice = fixed(latest.close);
      const previousClose = previous === undefined ? null : fixed(previous.close);
      const priceChange = previousClose === null ? null : fixed(latest.close - previousClose);
      const priceChangeRate = previousClose === null || previousClose === 0 ? null : fixed((latest.close - previousClose) / previousClose * 100, 4);
      const amplitudeRate = previousClose === null || previousClose === 0 ? null : fixed((latest.high - latest.low) / previousClose * 100, 4);
      const priorVolumes = history.bars.slice(-6, -1).map((bar) => bar.volume).filter((volume) => volume > 0);
      const averageVolume = priorVolumes.length === 0 ? null : priorVolumes.reduce((total, volume) => total + volume, 0) / priorVolumes.length;
      return {
        latestPrice,
        quoteDate: latest.date,
        previousClose,
        openPrice: fixed(latest.open),
        highPrice: fixed(latest.high),
        lowPrice: fixed(latest.low),
        priceChange,
        priceChangeRate,
        amplitudeRate,
        volumeRatio: averageVolume === null || averageVolume === 0 ? null : fixed(latest.volume / averageVolume, 4),
        turnoverRate: null
      };
    } catch {
      // A data source failure must not hide the user's own watchlist records.
      return emptyQuote;
    }
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
      this.insertHoldingOperation(userId, id, "buy", input.quantity, input.price, input.fee, input.occurredAt, input.note ?? "");
      return this.getHoldingSummary(userId, id);
    });
  }

  recordHoldingTransaction(userId: string, input: { holdingId: string; action: HoldingAction; quantity: number; price: number; fee: number; occurredAt: string; note?: string }): { id: string } {
    return this.database.transaction(() => {
      const holding = this.getHoldingRecord(userId, input.holdingId);
      if (holding.status !== "active") {
        throw errors.validation("清仓记录不能新增操作");
      }
      this.validateOperation(input.action, input.quantity, input.price, input.fee);
      if (input.action === "sell" && input.quantity > this.getPositionQuantity(userId, input.holdingId)) {
        throw errors.validation("卖出数量超过当前持仓");
      }
      const id = this.insertHoldingOperation(userId, input.holdingId, input.action, input.quantity, input.price, input.fee, input.occurredAt, input.note ?? "");
      this.syncHoldingStatus(userId, holding, this.getPositionQuantity(userId, input.holdingId));
      return { id };
    });
  }

  deleteHoldingTransaction(userId: string, holdingId: string, transactionId: string): { deleted: true } {
    return this.database.transaction(() => {
      const holding = this.getHoldingRecord(userId, holdingId);
      const transaction = this.getHoldingTransaction(userId, holdingId, transactionId);
      const nextQuantity = this.getPositionQuantity(userId, holdingId) - quantityDelta(transaction.action, transaction.quantity);
      if (nextQuantity < -0.000001) {
        throw errors.validation("删除该买入记录会导致持仓数量为负数");
      }
      this.removeCashForTransaction(userId, holdingId, transaction);
      this.database.run("DELETE FROM holding_transactions WHERE id = $id AND user_id = $userId", { id: transaction.id, userId });
      this.syncHoldingStatus(userId, holding, Math.max(nextQuantity, 0));
      return { deleted: true };
    });
  }

  deleteHolding(userId: string, id: string): { deleted: true } {
    return this.database.transaction(() => {
      this.getHoldingRecord(userId, id);
      const transactions = this.listHoldingTransactions(userId, id);
      for (const transaction of transactions) {
        this.removeCashForTransaction(userId, id, transaction);
      }
      this.database.run("DELETE FROM holdings WHERE id = $id AND user_id = $userId", { id, userId });
      return { deleted: true };
    });
  }

  listHoldings(userId: string): { items: HoldingSummary[]; cashAvailable: number } {
    const rows = this.listHoldingRows(userId);
    return { items: rows.map((row) => this.toHoldingSummary(row)), cashAvailable: this.getCash(userId) };
  }

  async getHoldingWorkspace(userId: string, refresh: boolean): Promise<HoldingWorkspace> {
    const summaries = this.listHoldingRows(userId).map((row) => this.toHoldingSummary(row));
    const records: HoldingWorkspaceRecord[] = [];
    for (const holding of summaries) {
      let currentPrice: number | null = null;
      let quoteDate: string | null = null;
      let priceChange: number | null = null;
      let priceChangeRate: number | null = null;
      try {
        const history = await this.market.getHistory(userId, holding.instrument.id, "day", refresh);
        const latest = history.bars.at(-1);
        const previous = history.bars.at(-2);
        if (latest !== undefined) {
          currentPrice = latest.close;
          quoteDate = latest.date;
          if (previous !== undefined && previous.close !== 0) {
            priceChange = Number((latest.close - previous.close).toFixed(6));
            priceChangeRate = Number(((priceChange / previous.close) * 100).toFixed(4));
          }
        }
      } catch {
        // The workspace remains usable with locally stored cost data when a provider is unavailable.
      }
      const marketValue = currentPrice === null ? null : Number((holding.quantity * currentPrice).toFixed(6));
      const profit = marketValue === null ? null : Number((marketValue - holding.cost).toFixed(6));
      records.push({
        ...holding,
        currentPrice,
        quoteDate,
        priceChange,
        priceChangeRate,
        marketValue,
        profit,
        profitRate: profit === null || holding.cost === 0 ? null : Number(((profit / Math.abs(holding.cost)) * 100).toFixed(4))
      });
    }
    const active = records.filter((record) => record.status === "active");
    const closed = records.filter((record) => record.status === "closed");
    const cashAvailable = this.getCash(userId);
    const totalCost = sum(active.map((record) => record.cost));
    const totalMarketValue = sum(active.map((record) => record.marketValue ?? 0));
    const totalAssets = Number((cashAvailable + totalMarketValue).toFixed(6));
    const principal = this.database.get<{ amount: number }>(
      "SELECT COALESCE(SUM(amount), 0) AS amount FROM cash_ledger WHERE user_id = $userId AND category = 'adjustment'",
      { userId }
    )?.amount ?? 0;
    const profit = Number((totalAssets - principal).toFixed(6));
    return {
      summary: {
        cashAvailable,
        totalCost,
        totalMarketValue,
        totalAssets,
        principal,
        profit,
        profitRate: principal === 0 ? null : Number(((profit / Math.abs(principal)) * 100).toFixed(4))
      },
      active,
      closed
    };
  }

  async getBatmanHoldingWorkspace(userId: string, refresh: boolean): Promise<BatmanHoldingWorkspace> {
    const workspace = await this.getHoldingWorkspace(userId, refresh);
    const quantityTotal = sum(workspace.active.map((record) => record.quantity));
    const profitMagnitude = sum(workspace.active.map((record) => Math.abs(record.profit ?? 0)));
    const active = workspace.active.map((record) => this.toBatmanHoldingWorkspaceRecord(record, {
      quantityTotal,
      totalCost: workspace.summary.totalCost,
      totalMarketValue: workspace.summary.totalMarketValue,
      profitMagnitude
    }));
    const closed = workspace.closed.map((record) => this.toBatmanHoldingWorkspaceRecord(record, {
      quantityTotal: 0,
      totalCost: 0,
      totalMarketValue: 0,
      profitMagnitude: 0
    }));
    return { summary: workspace.summary, active, closed };
  }

  getHoldingDetail(userId: string, id: string): { holding: HoldingSummary; transactions: HoldingOperation[] } {
    return {
      holding: this.getHoldingSummary(userId, id),
      transactions: this.listHoldingTransactions(userId, id).map((transaction) => this.toHoldingOperation(transaction))
    };
  }

  async getHoldingChart(userId: string, id: string, refresh: boolean): Promise<HoldingChartData> {
    const holding = this.getHoldingSummary(userId, id);
    const transactions = this.listHoldingTransactions(userId, id)
      .map((transaction) => this.toHoldingOperation(transaction))
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = holdingChartStartDate(datePart(transactions[0]?.occurredAt ?? holding.createdAt), endDate);
    const history = await this.market.getHistoryRange(userId, holding.instrument.id, "day", startDate, endDate, refresh);
    const macdLines = new IndicatorService().calculate(history.bars, ["MACD"])[0]?.lines ?? {};
    return { holding, transactions, bars: history.bars, trace: buildHoldingTrace(history.bars, transactions), macdLines };
  }

  private listHoldingRows(userId: string): HoldingRow[] {
    return this.database.all<HoldingRow>(
      `SELECT holdings.id, holdings.status, holdings.instrument_id, holdings.created_at, holdings.updated_at, instruments.code, instruments.exchange, instruments.name, instruments.asset_type,
              COALESCE(SUM(CASE holding_transactions.action WHEN 'buy' THEN holding_transactions.quantity WHEN 'sell' THEN -holding_transactions.quantity ELSE 0 END), 0) AS quantity,
              COALESCE(SUM(CASE holding_transactions.action
                WHEN 'buy' THEN holding_transactions.quantity * holding_transactions.price + holding_transactions.fee
                WHEN 'sell' THEN -(holding_transactions.quantity * holding_transactions.price - holding_transactions.fee)
                WHEN 'dividend' THEN -(holding_transactions.price - holding_transactions.fee)
                ELSE 0 END), 0) AS cost
         FROM holdings
         JOIN instruments ON instruments.id = holdings.instrument_id
         LEFT JOIN holding_transactions ON holding_transactions.holding_id = holdings.id AND holding_transactions.user_id = holdings.user_id
        WHERE holdings.user_id = $userId
        GROUP BY holdings.id
        ORDER BY CASE holdings.status WHEN 'active' THEN 0 ELSE 1 END, holdings.updated_at DESC`,
      { userId }
    );
  }

  private getHoldingSummary(userId: string, id: string): HoldingSummary {
    const row = this.listHoldingRows(userId).find((item) => item.id === id);
    if (row === undefined) {
      throw errors.notFound("持仓不存在");
    }
    return this.toHoldingSummary(row);
  }

  private getHoldingRecord(userId: string, id: string): HoldingRecord {
    const holding = this.database.get<HoldingRecord>(
      "SELECT id, status, instrument_id FROM holdings WHERE id = $id AND user_id = $userId",
      { id, userId }
    );
    if (holding === undefined) {
      throw errors.notFound("持仓不存在");
    }
    return holding;
  }

  private listHoldingTransactions(userId: string, holdingId: string): TransactionRow[] {
    return this.database.all<TransactionRow>(
      `SELECT id, holding_id, action, quantity, price, fee, note, occurred_at
         FROM holding_transactions WHERE holding_id = $holdingId AND user_id = $userId
         ORDER BY occurred_at DESC, created_at DESC`,
      { holdingId, userId }
    );
  }

  private getHoldingTransaction(userId: string, holdingId: string, id: string): TransactionRow {
    const transaction = this.database.get<TransactionRow>(
      `SELECT id, holding_id, action, quantity, price, fee, note, occurred_at
         FROM holding_transactions WHERE id = $id AND holding_id = $holdingId AND user_id = $userId`,
      { id, holdingId, userId }
    );
    if (transaction === undefined) {
      throw errors.notFound("操作记录不存在");
    }
    return transaction;
  }

  private insertHoldingOperation(userId: string, holdingId: string, action: HoldingAction, quantity: number, price: number, fee: number, occurredAt: string, note: string): string {
    const id = crypto.randomUUID();
    const storedAction = toStoredAction(action);
    this.applyCash(userId, cashAmount(storedAction, quantity, price, fee), storedAction, holdingId, note, occurredAt, id);
    this.database.run(
      `INSERT INTO holding_transactions (id, user_id, holding_id, action, quantity, price, fee, note, occurred_at, created_at)
       VALUES ($id, $userId, $holdingId, $action, $quantity, $price, $fee, $note, $occurredAt, $createdAt)`,
      { id, userId, holdingId, action: storedAction, quantity, price, fee, note, occurredAt, createdAt: new Date().toISOString() }
    );
    this.database.run("UPDATE holdings SET updated_at = $updatedAt WHERE id = $id AND user_id = $userId", {
      id: holdingId,
      userId,
      updatedAt: new Date().toISOString()
    });
    return id;
  }

  private removeCashForTransaction(userId: string, holdingId: string, transaction: TransactionRow): void {
    const expectedAmount = cashAmount(transaction.action, transaction.quantity, transaction.price, transaction.fee);
    const ledger = this.database.get<{ id: string; amount: number }>(
      `SELECT id, amount FROM cash_ledger
        WHERE user_id = $userId AND holding_transaction_id = $transactionId
        LIMIT 1`,
      { userId, transactionId: transaction.id }
    ) ?? this.database.get<{ id: string; amount: number }>(
      `SELECT id, amount FROM cash_ledger
        WHERE user_id = $userId AND holding_transaction_id IS NULL AND reference_id = $holdingId
          AND category = $action AND occurred_at = $occurredAt AND ABS(amount - $amount) < 0.000001
        ORDER BY id ASC LIMIT 1`,
      { userId, holdingId, action: transaction.action, occurredAt: transaction.occurred_at, amount: expectedAmount }
    );
    if (ledger === undefined) {
      throw errors.validation("无法定位该操作对应的资金流水");
    }
    const current = this.ensureCashAccount(userId).available;
    const next = Number((current - ledger.amount).toFixed(6));
    if (next < 0) {
      throw errors.validation("删除该操作会导致可用资金不足");
    }
    this.database.run("DELETE FROM cash_ledger WHERE id = $id AND user_id = $userId", { id: ledger.id, userId });
    this.database.run("UPDATE cash_accounts SET available = $available, updated_at = $updatedAt WHERE user_id = $userId", {
      userId,
      available: next,
      updatedAt: new Date().toISOString()
    });
  }

  private syncHoldingStatus(userId: string, holding: HoldingRecord, quantity: number): void {
    const status: "active" | "closed" = quantity > 0 ? "active" : "closed";
    if (status === "active" && holding.status === "closed") {
      const duplicate = this.database.get<{ id: string }>(
        "SELECT id FROM holdings WHERE user_id = $userId AND instrument_id = $instrumentId AND status = 'active' AND id != $id",
        { userId, instrumentId: holding.instrument_id, id: holding.id }
      );
      if (duplicate !== undefined) {
        throw errors.validation("该标的已有活动持仓，不能恢复历史记录");
      }
    }
    this.database.run("UPDATE holdings SET status = $status, updated_at = $updatedAt WHERE id = $id AND user_id = $userId", {
      id: holding.id,
      userId,
      status,
      updatedAt: new Date().toISOString()
    });
  }

  private validateOperation(action: HoldingAction, quantity: number, price: number, fee: number): void {
    if (price < 0 || fee < 0) {
      throw errors.validation("价格和费用不能为负数");
    }
    if (action === "interest") {
      if (quantity !== 0) throw errors.validation("计息操作的数量必须为 0");
      return;
    }
    if (quantity <= 0) {
      throw errors.validation("买入和卖出数量必须大于 0");
    }
  }

  private applyCash(userId: string, amount: number, category: "adjustment" | StoredHoldingAction, referenceId: string | null, note: string, occurredAt: string, holdingTransactionId: string | null = null): number {
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
      `INSERT INTO cash_ledger (id, user_id, amount, category, reference_id, holding_transaction_id, note, occurred_at, created_at)
       VALUES ($id, $userId, $amount, $category, $referenceId, $holdingTransactionId, $note, $occurredAt, $createdAt)`,
      { id: crypto.randomUUID(), userId, amount, category, referenceId, holdingTransactionId, note, occurredAt, createdAt: new Date().toISOString() }
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
    const quantity = Number(row.quantity);
    const cost = Number(row.cost);
    return {
      id: row.id,
      status: row.status,
      quantity,
      cost,
      averageCost: quantity === 0 ? 0 : Number((cost / quantity).toFixed(6)),
      instrument: { id: row.instrument_id, code: row.code, exchange: row.exchange, name: row.name, assetType: row.asset_type },
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private toBatmanHoldingWorkspaceRecord(
    record: HoldingWorkspaceRecord,
    totals: { quantityTotal: number; totalCost: number; totalMarketValue: number; profitMagnitude: number }
  ): BatmanHoldingWorkspaceRecord {
    return {
      ...record,
      costCashFlow: fixed(-record.cost),
      quantityRatio: totals.quantityTotal === 0 ? null : fixed(record.quantity / totals.quantityTotal * 100, 4),
      costRatio: totals.totalCost === 0 ? null : fixed(record.cost / totals.totalCost * 100, 4),
      averagePriceDifference: record.currentPrice === null ? null : fixed(record.currentPrice - record.averageCost),
      marketValueRatio: record.marketValue === null || totals.totalMarketValue === 0 ? null : fixed(record.marketValue / totals.totalMarketValue * 100, 4),
      profitRatio: record.profit === null || totals.profitMagnitude === 0 ? null : fixed(Math.abs(record.profit) / totals.profitMagnitude * 100, 4),
      dailyDifference: record.priceChange === null ? null : fixed(record.priceChange * record.quantity),
      dailyDifferenceRate: record.priceChangeRate
    };
  }

  private toHoldingOperation(row: TransactionRow): HoldingOperation {
    return {
      id: row.id,
      action: toPublicAction(row.action),
      quantity: row.action === "sell" ? -Number(row.quantity) : Number(row.quantity),
      price: Number(row.price),
      fee: Number(row.fee),
      cashImpact: cashAmount(row.action, Number(row.quantity), Number(row.price), Number(row.fee)),
      occurredAt: row.occurred_at,
      note: row.note
    };
  }
}

function toStoredAction(action: HoldingAction): StoredHoldingAction {
  return action === "interest" ? "dividend" : action;
}

function toPublicAction(action: StoredHoldingAction): HoldingAction {
  return action === "dividend" ? "interest" : action;
}

function cashAmount(action: StoredHoldingAction, quantity: number, price: number, fee: number): number {
  if (action === "buy") return -(quantity * price + fee);
  if (action === "sell") return quantity * price - fee;
  return price - fee;
}

function quantityDelta(action: StoredHoldingAction, quantity: number): number {
  return action === "buy" ? quantity : action === "sell" ? -quantity : 0;
}

function sum(values: number[]): number {
  return Number(values.reduce((total, value) => total + value, 0).toFixed(6));
}

function fixed(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

function datePart(value: string): string {
  return value.slice(0, 10);
}

function holdingChartStartDate(startDate: string, endDate: string): string {
  const minimum = new Date(`${endDate}T00:00:00.000Z`);
  minimum.setUTCMonth(minimum.getUTCMonth() - 3);
  const minimumDate = minimum.toISOString().slice(0, 10);
  return startDate < minimumDate ? startDate : minimumDate;
}

function buildHoldingTrace(
  bars: Array<{ date: string; close: number }>,
  transactions: HoldingOperation[]
): HoldingChartTrace[] {
  const trace: HoldingChartTrace[] = [];
  let transactionIndex = 0;
  let quantity = 0;
  let netCost = 0;
  let hasOperation = false;

  for (const bar of bars) {
    while (transactionIndex < transactions.length && datePart(transactions[transactionIndex]!.occurredAt) <= bar.date) {
      const transaction = transactions[transactionIndex]!;
      quantity += transaction.quantity;
      netCost -= transaction.cashImpact;
      hasOperation = true;
      transactionIndex += 1;
    }
    if (!hasOperation) continue;
    const normalizedQuantity = fixed(quantity);
    const normalizedCost = fixed(netCost);
    const marketValue = fixed(normalizedQuantity * bar.close);
    trace.push({
      date: bar.date,
      quantity: normalizedQuantity,
      netCost: normalizedCost,
      averageCost: normalizedQuantity === 0 ? null : fixed(normalizedCost / normalizedQuantity),
      marketValue,
      profit: fixed(marketValue - normalizedCost)
    });
  }
  return trace;
}
