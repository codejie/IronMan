import { IronManDatabase } from "../db/database";
import { decodeTextBytes } from "../charset";
import { AkShareTechnicalProvider, type AkShareTechnicalKind, type TechnicalRankingProvider } from "../market/akshare-technical-provider";
import type { AssetType, Exchange, Instrument, PriceBar } from "../market/types";
import { MarketService } from "./market-service";

export type ThirdPartyTechnicalKind = AkShareTechnicalKind;
export type TableValue = string | number | null;

export interface ThirdPartyTechnicalQuery {
  kind: ThirdPartyTechnicalKind;
  category?: number;
  days?: number;
  date?: string;
}

export interface ThirdPartyTechnicalRow {
  values: Record<string, TableValue>;
  instrument: Pick<Instrument, "id" | "code" | "exchange" | "name" | "assetType"> | null;
}

export interface ThirdPartyTechnicalTable {
  columns: string[];
  rows: ThirdPartyTechnicalRow[];
  source: "akshare" | "tonghuashun" | "eastmoney" | "local";
  updatedAt: string;
  notice?: string;
}

export interface ThirdPartyInfoLink {
  name: string;
  url: string;
  needCode: boolean;
  openInNewWindow: boolean;
}

export interface ThirdPartyInfoGroup {
  label: string;
  links: ThirdPartyInfoLink[];
}

interface CachedInstrumentRow {
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

interface EastmoneyLimitUpPayload {
  data?: { tc?: number | null; pool?: Array<Record<string, unknown>> | null } | null;
}

type ThirdPartyFetcher = (input: string, init?: RequestInit) => Promise<Response>;

const technicalKinds = new Set<ThirdPartyTechnicalKind>(["new_high", "uptrend", "high_volume", "rise_volume_price", "limit_up_pool"]);
const thsPaths: Record<Exclude<ThirdPartyTechnicalKind, "limit_up_pool">, string> = {
  new_high: "cxg",
  uptrend: "lxsz",
  high_volume: "cxfl",
  rise_volume_price: "ljqs"
};
const newHighLabels = ["月创新高", "半年新高", "一年新高", "历史新高"] as const;

export function thirdPartyInfoLinks(): ThirdPartyInfoGroup[] {
  return [
    {
      label: "热度信息",
      links: [
        { name: "东财热度", url: "https://guba.eastmoney.com/rank/", needCode: false, openInNewWindow: false },
        { name: "同花顺投顾", url: "https://guba.10jqka.com.cn/", needCode: false, openInNewWindow: false },
        { name: "新浪财经", url: "https://guba.sina.com.cn/", needCode: false, openInNewWindow: false },
        { name: "百度热搜", url: "https://gushitong.baidu.com/expressnews?tag=A%E8%82%A1", needCode: false, openInNewWindow: false }
      ]
    },
    {
      label: "行情数据",
      links: [
        { name: "东财数据中心", url: "https://data.eastmoney.com/", needCode: false, openInNewWindow: false },
        { name: "同花顺行情中心", url: "https://q.10jqka.com.cn/", needCode: false, openInNewWindow: false }
      ]
    },
    {
      label: "财经资讯",
      links: [
        { name: "东财财经早餐", url: "https://stock.eastmoney.com/a/czpnc.html", needCode: false, openInNewWindow: false },
        { name: "同花顺财经", url: "https://news.10jqka.com.cn/", needCode: false, openInNewWindow: false },
        { name: "富途快讯", url: "https://news.futunn.com/main/live?lang=zh-cn", needCode: false, openInNewWindow: false },
        { name: "财联社电报", url: "https://www.cls.cn/telegraph", needCode: false, openInNewWindow: false }
      ]
    },
    {
      label: "个股数据",
      links: [
        { name: "东财个股新闻", url: "https://so.eastmoney.com/news/s?keyword={code}", needCode: true, openInNewWindow: false },
        { name: "同花顺个股频道", url: "https://stockpage.10jqka.com.cn/{code}/", needCode: true, openInNewWindow: false }
      ]
    },
    {
      label: "单独窗口",
      links: [{ name: "雪球行情中心", url: "https://xueqiu.com/hq", needCode: false, openInNewWindow: true }]
    }
  ];
}

export function parseThsRankingTable(html: string): { columns: string[]; rows: Array<Record<string, string>> } {
  const headerBlock = html.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1] ?? "";
  const bodyBlock = html.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] ?? "";
  const columns = extractCells(headerBlock, "th").map(cleanHtmlText).filter(Boolean);
  if (columns.length === 0 || bodyBlock.length === 0) return { columns: [], rows: [] };

  const rows: Array<Record<string, string>> = [];
  for (const rowMarkup of bodyBlock.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = extractCells(rowMarkup[1] ?? "", "td").map(cleanHtmlText);
    if (cells.length === 0) continue;
    const row: Record<string, string> = {};
    columns.forEach((column, index) => {
      row[column] = cells[index] ?? "";
    });
    rows.push(row);
  }
  return { columns, rows };
}

