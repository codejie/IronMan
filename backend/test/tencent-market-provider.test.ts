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

  test("accepts the JSON payload even when Tencent serves it with a text/html content type", async () => {
    const requestedUrls: string[] = [];
    const provider = new TencentMarketProvider({
      fetcher: async (input: RequestInfo | URL) => {
        requestedUrls.push(String(input));
        return new Response(
          JSON.stringify({ code: 0, data: { sh600000: { qfqday: SAMPLERows } } }),
          { status: 200, headers: { "content-type": "text/html; charset=UTF-8" } },
        );
      },
    });

    const bars = await provider.history(instrument(), "day", 2);

    expect(requestedUrls).toHaveLength(1);
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

  test("fetches the current day's minute line from minute/query", async () => {
    const requestedUrls: string[] = [];
    const provider = new TencentMarketProvider({
      fetcher: async (input) => {
        requestedUrls.push(String(input));
        return Response.json({
          code: 0,
          data: {
            sh600000: {
              data: {
                data: ["0930 9.66 1037 1001742.00", "0931 9.67 2211 1024330.00"],
              },
            },
          },
        });
      },
    });

    const result = await provider.intradayMinute(instrument());

    expect(requestedUrls[0]).toContain("https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=sh600000");
    expect(result.points).toHaveLength(2);
    expect(result.points[0]).toEqual({ time: "09:30", price: 9.66, volume: 1037, cumulativeAmount: 1001742 });
    expect(result.points[1]?.time).toBe("09:31");
  });

  test("falls back to the backup domain when the primary minute query is WAF-blocked", async () => {
    const requestedUrls: string[] = [];
    const provider = new TencentMarketProvider({
      fetcher: async (input) => {
        requestedUrls.push(String(input));
        return requestedUrls.length === 1 ? wafResponse() : Response.json({
          code: 0,
          data: { sh600000: { data: { data: ["0930 9.66 1037 1001742.00"] } } },
        });
      },
    });

    const result = await provider.intradayMinute(instrument());

    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls[1]).toContain("https://proxy.finance.qq.com/ifzqgtimg/appstock/app/minute/query?code=sh600000");
    expect(result.points).toHaveLength(1);
  });

  test("reads a past trading day from day/query when a date is requested", async () => {
    const requestedUrls: string[] = [];
    const provider = new TencentMarketProvider({
      fetcher: async (input) => {
        requestedUrls.push(String(input));
        return Response.json({
          code: 0,
          data: {
            sh600000: {
              data: [
                { date: "20261016", data: ["0930 9.60 2070 1987200.20"], prec: ["9.60"] },
                { date: "20261021", data: ["0930 9.72 2681 2605932.00", "0931 9.73 1100 11000.00"], prec: ["9.72"] },
                { date: "20261022", data: ["0930 9.66 1037 1001742.00"], prec: ["9.66"] },
              ],
            },
          },
        });
      },
    });

    const result = await provider.intradayMinute(instrument(), "2026-10-21");

    expect(requestedUrls[0]).toContain("https://web.ifzq.gtimg.cn/appstock/app/day/query?code=sh600000");
    expect(result.date).toBe("2026-10-21");
    expect(result.points).toHaveLength(2);
    expect(result.points[0]).toEqual({ time: "09:30", price: 9.72, volume: 2681, cumulativeAmount: 2605932 });
  });

  test("rejects a requested trading day that the upstream does not cover", async () => {
    const provider = new TencentMarketProvider({
      fetcher: async () =>
        Response.json({
          code: 0,
          data: { sh600000: { data: [{ date: "20261022", data: ["0930 9.66 1037 1001742.00"], prec: ["9.66"] }] } },
        }),
    });

    let caught: unknown;
    try {
      await provider.intradayMinute(instrument(), "2026-10-15");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
  });
});
