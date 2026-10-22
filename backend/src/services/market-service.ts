import { IronManDatabase } from "../db/database";
import { errors } from "../errors";
import { EastmoneyMarketProvider } from "../market/eastmoney-provider";
import { AkShareMarketProvider } from "../market/akshare-provider";
import { TencentMarketProvider, type IntradayMinuteProvider, type IntradayMinuteResult } from "../market/tencent-provider";
import type {
  AssetType,
  DataSourceConfig,
  Exchange,
  Instrument,
  InstrumentCatalogProvider,
  MarketDataProvider,
  MarketSource,
  PriceBar,
  Timeframe
} from "../market/types";
import { SettingsService } from "./settings-service";

interface InstrumentRow {
  id: string;
  code: string;
  exchange: Exchange;
  name: string;
  asset_type: AssetType;
  created_at: string;
  updated_at: string;
}

interface BarRow {
  trade_date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number | null;
  turnover_rate: number | null;
}

const defaultConfig: DataSourceConfig = { primary: "eastmoney", fallback: "tencent" };
const sourceNames = new Set<MarketSource>(["tencent", "eastmoney", "akshare"]);

export class MarketService {
  private readonly providers: Map<MarketSource, MarketDataProvider>;
  private readonly catalogProvider: (MarketDataProvider & InstrumentCatalogProvider) | undefined;

  constructor(
    private readonly database: IronManDatabase,
    private readonly settings: SettingsService,
    providers: MarketDataProvider[] = [new AkShareMarketProvider(), new TencentMarketProvider(), new EastmoneyMarketProvider()]
  ) {
    this.providers = new Map(providers.map((provider) => [provider.source, provider]));
    this.catalogProvider = providers.find(isInstrumentCatalogProvider);
  }

  upsertInstrument(input: { code: string; exchange: Exchange; name: string; assetType: AssetType }): Instrument {
    const code = input.code.trim();
    const name = input.name.trim();
    const existing = this.database.get<InstrumentRow>(
      "SELECT * FROM instruments WHERE code = $code AND exchange = $exchange",
      { code, exchange: input.exchange }
    );
    const now = new Date().toISOString();
    if (existing !== undefined) {
      this.database.run(
        "UPDATE instruments SET name = $name, asset_type = $assetType, updated_at = $updatedAt WHERE id = $id",
        { id: existing.id, name, assetType: input.assetType, updatedAt: now }
      );
      return this.toInstrument({ ...existing, name, asset_type: input.assetType, updated_at: now });
    }
    const created: InstrumentRow = {
      id: crypto.randomUUID(),
      code,
      exchange: input.exchange,
      name,
      asset_type: input.assetType,
      created_at: now,
      updated_at: now
    };
    this.database.run(
      `INSERT INTO instruments (id, code, exchange, name, asset_type, created_at, updated_at)
       VALUES ($id, $code, $exchange, $name, $assetType, $createdAt, $updatedAt)`,
      {
        id: created.id,
        code: created.code,
        exchange: created.exchange,
        name: created.name,
        assetType: created.asset_type,
        createdAt: created.created_at,
        updatedAt: created.updated_at
      }
    );
    return this.toInstrument(created);
  }

  async search(query: string, assetType?: AssetType): Promise<Instrument[]> {
    const local = this.searchLocal(query, assetType);
    if (local.length > 0 || assetType === undefined || this.catalogProvider === undefined) return local;

    try {
      const catalogItems = await this.catalogProvider.searchInstruments(assetType, query);
      return catalogItems.map((item) => this.upsertInstrument(item));
    } catch (error) {
      if (error instanceof Error) throw error;
      throw errors.external("标的目录暂不可用，请稍后重试");
    }
  }

  private searchLocal(query: string, assetType?: AssetType): Instrument[] {
    const normalized = `%${query.trim()}%`;
    const rows = assetType === undefined
      ? this.database.all<InstrumentRow>(
          `SELECT * FROM instruments
            WHERE code LIKE $query OR name LIKE $query
            ORDER BY code ASC LIMIT 50`,
          { query: normalized }
        )
      : this.database.all<InstrumentRow>(
          `SELECT * FROM instruments
            WHERE (code LIKE $query OR name LIKE $query) AND asset_type = $assetType
            ORDER BY code ASC LIMIT 50`,
          { query: normalized, assetType }
        );
    return rows.map((row) => this.toInstrument(row));
  }

  getInstrument(id: string): Instrument {
    const row = this.database.get<InstrumentRow>("SELECT * FROM instruments WHERE id = $id", { id });
    if (row === undefined) {
      throw errors.notFound("标的不存在");
    }
    return this.toInstrument(row);
  }