export function filterRankingRows(rows: Array<Record<string, string>>, column: string, days: number): Array<Record<string, string>> {
  if (days <= 1) return rows;
  return rows.filter((row) => numericValue(row[column]) >= days);
}

export function buildLimitUpPoolTable(payload: EastmoneyLimitUpPayload): { columns: string[]; rows: Array<Record<string, TableValue>> } {
  const columns = ["代码", "名称", "最新价", "涨跌幅", "成交额", "流通市值", "总市值", "换手率", "连板数", "封板资金"];
  const rows = (payload.data?.pool ?? []).map((item) => {
    const price = finiteValue(item.p);
    return {
      "代码": textValue(item.c),
      "名称": textValue(item.n),
      "最新价": price === null ? null : price / 1000,
      "涨跌幅": finiteValue(item.zdp),
      "成交额": finiteValue(item.amount),
      "流通市值": finiteValue(item.ltsz),
      "总市值": finiteValue(item.tshare),
      "换手率": finiteValue(item.hs),
      "连板数": finiteValue(item.lbc),
      "封板资金": finiteValue(item.fund)
    };
  });
  return { columns, rows };
}

export interface ThirdPartyRankingBreakerOptions {
  /** 连续失败多少次后熔断同花顺榜单请求。 */
  thsTripThreshold?: number;
  /** 熔断后的冷却时长（毫秒），冷却内直接走向后本地计算。 */
  thsCooldownMs?: number;
}

const DEFAULT_THS_TRIP_THRESHOLD = 3;
const DEFAULT_THS_COOLDOWN_MS = 10 * 60 * 1000;

export class ThirdPartyDataService {
  private thsConsecutiveFailures = 0;
  private thsRetryAllowedAt = 0;

  constructor(
    private readonly database: IronManDatabase,
    private readonly market: MarketService,
    private readonly request: ThirdPartyFetcher = (input, init) => fetch(input, init),
    private readonly akshare: TechnicalRankingProvider = new AkShareTechnicalProvider(),
    breakerOptions: ThirdPartyRankingBreakerOptions = {}
  ) {
    this.thsTripThreshold = breakerOptions.thsTripThreshold ?? DEFAULT_THS_TRIP_THRESHOLD;
    this.thsCooldownMs = breakerOptions.thsCooldownMs ?? DEFAULT_THS_COOLDOWN_MS;
  }

  private readonly thsTripThreshold: number;
  private readonly thsCooldownMs: number;

  async technical(userId: string, query: ThirdPartyTechnicalQuery): Promise<ThirdPartyTechnicalTable> {
    if (!technicalKinds.has(query.kind)) throw new Error("不支持的技术数据类型");
    const now = new Date().toISOString();
    try {
      const remote = await this.akshare.technical(query);
      if (remote.rows.length === 0) throw new Error("上游未返回可用榜单数据");
      return {
        columns: remote.columns,
        rows: remote.rows.map((values) => ({ values, instrument: this.instrumentForRow(values) })),
        source: "akshare",
        updatedAt: now
      };
    } catch {
      try {
        const remote = query.kind === "limit_up_pool" ? await this.fetchLimitUpPool(query.date) : await this.fetchThsRankingWithBreaker(query);
        if (remote.rows.length === 0) throw new Error("上游未返回可用榜单数据");
        return {
          columns: remote.columns,
          rows: remote.rows.map((values) => ({ values, instrument: this.instrumentForRow(values) })),
          source: query.kind === "limit_up_pool" ? "eastmoney" : "tonghuashun",
          updatedAt: now,
          notice: "AKShare 服务暂不可用，已降级使用公开第三方榜单数据。"
        };
      } catch {
        const local = this.localTechnicalTable(userId, query);
        return {
          columns: local.columns,
          rows: local.rows.map((values) => ({ values, instrument: this.instrumentForRow(values) })),
          source: "local",
          updatedAt: now,
          notice: "AKShare 与公开第三方榜单暂不可用，已展示当前账户持仓与自选中可用行情的本地计算结果。"
        };
      }
    }
  }

  informationLinks(): ThirdPartyInfoGroup[] {
    return thirdPartyInfoLinks();
  }

