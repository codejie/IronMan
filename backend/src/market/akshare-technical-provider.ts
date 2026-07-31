import { resolveAkshareProviderUrl } from "../config";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type AkShareTechnicalKind = "new_high" | "uptrend" | "high_volume" | "rise_volume_price" | "limit_up_pool";
export type AkShareTechnicalValue = string | number | null;

export interface AkShareTechnicalRequest {
  kind: AkShareTechnicalKind;
  category?: number;
  days?: number;
  date?: string;
}

export interface AkShareTechnicalTable {
  columns: string[];
  rows: Array<Record<string, AkShareTechnicalValue>>;
}

export interface TechnicalRankingProvider {
  technical(query: AkShareTechnicalRequest): Promise<AkShareTechnicalTable>;
}

interface ProviderPayload {
  source?: unknown;
  columns?: unknown;
  rows?: unknown;
}

export interface AkShareTechnicalProviderOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetcher?: Fetcher;
}

export class AkShareTechnicalProvider implements TechnicalRankingProvider {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly request: Fetcher;

  constructor(options: AkShareTechnicalProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? resolveAkshareProviderUrl()).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? Number(process.env.AKSHARE_PROVIDER_TIMEOUT_MS ?? 8_000);
    this.request = options.fetcher ?? fetch;
  }

  async technical(query: AkShareTechnicalRequest): Promise<AkShareTechnicalTable> {
    let response: Response;
    try {
      response = await this.request(`${this.baseUrl}/v1/technical/ranking`, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "IronMan/0.1 technical-data" },
        body: JSON.stringify(query),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch {
      throw new Error("AKShare 技术数据服务暂不可用");
    }
    if (!response.ok) throw new Error("AKShare 技术数据服务暂不可用");

    let payload: ProviderPayload;
    try {
      payload = (await response.json()) as ProviderPayload;
    } catch {
      throw new Error("AKShare 技术数据服务返回了无效响应");
    }
    const columns = Array.isArray(payload.columns) && payload.columns.every((column) => typeof column === "string") ? payload.columns : [];
    const rows = Array.isArray(payload.rows) ? payload.rows.map(normalizeRow).filter((row): row is Record<string, AkShareTechnicalValue> => row !== null) : [];
    if (payload.source !== "akshare" || columns.length === 0) throw new Error("AKShare 未返回可用的技术数据");
    return { columns, rows };
  }
}

function normalizeRow(value: unknown): Record<string, AkShareTechnicalValue> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row: Record<string, AkShareTechnicalValue> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue === "string" || rawValue === null) row[key] = rawValue;
    else if (typeof rawValue === "number" && Number.isFinite(rawValue)) row[key] = rawValue;
    else return null;
  }
  return row;
}