  getDataSourceConfig(userId: string): DataSourceConfig {
    const stored = this.settings.get(userId, "market.data-source")?.value;
    return sanitizeDataSourceConfig(stored);
  }

  setDataSourceConfig(userId: string, config: DataSourceConfig): DataSourceConfig {
    if (!sourceNames.has(config.primary) || !sourceNames.has(config.fallback)) {
      throw errors.validation("不支持的数据源");
    }
    this.settings.upsert(userId, "market.data-source", config);
    return config;
  }

  async getHistory(userId: string, instrumentId: string, timeframe: Timeframe, refresh: boolean, limit = 180): Promise<{ source: MarketSource; bars: PriceBar[] }> {
    const instrument = this.getInstrument(instrumentId);
    const config = this.getDataSourceConfig(userId);
    const candidates = [...new Set([config.primary, config.fallback])];
    const cached = candidates
      .map((source) => ({ source, bars: this.getCachedBars(instrument.id, timeframe, source) }))
      .find((entry) => entry.bars.length > 0);
    if (!refresh && cached !== undefined && cached.bars.length >= limit) {
      return { source: cached.source, bars: this.takeRecentBars(cached.bars, limit) };
    }
    try {
      const result = await this.fetchWithFallback(instrument, timeframe, config, limit);
      this.database.transaction(() => this.cacheBars(instrument.id, timeframe, result.source, result.bars));
      return { source: result.source, bars: this.takeRecentBars(result.bars, limit) };
    } catch (error) {
      if (cached !== undefined) {
        return { source: cached.source, bars: this.takeRecentBars(cached.bars, limit) };
      }
      throw error;
    }
  }

  /**
   * 当天分时（可选近 N 个交易日，视上游支持）。分时数据实时性强，不做本地缓存。
   */
  async getIntradayMinute(userId: string, instrumentId: string, date?: string): Promise<IntradayMinuteResult & { source: MarketSource }> {
    const instrument = this.getInstrument(instrumentId);
    const config = this.getDataSourceConfig(userId);
    const candidates = [...new Set([config.primary, config.fallback])];
    let lastError: unknown = undefined;
    for (const source of candidates) {
      const provider = this.providers.get(source);
      if (provider === undefined || !("intradayMinute" in provider)) continue;
      try {
        const result = await (provider as MarketDataProvider & IntradayMinuteProvider).intradayMinute(instrument, date);
        return { source, date: result.date, points: result.points };
      } catch (error) {
        lastError = error;
      }
    }
    throw errors.external("分时数据源暂不可用");
  }

  async getHistoryRange(
    userId: string,
    instrumentId: string,
    timeframe: Timeframe,
    startDate: string,
    endDate: string,
    refresh: boolean
  ): Promise<{ source: MarketSource; bars: PriceBar[] }> {
    if (!isCalendarDate(startDate) || !isCalendarDate(endDate) || startDate > endDate) {
      throw errors.validation("历史行情日期范围无效");
    }

    const instrument = this.getInstrument(instrumentId);
    const config = this.getDataSourceConfig(userId);
    const candidates = [...new Set([config.primary, config.fallback])];
    const cached = candidates
      .map((source) => ({ source, bars: this.getCachedBars(instrument.id, timeframe, source) }))
      .find((entry) => entry.bars.length > 0);
    const cachedRange = cached === undefined ? [] : barsInRange(cached.bars, startDate, endDate);
    if (!refresh && isCompleteRange(cachedRange, startDate, endDate)) {
      return { source: cached!.source, bars: cachedRange };
    }

    const bars = new Map(cachedRange.map((bar) => [bar.date, bar]));
    let source = cached?.source ?? config.primary;
    let cursor = endDate;
    let lastError: unknown;

    for (let page = 0; page < 24; page += 1) {
      try {
        const result = await this.fetchWithFallback(instrument, timeframe, config, 640, cursor);
        source = result.source;
        this.database.transaction(() => this.cacheBars(instrument.id, timeframe, result.source, result.bars));
        for (const bar of result.bars) {
          if (bar.date >= startDate && bar.date <= endDate) bars.set(bar.date, bar);
        }
        const sorted = [...result.bars].sort((left, right) => left.date.localeCompare(right.date));
        const earliest = sorted[0]?.date;
        if (earliest === undefined || earliest <= startDate || sorted.length < 640) break;
        const previous = previousCalendarDate(earliest);
        if (previous >= cursor) break;
        cursor = previous;
      } catch (error) {
        lastError = error;
        break;
      }
    }

    const result = [...bars.values()].sort((left, right) => left.date.localeCompare(right.date));
    if (result.length > 0) return { source, bars: result };
    if (lastError instanceof Error) throw lastError;
    throw errors.external("未获取到指定日期范围的历史行情");
  }

