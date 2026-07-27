import { errors } from "../errors";
import type { AssetType, Instrument, InstrumentCatalogEntry, InstrumentCatalogProvider, MarketDataProvider, PriceBar, Timeframe } from "./types";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface HistoryPayload {
  source?: unknown;
  bars?: unknown;
}

interface InstrumentSearchPayload {
  source?: unknown;
  items?: unknown;
}

export interface AkShareMarketProviderOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetcher?: Fetcher;
}

export class AkShareMarketProvider implements MarketDataProvider, InstrumentCatalogProvider {
  readonly source = "akshare" as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly request: Fetcher;

  constructor(options: AkShareMarketProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.AKSHARE_PROVIDER_URL ?? "http://127.0.0.1:8001").replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? Number(process.env.AKSHARE_PROVIDER_TIMEOUT_MS ?? 8_000);
    this.request = options.fetcher ?? fetch;
  }

  async history(instrument: Instrument, timeframe: Timeframe, limit: number, endDate?: string): Promise<PriceBar[]> {
    let response: Response;
    try {
      response = await this.request(`${this.baseUrl}/v1/market/history`, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "IronMan/0.1 market-data" },
        body: JSON.stringify({
          assetType: instrument.assetType,
          exchange: instrument.exchange,
          code: instrument.code,
          timeframe,
          limit,
          endDate: endDate ?? null,
          adjust: "qfq"
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch {
      throw errors.external("AKShare 行情服务暂不可用");
    }
    if (!response.ok) throw errors.external("AKShare 行情服务暂不可用");

    let payload: HistoryPayload;
    try {
      payload = (await response.json()) as HistoryPayload;
    } catch {
      throw errors.external("AKShare 行情服务返回了无效响应");
    }
    const bars = Array.isArray(payload.bars) ? payload.bars.map(toPriceBar).filter((bar): bar is PriceBar => bar !== null) : [];
    if (payload.source !== "akshare" || bars.length === 0) throw errors.external("AKShare 未返回可用的历史行情");
    return bars;
  }

  async searchInstruments(assetType: AssetType, query: string, limit = 50): Promise<InstrumentCatalogEntry[]> {
    let response: Response;
    try {
      response = await this.request(`${this.baseUrl}/v1/market/instruments/search`, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "IronMan/0.1 market-data" },
        body: JSON.stringify({ assetType, query, limit }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch {
      throw errors.external("AKShare 标的目录服务暂不可用");
    }
    if (!response.ok) throw errors.external("AKShare 标的目录服务暂不可用");

    let payload: InstrumentSearchPayload;
    try {
      payload = (await response.json()) as InstrumentSearchPayload;
    } catch {
      throw errors.external("AKShare 标的目录服务返回了无效响应");
    }
    if (payload.source !== "akshare" || !Array.isArray(payload.items)) {
      throw errors.external("AKShare 未返回可用的标的目录");
    }
    return payload.items.map(toCatalogEntry).filter((item): item is InstrumentCatalogEntry => item !== null);
  }
}

function toPriceBar(value: unknown): PriceBar | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  const date = typeof item.date === "string" ? item.date : "";
  const open = numberValue(item.open);
  const close = numberValue(item.close);
  const high = numberValue(item.high);
  const low = numberValue(item.low);
  const volume = numberValue(item.volume);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || [open, close, high, low, volume].some((item) => item === null)) return null;
  return { date, open: open!, close: close!, high: high!, low: low!, volume: volume! };
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toCatalogEntry(value: unknown): InstrumentCatalogEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  const code = typeof item.code === "string" ? item.code.trim() : "";
  const exchange = item.exchange;
  const name = typeof item.name === "string" ? item.name.trim() : "";
  const assetType = item.assetType;
  if (
    !code ||
    !name ||
    (exchange !== "sh" && exchange !== "sz" && exchange !== "bj" && exchange !== "fund") ||
    (assetType !== "stock" && assetType !== "index" && assetType !== "fund")
  ) {
    return null;
  }
  return { code, exchange, name, assetType };
}
