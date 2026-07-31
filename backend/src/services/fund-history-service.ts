import { IronManDatabase } from "../db/database";
import { errors } from "../errors";
import type { MarketSource, PriceBar, Timeframe } from "../market/types";

const calculationVersion = 1;
const businessTimeZone = "Asia/Shanghai";
const epsilon = 0.000001;

export interface FundHistoryMarket {
  getHistoryRange(
    userId: string,
    instrumentId: string,
    timeframe: Timeframe,
    startDate: string,
    endDate: string,
    refresh?: boolean,
  ): Promise<{ source: MarketSource; bars: PriceBar[] }>;
}

export interface FundHistoryCalendar {
  getTradeDays(userId: string, startDate: string, endDate: string): string[];
}

export type FundHistoryStatus = "idle" | "calculating" | "dirty" | "failed";
export type FundDataStatus = "complete" | "partial";

export interface FundHistoryPoint {
  tradeDate: string;
  cashAvailable: number;
  principal: number;
  marketValue: number;
  totalAssets: number;
  externalCashFlow: number;
  dailyProfit: number | null;
  dailyReturn: number | null;
  performanceIndex: number;
  cumulativeProfit: number;
  cumulativeProfitRate: number | null;
  instrumentCount: number;
  pricedCount: number;
  carriedPriceCount: number;
  missingPriceCount: number;
  dataStatus: FundDataStatus;
  calculationVersion: number;
  calculatedAt: string;
}

export type FundHistoryEventKind = "adjustment" | "buy" | "sell" | "close" | "dividend";

export interface FundHistoryEvent {
  id: string;
  tradeDate: string;
  kind: FundHistoryEventKind;
  label: string;
  amount: number;
  instrumentName: string | null;
}

export interface FundHistoryState {
  coveredFrom: string | null;
  coveredTo: string | null;
  dirtyFrom: string | null;
  status: FundHistoryStatus;
  lastError: string | null;
  calculationVersion: number;
  updatedAt: string;
  tradeDayCount: number;
}

export interface FundHistoryResult {
  summary: {
    totalAssets: number;
    marketValue: number;
    cashAvailable: number;
    principal: number;
    cumulativeProfit: number;
    cumulativeProfitRate: number | null;
    maxDrawdown: number | null;
  };
  points: FundHistoryPoint[];
  events: FundHistoryEvent[];
  state: FundHistoryState;
}

interface CashRow {
  id: string;
  amount: number;
  category: "adjustment" | "buy" | "sell" | "dividend";
  occurred_at: string;
  created_at: string;
}

interface TransactionRow {
  id: string;
  holding_id: string;
  instrument_id: string;
  instrument_name: string;
  action: "buy" | "sell" | "dividend";
  quantity: number;
  cash_amount: number;
  occurred_at: string;
  created_at: string;
}

interface StateRow {
  covered_from: string | null;
  covered_to: string | null;
  dirty_from: string | null;
  status: FundHistoryStatus;
  last_error: string | null;
  calculation_version: number;
  updated_at: string;
}

interface MetricRow {
  user_id: string;
  trade_date: string;
  cash_available: number;
  principal: number;
  market_value: number;
  total_assets: number;
  external_cash_flow: number;
  daily_profit: number | null;
  daily_return: number | null;
  performance_index: number;
  cumulative_profit: number;
  cumulative_profit_rate: number | null;
  instrument_count: number;
  priced_count: number;
  carried_price_count: number;
  missing_price_count: number;
  data_status: FundDataStatus;
  calculation_version: number;
  calculated_at: string;
}

