export type AssetType = "stock" | "index" | "fund";
export type Exchange = "sh" | "sz" | "bj" | "fund";
export type MarketSource = "tencent" | "eastmoney" | "akshare";
export type Timeframe = "day" | "week" | "month";

export interface Instrument {
  id: string;
  code: string;
  exchange: Exchange;
  name: string;
  assetType: AssetType;
  createdAt: string;
  updatedAt: string;
}

export interface PriceBar {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount?: number | null;
  turnoverRate?: number | null;
}

export interface MarketDataProvider {
  readonly source: MarketSource;
  history(instrument: Instrument, timeframe: Timeframe, limit: number, endDate?: string): Promise<PriceBar[]>;
}

export interface InstrumentCatalogEntry {
  code: string;
  exchange: Exchange;
  name: string;
  assetType: AssetType;
}

export interface InstrumentCatalogProvider {
  searchInstruments(assetType: AssetType, query: string, limit?: number): Promise<InstrumentCatalogEntry[]>;
}

export interface DataSourceConfig {
  primary: MarketSource;
  fallback: MarketSource;
}
