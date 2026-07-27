import { describe, expect, test } from "bun:test";
import { AkShareMarketProvider } from "../src/market/akshare-provider";
import type { Instrument } from "../src/market/types";

function instrument(input: Pick<Instrument, "code" | "exchange" | "assetType">): Instrument {
  return {
    id: "instrument-id",
    name: "测试标的",
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z",
    ...input
  };
}

describe("AKShare market provider", () => {
  test("posts a type-scoped catalog search and normalizes matching instruments", async () => {
    let requestedUrl = "";
    let requestedBody: unknown;
    const provider = new AkShareMarketProvider({
      baseUrl: "http://127.0.0.1:18001",
      fetcher: async (input, init) => {
        requestedUrl = String(input);
        requestedBody = JSON.parse(String(init?.body));
        return Response.json({
          source: "akshare",
          items: [{ assetType: "index", code: "000001", exchange: "sh", name: "上证指数" }]
        });
      }
    });

    const items = await provider.searchInstruments("index", "000001");

    expect(requestedUrl).toBe("http://127.0.0.1:18001/v1/market/instruments/search");
    expect(requestedBody).toEqual({ assetType: "index", query: "000001", limit: 50 });
    expect(items).toEqual([{ assetType: "index", code: "000001", exchange: "sh", name: "上证指数" }]);
  });

  test("posts a normalized ETF history request and returns valid bars", async () => {
    let requestedUrl = "";
    let requestedBody: unknown;
    const provider = new AkShareMarketProvider({
      baseUrl: "http://127.0.0.1:18001",
      fetcher: async (input, init) => {
        requestedUrl = String(input);
        requestedBody = JSON.parse(String(init?.body));
        return Response.json({
          source: "akshare",
          bars: [{ date: "2026-07-23", open: 1.02, close: 1.05, high: 1.06, low: 1.01, volume: 120000 }]
        });
      }
    });

    const bars = await provider.history(instrument({ code: "563230", exchange: "fund", assetType: "fund" }), "day", 180, "2026-07-24");

    expect(requestedUrl).toBe("http://127.0.0.1:18001/v1/market/history");
    expect(requestedBody).toEqual({
      assetType: "fund",
      exchange: "fund",
      code: "563230",
      timeframe: "day",
      limit: 180,
      endDate: "2026-07-24",
      adjust: "qfq"
    });
    expect(bars).toEqual([{ date: "2026-07-23", open: 1.02, close: 1.05, high: 1.06, low: 1.01, volume: 120000 }]);
  });

  test("rejects unavailable and malformed provider responses", async () => {
    const unavailable = new AkShareMarketProvider({
      baseUrl: "http://127.0.0.1:18001",
      fetcher: async () => new Response("temporary failure", { status: 503 })
    });
    const malformed = new AkShareMarketProvider({
      baseUrl: "http://127.0.0.1:18001",
      fetcher: async () => Response.json({ bars: [{ date: "2026-07-23", open: "bad" }] })
    });
    const target = instrument({ code: "000001", exchange: "sz", assetType: "stock" });

    await expect(unavailable.history(target, "day", 20)).rejects.toThrow("AKShare 行情服务暂不可用");
    await expect(malformed.history(target, "day", 20)).rejects.toThrow("AKShare 未返回可用的历史行情");
  });
});