export class FundHistoryService {
  constructor(
    private readonly database: IronManDatabase,
    private readonly market: FundHistoryMarket,
    private readonly calendar: FundHistoryCalendar,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getHistory(userId: string, input: { startDate: string; endDate: string }): Promise<FundHistoryResult> {
    validateRange(input.startDate, input.endDate);
    const state = this.ensureState(userId);
    const existing = this.listPoints(userId, input.startDate, input.endDate);
    if (state.status !== "dirty" && state.status !== "calculating") {
      const requestedDays = this.requestedTradeDays(userId, input.startDate, input.endDate);
      const existingDates = new Set(existing.map((point) => point.tradeDate));
      const missingDays = requestedDays.filter((date) => !existingDates.has(date));
      if (missingDays.length > 0) {
        try {
          const calculated = await this.calculateRange(userId, missingDays[0]!, missingDays.at(-1)!);
          const missingSet = new Set(missingDays);
          this.storePoints(userId, calculated.filter((point) => missingSet.has(point.tradeDate)), false);
        } catch (error) {
          this.markFailed(userId, error);
          if (existing.length === 0) throw error;
        }
      }
    }
    const points = this.listPoints(userId, input.startDate, input.endDate);
    return {
      summary: summarize(points),
      points,
      events: this.listEvents(userId, input.startDate, input.endDate),
      state: this.getStatus(userId),
    };
  }

  getStatus(userId: string): FundHistoryState {
    const state = this.ensureState(userId);
    const count = this.database.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM fund_daily_metrics WHERE user_id = $userId",
      { userId },
    )?.count ?? 0;
    return {
      coveredFrom: state.covered_from,
      coveredTo: state.covered_to,
      dirtyFrom: state.dirty_from,
      status: state.calculation_version < calculationVersion && state.status === "idle" ? "dirty" : state.status,
      lastError: state.last_error,
      calculationVersion: state.calculation_version,
      updatedAt: state.updated_at,
      tradeDayCount: count,
    };
  }

