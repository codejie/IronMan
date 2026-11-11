import { flushPromises, mount } from "@vue/test-utils";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import type { BatmanHoldingWorkspace, BatmanHoldingWorkspaceRecord, ProfitRuleCheck, ProfitRuleEvaluation } from "@/api/client";
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
    expect(wrapper.find("button[aria-label='删除 测试股票 持仓']").exists()).toBe(false);
    expect(wrapper.find(".holding-record-row .batman-icon-button.danger").exists()).toBe(false);
    expect(wrapper.find(".batman-expander").exists()).toBe(false);
    expect(wrapper.find(".batman-operations-row").exists()).toBe(false);
    expect(wrapper.findAll(".holdings-table thead th")).toHaveLength(12);
  });

  test("places the profit-rule action after intraday data and shows the triggered stop loss", async () => {
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
        holding({
          id: "holding-1",
          profitRule: profitRule({
            signal: "stop_loss",
            summary: "固定比例止损触发：现价 0.9 已跌破止损价 0.95，浮亏 -10.00 元。",
            stopLoss: ruleCheck({ status: "triggered", detail: "现价 0.9 已跌破止损价 0.95" })
          })
        })
      ],
      closed: []
    } satisfies BatmanHoldingWorkspace);

    const wrapper = await mountView();
    const controls = wrapper.get(".holding-record-row .batman-action-controls");
    const buttons = controls.findAll("button");
    expect(buttons.map((button) => button.attributes("aria-label"))).toEqual([
      "查看 测试股票 分时数据",
      "查看 测试股票 损盈规则",
      "为 测试股票 设置持仓提醒"
    ]);

    const ruleButton = buttons[1]!;
    expect(ruleButton.attributes("data-hint")).toBe("已触发止损");
    expect(ruleButton.attributes("data-hint-position")).toBe("top");
    expect(ruleButton.classes()).toContain("danger");

    await ruleButton.trigger("click");
    const dialog = wrapper.get(".profit-rule-dialog");
    expect(dialog.text()).toContain("损盈规则 · 测试股票");
    expect(dialog.text()).toContain("已触发止损");
    expect(dialog.text()).toContain("止损规则");
    expect(dialog.text()).toContain("止盈规则");
    expect(dialog.text()).toContain("固定比例止损");
    expect(dialog.text()).toContain("止损价");
    expect(dialog.text()).toContain("0.95");
    expect(dialog.text()).toContain("止损比例 5%");
    expect(dialog.text()).toContain("盈亏比止盈");
    expect(dialog.text()).toContain("1.15");
    expect(dialog.text()).toContain("规则来自「系统配置 › 损盈规则」");

    await wrapper.get("button[aria-label='关闭损盈规则对话框']").trigger("click");
    expect(wrapper.find(".profit-rule-dialog").exists()).toBe(false);
  });

  test("shows a take-profit signal with its own icon color", async () => {
    mocks.batmanHoldingWorkspace.mockResolvedValue({
      summary: {
        cashAvailable: 0,
        totalCost: 100,
        totalMarketValue: 120,
        totalAssets: 120,
        principal: 100,
        profit: 20,
        profitRate: 20
      },
      active: [
        holding({
          id: "holding-1",
          profitRule: profitRule({
            signal: "take_profit",
            takeProfit: ruleCheck({
              kind: "take_profit",
              strategy: "trailing",
              strategyLabel: "移动止盈",
              status: "triggered",
              thresholdPrice: 1.14,
              thresholdAmount: 14,
              currentProfit: 20,
              distancePercent: -2.63,
              detail: "现价 1.2 已回撤至离场价 1.14",
              basis: ["持仓期最高价 1.2", "回撤比例 5%", "离场价 1.14"]
            })
          })
        })
      ],
      closed: []
    } satisfies BatmanHoldingWorkspace);

    const wrapper = await mountView();
    const ruleButton = wrapper.get("button[aria-label='查看 测试股票 损盈规则']");
    expect(ruleButton.attributes("data-hint")).toBe("已触发止盈");
    expect(ruleButton.classes()).toContain("profit");
    expect(ruleButton.classes()).not.toContain("danger");

    await ruleButton.trigger("click");
    expect(wrapper.get(".profit-rule-dialog").text()).toContain("离场价");
  });

  test("falls back to a data-missing profit rule when the workspace has no evaluation", async () => {
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

    const wrapper = await mountView();
    const ruleButton = wrapper.get("button[aria-label='查看 测试股票 损盈规则']");
    expect(ruleButton.attributes("data-hint")).toBe("损盈规则（数据不足）");
    expect(ruleButton.classes()).not.toContain("danger");
    expect(ruleButton.classes()).not.toContain("profit");

    await ruleButton.trigger("click");
    const dialog = wrapper.get(".profit-rule-dialog");
    expect(dialog.text()).toContain("数据不足");
    expect(dialog.text()).toContain("当前持仓暂时缺少损盈评估数据。");
    expect(dialog.find(".profit-rule-card").exists()).toBe(false);
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

    // 实时源现在通过 recentDays 单次请求拉多天分钟点；date 缺省、recentDays 必带
    expect(mocks.marketMinute).toHaveBeenCalled();
    const firstCall = mocks.marketMinute.mock.calls[0] as unknown[];
    expect(firstCall[2]).toBeUndefined();
    expect(typeof firstCall[3]).toBe("number");
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

  test("keeps 全部 range enabled under realtime source with a hint about lookback", async () => {
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
        { time: "09:30", price: 10, volume: 1_200, cumulativeAmount: 12_000 }
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

    const rangeButtons = () => wrapper.findAll(".intraday-range-toggle .intraday-toggle-button");
    const allRealtime = rangeButtons().find((b) => b.text() === "全部")!;
    expect(allRealtime.attributes("disabled")).toBeUndefined();
    expect(allRealtime.attributes("title") ?? "").toContain("实时分时源");
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

function ruleCheck(overrides: Partial<ProfitRuleCheck> = {}): ProfitRuleCheck {
  return {
    kind: "stop_loss",
    strategy: "fixed_percentage",
    strategyLabel: "固定比例止损",
    status: "safe",
    thresholdPrice: 0.95,
    thresholdAmount: -5,
    currentProfit: -10,
    distancePercent: 5.26,
    detail: "现价 0.9 仍在止损价 0.95 之上",
    basis: ["成本价 1", "止损比例 5%"],
    ...overrides
  };
}

function profitRule(overrides: Partial<ProfitRuleEvaluation> = {}): ProfitRuleEvaluation {
  return {
    signal: "safe",
    summary: "当前价格未触发止损或止盈规则。",
    asOf: "2026-07-24",
    stopLoss: ruleCheck(),
    takeProfit: ruleCheck({
      kind: "take_profit",
      strategy: "risk_reward",
      strategyLabel: "盈亏比止盈",
      thresholdPrice: 1.15,
      thresholdAmount: 15,
      distancePercent: -21.74,
      detail: "现价 0.9 尚未达到止盈价 1.15",
      basis: ["成本价 1", "每股止损空间 0.05", "盈亏比 1 : 3"]
    }),
    ...overrides
  };
}

async function mountView() {
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
  return wrapper;
}
