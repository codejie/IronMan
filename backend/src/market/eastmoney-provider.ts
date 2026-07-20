import { errors } from "../errors";
import type { Instrument, MarketDataProvider, PriceBar, Timeframe } from "./types";

interface EastmoneyPayload {
  data?: { klines?: string[] };
}

function securityId(instrument: Instrument): string {
  const market = instrument.exchange === "sh" ? "1" : "0";
  return `${market}.${instrument.code}`;
}

export class EastmoneyMarketProvider implements MarketDataProvider {
  readonly source = "eastmoney" as const;

  async history(instrument: Instrument, timeframe: Timeframe): Promise<PriceBar[]> {
    const klt = timeframe === "week" ? "102" : timeframe === "month" ? "103" : "101";
    const query = new URLSearchParams({ secid: securityId(instrument), klt, fqt: "1", lmt: "180", end: "20500101", fields1: "f1,f2,f3,f4,f5,f6", fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61" });
    const response = await fetch(`https://push2his.eastmoney.com/api/qt/stock/kline/get?${query.toString()}`, { headers: { "user-agent": "IronMan/0.1 market-data" }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw errors.external("Eastmoney 行情服务暂不可用");
    const payload = (await response.json()) as EastmoneyPayload;
    const bars = (payload.data?.klines ?? [])
      .map((line) => line.split(","))
      .map((parts) => ({ date: parts[0] ?? "", open: Number(parts[1]), close: Number(parts[2]), high: Number(parts[3]), low: Number(parts[4]), volume: Number(parts[5]) }))
      .filter((bar) => bar.date.length > 0 && [bar.open, bar.close, bar.high, bar.low, bar.volume].every(Number.isFinite));
    if (bars.length === 0) throw errors.external("Eastmoney 未返回可用的历史行情");
    return bars;
  }
}
