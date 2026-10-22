import { describe, expect, test } from "bun:test";
import { TencentMarketProvider } from "../src/market/tencent-provider";
import type { Instrument } from "../src/market/types";

function instrument(): Instrument {
  return {
    id: "instrument-id",
    code: "600000",
    exchange: "sh",
    name: "浦发银行",
    assetType: "stock",
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z",
  };
}

const SAMPLERows = [
  ["2026-10-21", "9.72", "9.66", "9.76", "9.61", "462562", "44708.58", "1.54"],
  ["2026-10-22", "9.66", "9.67", "9.69", "9.55", "187058", "17947.97", "1.45"],
];

function payloadResponse(): Response {
  return Response.json({
    code: 0,
    data: { sh600000: { qfqday: SAMPLERows } },
  });
}

function wafResponse(): Response {
  return new Response(
    '<!DOCTYPE html><html><head><script>var i=location.href;window.location.href="https://waf.tencent.com/501page.html"</script></head></html>',
    { status: 501 },
  );
}

describe("Tencent market provider", () => {
  test("keeps using the primary domain when it responds correctly", async () => {
    const requestedUrls: string[] = [];
    const provider = new TencentMarketProvider({
      fetcher: async (input) => {
        requestedUrls.push(String(input));
        return payloadResponse();
      },
    });

    const bars = await provider.history(instrument(), "day", 2);

    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get");
    expect(bars.map((bar) => bar.close)).toEqual([9.66, 9.67]);
  });

  test("retries the backup domain when the primary domain is walled off", async () => {
    const requestedUrls: string[] = [];
    const provider = new TencentMarketProvider({
      fetcher: async (input: RequestInfo | URL) => {
        requestedUrls.push(String(input));
        return requestedUrls.length === 1 ? wafResponse() : payloadResponse();
      },
    });

    const bars = await provider.history(instrument(), "day", 2);

    expect(requestedUrls).toEqual([
      expect.stringContaining("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"),
      expect.stringContaining("https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get"),
    ]);
    expect(bars.map((bar) => bar.close)).toEqual([9.66, 9.67]);
  });

  test("retries the backup domain when the primary returns a non-JSON WAF page", async () => {
    const requestedUrls: string[] = [];
    const provider = new TencentMarketProvider({
      fetcher: async (input: RequestInfo | URL) => {
        requestedUrls.push(String(input));
        return requestedUrls.length === 1
          ? new Response("<!DOCTYPE html><html>blocked</html>", { status: 200 })
          : payloadResponse();
      },
    });

    const bars = await provider.history(instrument(), "day", 2);

    expect(requestedUrls).toHaveLength(2);
    expect(bars).toHaveLength(2);
  });

  test("retries the backup domain when the primary request itself fails", async () => {
    const requestedUrls: string[] = [];
    const provider = new TencentMarketProvider({
      fetcher: async (input: RequestInfo | URL) => {
        requestedUrls.push(String(input));
        if (requestedUrls.length === 1) throw new Error("network unreachable");
        return payloadResponse();
      },
    });

    const bars = await provider.history(instrument(), "day", 2);

    expect(requestedUrls).toHaveLength(2);
    expect(bars.map((bar) => bar.date)).toEqual(["2026-10-21", "2026-10-22"]);
  });

  test("throws when both domains fail", async () => {
    const provider = new TencentMarketProvider({
      fetcher: async () => wafResponse(),
    });

    let caught: unknown;
    try {
      await provider.history(instrument(), "day", 2);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
  });
});