  markDirty(userId: string, affectedDate: string): void {
    if (!isCalendarDate(affectedDate)) return;
    const current = this.ensureState(userId);
    const hasMetrics = (this.database.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM fund_daily_metrics WHERE user_id = $userId",
      { userId },
    )?.count ?? 0) > 0;
    if (!hasMetrics) return;
    const dirtyFrom = current.dirty_from === null || affectedDate < current.dirty_from ? affectedDate : current.dirty_from;
    this.database.run(
      `UPDATE fund_history_state
          SET dirty_from = $dirtyFrom, status = 'dirty', last_error = NULL, updated_at = $updatedAt
        WHERE user_id = $userId`,
      { userId, dirtyFrom, updatedAt: new Date().toISOString() },
    );
  }

  async recalculate(userId: string, endDate?: string): Promise<FundHistoryResult> {
    const targetEndDate = endDate ?? this.latestCompletedTradeDate(userId);
    if (!isCalendarDate(targetEndDate)) throw errors.validation("重新计算日期无效");
    const current = this.ensureState(userId);
    if (current.status === "calculating") throw errors.alreadyExists("资金历史数据正在计算");
    const startDate = shiftYear(targetEndDate, -1);
    this.setCalculating(userId);
    try {
      const points = await this.calculateRange(userId, startDate, targetEndDate);
      this.storePoints(userId, points, true, startDate, targetEndDate);
      const visible = this.listPoints(userId, startDate, targetEndDate);
      return {
        summary: summarize(visible),
        points: visible,
        events: this.listEvents(userId, startDate, targetEndDate),
        state: this.getStatus(userId),
      };
    } catch (error) {
      this.markFailed(userId, error);
      throw error;
    }
  }

  private async calculateRange(userId: string, startDate: string, endDate: string): Promise<FundHistoryPoint[]> {
    const cashRows = this.cashRows(userId);
    const transactions = this.transactionRows(userId);
    const earliestEvent = earliestBusinessDate(cashRows, transactions);
    if (earliestEvent === null || earliestEvent > endDate) return [];
    const effectiveStart = earliestEvent > startDate ? earliestEvent : startDate;
    const calendarStart = shiftDays(effectiveStart, -14);
    const calendarDays = this.calendar.getTradeDays(userId, calendarStart, endDate).sort();
    const visibleDays = calendarDays.filter((date) => date >= effectiveStart && date <= endDate);
    if (visibleDays.length === 0) return [];
    const firstVisibleIndex = calendarDays.indexOf(visibleDays[0]!);
    const baselineDay = firstVisibleIndex > 0 ? calendarDays[firstVisibleIndex - 1]! : null;
    const calculationDays = baselineDay === null ? visibleDays : [baselineDay, ...visibleDays];
    const marketStart = shiftYear(calculationDays[0]!, -1);
    const instrumentIds = [...new Set(transactions.filter((row) => fundBusinessDate(row.occurred_at) <= endDate).map((row) => row.instrument_id))];
    const barsByInstrument = new Map<string, PriceBar[]>();
    await mapWithConcurrency(instrumentIds, 4, async (instrumentId) => {
      try {
        const history = await this.market.getHistoryRange(userId, instrumentId, "day", marketStart, endDate, false);
        barsByInstrument.set(instrumentId, [...history.bars].sort((left, right) => left.date.localeCompare(right.date)));
      } catch {
        barsByInstrument.set(instrumentId, []);
      }
    });

    const sortedCash = [...cashRows].sort(compareOccurredRows);
    const sortedTransactions = [...transactions].sort(compareOccurredRows);
    const quantities = new Map<string, number>();
    let cashIndex = 0;
    let transactionIndex = 0;
    let cashAvailable = 0;
    let principal = 0;
    let previousAssets: number | null = null;
    let performanceIndex = 1;
    const results: FundHistoryPoint[] = [];
    const calculatedAt = new Date().toISOString();

    for (const tradeDate of calculationDays) {
      let externalCashFlow = 0;
      while (cashIndex < sortedCash.length && fundBusinessDate(sortedCash[cashIndex]!.occurred_at) <= tradeDate) {
        const row = sortedCash[cashIndex]!;
        cashAvailable = fixed(cashAvailable + Number(row.amount));
        if (row.category === "adjustment") {
          principal = fixed(principal + Number(row.amount));
          externalCashFlow = fixed(externalCashFlow + Number(row.amount));
        }
        cashIndex += 1;
      }
      while (transactionIndex < sortedTransactions.length && fundBusinessDate(sortedTransactions[transactionIndex]!.occurred_at) <= tradeDate) {
        const row = sortedTransactions[transactionIndex]!;
        const current = quantities.get(row.instrument_id) ?? 0;
        const delta = row.action === "buy" ? Number(row.quantity) : row.action === "sell" ? -Number(row.quantity) : 0;
        quantities.set(row.instrument_id, fixed(current + delta));
        transactionIndex += 1;
      }

      let marketValue = 0;
      let instrumentCount = 0;
      let pricedCount = 0;
      let carriedPriceCount = 0;
      let missingPriceCount = 0;
      for (const [instrumentId, quantity] of quantities) {
        if (quantity <= epsilon) continue;
        instrumentCount += 1;
        const bars = barsByInstrument.get(instrumentId) ?? [];
        const price = latestPrice(bars, tradeDate);
        if (price === null) {
          missingPriceCount += 1;
          continue;
        }
        marketValue = fixed(marketValue + quantity * price.close);
        if (price.exact) pricedCount += 1;
        else carriedPriceCount += 1;
      }
      const totalAssets = fixed(cashAvailable + marketValue);
      const cumulativeProfit = fixed(totalAssets - principal);
      const cumulativeProfitRate = Math.abs(principal) <= epsilon ? null : fixed(cumulativeProfit / Math.abs(principal) * 100, 4);
      const dailyProfit = previousAssets === null ? null : fixed(totalAssets - previousAssets - externalCashFlow);
      const dailyReturn = previousAssets === null || Math.abs(previousAssets) <= epsilon || dailyProfit === null
        ? null
        : fixed(dailyProfit / Math.abs(previousAssets), 8);
      if (dailyReturn !== null) performanceIndex = fixed(performanceIndex * (1 + dailyReturn), 8);
      const point: FundHistoryPoint = {
        tradeDate,
        cashAvailable,
        principal,
        marketValue,
        totalAssets,
        externalCashFlow,
        dailyProfit,
        dailyReturn,
        performanceIndex,
        cumulativeProfit,
        cumulativeProfitRate,
        instrumentCount,
        pricedCount,
        carriedPriceCount,
        missingPriceCount,
        dataStatus: missingPriceCount > 0 ? "partial" : "complete",
        calculationVersion,
        calculatedAt,
      };
      previousAssets = totalAssets;
      if (tradeDate >= effectiveStart) results.push(point);
    }
    return results;
  }

  private requestedTradeDays(userId: string, startDate: string, endDate: string): string[] {
    const earliest = earliestBusinessDate(this.cashRows(userId), this.transactionRows(userId));
    if (earliest === null || earliest > endDate) return [];
    const effectiveStart = earliest > startDate ? earliest : startDate;
    return this.calendar.getTradeDays(userId, effectiveStart, endDate).filter((date) => date >= effectiveStart && date <= endDate).sort();
  }

  private latestCompletedTradeDate(userId: string): string {
    const now = this.now();
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: businessTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
    const minutes = Number(part("hour")) * 60 + Number(part("minute"));
    const currentDate = `${part("year")}-${part("month")}-${part("day")}`;
    const latestCandidate = minutes >= 15 * 60 + 30 ? currentDate : shiftDays(currentDate, -1);
    return this.calendar.getTradeDays(userId, shiftDays(latestCandidate, -14), latestCandidate).sort().at(-1) ?? latestCandidate;
  }

  private cashRows(userId: string): CashRow[] {
    return this.database.all<CashRow>(
      `SELECT id, amount, category, occurred_at, created_at
         FROM cash_ledger WHERE user_id = $userId ORDER BY occurred_at, created_at, id`,
      { userId },
    );
  }

  private transactionRows(userId: string): TransactionRow[] {
    return this.database.all<TransactionRow>(
      `SELECT holding_transactions.id, holding_transactions.holding_id, holdings.instrument_id,
              instruments.name AS instrument_name, holding_transactions.action, holding_transactions.quantity,
              COALESCE((SELECT SUM(cash_ledger.amount) FROM cash_ledger
                         WHERE cash_ledger.holding_transaction_id = holding_transactions.id), 0) AS cash_amount,
              holding_transactions.occurred_at, holding_transactions.created_at
         FROM holding_transactions
         JOIN holdings ON holdings.id = holding_transactions.holding_id
         JOIN instruments ON instruments.id = holdings.instrument_id
        WHERE holding_transactions.user_id = $userId
        ORDER BY holding_transactions.occurred_at, holding_transactions.created_at, holding_transactions.id`,
      { userId },
    );
  }

  private listEvents(userId: string, startDate: string, endDate: string): FundHistoryEvent[] {
    const events: Array<FundHistoryEvent & { occurredAt: string; createdAt: string }> = this.cashRows(userId)
      .filter((row) => row.category === "adjustment")
      .map((row) => ({
        id: row.id,
        tradeDate: fundBusinessDate(row.occurred_at),
        kind: "adjustment" as const,
        label: Number(row.amount) >= 0 ? "入金" : "出金",
        amount: Number(row.amount),
        instrumentName: null,
        occurredAt: row.occurred_at,
        createdAt: row.created_at,
      }));
    const quantities = new Map<string, number>();
    for (const row of this.transactionRows(userId)) {
      const before = quantities.get(row.holding_id) ?? 0;
      const after = fixed(before + (row.action === "buy" ? Number(row.quantity) : row.action === "sell" ? -Number(row.quantity) : 0));
      quantities.set(row.holding_id, after);
      const kind: FundHistoryEventKind = row.action === "sell" && after <= epsilon ? "close" : row.action;
      const actionLabel = kind === "close" ? "清仓" : kind === "buy" ? "买入" : kind === "sell" ? "卖出" : "分红/计息";
      events.push({
        id: row.id,
        tradeDate: fundBusinessDate(row.occurred_at),
        kind,
        label: `${actionLabel} ${row.instrument_name}`,
        amount: fixed(Number(row.cash_amount)),
        instrumentName: row.instrument_name,
        occurredAt: row.occurred_at,
        createdAt: row.created_at,
      });
    }
    return events
      .filter((event) => event.tradeDate >= startDate && event.tradeDate <= endDate)
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .map(({ occurredAt: _occurredAt, createdAt: _createdAt, ...event }) => event);
  }

  private listPoints(userId: string, startDate: string, endDate: string): FundHistoryPoint[] {
    return this.database
      .all<MetricRow>(
        `SELECT * FROM fund_daily_metrics
          WHERE user_id = $userId AND trade_date >= $startDate AND trade_date <= $endDate
          ORDER BY trade_date`,
        { userId, startDate, endDate },
      )
      .map(toPoint);
  }

  private storePoints(userId: string, points: FundHistoryPoint[], replaceRange: boolean, startDate?: string, endDate?: string): void {
    this.database.transaction(() => {
      if (replaceRange && startDate !== undefined && endDate !== undefined) {
        this.database.run(
          "DELETE FROM fund_daily_metrics WHERE user_id = $userId AND trade_date >= $startDate AND trade_date <= $endDate",
          { userId, startDate, endDate },
        );
      }
      for (const point of points) this.insertPoint(userId, point, replaceRange);
      const coverage = this.database.get<{ covered_from: string | null; covered_to: string | null }>(
        "SELECT MIN(trade_date) AS covered_from, MAX(trade_date) AS covered_to FROM fund_daily_metrics WHERE user_id = $userId",
        { userId },
      );
      this.database.run(
        `UPDATE fund_history_state
            SET covered_from = $coveredFrom, covered_to = $coveredTo, dirty_from = NULL,
                status = 'idle', last_error = NULL, calculation_version = $version, updated_at = $updatedAt
          WHERE user_id = $userId`,
        {
          userId,
          coveredFrom: coverage?.covered_from ?? null,
          coveredTo: coverage?.covered_to ?? null,
          version: calculationVersion,
          updatedAt: new Date().toISOString(),
        },
      );
    });
  }

  private insertPoint(userId: string, point: FundHistoryPoint, replace: boolean): void {
    const conflict = replace ? `DO UPDATE SET
      cash_available = excluded.cash_available, principal = excluded.principal, market_value = excluded.market_value,
      total_assets = excluded.total_assets, external_cash_flow = excluded.external_cash_flow,
      daily_profit = excluded.daily_profit, daily_return = excluded.daily_return, performance_index = excluded.performance_index,
      cumulative_profit = excluded.cumulative_profit, cumulative_profit_rate = excluded.cumulative_profit_rate,
      instrument_count = excluded.instrument_count, priced_count = excluded.priced_count,
      carried_price_count = excluded.carried_price_count, missing_price_count = excluded.missing_price_count,
      data_status = excluded.data_status, calculation_version = excluded.calculation_version, calculated_at = excluded.calculated_at`
      : "DO NOTHING";
    this.database.run(
      `INSERT INTO fund_daily_metrics (
        user_id, trade_date, cash_available, principal, market_value, total_assets, external_cash_flow,
        daily_profit, daily_return, performance_index, cumulative_profit, cumulative_profit_rate,
        instrument_count, priced_count, carried_price_count, missing_price_count, data_status,
        calculation_version, calculated_at
      ) VALUES (
        $userId, $tradeDate, $cashAvailable, $principal, $marketValue, $totalAssets, $externalCashFlow,
        $dailyProfit, $dailyReturn, $performanceIndex, $cumulativeProfit, $cumulativeProfitRate,
        $instrumentCount, $pricedCount, $carriedPriceCount, $missingPriceCount, $dataStatus,
        $calculationVersion, $calculatedAt
      ) ON CONFLICT(user_id, trade_date) ${conflict}`,
      { userId, ...point },
    );
  }

  private ensureState(userId: string): StateRow {
    const existing = this.database.get<StateRow>("SELECT * FROM fund_history_state WHERE user_id = $userId", { userId });
    if (existing !== undefined) return existing;
    const now = new Date().toISOString();
    this.database.run(
      `INSERT INTO fund_history_state (user_id, status, calculation_version, updated_at)
       VALUES ($userId, 'idle', $version, $updatedAt)`,
      { userId, version: calculationVersion, updatedAt: now },
    );
    return {
      covered_from: null,
      covered_to: null,
      dirty_from: null,
      status: "idle",
      last_error: null,
      calculation_version: calculationVersion,
      updated_at: now,
    };
  }

  private setCalculating(userId: string): void {
    this.ensureState(userId);
    this.database.run(
      "UPDATE fund_history_state SET status = 'calculating', last_error = NULL, updated_at = $updatedAt WHERE user_id = $userId",
      { userId, updatedAt: new Date().toISOString() },
    );
  }

  private markFailed(userId: string, error: unknown): void {
    this.ensureState(userId);
    this.database.run(
      "UPDATE fund_history_state SET status = 'failed', last_error = $lastError, updated_at = $updatedAt WHERE user_id = $userId",
      {
        userId,
        lastError: error instanceof Error ? error.message.slice(0, 500) : "资金历史计算失败",
        updatedAt: new Date().toISOString(),
      },
    );
  }
}