  marketCloud(): { title: string; url: string; openUrl: string } {
    return { title: "52ETF 大盘云图", url: "https://52etf.site", openUrl: "https://52etf.site" };
  }

  private async fetchThsRankingWithBreaker(query: ThirdPartyTechnicalQuery): Promise<{ columns: string[]; rows: Array<Record<string, TableValue>> }> {
    if (Date.now() < this.thsRetryAllowedAt) {
      throw new Error("同花顺榜单处于熔断冷却期，暂不请求上游");
    }
    try {
      const result = await this.fetchThsRanking(query);
      this.thsConsecutiveFailures = 0;
      this.thsRetryAllowedAt = 0;
      return result;
    } catch (error) {
      this.thsConsecutiveFailures += 1;
      if (this.thsConsecutiveFailures >= this.thsTripThreshold) {
        this.thsRetryAllowedAt = Date.now() + this.thsCooldownMs;
        this.thsConsecutiveFailures = 0;
      }
      throw error;
    }
  }

  private async fetchThsRanking(query: ThirdPartyTechnicalQuery): Promise<{ columns: string[]; rows: Array<Record<string, TableValue>> }> {
    const path = thsPaths[query.kind as Exclude<ThirdPartyTechnicalKind, "limit_up_pool">];
    const response = await this.request(`https://data.10jqka.com.cn/rank/${path}/`, {
      headers: {
        accept: "text/html, */*; q=0.01",
        referer: `https://data.10jqka.com.cn/rank/${path}/`,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36"
      },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`同花顺榜单请求失败：${response.status}`);
    const payload = new Uint8Array(await response.arrayBuffer());
    const parsed = parseThsRankingTable(decodeTextBytes(payload, response.headers.get("content-type")));
    let rows = parsed.rows;
    if (query.kind === "uptrend") rows = filterRankingRows(rows, "连涨天数", normalizeDays(query.days));
    if (query.kind === "high_volume") rows = filterRankingRows(rows, "放量天数", normalizeDays(query.days));
    if (query.kind === "rise_volume_price") rows = filterRankingRows(rows, "量价齐升天数", normalizeDays(query.days));
    if (query.kind === "new_high") {
      const label = newHighLabels[normalizeCategory(query.category)];
      rows = rows.map((row) => ({ ...row, "新高分类": label }));
      const columns = parsed.columns.includes("新高分类") ? parsed.columns : [...parsed.columns, "新高分类"];
      return { columns, rows };
    }
    return { columns: parsed.columns, rows };
  }

  private async fetchLimitUpPool(date?: string): Promise<{ columns: string[]; rows: Array<Record<string, TableValue>> }> {
    const normalizedDate = normalizeMarketDate(date);
    const pageSize = 500;
    const pool: Array<Record<string, unknown>> = [];
    let totalCount = 0;
    for (let page = 0; page <= 4; page += 1) {
      const params = new URLSearchParams({
        ut: "7eea3edcaed734bea9cbfc24409ed989",
        date: normalizedDate,
        dpt: "wz.ztzt",
        Pageindex: String(page),
        PageSize: String(pageSize),
        sort: "fbt:asc"
      });
      const response = await this.request(`https://push2ex.eastmoney.com/getTopicZTPool?${params.toString()}`, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; IronMan/1.0)", referer: "https://quote.eastmoney.com/" },
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) throw new Error(`东方财富涨停股池请求失败：${response.status}`);
      const payload = (await response.json()) as EastmoneyLimitUpPayload;
      const rows = payload.data?.pool ?? [];
      totalCount = typeof payload.data?.tc === "number" && Number.isFinite(payload.data.tc) ? payload.data.tc : pool.length + rows.length;
      pool.push(...rows);
      if (pool.length >= totalCount || rows.length < pageSize) break;
    }
    const table = buildLimitUpPoolTable({ data: { tc: totalCount, pool } });
    if (table.rows.length === 0) throw new Error("东方财富未返回涨停股池数据");
    return table;
  }

  private localTechnicalTable(userId: string, query: ThirdPartyTechnicalQuery): { columns: string[]; rows: Array<Record<string, TableValue>> } {
    const rows = this.userInstruments(userId)
      .map((instrument) => ({ instrument, bars: this.cachedBars(instrument.id) }))
      .filter((entry) => entry.bars.length >= 2);

    switch (query.kind) {
      case "new_high":
        return this.localNewHigh(rows, normalizeCategory(query.category));
      case "uptrend":
        return this.localUptrend(rows, normalizeDays(query.days));
      case "high_volume":
        return this.localHighVolume(rows, normalizeDays(query.days));
      case "rise_volume_price":
        return this.localRiseVolumePrice(rows, normalizeDays(query.days));
      case "limit_up_pool":
        return this.localLimitUpPool(rows, query.date);
    }
  }

