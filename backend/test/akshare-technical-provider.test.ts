import { describe, expect, test } from "bun:test";
import { AkShareTechnicalProvider } from "../src/market/akshare-technical-provider";

describe("AkShareTechnicalProvider", () => {
  test("posts a typed ranking request and validates the normalized result", async () => {
    let request: { url?: string; body?: unknown } = {};
    const provider = new AkShareTechnicalProvider({
      baseUrl: "http://provider.test",
      fetcher: async (url, init) => {
        request = { url: String(url), body: JSON.parse(String(init?.body)) };
        return new Response(JSON.stringify({ source: "akshare", columns: ["代码", "名称", "连涨天数"], rows: [{ "代码": "600000", "名称": "浦发银行", "连涨天数": 4 }] }), { status: 200 });
      }
    });

    await expect(provider.technical({ kind: "uptrend", days: 3 })).resolves.toEqual({
      columns: ["代码", "名称", "连涨天数"],
      rows: [{ "代码": "600000", "名称": "浦发银行", "连涨天数": 4 }]
    });
    expect(request).toEqual({ url: "http://provider.test/v1/technical/ranking", body: { kind: "uptrend", days: 3 } });
  });
});
