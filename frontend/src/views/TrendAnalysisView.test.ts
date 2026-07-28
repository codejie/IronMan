import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import TrendAnalysisView from "./TrendAnalysisView.vue";

const mocks = vi.hoisted(() => ({
  getAiConfig: vi.fn(),
  listTrendStrategies: vi.fn(),
  trendIndicatorCatalog: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    getAiConfig: mocks.getAiConfig,
    listTrendStrategies: mocks.listTrendStrategies,
    trendIndicatorCatalog: mocks.trendIndicatorCatalog,
  },
}));

vi.mock("@/stores/session", () => ({
  useSession: () => ({ token: { value: "test-token" } }),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/components/confirmation", () => ({
  requestConfirmation: vi.fn(),
}));

describe("TrendAnalysisView strategy navigation", () => {
  beforeEach(() => {
    mocks.getAiConfig.mockReset();
    mocks.listTrendStrategies.mockReset();
    mocks.trendIndicatorCatalog.mockReset();
    mocks.push.mockReset();
    mocks.getAiConfig.mockResolvedValue({ models: [] });
    mocks.listTrendStrategies.mockResolvedValue({ items: [] });
    mocks.trendIndicatorCatalog.mockResolvedValue({ items: [] });
  });

  test("opens the route-based strategy editor", async () => {
    const wrapper = mount(TrendAnalysisView, {
      global: {
        stubs: {
          InstrumentSearch: true,
          TrendReportChart: true,
        },
      },
    });
    await flushPromises();

    const createButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("新建策略"));
    if (createButton === undefined)
      throw new Error("new strategy control was not rendered");
    await createButton.trigger("click");
    await flushPromises();

    expect(mocks.push).toHaveBeenCalledWith("/analysis/trend/strategy/new");
  });
});
