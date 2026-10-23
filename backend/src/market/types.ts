export type AssetType = "stock" | "index" | "fund";
export type Exchange = "sh" | "sz" | "bj" | "fund";
export type MarketSource = "tencent" | "eastmoney" | "akshare";

/** 分时数据来源偏好（仅标明来源，不改变读取/存储/展示行为）。 */
export type IntradayDisplaySource = "snapshot" | "realtime";
export type Timeframe = "day" | "week" | "month";
export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

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
