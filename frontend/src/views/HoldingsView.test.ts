import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import type { BatmanHoldingWorkspace, BatmanHoldingWorkspaceRecord } from "@/api/client";
import HoldingsView from "./HoldingsView.vue";

const mocks = vi.hoisted(() => ({
  batmanHoldingWorkspace: vi.fn()
}));

vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ApiError";
    }
  },
  api: {
    batmanHoldingWorkspace: mocks.batmanHoldingWorkspace
  }
}));

vi.mock("@/stores/session", () => ({
  useSession: () => ({ token: { value: "test-token" } })
}));

describe("HoldingsView", () => {
  beforeEach(() => {
    mocks.batmanHoldingWorkspace.mockReset();
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
  });

  test("uses a hint-based icon to delete an operation record", async () => {
    const source = await import("./HoldingsView.vue?raw");

    expect(source.default).toContain('data-hint="删除操作"');
    expect(source.default).toContain('class="batman-icon-button danger"');
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
