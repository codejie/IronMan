import { errors } from "../errors";
import { listedFundExchange } from "./listed-fund";
import type { Fetcher, Instrument, MarketDataProvider, PriceBar, Timeframe } from "./types";

interface TencentKlinePayload {
  data?: Record<string, { qfqday?: string[][]; day?: string[][]; qfqweek?: string[][]; week?: string[][]; qfqmonth?: string[][]; month?: string[][] }>;
}

interface TencentEndpoint {
  baseUrl: string;
  path: string;
}

const THIRTY_SECONDS = 10_000;

const endpoints: TencentEndpoint[] = [
  { baseUrl: "https://web.ifzq.gtimg.cn", path: "/appstock/app/fqkline/get" },
  { baseUrl: "https://proxy.finance.qq.com", path: "/ifzqgtimg/appstock/app/newfqkline/get" },
];

export function tencentSymbol(instrument: Instrument): string {
  const listedExchange = listedFundExchange(instrument);
  if (listedExchange !== undefined) return `${listedExchange}${instrument.code}`;
  return instrument.exchange === "fund" ? instrument.code : `${instrument.exchange}${instrument.code}`;
}

function seriesFor(payload: TencentKlinePayload, symbol: string, timeframe: Timeframe): string[][] {
  const item = payload.data?.[symbol];
  if (item === undefined) return [];
  if (timeframe === "week") return item.qfqweek ?? item.week ?? [];
  if (timeframe === "month") return item.qfqmonth ?? item.month ?? [];
  return item.qfqday ?? item.day ?? [];
}

function isWafBlocked(response: Response, body: string): boolean {
  if (response.status === 501) return true;
  return body.includes("waf.tencent.com") || (body.trimStart().startsWith("<!DOCTYPE") && !body.includes("qfq"));
}

export interface TencentMarketProviderOptions {
  fetcher?: Fetcher;
}

export class TencentMarketProvider implements MarketDataProvider {
  readonly source = "tencent" as const;
  private readonly request: Fetcher;

  constructor(options: TencentMarketProviderOptions = {}) {
    this.request = options.fetcher ?? fetch;
  }

  async history(instrument: Instrument, timeframe: Timeframe, limit: number, endDate?: string): Promise<PriceBar[]> {
    const symbol = tencentSymbol(instrument);
    const end = endDate ?? "";
    const param = `${symbol},${timeframe},,${end},${limit},qfq`;
    const requestUrl = `${endpoints[0]!.baseUrl}${endpoints[0]!.path}?param=${encodeURIComponent(param)}`;
    const backupUrl = `${endpoints[1]!.baseUrl}${endpoints[1]!.path}?param=${encodeURIComponent(param)}`;

    for (let attempt = 0; attempt < endpoints.length; attempt += 1) {
      const target = attempt === 0 ? requestUrl : backupUrl;
      let response: Response;
      let body: string;
      try {
        response = await this.request(target, {
          headers: { "user-agent": "IronMan/0.1 market-data" },
          signal: AbortSignal.timeout(THIRTY_SECONDS),
        });
        body = await response.text();
      } catch {
        continue;
      }
      if (!response.ok || isWafBlocked(response, body)) {
        continue;
      }
      let payload: TencentKlinePayload;
      try {
        payload = JSON.parse(body) as TencentKlinePayload;
      } catch {
        continue;
      }
      const bars = seriesFor(payload, symbol, timeframe)
        .map((row) => ({
          date: row[0] ?? "",
          open: Number(row[1]),
          close: Number(row[2]),
          high: Number(row[3]),
          low: Number(row[4]),
          volume: Number(row[5]),
          amount: Number(row[6]),
          turnoverRate: Number(row[7])
        }))
        .filter((row) => row.date.length > 0 && [row.open, row.close, row.high, row.low, row.volume].every(Number.isFinite));
      if (bars.length === 0) {
        throw errors.external("Tencent 未返回可用的历史行情");
      }
      return bars.map((bar) => ({
        date: bar.date,
        open: bar.open,
        close: bar.close,
        high: bar.high,
        low: bar.low,
        volume: bar.volume,
        ...(Number.isFinite(bar.amount) ? { amount: bar.amount } : {}),
        ...(Number.isFinite(bar.turnoverRate) ? { turnoverRate: bar.turnoverRate } : {}),
      }));
    }
    throw errors.external("Tencent 行情服务暂不可用");
  }
}
