import { describe, expect, test } from "bun:test";
import { readHoldingDiagnosisSource } from "../src/services/holding-diagnosis-sources";
import type { HoldingDiagnosisSourceRecord } from "../src/services/holding-diagnosis-service";
import { gbkBytes } from "./helpers/gbk-fixture";

const source: HoldingDiagnosisSourceRecord = {
  sourceId: "cninfo",
  sourceName: "巨潮资讯",
  type: "disclosure",
  title: "浦发银行公告",
  url: "https://www.cninfo.com.cn/new/disclosure/stock?stockCode=600000"
};

describe("holding diagnosis source reading", () => {
  test("decodes GBK source pages so titles and summaries stay readable", async () => {
    const html = '<html><head><meta name="description" content="浦发银行2026年第三季度报告" /><title>浦发银行公告-巨潮资讯</title></head><body></body></html>';

    const record = await readHoldingDiagnosisSource(source, {
      fetcher: async () =>
        new Response(gbkBytes(html), { status: 200, headers: { "content-type": "text/html; charset=gbk" } })
    });

    expect(record.title).toBe("浦发银行公告-巨潮资讯");
    expect(record.summary).toBe("浦发银行2026年第三季度报告");
    expect(record.availability).toBe("available");
  });

  test("still rejects hosts outside the allowlist", async () => {
    await expect(readHoldingDiagnosisSource({ ...source, url: "https://example.com/report" })).rejects.toThrow("白名单");
  });
});