function toPoint(row: MetricRow): FundHistoryPoint {
  return {
    tradeDate: row.trade_date,
    cashAvailable: Number(row.cash_available),
    principal: Number(row.principal),
    marketValue: Number(row.market_value),
    totalAssets: Number(row.total_assets),
    externalCashFlow: Number(row.external_cash_flow),
    dailyProfit: row.daily_profit === null ? null : Number(row.daily_profit),
    dailyReturn: row.daily_return === null ? null : Number(row.daily_return),
    performanceIndex: Number(row.performance_index),
    cumulativeProfit: Number(row.cumulative_profit),
    cumulativeProfitRate: row.cumulative_profit_rate === null ? null : Number(row.cumulative_profit_rate),
    instrumentCount: Number(row.instrument_count),
    pricedCount: Number(row.priced_count),
    carriedPriceCount: Number(row.carried_price_count),
    missingPriceCount: Number(row.missing_price_count),
    dataStatus: row.data_status,
    calculationVersion: Number(row.calculation_version),
    calculatedAt: row.calculated_at,
  };
}

function summarize(points: FundHistoryPoint[]): FundHistoryResult["summary"] {
  const latest = points.at(-1);
  if (latest === undefined) {
    return { totalAssets: 0, marketValue: 0, cashAvailable: 0, principal: 0, cumulativeProfit: 0, cumulativeProfitRate: null, maxDrawdown: null };
  }
  let peak: number | null = null;
  let maxDrawdown: number | null = null;
  let performance = 1;
  for (const point of points) {
    if (point.dailyReturn !== null) performance *= 1 + point.dailyReturn;
    peak = peak === null ? performance : Math.max(peak, performance);
    const drawdown = peak === 0 ? 0 : performance / peak - 1;
    maxDrawdown = maxDrawdown === null ? drawdown : Math.min(maxDrawdown, drawdown);
  }
  return {
    totalAssets: latest.totalAssets,
    marketValue: latest.marketValue,
    cashAvailable: latest.cashAvailable,
    principal: latest.principal,
    cumulativeProfit: latest.cumulativeProfit,
    cumulativeProfitRate: latest.cumulativeProfitRate,
    maxDrawdown: maxDrawdown === null ? null : fixed(maxDrawdown * 100, 4),
  };
}

