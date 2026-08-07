import type { Instrument } from "../market/types";
import type {
  HoldingDiagnosisSourceAdapter,
  HoldingDiagnosisSourceRecord,
} from "./holding-diagnosis-service";

type DiagnosisInstrument = Pick<
  Instrument,
  "id" | "code" | "exchange" | "name" | "assetType"
>;

function record(
  sourceId: string,
  sourceName: string,
  type: HoldingDiagnosisSourceRecord["type"],
  title: string,
  url: string,
  summary: string,
  highlights: string[],
): HoldingDiagnosisSourceRecord {
  return {
    sourceId,
    sourceName,
    type,
    title,
    url,
    availability: "link_only",
    summary,
    highlights,
  };
}

function xueqiuSymbol(instrument: DiagnosisInstrument): string {
  return `${instrument.exchange === "sh" ? "SH" : "SZ"}${instrument.code}`;
}

const readableSourceHosts = new Set([
  "cninfo.com.cn",
  "eastmoney.com",
  "sse.com.cn",
  "xueqiu.com",
]);

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
      "user-agent": "IronMan/0.1 source-summary",
    },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`来源返回 HTTP ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 200_000) {
    throw new Error("来源响应超过 200 KB 限制");
  }
  const text = await readSourceText(response, 200_000);
  const description = htmlMetaContent(text, "description") ?? htmlMetaContent(text, "og:description");
  const title = htmlTitle(text) ?? source.title;
  const summary = (description ?? title).trim().slice(0, 600);
  if (!summary) throw new Error("来源没有可用摘要");
  return {
    title,
    availability: "available",
    summary: `${source.sourceName} 页面摘要：${summary}`.slice(0, 600),
    highlights: ["状态：已读取公开页面短摘要", "正文未保存，完整内容请通过来源链接核验"],
    transientText: summary.slice(0, 1_200),
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

export const holdingDiagnosisSources: HoldingDiagnosisSourceAdapter[] = [
  {
    id: "cninfo",
    label: "巨潮资讯",
    description: "A 股上市公司公告与披露入口。",
    fallbackUrl: "https://www.cninfo.com.cn/",
    async collect(instrument) {
      if (instrument.assetType !== "stock") return [];
      return [record(
        "cninfo",
        "巨潮资讯",
        "disclosure",
        `${instrument.name} 公告检索入口`,
        `https://www.cninfo.com.cn/new/commonUrl?url=disclosure/list/notice&code=${encodeURIComponent(instrument.code)}`,
        `${instrument.name} 的巨潮资讯披露检索入口。该来源用于核验公告线索，本次未读取或保存公告正文。`,
        ["适用内容：定期报告、临时公告", "状态：仅提供检索入口，需跳转核验"],
      )];
    },
  },
  {
    id: "sse",
    label: "上交所公告",
    description: "上交所上市公司公告入口，仅适用于沪市股票。",
    fallbackUrl: "https://www.sse.com.cn/",
    async collect(instrument) {
      if (instrument.assetType !== "stock" || instrument.exchange !== "sh") return [];
      return [record(
        "sse",
        "上海证券交易所",
        "disclosure",
        `${instrument.name} 上交所公告入口`,
        `https://www.sse.com.cn/assortment/stock/list/info/announcement/index.shtml?productId=${encodeURIComponent(instrument.code)}`,
        `${instrument.name} 的上交所公告检索入口。该来源用于核验沪市披露线索，本次未读取或保存公告正文。`,
        ["适用内容：沪市公司公告", "状态：仅提供检索入口，需跳转核验"],
      )];
    },
  },
  {
    id: "eastmoney",
    label: "东方财富资讯",
    description: "公开财经资讯与标的新闻检索入口，仅作为待核验线索。",
    fallbackUrl: "https://www.eastmoney.com/",
    async collect(instrument) {
      return [record(
        "eastmoney",
        "东方财富",
        "news",
        `${instrument.name} 东方财富资讯检索`,
        `https://so.eastmoney.com/news/s?keyword=${encodeURIComponent(instrument.code)}`,
        `${instrument.name} 的东方财富公开资讯检索入口。资讯标题和正文需在来源页进一步核验，本次未抓取正文。`,
        ["适用内容：公开财经资讯", "状态：仅提供检索入口，需跳转核验"],
      )];
    },
  },
  {
    id: "xueqiu",
    label: "雪球行情",
    description: "公开行情讨论入口，仅作为待核验线索。",
    fallbackUrl: "https://xueqiu.com/",
    async collect(instrument) {
      return [record(
        "xueqiu",
        "雪球",
        "reference",
        `${instrument.name} 雪球行情入口`,
        `https://xueqiu.com/S/${xueqiuSymbol(instrument)}`,
        `${instrument.name} 的雪球行情讨论入口。公开讨论仅作为待核验线索，本次未读取或保存讨论内容。`,
        ["适用内容：行情讨论线索", "状态：仅提供检索入口，需跳转核验"],
      )];
    },
  },
];