  private localNewHigh(entries: Array<{ instrument: Instrument; bars: PriceBar[] }>, category: number): { columns: string[]; rows: Array<Record<string, TableValue>> } {
    const window = [30, 120, 250, Number.MAX_SAFE_INTEGER][category] ?? 30;
    const label = newHighLabels[category] ?? newHighLabels[0];
    const rows = entries.flatMap(({ instrument, bars }) => {
      const latest = bars.at(-1)!;
      const range = bars.slice(-window);
      const high = Math.max(...range.map((bar) => bar.high));
      if (latest.close < high) return [];
      return [{ "代码": instrument.code, "名称": instrument.name, "最新价": round(latest.close), "涨跌幅": percentChange(bars), "新高分类": label, "日期": latest.date }];
    });
    return { columns: ["代码", "名称", "最新价", "涨跌幅", "新高分类", "日期"], rows };
  }

  private localUptrend(entries: Array<{ instrument: Instrument; bars: PriceBar[] }>, minimumDays: number): { columns: string[]; rows: Array<Record<string, TableValue>> } {
    const rows = entries.flatMap(({ instrument, bars }) => {
      const count = trailingCount(bars, (current, previous) => current.close > previous.close);
      if (count < minimumDays) return [];
      const latest = bars.at(-1)!;
      return [{ "代码": instrument.code, "名称": instrument.name, "最新价": round(latest.close), "涨跌幅": percentChange(bars), "连涨天数": count, "日期": latest.date }];
    });
    return { columns: ["代码", "名称", "最新价", "涨跌幅", "连涨天数", "日期"], rows };
  }

  private localHighVolume(entries: Array<{ instrument: Instrument; bars: PriceBar[] }>, minimumDays: number): { columns: string[]; rows: Array<Record<string, TableValue>> } {
    const rows = entries.flatMap(({ instrument, bars }) => {
      const count = trailingCount(bars, (current, _previous, index) => current.volume >= averagePriorVolume(bars, index) * 1.35);
      if (count < minimumDays) return [];
      const latest = bars.at(-1)!;
      return [{ "代码": instrument.code, "名称": instrument.name, "最新价": round(latest.close), "成交量": round(latest.volume), "放量倍数": round(latest.volume / Math.max(averagePriorVolume(bars, bars.length - 1), 1)), "放量天数": count, "日期": latest.date }];
    });
    return { columns: ["代码", "名称", "最新价", "成交量", "放量倍数", "放量天数", "日期"], rows };
  }

  private localRiseVolumePrice(entries: Array<{ instrument: Instrument; bars: PriceBar[] }>, minimumDays: number): { columns: string[]; rows: Array<Record<string, TableValue>> } {
    const rows = entries.flatMap(({ instrument, bars }) => {
      const count = trailingCount(bars, (current, previous, index) => current.close > previous.close && current.volume >= averagePriorVolume(bars, index) * 1.15);
      if (count < minimumDays) return [];
      const latest = bars.at(-1)!;
      return [{ "代码": instrument.code, "名称": instrument.name, "最新价": round(latest.close), "涨跌幅": percentChange(bars), "成交量": round(latest.volume), "量价齐升天数": count, "日期": latest.date }];
    });
    return { columns: ["代码", "名称", "最新价", "涨跌幅", "成交量", "量价齐升天数", "日期"], rows };
  }

  private localLimitUpPool(entries: Array<{ instrument: Instrument; bars: PriceBar[] }>, date?: string): { columns: string[]; rows: Array<Record<string, TableValue>> } {
    const selectedDate = date === undefined || date.trim() === "" ? undefined : normalizeIsoDate(date);
    const rows = entries.flatMap(({ instrument, bars }) => {
      const index = selectedDate === undefined ? bars.length - 1 : bars.findIndex((bar) => bar.date === selectedDate);
      if (index < 1) return [];
      const current = bars[index]!;
      const previous = bars[index - 1]!;
      const change = ((current.close - previous.close) / previous.close) * 100;
      if (change < 9.5) return [];
      return [{ "代码": instrument.code, "名称": instrument.name, "最新价": round(current.close), "涨跌幅": round(change), "成交额": round(current.close * current.volume), "换手率": null, "日期": current.date }];
    });
    return { columns: ["代码", "名称", "最新价", "涨跌幅", "成交额", "换手率", "日期"], rows };
  }

