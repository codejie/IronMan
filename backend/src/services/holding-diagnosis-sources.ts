import { createHash } from "node:crypto";
import type { Instrument } from "../market/types";
import type {
  HoldingDiagnosisSourceAdapter,
  HoldingDiagnosisSourceRecord,
} from "./holding-diagnosis-service";

type DiagnosisInstrument = Pick<
  Instrument,
  "id" | "code" | "exchange" | "name" | "assetType"
>;

export interface HoldingDiagnosisSourceOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

interface NewsDocument {
  externalId?: unknown;
  title?: unknown;
  content?: unknown;
  publishedAt?: unknown;
  sourceName?: unknown;
  url?: unknown;
  contentHash?: unknown;
}

interface DisclosureDocument extends NewsDocument {
  contentHash?: unknown;
  availability?: unknown;
  error?: unknown;
}

function contentText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function stringValue(value: unknown, fallback: string): string {
  const text = contentText(value);
  return text || fallback;
}

function sourceExcerpt(content: string): string {
  return content.slice(0, 220).trim() + (content.length > 220 ? "……" : "");
}

function sourceUrl(value: unknown, fallback: string): string {
  const candidate = contentText(value);
  if (!candidate) return fallback;
  try {
    const parsed = new URL(candidate);
    const allowed = ["cninfo.com.cn", "eastmoney.com"];
    if (!["http:", "https:"].includes(parsed.protocol) || !allowed.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) {
      return fallback;
    }
    parsed.protocol = "https:";
    return parsed.toString();
  } catch {
    return fallback;
  }
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function baseUrl(value: string | undefined): string {
  const candidate = (value ?? "http://127.0.0.1:6102").trim().replace(/\/$/, "");
  if (!/^https?:\/\//i.test(candidate)) throw new Error("AKShareProvider 地址无效");
  return candidate;
}

async function postProvider(
  path: string,
  body: Record<string, unknown>,
  options: Required<Pick<HoldingDiagnosisSourceOptions, "baseUrl" | "timeoutMs" | "fetcher">>,
): Promise<Record<string, unknown>> {
  const response = await options.fetcher(`${options.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) throw new Error(`资料服务返回 HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("资料服务返回格式无效");
  }
  return payload as Record<string, unknown>;
}

function documents(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(payload.items)
    ? payload.items.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item))
    : [];
}

function newsRecord(instrument: DiagnosisInstrument, item: NewsDocument): HoldingDiagnosisSourceRecord | null {
  const title = stringValue(item.title, `${instrument.name} 财经新闻`);
  const content = contentText(item.content);
  const externalId = stringValue(item.externalId, `${instrument.code}:${title}`);
  const fallbackUrl = `https://so.eastmoney.com/news/s?keyword=${encodeURIComponent(instrument.code)}`;
  if (!content) return null;
  return {
    sourceId: `akshare_news_em:${externalId}`,
    sourceName: stringValue(item.sourceName, "东方财富新闻"),
    type: "news",
    title,
    publishedAt: typeof item.publishedAt === "string" ? item.publishedAt : null,
    url: sourceUrl(item.url, fallbackUrl),
    availability: "available",
    summary: sourceExcerpt(content),
    highlights: ["正文已采集，摘要由当前标的 AI 诊断提炼", `正文长度：${content.length} 字`],
    transientText: content.slice(0, 30_000),
    externalId,
    origin: "aggregated",
    contentHash: typeof item.contentHash === "string" ? item.contentHash : hashText(content),
    summaryKind: "local_excerpt",
  };
}

function disclosureRecord(instrument: DiagnosisInstrument, item: DisclosureDocument): HoldingDiagnosisSourceRecord | null {
  const title = stringValue(item.title, `${instrument.name} 最新公告`);
  const externalId = stringValue(item.externalId, `${instrument.code}:${title}`);
  const fallbackUrl = `https://www.cninfo.com.cn/new/commonUrl?url=disclosure/list/notice&code=${encodeURIComponent(instrument.code)}`;
  const content = contentText(item.content);
  const available = item.availability === "available" && content.length > 0;
  const error = contentText(item.error);
  return {
    sourceId: `cninfo_disclosure:${externalId}`,
    sourceName: stringValue(item.sourceName, "巨潮资讯"),
    type: "disclosure",
    title,
    publishedAt: typeof item.publishedAt === "string" ? item.publishedAt : null,
    url: sourceUrl(item.url, fallbackUrl),
    availability: available ? "available" : "failed",
    summary: available ? sourceExcerpt(content) : `公告正文暂不可用${error ? `：${error}` : ""}`.slice(0, 600),
    highlights: available
      ? ["公告正文已采集，摘要由当前标的 AI 诊断提炼", `正文长度：${content.length} 字`]
      : ["公告标题和链接已取得，但正文未能解析", error || "请通过原始链接核验"],
    transientText: available ? content.slice(0, 30_000) : undefined,
    externalId,
    origin: "official",
    contentHash: typeof item.contentHash === "string" ? item.contentHash : available ? hashText(content) : undefined,
    summaryKind: available ? "local_excerpt" : "metadata_only",
  };
}