  overview(): { instrumentCount: number; cachedBarCount: number; latestCacheAt: string | null } {
    const instrumentCount = this.database.get<{ count: number }>("SELECT COUNT(*) AS count FROM instruments")?.count ?? 0;
    const cache = this.database.get<{ count: number; latest: string | null }>("SELECT COUNT(*) AS count, MAX(created_at) AS latest FROM market_bars");
    return { instrumentCount, cachedBarCount: cache?.count ?? 0, latestCacheAt: cache?.latest ?? null };
  }

  async refreshInstruments(userId: string, instrumentIds: string[]): Promise<{ requested: number; refreshed: number; failed: number }> {
    const ids = [...new Set(instrumentIds)];
    let refreshed = 0;
    let failed = 0;
    for (const instrumentId of ids) {
      try {
        await this.getHistory(userId, instrumentId, "day", true);
        refreshed += 1;
      } catch {
        failed += 1;
      }
    }
    return { requested: ids.length, refreshed, failed };
  }

  clearCachedBars(): number {
    const deleted = this.database.get<{ count: number }>("SELECT COUNT(*) AS count FROM market_bars")?.count ?? 0;
    this.database.run("DELETE FROM market_bars");
    return deleted;
  }

  async signalsForWatchlist(userId: string): Promise<Array<{ instrumentId: string; name: string; code: string; price: number; signals: string[]; source: MarketSource }>> {
    const rows = this.database.all<{ instrument_id: string; name: string; code: string }>(
      `SELECT watchlist_entries.instrument_id, instruments.name, instruments.code
         FROM watchlist_entries JOIN instruments ON instruments.id = watchlist_entries.instrument_id
        WHERE watchlist_entries.user_id = $userId ORDER BY watchlist_entries.created_at DESC`,
      { userId }
    );
    const results: Array<{ instrumentId: string; name: string; code: string; price: number; signals: string[]; source: MarketSource }> = [];
    for (const row of rows) {
      const history = await this.getHistory(userId, row.instrument_id, "day", false);
      const latest = history.bars.at(-1);
      if (latest === undefined) continue;
      const prior = history.bars.slice(-21, -1);
      const high = Math.max(...prior.map((bar) => bar.high));
      const averageVolume = prior.reduce((total, bar) => total + bar.volume, 0) / Math.max(prior.length, 1);
      const signals: string[] = [];
      if (latest.close >= high) signals.push("近 20 日新高");
      if (latest.volume >= averageVolume * 1.8) signals.push("成交量放大");
      if (latest.close > latest.open) signals.push("当日上涨");
      results.push({ instrumentId: row.instrument_id, name: row.name, code: row.code, price: latest.close, signals, source: history.source });
    }
    return results;
  }

  async watchlistSnapshot(userId: string): Promise<Array<{ instrumentId: string; price: number; source: MarketSource; updatedAt: string }>> {
    const instruments = this.database.all<{ instrument_id: string }>("SELECT instrument_id FROM watchlist_entries WHERE user_id = $userId", { userId });
    const snapshot: Array<{ instrumentId: string; price: number; source: MarketSource; updatedAt: string }> = [];
    for (const row of instruments) {
      const history = await this.getHistory(userId, row.instrument_id, "day", false);
      const latest = history.bars.at(-1);
      if (latest !== undefined) snapshot.push({ instrumentId: row.instrument_id, price: latest.close, source: history.source, updatedAt: new Date().toISOString() });
    }
    return snapshot;
  }

  informationLinks(): Array<{ label: string; links: Array<{ name: string; url: string }> }> {
    return [
      { label: "公告与披露", links: [{ name: "巨潮资讯", url: "https://www.cninfo.com.cn" }, { name: "上海证券交易所", url: "https://www.sse.com.cn" }] },
      { label: "市场信息", links: [{ name: "东方财富", url: "https://www.eastmoney.com" }, { name: "腾讯财经", url: "https://finance.qq.com" }] }
    ];
  }

