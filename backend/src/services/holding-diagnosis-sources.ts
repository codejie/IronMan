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
