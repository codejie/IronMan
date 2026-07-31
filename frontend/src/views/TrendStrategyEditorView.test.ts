import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import TrendStrategyEditorView from "./TrendStrategyEditorView.vue";

const mocks = vi.hoisted(() => ({
  batmanHoldingWorkspace: vi.fn(),
  createTrendStrategy: vi.fn(),
  deleteTrendStrategy: vi.fn(),
  getTrendStrategy: vi.fn(),
  listTrendStrategyTargets: vi.fn(),
  trendIndicatorCatalog: vi.fn(),
  updateTrendStrategy: vi.fn(),
  watchlistWorkspace: vi.fn(),
  confirmation: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  route: { params: {} as Record<string, string> },
}));

vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    batmanHoldingWorkspace: mocks.batmanHoldingWorkspace,
    createTrendStrategy: mocks.createTrendStrategy,
    deleteTrendStrategy: mocks.deleteTrendStrategy,
    getTrendStrategy: mocks.getTrendStrategy,
    listTrendStrategyTargets: mocks.listTrendStrategyTargets,
    trendIndicatorCatalog: mocks.trendIndicatorCatalog,
    updateTrendStrategy: mocks.updateTrendStrategy,
    watchlistWorkspace: mocks.watchlistWorkspace,
  },
}));

vi.mock("@/stores/session", () => ({
  useSession: () => ({ token: { value: "test-token" } }),
}));

vi.mock("@/components/confirmation", () => ({
  requestConfirmation: mocks.confirmation,
}));

vi.mock("vue-router", () => ({
  useRoute: () => mocks.route,
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));

describe("TrendStrategyEditorView", () => {
  beforeEach(() => {
    mocks.route.params = {};
    for (const mock of Object.values(mocks)) {
      if (typeof mock === "function") mock.mockReset();
    }
    mocks.trendIndicatorCatalog.mockResolvedValue({
      items: [
        definition("MA", "移动平均线", "overlap", [
          parameter("period", "周期", 20),
        ]),
        definition("MACD", "指数平滑异同移动平均线", "momentum", [
          parameter("fast", "快线", 12),
        ]),
        definition("OBV", "能量潮", "volume"),
      ],
    });
    mocks.batmanHoldingWorkspace.mockResolvedValue({
      active: [
        {
          instrument: instrument("holding-1", "600000", "浦发银行"),
          currentPrice: 10.25,
        },
      ],
    });
    mocks.watchlistWorkspace.mockResolvedValue({
      items: [
        {
          instrument: instrument("watch-1", "000001", "平安银行"),
          latestPrice: 11.4,
        },
      ],
    });
  });

  test("groups the catalog and keeps target scope in the left work column", async () => {
    const wrapper = mount(TrendStrategyEditorView, {
      global: { stubs: { InstrumentSearch: true } },
    });
    await flushPromises();

    expect(wrapper.get(".strategy-settings-column").text()).toContain(
      "标的范围",
    );
    expect(wrapper.get(".strategy-settings-column").text()).toContain("自定义");
    expect(wrapper.get(".strategy-settings-column").text()).not.toContain(
      "自定义标的",
    );
    expect(wrapper.get(".strategy-indicator-column").text()).toContain(
      "指标库",
    );
    expect(wrapper.text()).toContain("浦发银行");
    expect(wrapper.text()).toContain("平安银行");
    expect(
      wrapper
        .get("button[aria-label='收起覆盖研究']")
        .attributes("aria-expanded"),
    ).toBe("true");

    await wrapper.get("button[aria-label='展开成交量指标']").trigger("click");
    await wrapper.get("button[aria-label='添加 OBV']").trigger("click");
    expect(wrapper.get("button[aria-label='移除 OBV']").text()).toBe("移除");

    await wrapper.get("button[aria-label='从策略中移除 OBV']").trigger("click");
    expect(wrapper.get("button[aria-label='添加 OBV']").text()).toBe("添加");
  });

  test("shows compact advice for selected indicator parameters without replacing the remove control", async () => {
    const wrapper = mount(TrendStrategyEditorView, {
      global: { stubs: { InstrumentSearch: true } },
    });
    await flushPromises();

    const parameterRows = wrapper.findAll(".strategy-parameter-list article");
    expect(parameterRows[0]?.text()).toContain("移动平均线使用说明");
    expect(
      parameterRows[0]
        ?.get("button[aria-label='从策略中移除 MA']")
        .classes(),
    ).toContain("strategy-parameter-remove");
  });

  test("expands structured indicator help with meaning, usage, and trend judgment", async () => {
    const wrapper = mount(TrendStrategyEditorView, {
      global: { stubs: { InstrumentSearch: true } },
    });
    await flushPromises();

    await wrapper.get("button[aria-label='查看 MA 指标说明']").trigger("click");
    const detail = wrapper.get(".strategy-indicator-details");
    expect(detail.text()).toContain("意义");
    expect(detail.text()).toContain("移动平均线用于识别价格运行方向");
    expect(detail.text()).toContain("用法");
    expect(detail.text()).toContain("趋势判断");
    expect(detail.text()).toContain("价格在均线上方且均线上行时偏多");
  });

  test("saves a new strategy and returns to the workspace with its selection", async () => {
    mocks.createTrendStrategy.mockResolvedValue({
      ...strategy(),
      id: "strategy-new",
      name: "风险观察",
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.000Z",
    });
    const wrapper = mount(TrendStrategyEditorView, {
      global: { stubs: { InstrumentSearch: true } },
    });
    await flushPromises();

    await wrapper
      .get("input[placeholder='例如：持仓趋势观察']")
      .setValue("风险观察");
    const saveButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("保存策略"));
    if (saveButton === undefined)
      throw new Error("save control was not rendered");
    await saveButton.trigger("click");
    await flushPromises();

    expect(mocks.createTrendStrategy).toHaveBeenCalledWith(
      "test-token",
      expect.objectContaining({ name: "风险观察" }),
    );
    expect(mocks.replace).toHaveBeenCalledWith({
      path: "/analysis/trend",
      query: { strategyId: "strategy-new" },
    });
  });
});

function parameter(key: string, label: string, defaultValue: number) {
  return { key, label, defaultValue, min: 1, max: 240 };
}

function definition(
  id: string,
  label: string,
  category: string,
  parameters = [] as ReturnType<typeof parameter>[],
) {
  return {
    id,
    label,
    category,
    description: `${label}描述`,
    usageHint: `${label}使用说明`,
    detail: {
      meaning: `${label}用于识别价格运行方向`,
      usage: `结合${label}与价格关系观察信号`,
      trend: "价格在均线上方且均线上行时偏多",
    },
    parameters,
    lines: [id.toLowerCase()],
    chart: "sub" as const,
  };
}

function instrument(id: string, code: string, name: string) {
  return {
    id,
    code,
    name,
    exchange: "sh" as const,
    assetType: "stock" as const,
  };
}

function strategy() {
  return {
    remarks: "",
    targetScope: "holdings_watchlist" as const,
    dataRange: { preset: "6m" as const },
    reportWindow: "7d" as const,
    backtestConfig: null,
    customInstrumentIds: [],
    indicators: [],
  };
}
