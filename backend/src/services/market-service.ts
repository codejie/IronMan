import { IronManDatabase } from "../db/database";
import { errors } from "../errors";
import { EastmoneyMarketProvider } from "../market/eastmoney-provider";
import { MockMarketProvider } from "../market/mock-provider";
import { TencentMarketProvider } from "../market/tencent-provider";
import type { AssetType, DataSourceConfig, Exchange, Instrument, MarketDataProvider, MarketSource, PriceBar, Timeframe } from "../market/types";
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
}

const defaultConfig: DataSourceConfig = { primary: "tencent", fallback: "mock" };
const sourceNames = new Set<MarketSource>(["mock", "tencent", "eastmoney"]);

export class MarketService {
  private readonly providers: Map<MarketSource, MarketDataProvider>;

  constructor(
    private readonly database: IronManDatabase,
    private readonly settings: SettingsService,
    providers: MarketDataProvider[] = [new TencentMarketProvider(), new EastmoneyMarketProvider(), new MockMarketProvider()]
  ) {
    this.providers = new Map(providers.map((provider) => [provider.source, provider]));
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

  search(query: string): Instrument[] {
    const normalized = `%${query.trim()}%`;
    return this.database
      .all<InstrumentRow>(
        "SELECT * FROM instruments WHERE code LIKE $query OR name LIKE $query ORDER BY code ASC LIMIT 50",
        { query: normalized }
      )
      .map((row) => this.toInstrument(row));
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
    if (!isDataSourceConfig(stored)) {
      return defaultConfig;
    }
    return stored;
  }

  setDataSourceConfig(userId: string, config: DataSourceConfig): DataSourceConfig {
    if (!sourceNames.has(config.primary) || !sourceNames.has(config.fallback)) {
      throw errors.validation("不支持的数据源");
    }
    this.settings.upsert(userId, "market.data-source", config);
    return config;
  }

  async getHistory(userId: string, instrumentId: string, timeframe: Timeframe, refresh: boolean): Promise<{ source: MarketSource; bars: PriceBar[] }> {
    const instrument = this.getInstrument(instrumentId);
    const config = this.getDataSourceConfig(userId);
    if (!refresh) {
      const cached = this.getCachedBars(instrument.id, timeframe, config.primary);
      if (cached.length > 0) {
        return { source: config.primary, bars: cached };
      }
    }

    const result = await this.fetchWithFallback(instrument, timeframe, config);
    this.database.transaction(() => this.cacheBars(instrument.id, timeframe, result.source, result.bars));
    return result;
  }

  overview(): { instrumentCount: number; cachedBarCount: number; latestCacheAt: string | null } {
    const instrumentCount = this.database.get<{ count: number }>("SELECT COUNT(*) AS count FROM instruments")?.count ?? 0;
    const cache = this.database.get<{ count: number; latest: string | null }>("SELECT COUNT(*) AS count, MAX(created_at) AS latest FROM market_bars");
    return { instrumentCount, cachedBarCount: cache?.count ?? 0, latestCacheAt: cache?.latest ?? null };
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

  private async fetchWithFallback(instrument: Instrument, timeframe: Timeframe, config: DataSourceConfig): Promise<{ source: MarketSource; bars: PriceBar[] }> {
    const candidates = [...new Set([config.primary, config.fallback])];
    let lastError: unknown;
    for (const source of candidates) {
      try {
        const provider = this.providers.get(source);
        if (provider === undefined) continue;
        return { source, bars: await provider.history(instrument, timeframe) };
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
        `SELECT trade_date, open, close, high, low, volume FROM market_bars
          WHERE instrument_id = $instrumentId AND timeframe = $timeframe AND source = $source
          ORDER BY trade_date ASC`,
        { instrumentId, timeframe, source }
      )
      .map((row) => ({ date: row.trade_date, open: row.open, close: row.close, high: row.high, low: row.low, volume: row.volume }));
  }

  private cacheBars(instrumentId: string, timeframe: Timeframe, source: MarketSource, bars: PriceBar[]): void {
    const now = new Date().toISOString();
    for (const bar of bars) {
      this.database.run(
        `INSERT INTO market_bars (id, instrument_id, timeframe, source, trade_date, open, close, high, low, volume, created_at)
         VALUES ($id, $instrumentId, $timeframe, $source, $tradeDate, $open, $close, $high, $low, $volume, $createdAt)
         ON CONFLICT(instrument_id, timeframe, source, trade_date)
         DO UPDATE SET open = excluded.open, close = excluded.close, high = excluded.high, low = excluded.low, volume = excluded.volume`,
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

function isDataSourceConfig(value: unknown): value is DataSourceConfig {
  if (typeof value !== "object" || value === null) return false;
  const config = value as Partial<DataSourceConfig>;
  return sourceNames.has(config.primary as MarketSource) && sourceNames.has(config.fallback as MarketSource);
}
