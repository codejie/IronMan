import { errors } from "../errors";
import type { Instrument, MarketDataProvider, PriceBar, Timeframe } from "./types";

interface TencentKlinePayload {
  data?: Record<string, { qfqday?: string[][]; day?: string[][]; qfqweek?: string[][]; week?: string[][]; qfqmonth?: string[][]; month?: string[][] }>;
}

function symbolFor(instrument: Instrument): string {
  return instrument.exchange === "fund" ? instrument.code : `${instrument.exchange}${instrument.code}`;
}

function seriesFor(payload: TencentKlinePayload, symbol: string, timeframe: Timeframe): string[][] {
  const item = payload.data?.[symbol];
  if (item === undefined) return [];
  if (timeframe === "week") return item.qfqweek ?? item.week ?? [];
  if (timeframe === "month") return item.qfqmonth ?? item.month ?? [];
  return item.qfqday ?? item.day ?? [];
}

export class TencentMarketProvider implements MarketDataProvider {
  readonly source = "tencent" as const;

  async history(instrument: Instrument, timeframe: Timeframe): Promise<PriceBar[]> {
    const symbol = symbolFor(instrument);
    const response = await fetch(
      `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${encodeURIComponent(`${symbol},${timeframe},,,180,qfq`)}`,
      { headers: { "user-agent": "IronMan/0.1 market-data" }, signal: AbortSignal.timeout(10_000) }
    );
    if (!response.ok) {
      throw errors.external("Tencent 行情服务暂不可用");
    }
    const data = (await response.json()) as TencentKlinePayload;
    const bars = seriesFor(data, symbol, timeframe)
      .map((row) => ({
        date: row[0] ?? "",
        open: Number(row[1]),
        close: Number(row[2]),
        high: Number(row[3]),
        low: Number(row[4]),
        volume: Number(row[5])
      }))
      .filter((row) => row.date.length > 0 && [row.open, row.close, row.high, row.low, row.volume].every(Number.isFinite));
    if (bars.length === 0) {
      throw errors.external("Tencent 未返回可用的历史行情");
    }
    return bars;
  }
}
