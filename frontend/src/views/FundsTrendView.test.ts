import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import FundsTrendView from "./FundsTrendView.vue";

const mocks = vi.hoisted(() => ({
  fundHistory: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {},
  api: { fundHistory: mocks.fundHistory },
}));

vi.mock("@/stores/session", () => ({
  useSession: () => ({ token: { value: "test-token" } }),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

function result() {
  return {
    summary: {
      totalAssets: 120_000,
      marketValue: 80_000,
      cashAvailable: 40_000,
      principal: 100_000,
      cumulativeProfit: 20_000,
      cumulativeProfitRate: 20,
      maxDrawdown: -5.25,
    },
    points: [
      {
        tradeDate: "2026-07-30",
        cashAvailable: 40_000,
        principal: 100_000,
        marketValue: 80_000,
        totalAssets: 120_000,
        externalCashFlow: 0,
        dailyProfit: 800,
        dailyReturn: 0.0067,
        performanceIndex: 1.2,
        cumulativeProfit: 20_000,
        cumulativeProfitRate: 20,
        instrumentCount: 3,
        pricedCount: 3,
        carriedPriceCount: 0,
        missingPriceCount: 0,
        dataStatus: "complete",
        calculationVersion: 1,
        calculatedAt: "2026-07-30T08:10:00.000Z",
      },
    ],
    events: [],
    state: {
      coveredFrom: "2026-04-30",
      coveredTo: "2026-07-30",
      dirtyFrom: null,
      status: "idle",
      lastError: null,
      calculationVersion: 1,
      updatedAt: "2026-07-30T08:10:00.000Z",
      tradeDayCount: 63,
    },
  };
}

describe("FundsTrendView", () => {
  beforeEach(() => {
    mocks.fundHistory.mockReset();
    mocks.push.mockReset();
    mocks.fundHistory.mockResolvedValue(result());
  });

  test("loads three months by default and switches the requested range", async () => {
    const wrapper = mount(FundsTrendView, {
      global: {
        stubs: {
          FundsAssetTrendChart: true,
          FundsProfitTrendChart: true,
          FundsHistoryStatus: true,
        },
      },
    });
    await flushPromises();

    expect(mocks.fundHistory).toHaveBeenCalledTimes(1);
    const firstCall = mocks.fundHistory.mock.calls[0] as [string, string, string];
    expect(firstCall[0]).toBe("test-token");
    expect(monthDistance(firstCall[1], firstCall[2])).toBe(3);
    expect(wrapper.text()).toContain("120,000.00");
    expect(wrapper.text()).toContain("2026-07-30");

    await wrapper.get("button[data-period='6']").trigger("click");
    await flushPromises();
    const secondCall = mocks.fundHistory.mock.calls[1] as [string, string, string];
    expect(monthDistance(secondCall[1], secondCall[2])).toBe(6);
  });

  test("returns to holdings from the compact header action", async () => {
    const wrapper = mount(FundsTrendView, {
      global: {
        stubs: {
          FundsAssetTrendChart: true,
          FundsProfitTrendChart: true,
          FundsHistoryStatus: true,
        },
      },
    });
    await flushPromises();
    await wrapper.get("button[aria-label='返回持仓信息']").trigger("click");
    expect(mocks.push).toHaveBeenCalledWith("/holding/list");
  });

  test("places profit change before asset change", async () => {
    const source = await import("./FundsTrendView.vue?raw");

    expect(source.default.indexOf("<h2>盈亏变化</h2>")).toBeLessThan(
      source.default.indexOf("<h2>资产变化</h2>"),
    );
  });
});

function monthDistance(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
}
