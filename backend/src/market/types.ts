export type AssetType = "stock" | "index" | "fund";
export type Exchange = "sh" | "sz" | "bj" | "fund";
export type MarketSource = "mock" | "tencent" | "eastmoney";
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
}

export interface MarketDataProvider {
  readonly source: MarketSource;
  history(instrument: Instrument, timeframe: Timeframe): Promise<PriceBar[]>;
}

export interface DataSourceConfig {
  primary: MarketSource;
  fallback: MarketSource;
}