function earliestBusinessDate(cashRows: CashRow[], transactions: TransactionRow[]): string | null {
  const dates = [...cashRows.map((row) => fundBusinessDate(row.occurred_at)), ...transactions.map((row) => fundBusinessDate(row.occurred_at))];
  return dates.sort()[0] ?? null;
}

function compareOccurredRows(left: { occurred_at: string; created_at: string; id: string }, right: { occurred_at: string; created_at: string; id: string }): number {
  return left.occurred_at.localeCompare(right.occurred_at)
    || left.created_at.localeCompare(right.created_at)
    || left.id.localeCompare(right.id);
}

function latestPrice(bars: PriceBar[], tradeDate: string): { close: number; exact: boolean } | null {
  let latest: PriceBar | undefined;
  for (const bar of bars) {
    if (bar.date > tradeDate) break;
    latest = bar;
  }
  return latest === undefined ? null : { close: latest.close, exact: latest.date === tradeDate };
}

export function fundBusinessDate(value: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: businessTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function validateRange(startDate: string, endDate: string): void {
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate) || startDate > endDate) {
    throw errors.validation("资金历史日期范围无效");
  }
  if (endDate > fundBusinessDate(new Date().toISOString())) throw errors.validation("资金历史结束日期不能晚于当前日期");
  if (endDate > shiftYear(startDate, 1)) throw errors.validation("资金历史日期范围不能超过一年");
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function shiftYear(value: string, offset: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCFullYear(date.getUTCFullYear() + offset);
  return date.toISOString().slice(0, 10);
}

function shiftDays(value: string, offset: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function fixed(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, work: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      if (item !== undefined) await work(item);
    }
  });
  await Promise.all(workers);
}