  private async fetchWithFallback(
    instrument: Instrument,
    timeframe: Timeframe,
    config: DataSourceConfig,
    limit: number,
    endDate?: string
  ): Promise<{ source: MarketSource; bars: PriceBar[] }> {
    const candidates = [...new Set([config.primary, config.fallback])];
    let lastError: unknown;
    for (const source of candidates) {
      try {
        const provider = this.providers.get(source);
        if (provider === undefined) continue;
        return { source, bars: await provider.history(instrument, timeframe, limit, endDate) };
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError instanceof Error) {
      throw lastError;
    }
    throw errors.external("所有行情数据源均不可用");
  }

  private getCachedBars(instrumentId: string, timeframe: Timeframe, source: MarketSource): PriceBar[] {
    return this.database
      .all<BarRow>(
        `SELECT trade_date, open, close, high, low, volume, amount, turnover_rate FROM market_bars
          WHERE instrument_id = $instrumentId AND timeframe = $timeframe AND source = $source
          ORDER BY trade_date ASC`,
        { instrumentId, timeframe, source }
      )
      .map((row) => ({
        date: row.trade_date,
        open: row.open,
        close: row.close,
        high: row.high,
        low: row.low,
        volume: row.volume,
        ...(row.amount === null ? {} : { amount: row.amount }),
        ...(row.turnover_rate === null ? {} : { turnoverRate: row.turnover_rate }),
      }));
  }

  private takeRecentBars(bars: PriceBar[], limit: number): PriceBar[] {
    return bars.length <= limit ? bars : bars.slice(-limit);
  }

  private cacheBars(instrumentId: string, timeframe: Timeframe, source: MarketSource, bars: PriceBar[]): void {
    const now = new Date().toISOString();
    for (const bar of bars) {
      this.database.run(
        `INSERT INTO market_bars (id, instrument_id, timeframe, source, trade_date, open, close, high, low, volume, amount, turnover_rate, created_at)
         VALUES ($id, $instrumentId, $timeframe, $source, $tradeDate, $open, $close, $high, $low, $volume, $amount, $turnoverRate, $createdAt)
         ON CONFLICT(instrument_id, timeframe, source, trade_date)
         DO UPDATE SET open = excluded.open, close = excluded.close, high = excluded.high, low = excluded.low, volume = excluded.volume, amount = excluded.amount, turnover_rate = excluded.turnover_rate`,
        {
          id: crypto.randomUUID(),
          instrumentId,
          timeframe,
          source,
          tradeDate: bar.date,
          open: bar.open,
          close: bar.close,
          high: bar.high,
          low: bar.low,
          volume: bar.volume,
          amount: bar.amount ?? null,
          turnoverRate: bar.turnoverRate ?? null,
          createdAt: now
        }
      );
    }
  }

  private toInstrument(row: InstrumentRow): Instrument {
    return {
      id: row.id,
      code: row.code,
      exchange: row.exchange,
      name: row.name,
      assetType: row.asset_type,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

function isCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

function barsInRange(bars: PriceBar[], startDate: string, endDate: string): PriceBar[] {
  return bars.filter((bar) => bar.date >= startDate && bar.date <= endDate);
}

function isCompleteRange(bars: PriceBar[], startDate: string, endDate: string): boolean {
  return bars[0]?.date !== undefined && bars[0].date <= startDate && bars.at(-1)?.date !== undefined && bars.at(-1)!.date >= endDate;
}

function previousCalendarDate(date: string): string {
  return new Date(new Date(`${date}T00:00:00.000Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
}

function isDataSourceConfig(value: unknown): value is DataSourceConfig {
  if (typeof value !== "object" || value === null) return false;
  const config = value as Partial<DataSourceConfig>;
  return sourceNames.has(config.primary as MarketSource) && sourceNames.has(config.fallback as MarketSource);
}

/** Rebuilds a persisted configuration against the currently supported sources so that
 * removed sources (for example the retired local mock) fall back to the slot defaults. */
function sanitizeDataSourceConfig(value: unknown): DataSourceConfig {
  if (!isDataSourceConfig(value)) {
    const candidate = typeof value === "object" && value !== null ? (value as Partial<DataSourceConfig>) : {};
    const primary = sourceNames.has(candidate.primary as MarketSource) ? (candidate.primary as MarketSource) : defaultConfig.primary;
    const fallback = sourceNames.has(candidate.fallback as MarketSource) ? (candidate.fallback as MarketSource) : defaultConfig.fallback;
    return { primary, fallback };
  }
  return value;
}

function isInstrumentCatalogProvider(provider: MarketDataProvider): provider is MarketDataProvider & InstrumentCatalogProvider {
  return typeof (provider as Partial<InstrumentCatalogProvider>).searchInstruments === "function";
}
