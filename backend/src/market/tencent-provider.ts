import { errors } from "../errors";
import { listedFundExchange } from "./listed-fund";
import type { Fetcher, Instrument, MarketDataProvider, PriceBar, Timeframe } from "./types";

interface TencentKlinePayload {
  data?: Record<string, { qfqday?: string[][]; day?: string[][]; qfqweek?: string[][]; week?: string[][]; qfqmonth?: string[][]; month?: string[][] }>;
}

interface TencentMinutePayload {
  data?: Record<string, { data?: { data?: string[] } }>;
}

interface TencentDayMinutePayload {
  data?: Record<string, { data?: Array<{ date?: string; data?: string[] }> }>;
}

export interface IntradayMinutePoint {
  /** 交易时间，格式 HH:MM。 */
  time: string;
  price: number;
  volume: number;
  cumulativeAmount: number;
}

export interface IntradayMinuteResult {
  /** 分时所属交易日，格式 YYYY-MM-DD。 */
  date: string;
  points: IntradayMinutePoint[];
}

export interface IntradayMinuteProvider {
  intradayMinute(instrument: Instrument, date?: string): Promise<IntradayMinuteResult>;
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

  async intradayMinute(instrument: Instrument, date?: string): Promise<IntradayMinuteResult> {
    const symbol = tencentSymbol(instrument);
    const normalizedDate = normalizeMinuteDate(date);
    const path = normalizedDate === undefined ? "/appstock/app/minute/query" : "/appstock/app/day/query";
    const requestUrls = [
      `${endpoints[0]!.baseUrl}${path}?code=${encodeURIComponent(symbol)}`,
      `${endpoints[1]!.baseUrl}/ifzqgtimg${path}?code=${encodeURIComponent(symbol)}`,
    ];

    for (const target of requestUrls) {
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
      if (!response.ok || isWafBlocked(response, body)) continue;
      let payload: TencentMinutePayload | TencentDayMinutePayload;
      try {
        payload = JSON.parse(body) as TencentMinutePayload | TencentDayMinutePayload;
      } catch {
        continue;
      }
      const parsed = normalizedDate === undefined
        ? parseCurrentMinute(payload as TencentMinutePayload, symbol)
        : parseDayMinute(payload as TencentDayMinutePayload, symbol, normalizedDate);
      if (parsed === null) continue;
      return parsed;
    }
    throw errors.external("Tencent 分时服务暂不可用");
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

function normalizeMinuteDate(date: string | undefined): string | undefined {
  if (date === undefined || date.trim() === "") return undefined;
  const normalized = date.trim().replaceAll("/", "-");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw errors.validation("分时日期格式无效");
  return normalized;
}

function formatMinuteTime(raw: string): string {
  const compact = raw.trim();
  if (/^\d{2}:\d{2}$/.test(compact)) return compact;
  if (/^\d{3,4}$/.test(compact)) {
    const hour = compact.slice(0, compact.length - 2);
    const minute = compact.slice(-2);
    return `${hour.padStart(2, "0")}:${minute}`;
  }
  return compact;
}

function parseMinuteRows(rows: string[]): IntradayMinutePoint[] {
  return rows
    .map((row) => {
      const parts = row.trim().split(/\s+/);
      const [time, price, volume, cumulativeAmount] = parts;
      return {
        time: formatMinuteTime(time ?? ""),
        price: Number(price),
        volume: Number(volume),
        cumulativeAmount: Number(cumulativeAmount),
      };
    })
    .filter((point) => /^\d{2}:\d{2}$/.test(point.time) && [point.price, point.volume, point.cumulativeAmount].every(Number.isFinite));
}

function parseCurrentMinute(payload: TencentMinutePayload, symbol: string): IntradayMinuteResult | null {
  const rows = payload.data?.[symbol]?.data?.data ?? [];
  if (rows.length === 0) return null;
  return {
    date: new Date().toISOString().slice(0, 10),
    points: parseMinuteRows(rows),
  };
}

function parseDayMinute(payload: TencentDayMinutePayload, symbol: string, requestedDate: string): IntradayMinuteResult | null {
  const days = payload.data?.[symbol]?.data ?? [];
  const matched = days.find((day) => day.date === requestedDate.replaceAll("-", ""));
  if (matched === undefined) throw errors.external("Tencent 未返回该交易日的分时数据");
  const rows = matched.data ?? [];
  if (rows.length === 0) return null;
  return { date: requestedDate, points: parseMinuteRows(rows) };
}