  private userInstruments(userId: string): Instrument[] {
    return this.database
      .all<CachedInstrumentRow>(
        `SELECT instruments.*
           FROM instruments
           JOIN (
             SELECT instrument_id FROM watchlist_entries WHERE user_id = $userId
             UNION
             SELECT instrument_id FROM holdings WHERE user_id = $userId
           ) AS referenced ON referenced.instrument_id = instruments.id
          WHERE instruments.asset_type = 'stock'
          ORDER BY instruments.code ASC`,
        { userId }
      )
      .map((row) => ({ id: row.id, code: row.code, exchange: row.exchange, name: row.name, assetType: row.asset_type, createdAt: row.created_at, updatedAt: row.updated_at }));
  }

  private cachedBars(instrumentId: string): PriceBar[] {
    const source = this.database.get<{ source: string }>(
      `SELECT source FROM market_bars
        WHERE instrument_id = $instrumentId AND timeframe = 'day'
        GROUP BY source
        ORDER BY MAX(trade_date) DESC, COUNT(*) DESC
        LIMIT 1`,
      { instrumentId }
    )?.source;
    if (source === undefined) return [];
    return this.database
      .all<BarRow>(
        `SELECT trade_date, open, close, high, low, volume
           FROM market_bars
          WHERE instrument_id = $instrumentId AND timeframe = 'day' AND source = $source
          ORDER BY trade_date ASC`,
        { instrumentId, source }
      )
      .map((bar) => ({ date: bar.trade_date, open: bar.open, close: bar.close, high: bar.high, low: bar.low, volume: bar.volume }));
  }

  private instrumentForRow(values: Record<string, TableValue>): Pick<Instrument, "id" | "code" | "exchange" | "name" | "assetType"> | null {
    const code = normalizeCode(values["股票代码"] ?? values["代码"]);
    const name = textValue(values["股票简称"] ?? values["名称"]);
    if (code === "" || name === "") return null;
    const exchange = stockExchange(code);
    if (exchange === null) return null;
    const instrument = this.market.upsertInstrument({ code, exchange, name, assetType: "stock" });
    return { id: instrument.id, code: instrument.code, exchange: instrument.exchange, name: instrument.name, assetType: instrument.assetType };
  }
}

function extractCells(markup: string, tag: "th" | "td"): string[] {
  return [...markup.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))].map((match) => match[1] ?? "");
}

function cleanHtmlText(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function finiteValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function numericValue(value: string | undefined): number {
  const parsed = Number((value ?? "").replace(/[,%]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDays(days: number | undefined): number {
  return Number.isInteger(days) && days !== undefined ? Math.max(1, Math.min(days, 30)) : 1;
}

function normalizeCategory(category: number | undefined): 0 | 1 | 2 | 3 {
  return category === 1 || category === 2 || category === 3 ? category : 0;
}

function normalizeMarketDate(date: string | undefined): string {
  return date === undefined || date.trim() === "" ? new Date().toISOString().slice(0, 10).replaceAll("-", "") : normalizeIsoDate(date).replaceAll("-", "");
}

function normalizeIsoDate(date: string): string {
  const normalized = date.trim().replaceAll("/", "-");
  if (/^\d{8}$/.test(normalized)) return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error("日期格式无效");
  return normalized;
}

function normalizeCode(value: TableValue | undefined): string {
  const matched = textValue(value).match(/\d{6}/);
  return matched?.[0] ?? "";
}

function stockExchange(code: string): Exchange | null {
  if (code.startsWith("6") || code.startsWith("5")) return "sh";
  if (code.startsWith("0") || code.startsWith("3")) return "sz";
  if (code.startsWith("4") || code.startsWith("8")) return "bj";
  return null;
}

function percentChange(bars: PriceBar[]): number | null {
  const latest = bars.at(-1);
  const previous = bars.at(-2);
  if (latest === undefined || previous === undefined || previous.close === 0) return null;
  return round(((latest.close - previous.close) / previous.close) * 100);
}

function trailingCount(bars: PriceBar[], predicate: (current: PriceBar, previous: PriceBar, index: number) => boolean): number {
  let count = 0;
  for (let index = bars.length - 1; index > 0; index -= 1) {
    if (!predicate(bars[index]!, bars[index - 1]!, index)) break;
    count += 1;
  }
  return count;
}

function averagePriorVolume(bars: PriceBar[], index: number): number {
  const start = Math.max(0, index - 20);
  const prior = bars.slice(start, index);
  return prior.reduce((total, bar) => total + bar.volume, 0) / Math.max(prior.length, 1);
}

function round(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 10_000) / 10_000 : 0;
}
