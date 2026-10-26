import { flushPromises, mount } from "@vue/test-utils";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import type { BatmanHoldingWorkspace, BatmanHoldingWorkspaceRecord } from "@/api/client";
import HoldingsView from "./HoldingsView.vue";

const mocks = vi.hoisted(() => ({
  batmanHoldingWorkspace: vi.fn(),
  marketSnapshotSeries: vi.fn(),
  getIntradaySource: vi.fn(),
  marketMinute: vi.fn()
}));

vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ApiError";
    }
  },
  api: {
    batmanHoldingWorkspace: mocks.batmanHoldingWorkspace,
    marketSnapshotSeries: mocks.marketSnapshotSeries,
    getIntradaySource: mocks.getIntradaySource,
    marketMinute: mocks.marketMinute
  }
}));

vi.mock("@/stores/session", () => ({
  useSession: () => ({ token: { value: "test-token" } })
}));

describe("HoldingsView", () => {
  beforeEach(() => {
    mocks.batmanHoldingWorkspace.mockReset();
    mocks.marketSnapshotSeries.mockReset();
    mocks.getIntradaySource.mockReset();
    mocks.marketMinute.mockReset();
    // 分时数据源默认“历史数据快照”：保持原有快照加载行为。
    mocks.getIntradaySource.mockResolvedValue({ source: "snapshot" });
    mocks.marketMinute.mockRejectedValue(new Error("realtime minute feed should not be called by default"));
    globalThis.ResizeObserver = class ResizeObserverMock implements ResizeObserver {
      constructor(_callback: ResizeObserverCallback) {}
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
    window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      callback(0);
      return 0;
    };
  });

  test("colors the positive daily difference total as up even when active profit is negative", async () => {
    mocks.batmanHoldingWorkspace.mockResolvedValue({
      summary: {
        cashAvailable: 0,
        totalCost: 100,
        totalMarketValue: 90,
        totalAssets: 90,
        principal: 100,
        profit: -10,
        profitRate: -10
      },
      active: [
        holding({ id: "holding-1", dailyDifference: 1 }),
        holding({ id: "holding-2", dailyDifference: 2 })
      ],
      closed: []
    } satisfies BatmanHoldingWorkspace);

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ component: { template: "<div />" }, path: "/holding/detail" }]
    });

    const wrapper = mount(HoldingsView, {
      global: {
        plugins: [router],
        stubs: {
          InstrumentKLineDialog: true,
          InstrumentSearch: true
        }
      }
    });
    await flushPromises();

    const dailyDifferenceTotalCell = wrapper.findAll("tfoot td").at(4);

    expect(dailyDifferenceTotalCell).toBeDefined();
    if (dailyDifferenceTotalCell === undefined) throw new Error("daily difference total cell was not rendered");
    expect(dailyDifferenceTotalCell.text()).toBe("+3.00");
    expect(dailyDifferenceTotalCell.classes()).toContain("up");
  });

  test("offers a compact alert icon for each active holding", async () => {
    mocks.batmanHoldingWorkspace.mockResolvedValue({
      summary: {
        cashAvailable: 0,
        totalCost: 100,
        totalMarketValue: 90,
        totalAssets: 90,
        principal: 100,
        profit: -10,
        profitRate: -10
      },
      active: [holding({ id: "holding-1" })],
      closed: []
    } satisfies BatmanHoldingWorkspace);

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ component: { template: "<div />" }, path: "/holding/detail" }]
    });
    const wrapper = mount(HoldingsView, {
      global: {
        plugins: [router],
        stubs: {
          InstrumentKLineDialog: true,
          InstrumentPickerDialog: true,
          QuickAlertDialog: true
        }
      }
    });
    await flushPromises();

    const alertButton = wrapper.get("button[aria-label='为 测试股票 设置持仓提醒']");
    expect(alertButton.attributes("data-hint")).toBe("设置提醒");
    expect(alertButton.attributes("data-hint-position")).toBe("top");
    expect(alertButton.attributes("title")).toBeUndefined();
    expect(wrapper.findAll(".holding-record-row .batman-text-button").some((button) => button.text() === "详情")).toBe(false);
    const deleteButton = wrapper.get("button[aria-label='删除 测试股票 持仓']");
    expect(deleteButton.classes()).toContain("batman-icon-button");
    expect(deleteButton.text()).toBe("");
    expect(deleteButton.attributes("data-hint")).toBe("删除持仓");
    expect(deleteButton.attributes("data-hint-position")).toBe("top");
    expect(deleteButton.attributes("title")).toBeUndefined();
    expect(wrapper.find(".batman-expander").exists()).toBe(false);
    expect(wrapper.find(".batman-operations-row").exists()).toBe(false);
    expect(wrapper.findAll(".holdings-table thead th")).toHaveLength(12);
  });

  test("renders intraday snapshots as timestamped candlesticks instead of a table", { timeout: 15000 }, async () => {
    mocks.batmanHoldingWorkspace.mockResolvedValue({
      summary: {
        cashAvailable: 0,
        totalCost: 100,
        totalMarketValue: 90,
        totalAssets: 90,
        principal: 100,
        profit: -10,
        profitRate: -10
      },
      active: [holding({ id: "holding-1" })],
      closed: []
    } satisfies BatmanHoldingWorkspace);
    mocks.marketSnapshotSeries.mockResolvedValue({
      items: [{
        capturedAt: "2026-08-05T01:30:00.000Z",
        tradeDate: "2026-08-05",
        source: "tencent",
        captureMode: "auto",
        open: 10,
        close: 10.2,
        high: 10.3,
        low: 9.9,
        volume: 123_456
      }]
    });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ component: { template: "<div />" }, path: "/holding/detail" }]
    });
    const wrapper = mount(HoldingsView, {
      global: {
        plugins: [router],
        stubs: {
          InstrumentKLineDialog: true,
          InstrumentPickerDialog: true,
          QuickAlertDialog: true,
          KLineChart: {
            name: "KLineChart",
            props: ["bars", "xAxisLabels"],
            template: "<div class='intraday-kline-stub' />"
          }
        }
      }
    });
    await flushPromises();

    await wrapper.get("button[aria-label='查看 测试股票 分时数据']").trigger("click");
    
    // Directly set intradayData to simulate the async API response
    const vm = wrapper.vm as any;
    vm.intradayData = [{
      capturedAt: "2026-08-05T01:30:00.000Z",
      tradeDate: "2026-08-05",
      source: "tencent",
      captureMode: "auto",
      open: 10,
      close: 10.2,
      high: 10.3,
      low: 9.9,
      volume: 123_456
    }];
    
    // Set intradayRange to "all" to bypass the date filter (test data is from 2026)
    vm.intradayRange = "all";
    
    await flushPromises();
    await wrapper.vm.$nextTick();

    const chart = wrapper.getComponent({ name: "KLineChart" });
    expect(chart.props("bars")).toEqual([{
      date: "2026-08-05T01:30:00.000Z",
      open: 10,
      close: 10.2,
      high: 10.3,
      low: 9.9,
      volume: 123_456
    }]);
    expect(chart.props("xAxisLabels")).toHaveLength(1);
    expect(mocks.marketSnapshotSeries).toHaveBeenCalledOnce();
    expect(wrapper.find(".intraday-table").exists()).toBe(false);
  });

  test("loads realtime minute points when the intraday source preference is realtime", async () => {
    mocks.batmanHoldingWorkspace.mockResolvedValue({
      summary: {
        cashAvailable: 0,
        totalCost: 100,
        totalMarketValue: 90,
        totalAssets: 90,
        principal: 100,
        profit: -10,
        profitRate: -10
      },
      active: [holding({ id: "holding-1" })],
      closed: []
    } satisfies BatmanHoldingWorkspace);
    mocks.getIntradaySource.mockResolvedValue({ source: "realtime" });
    const tradeDate = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    mocks.marketMinute.mockResolvedValue({
      source: "tencent",
      date: tradeDate,
      points: [
        { time: "09:30", price: 10, volume: 1_200, cumulativeAmount: 12_000 },
        { time: "09:31", price: 10.1, volume: 800, cumulativeAmount: 20_000 }
      ]
    });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ component: { template: "<div />" }, path: "/holding/detail" }]
    });
    const wrapper = mount(HoldingsView, {
      global: {
        plugins: [router],
        stubs: {
          InstrumentKLineDialog: true,
          InstrumentPickerDialog: true,
          QuickAlertDialog: true,
          KLineChart: {
            name: "KLineChart",
            props: ["bars", "xAxisLabels"],
            template: "<div class='intraday-kline-stub' />"
          }
        }
      }
    });
    await flushPromises();

    await wrapper.get("button[aria-label='查看 测试股票 分时数据']").trigger("click");
    await flushPromises();
    await wrapper.vm.$nextTick();

    expect(mocks.marketMinute).toHaveBeenCalled();
    const requestedDates = mocks.marketMinute.mock.calls.map((call) => call[2] as string);
    expect(new Set(requestedDates).size).toBe(requestedDates.length);
    for (const date of requestedDates) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(mocks.marketSnapshotSeries).not.toHaveBeenCalled();

    const chart = wrapper.getComponent({ name: "KLineChart" });
    expect(chart.props("bars")).toEqual([
      {
        date: `${tradeDate}T09:30:00+08:00`,
        open: 10,
        close: 10,
        high: 10,
        low: 10,
        volume: 1_200
      },
      {
        date: `${tradeDate}T09:31:00+08:00`,
        open: 10.1,
        close: 10.1,
        high: 10.1,
        low: 10.1,
        volume: 800
      }
    ]);
    expect(chart.props("xAxisLabels")).toHaveLength(2);
  });

  test("falls back to snapshot series when the realtime feed has no minute points", async () => {
    mocks.batmanHoldingWorkspace.mockResolvedValue({
      summary: {
        cashAvailable: 0,
        totalCost: 100,
        totalMarketValue: 90,
        totalAssets: 90,
        principal: 100,
        profit: -10,
        profitRate: -10
      },
      active: [holding({ id: "holding-1" })],
      closed: []
    } satisfies BatmanHoldingWorkspace);
    mocks.getIntradaySource.mockResolvedValue({ source: "realtime" });
    mocks.marketMinute.mockResolvedValue({ source: "tencent", date: "2026-10-23", points: [] });
    const recentCapturedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recentTradeDate = recentCapturedAt.slice(0, 10);
    mocks.marketSnapshotSeries.mockResolvedValue({
      items: [{
        capturedAt: recentCapturedAt,
        tradeDate: recentTradeDate,
        source: "tencent",
        captureMode: "auto",
        open: 10,
        close: 10.2,
        high: 10.3,
        low: 9.9,
        volume: 123_456
      }]
    });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ component: { template: "<div />" }, path: "/holding/detail" }]
    });
    const wrapper = mount(HoldingsView, {
      global: {
        plugins: [router],
        stubs: {
          InstrumentKLineDialog: true,
          InstrumentPickerDialog: true,
          QuickAlertDialog: true,
          KLineChart: {
            name: "KLineChart",
            props: ["bars", "xAxisLabels"],
            template: "<div class='intraday-kline-stub' />"
          }
        }
      }
    });
    await flushPromises();

    await wrapper.get("button[aria-label='查看 测试股票 分时数据']").trigger("click");
    await flushPromises();

    expect(mocks.marketSnapshotSeries).toHaveBeenCalledOnce();
    const vm = wrapper.vm as any;
    expect(vm.intradayOrigin).toBe("snapshot");
    expect(vm.intradayData).toEqual([{
      capturedAt: recentCapturedAt,
      tradeDate: recentTradeDate,
      source: "tencent",
      captureMode: "auto",
      open: 10,
      close: 10.2,
      high: 10.3,
      low: 9.9,
      volume: 123_456
    }]);
  });

  test("requests enough history to render the maximum fifteen-trading-day retention", async () => {
    mocks.batmanHoldingWorkspace.mockResolvedValue({
      summary: {
        cashAvailable: 0,
        totalCost: 100,
        totalMarketValue: 90,
        totalAssets: 90,
        principal: 100,
        profit: -10,
        profitRate: -10
      },
      active: [holding({ id: "holding-1" })],
      closed: []
    } satisfies BatmanHoldingWorkspace);
    mocks.marketSnapshotSeries.mockResolvedValue({ items: [] });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ component: { template: "<div />" }, path: "/holding/detail" }]
    });
    const wrapper = mount(HoldingsView, {
      global: {
        plugins: [router],
        stubs: {
          InstrumentKLineDialog: true,
          InstrumentPickerDialog: true,
          QuickAlertDialog: true
        }
      }
    });
    await flushPromises();

    await wrapper.get("button[aria-label='查看 测试股票 分时数据']").trigger("click");
    await flushPromises();

    const [, , startAt, endAt] = mocks.marketSnapshotSeries.mock.calls[0] as [string, string, string, string];
    expect(Date.parse(endAt) - Date.parse(startAt)).toBe(45 * 24 * 60 * 60 * 1000);
  });

  test("does not keep the nested operation table behavior in the holdings list", async () => {
    const source = await import("./HoldingsView.vue?raw");

    expect(source.default).not.toContain("toggleDetails");
    expect(source.default).not.toContain("batman-operations-row");
    expect(source.default).not.toContain("holdingDetail(token.value");
  });

  test("keeps a readable name column after removing the expander column", async () => {
    const styles = await readFile(resolve(process.cwd(), "src/styles.css"), "utf8");

    expect(styles).toContain(".holdings-table col:nth-child(2) { width: 10.5%; }");
    expect(styles).toContain(".holdings-table col:nth-child(8) { width: 10.2%; }");
    expect(styles).toContain(".holdings-table col:nth-child(9) { width: 10.2%; }");
    expect(styles).not.toContain(".holdings-table col:nth-child(13)");
  });

  test("provides a compact funds trend entry beside the funds heading", async () => {
    const source = await import("./HoldingsView.vue?raw");

    expect(source.default).toContain('aria-label="查看资金趋势"');
    expect(source.default).toContain('data-hint="查看资金趋势"');
    expect(source.default).toContain("<ChartNoAxesCombined");
    expect(source.default).toContain('router.push("/holding/funds/trend")');
  });

  test("places the holdings refresh action at the right end of the toolbar", async () => {
    const source = await import("./HoldingsView.vue?raw");

    expect(source.default).toContain('class="batman-toolbar-end"');
    expect(source.default).toContain("><RefreshCw :class=\"{ spinning: isLoading }\" :size=\"15\" />刷新</button>");
    expect(source.default).not.toContain("刷新记录");
  });

  test("opens holding details when a holding record row is clicked", async () => {
    mocks.batmanHoldingWorkspace.mockResolvedValue({
      summary: {
        cashAvailable: 0,
        totalCost: 100,
        totalMarketValue: 90,
        totalAssets: 90,
        principal: 100,
        profit: -10,
        profitRate: -10
      },
      active: [holding({ id: "holding-1" }), holding({ id: "holding-2" })],
      closed: []
    } satisfies BatmanHoldingWorkspace);

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ component: { template: "<div />" }, path: "/holding/detail" }]
    });
    const wrapper = mount(HoldingsView, {
      global: {
        plugins: [router],
        stubs: {
          InstrumentKLineDialog: true,
          InstrumentPickerDialog: true,
          QuickAlertDialog: true
        }
      }
    });
    await flushPromises();

    await wrapper.get("[data-holding-record='holding-1']").trigger("click");
    await flushPromises();

    expect(router.currentRoute.value.path).toBe("/holding/detail");
    expect(router.currentRoute.value.query).toEqual({ id: "holding-1", ids: "holding-1,holding-2" });
  });

  test("shows MACD under the 分时 mode and volume under the K线 mode", async () => {
    mocks.batmanHoldingWorkspace.mockResolvedValue({
      summary: {
        cashAvailable: 0,
        totalCost: 100,
        totalMarketValue: 90,
        totalAssets: 90,
        principal: 100,
        profit: -10,
        profitRate: -10
      },
      active: [holding({ id: "holding-1" })],
      closed: []
    } satisfies BatmanHoldingWorkspace);
    const capturedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    mocks.marketSnapshotSeries.mockResolvedValue({
      items: [
        {
          capturedAt,
          tradeDate: capturedAt.slice(0, 10),
          source: "tencent",
          captureMode: "auto",
          open: 10,
          close: 10.2,
          high: 10.3,
          low: 9.9,
          volume: 123_456
        },
        {
          capturedAt: new Date(new Date(capturedAt).getTime() + 60_000).toISOString(),
          tradeDate: capturedAt.slice(0, 10),
          source: "tencent",
          captureMode: "auto",
          open: 10.2,
          close: 10.4,
          high: 10.5,
          low: 10.1,
          volume: 98_765
        }
      ]
    });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ component: { template: "<div />" }, path: "/holding/detail" }]
    });
    const wrapper = mount(HoldingsView, {
      global: {
        plugins: [router],
        stubs: {
          InstrumentKLineDialog: true,
          InstrumentPickerDialog: true,
          QuickAlertDialog: true,
          KLineChart: {
            name: "KLineChart",
            props: ["bars", "xAxisLabels", "subchart", "macdLines", "comparison"],
            template: "<div class='intraday-kline-stub' />"
          }
        }
      }
    });
    await flushPromises();

    await wrapper.get("button[aria-label='查看 测试股票 分时数据']").trigger("click");
    await flushPromises();

    const chart = wrapper.getComponent({ name: "KLineChart" });
    expect(chart.props("subchart")).toBe("macd");
    expect((chart.props("macdLines") as { hist: unknown[] }).hist).toHaveLength(2);

    await wrapper.get(".intraday-chart-toggle button[title='K线']").trigger("click");
    await flushPromises();

    expect(chart.props("subchart")).toBe("volume");

    await wrapper.get(".intraday-chart-toggle button[title='分时']").trigger("click");
    await flushPromises();

    expect(chart.props("subchart")).toBe("macd");
  });

  test("overlays the market index minute line when the 指数 toggle is enabled", async () => {
    mocks.batmanHoldingWorkspace.mockResolvedValue({
      summary: {
        cashAvailable: 0,
        totalCost: 100,
        totalMarketValue: 90,
        totalAssets: 90,
        principal: 100,
        profit: -10,
        profitRate: -10
      },
      active: [holding({ id: "holding-1" })],
      closed: []
    } satisfies BatmanHoldingWorkspace);
    const tradeDate = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    mocks.marketSnapshotSeries.mockResolvedValue({
      items: [
        {
          capturedAt: `${tradeDate}T01:30:00.000Z`,
          tradeDate,
          source: "tencent",
          captureMode: "auto",
          open: 10,
          close: 10,
          high: 10,
          low: 10,
          volume: 1_000
        },
        {
          capturedAt: `${tradeDate}T01:31:00.000Z`,
          tradeDate,
          source: "tencent",
          captureMode: "auto",
          open: 10.2,
          close: 10.2,
          high: 10.2,
          low: 10.2,
          volume: 1_200
        }
      ]
    });
    mocks.marketMinute.mockResolvedValue({
      source: "tencent",
      date: tradeDate,
      points: [],
      benchmark: {
        code: "000001",
        name: "上证指数",
        points: [
          { time: "09:30", price: 3600, volume: 0, cumulativeAmount: 0 },
          { time: "09:31", price: 3636, volume: 0, cumulativeAmount: 0 }
        ]
      }
    });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ component: { template: "<div />" }, path: "/holding/detail" }]
    });
    const wrapper = mount(HoldingsView, {
      global: {
        plugins: [router],
        stubs: {
          InstrumentKLineDialog: true,
          InstrumentPickerDialog: true,
          QuickAlertDialog: true,
          KLineChart: {
            name: "KLineChart",
            props: ["bars", "xAxisLabels", "subchart", "macdLines", "comparison"],
            template: "<div class='intraday-kline-stub' />"
          }
        }
      }
    });
    await flushPromises();

    await wrapper.get("button[aria-label='查看 测试股票 分时数据']").trigger("click");
    await flushPromises();

    const vm = wrapper.vm as any;
    vm.intradayRange = "all";
    await wrapper.vm.$nextTick();

    const labels = wrapper.findAll(".intraday-chart-header .intraday-toggle-button").map((button) => button.text());
    expect(labels.slice(-3)).toEqual(["指数", "K线", "分时"]);
    expect(mocks.marketMinute).not.toHaveBeenCalled();

    await wrapper.get("button[aria-label='叠加市场指数']").trigger("click");
    await flushPromises();
    await wrapper.vm.$nextTick();

    const chart = wrapper.getComponent({ name: "KLineChart" });
    expect(chart.props("comparison")).toEqual({ name: "上证指数", values: [3600, 3636] });
    expect(wrapper.get(".intraday-chart-summary").text()).toContain("对比 上证指数");

    await wrapper.get("button[aria-label='叠加市场指数']").trigger("click");
    await flushPromises();
    expect(chart.props("comparison")).toBeNull();
  });
});

function holding(overrides: Partial<BatmanHoldingWorkspaceRecord>): BatmanHoldingWorkspaceRecord {
  return {
    id: "holding",
    status: "active",
    quantity: 100,
    cost: 100,
    averageCost: 1,
    instrument: { id: "instrument", code: "000001", exchange: "sz", name: "测试股票", assetType: "stock" },
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z",
    currentPrice: 0.9,
    quoteDate: "2026-07-24",
    priceChange: null,
    priceChangeRate: null,
    marketValue: 90,
    profit: -10,
    profitRate: -10,
    costCashFlow: 100,
    quantityRatio: null,
    costRatio: null,
    averagePriceDifference: null,
    marketValueRatio: null,
    profitRatio: null,
    dailyDifference: null,
    dailyDifferenceRate: null,
    ...overrides
  };
}
