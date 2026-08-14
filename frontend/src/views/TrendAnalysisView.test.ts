import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import TrendAnalysisView from "./TrendAnalysisView.vue";

const mocks = vi.hoisted(() => ({
  getAiConfig: vi.fn(),
  listTrendRuns: vi.fn(),
  listTrendStrategies: vi.fn(),
  listTrendStrategyTargets: vi.fn(),
  trendIndicatorCatalog: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    getAiConfig: mocks.getAiConfig,
    listTrendRuns: mocks.listTrendRuns,
    listTrendStrategies: mocks.listTrendStrategies,
    listTrendStrategyTargets: mocks.listTrendStrategyTargets,
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
    mocks.listTrendRuns.mockReset();
    mocks.listTrendStrategies.mockReset();
    mocks.listTrendStrategyTargets.mockReset();
    mocks.trendIndicatorCatalog.mockReset();
    mocks.push.mockReset();
    mocks.getAiConfig.mockResolvedValue({ models: [] });
    mocks.listTrendRuns.mockResolvedValue({ items: [] });
    mocks.listTrendStrategies.mockResolvedValue({ items: [] });
    mocks.listTrendStrategyTargets.mockResolvedValue({
      strategyId: "strategy-custom",
      targetScope: "custom",
      items: [],
    });
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

  test("omits the empty description placeholder from strategy options", async () => {
    mocks.listTrendStrategies.mockResolvedValue({
      items: [
        strategy({
          id: "strategy-custom",
          name: "趋势观察",
          targetScope: "custom",
          remarks: "",
        }),
      ],
    });
    const wrapper = mount(TrendAnalysisView, {
      global: {
        stubs: {
          TrendReportChart: true,
        },
      },
    });
    await flushPromises();

    const optionText = wrapper.get("select[aria-label='当前趋势策略']").text();
    expect(optionText).toContain("[自定义] 趋势观察");
    expect(optionText).not.toContain(": 未填写描述");
  });

  test("uses hint-based icon actions for each trend report row", async () => {
    const source = await import("./TrendAnalysisView.vue?raw");

    expect(source.default).toContain('class="batman-icon-button trend-reminder-button"');
    expect(source.default).toContain("<Bell :size=\"14\" />");
    expect(source.default).toContain('data-hint="创建风险提醒"');
    expect(source.default).toContain("查看已缓存 AI 解读");
    expect(source.default).toContain("生成 AI 解读");
    expect(source.default).toContain("trend-ai-cache-marker");
    expect(source.default).not.toContain('title="创建风险提醒"');
    expect(source.default).not.toContain("<Bot :size=\"13\" />AI 解读");
  });

  test("uses the archive-style selected state without run-list hover styling", async () => {
    const source = await import("./TrendAnalysisView.vue?raw");

    expect(source.default).toMatch(/\.trend-run-item\.active\s*\{[^}]*background:\s*#172b41;[^}]*box-shadow:\s*inset 3px 0 #57cfc6;/s);
    expect(source.default).toMatch(/\.trend-run-item\s*\{[^}]*border-radius:\s*0;/s);
    expect(source.default).toMatch(/\/\*\s*\.trend-run-item:hover/);
    expect(source.default).toMatch(/\/\*\s*\.trend-run-delete:hover/);
  });

  test("shows report-level generation state and opens cached interpretations in place", async () => {
    const source = await import("./TrendAnalysisView.vue?raw");

    expect(source.default).toContain("generatingReportId");
    expect(source.default).toContain("trend-ai-generating-marker");
    expect(source.default).toContain("<Ellipsis");
    expect(source.default).toContain("openAiInterpretation(report)");
    expect(source.default).toContain('ref="aiInterpretationCard"');
    expect(source.default).toContain("scrollIntoView");
  });
});

function strategy(input: {
  id: string;
  name: string;
  targetScope: "custom";
  remarks: string;
}) {
  return {
    id: input.id,
    name: input.name,
    remarks: input.remarks,
    targetScope: input.targetScope,
    dataRange: { preset: "6m" as const },
    reportWindow: "7d" as const,
    backtestConfig: null,
    customInstrumentIds: [],
    indicators: [],
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
  };
}
