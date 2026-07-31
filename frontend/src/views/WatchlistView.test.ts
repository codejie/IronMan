import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import WatchlistView from "./WatchlistView.vue";

const mocks = vi.hoisted(() => ({
  watchlistWorkspace: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {},
  api: { watchlistWorkspace: mocks.watchlistWorkspace },
}));

vi.mock("@/stores/session", () => ({
  useSession: () => ({ token: { value: "test-token" } }),
}));

describe("WatchlistView", () => {
  beforeEach(() => {
    mocks.watchlistWorkspace.mockReset();
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

  test("uses compact action icons with a single shared hint for each watchlist instrument", async () => {
    mocks.watchlistWorkspace.mockResolvedValue({
      items: [
        {
          id: "watchlist-1",
          instrument: { id: "instrument-1", code: "000001", exchange: "sz", name: "测试股票", assetType: "stock" },
          isHeld: false,
          latestPrice: 10,
          targetPrice: 12,
          targetPriceDifference: 2,
          previousClose: null,
          openPrice: null,
          highPrice: null,
          lowPrice: null,
          priceChange: null,
          priceChangeRate: null,
          amplitudeRate: null,
          volumeRatio: null,
          turnoverRate: null,
        },
      ],
    });

    const wrapper = mount(WatchlistView, {
      global: {
        stubs: {
          InstrumentKLineDialog: true,
          InstrumentPickerDialog: true,
          QuickAlertDialog: true,
        },
      },
    });
    await flushPromises();

    const alertButton = wrapper.get("button[aria-label='为 测试股票 设置提醒']");
    const targetButton = wrapper.get("button[aria-label='设置 测试股票 目标价']");
    const deleteButton = wrapper.get("button[aria-label='删除 测试股票 自选']");

    expect(alertButton.classes()).toContain("batman-icon-button");
    expect(alertButton.attributes("data-hint")).toBe("设置提醒");
    expect(alertButton.attributes("data-hint-position")).toBe("top");
    expect(alertButton.attributes("title")).toBeUndefined();
    expect(targetButton.classes()).toContain("batman-icon-button");
    expect(targetButton.text()).toBe("");
    expect(targetButton.attributes("data-hint")).toBe("设置目标价");
    expect(targetButton.attributes("data-hint-position")).toBe("top");
    expect(targetButton.attributes("title")).toBeUndefined();
    expect(deleteButton.classes()).toContain("batman-icon-button");
    expect(deleteButton.classes()).toContain("danger");
    expect(deleteButton.text()).toBe("");
    expect(deleteButton.attributes("data-hint")).toBe("删除自选");
    expect(deleteButton.attributes("data-hint-position")).toBe("top");
    expect(deleteButton.attributes("title")).toBeUndefined();
    expect(wrapper.get("td.batman-actions").attributes("title")).toBeUndefined();
  });
});
