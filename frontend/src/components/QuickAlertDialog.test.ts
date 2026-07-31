import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import QuickAlertDialog from "./QuickAlertDialog.vue";

const mocks = vi.hoisted(() => ({
  createAlertRule: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {},
  api: { createAlertRule: mocks.createAlertRule },
}));

vi.mock("@/stores/session", () => ({
  useSession: () => ({ token: { value: "test-token" } }),
}));

describe("QuickAlertDialog", () => {
  beforeEach(() => {
    mocks.createAlertRule.mockReset();
    mocks.createAlertRule.mockResolvedValue({ id: "rule-1" });
  });

  test("creates a scoped target-price rule from the current instrument", async () => {
    const wrapper = mount(QuickAlertDialog, {
      props: {
        instrument: { id: "instrument-1", name: "测试股票" },
        currentPrice: 10.25,
        initialDirection: "above",
        initialPrice: 12.34,
        kind: "target_price",
        open: true,
        scopeType: "watchlist",
      },
    });

    const priceInput = wrapper.get("input[aria-label='触发价格']").element as HTMLInputElement;
    expect(wrapper.get("[data-quick-alert-current-price]").text()).toBe("当前价 10.2500");
    expect(priceInput.value).toBe("12.34");
    expect(priceInput.min).toBe("");
    expect(priceInput.step).toBe("any");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(mocks.createAlertRule).toHaveBeenCalledWith("test-token", {
      name: "测试股票 高于 12.3400",
      kind: "target_price",
      instrumentId: "instrument-1",
      condition: { direction: "above", targetPrice: 12.34 },
      cooldownMinutes: 240,
      scopeType: "watchlist",
      severity: "warning",
    });
    expect(wrapper.emitted("created")).toHaveLength(1);
  });
});