function metadataFallback(
  sourceId: string,
  sourceName: string,
  type: HoldingDiagnosisSourceRecord["type"],
  instrument: DiagnosisInstrument,
  url: string,
  title: string,
): HoldingDiagnosisSourceRecord {
  return {
    sourceId,
    sourceName,
    type,
    title,
    url,
    availability: "link_only",
    summary: `${instrument.name} 本次未取得该资料源正文，当前仅保留可核验入口。`,
    highlights: ["正文采集服务暂不可用", "不将页面元信息作为事实摘要"],
    origin: type === "disclosure" ? "official" : "aggregated",
    summaryKind: "metadata_only",
  };
}

export function createHoldingDiagnosisSources(options: HoldingDiagnosisSourceOptions = {}): HoldingDiagnosisSourceAdapter[] {
  const provider = {
    baseUrl: baseUrl(options.baseUrl),
    timeoutMs: options.timeoutMs ?? 12_000,
    fetcher: options.fetcher ?? fetch,
  };
  const cninfo: HoldingDiagnosisSourceAdapter = {
    id: "cninfo",
    label: "巨潮资讯公告正文",
    description: "A 股上市公司公告正文与附件，优先作为官方事实来源。",
    fallbackUrl: "https://www.cninfo.com.cn/",
    async collect(instrument) {
      if (instrument.assetType !== "stock") return [];
      try {
        const payload = await postProvider("/v1/disclosures/cninfo", {
          code: instrument.code,
          exchange: instrument.exchange,
          limit: 5,
        }, provider);
        return documents(payload)
          .map((item) => disclosureRecord(instrument, item as DisclosureDocument))
          .filter((item): item is HoldingDiagnosisSourceRecord => item !== null);
      } catch {
        return [metadataFallback(
          "cninfo",
          "巨潮资讯",
          "disclosure",
          instrument,
          `https://www.cninfo.com.cn/new/commonUrl?url=disclosure/list/notice&code=${encodeURIComponent(instrument.code)}`,
          `${instrument.name} 公告检索入口`,
        )];
      }
    },
  };
  const news: HoldingDiagnosisSourceAdapter = {
    id: "akshare_news_em",
    label: "AKShare 个股新闻",
    description: "本地 AKShare 服务提供的个股新闻正文，作为官方公告之外的补充证据。",
    fallbackUrl: "https://akshare.akfamily.xyz/",
    async collect(instrument) {
      if (instrument.assetType !== "stock") return [];
      try {
        const payload = await postProvider("/v1/news/stock", {
          code: instrument.code,
          limit: 5,
        }, provider);
        return documents(payload)
          .map((item) => newsRecord(instrument, item as NewsDocument))
          .filter((item): item is HoldingDiagnosisSourceRecord => item !== null);
      } catch {
        return [metadataFallback(
          "akshare_news_em",
          "AKShare 个股新闻",
          "news",
          instrument,
          `https://so.eastmoney.com/news/s?keyword=${encodeURIComponent(instrument.code)}`,
          `${instrument.name} 财经新闻检索入口`,
        )];
      }
    },
  };
  return [cninfo, news];
}

export const holdingDiagnosisSources = createHoldingDiagnosisSources();

const readableSourceHosts = new Set(["cninfo.com.cn", "eastmoney.com"]);

export async function readHoldingDiagnosisSource(
  source: HoldingDiagnosisSourceRecord,
): Promise<Partial<HoldingDiagnosisSourceRecord>> {
  const url = new URL(source.url);
  if (![...readableSourceHosts].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new Error("来源域名不在允许读取的白名单中");
  }
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/json",
      "user-agent": "IronMan/0.1 source-metadata",
    },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`来源返回 HTTP ${response.status}`);
  const text = await readSourceText(response, 200_000);
  const description = htmlMetaContent(text, "description") ?? htmlMetaContent(text, "og:description");
  const title = htmlTitle(text) ?? source.title;
  const summary = (description ?? title).trim().slice(0, 600);
  if (!summary) throw new Error("来源没有可用元信息");
  return {
    title,
    availability: "available",
    summary,
    highlights: ["状态：已读取公开页面短摘要", "未取得正文，不将元信息作为事实摘要"],
    summaryKind: "metadata_only",
  };
}

async function readSourceText(response: Response, limit: number): Promise<string> {
  if (response.body === null) return response.text();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > limit) throw new Error("来源响应超过 200 KB 限制");
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function htmlMetaContent(html: string, name: string): string | null {
  const escaped = name.replace(":", "\\:");
  const match = new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i").exec(html.slice(0, 120_000));
  return match?.[1] === undefined ? null : decodeHtml(match[1]);
}

function htmlTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html.slice(0, 120_000));
  return match?.[1] === undefined ? null : decodeHtml(match[1].replace(/<[^>]+>/g, "").trim());
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
