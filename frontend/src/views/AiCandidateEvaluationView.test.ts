import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import AiCandidateEvaluationView from "./AiCandidateEvaluationView.vue";

const mocks = vi.hoisted(() => ({
  aiCandidateEvaluationSummary: vi.fn(),
  routerPush: vi.fn(),
}));

vi.mock("@/api/client", () => ({ ApiError: class ApiError extends Error {}, api: mocks }));
vi.mock("@/stores/session", () => ({ useSession: () => ({ token: { value: "test-token" } }) }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: mocks.routerPush }) }));

describe("AiCandidateEvaluationView", () => {
  beforeEach(() => {
    mocks.aiCandidateEvaluationSummary.mockReset();
    mocks.routerPush.mockReset();
    mocks.aiCandidateEvaluationSummary.mockResolvedValue({
      horizons: {
        "5": { total: 3, matured: 2, pending: 1, hitRate: 0.5, averageNetReturn: 0.012, averageExcessReturn: 0.01 },
        "10": { total: 3, matured: 1, pending: 2, hitRate: 1, averageNetReturn: 0.02, averageExcessReturn: 0.018 },
        "20": { total: 3, matured: 0, pending: 3, hitRate: null, averageNetReturn: null, averageExcessReturn: null },
      },
      byStrategy: {
        trend_event: { total: 1, matured: 1, hitRate: 1, averageNetReturn: 0.02 },
        quality_growth: { total: 1, matured: 0, hitRate: null, averageNetReturn: null },
        value_repair: { total: 1, matured: 0, hitRate: null, averageNetReturn: null },
      },
    });
  });

  test("renders 5/10/20 evaluation summaries independently from candidate records", async () => {
    const wrapper = mount(AiCandidateEvaluationView);
    await flushPromises();
    expect(mocks.aiCandidateEvaluationSummary).toHaveBeenCalledWith("test-token");
    expect(wrapper.text()).toContain("效果评估");
    expect(wrapper.text()).toContain("5 日");
    expect(wrapper.text()).toContain("趋势事件");
    expect(wrapper.text()).not.toContain("今日候选");
    expect(wrapper.text()).not.toContain("历史推荐");
    expect(wrapper.text()).not.toContain("候选记录分析");
    expect(wrapper.text()).not.toContain("以当前保留的日期记录为样本");
    expect(wrapper.get(".evaluation-title-group").get("button").text()).toContain("返回候选记录");
    expect(wrapper.get(".evaluation-title-group").get("h1").text()).toBe("效果评估");
  });

  test("returns to the date-centered candidate page", async () => {
    const wrapper = mount(AiCandidateEvaluationView);
    await flushPromises();
    await wrapper.find("button").trigger("click");
    expect(mocks.routerPush).toHaveBeenCalledWith("/analysis/ai-candidates");
  });
});
