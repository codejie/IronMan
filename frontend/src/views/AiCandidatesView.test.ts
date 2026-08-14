import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AiCandidateItem, AiCandidateRun } from "@/api/client";
import AiCandidatesView from "./AiCandidatesView.vue";

const mocks = vi.hoisted(() => ({
  createAiCandidateRun: vi.fn(),
  getAiCandidateRunDetail: vi.fn(),
  listAiCandidateRuns: vi.fn(),
  deleteAiCandidateDate: vi.fn(),
  requestConfirmation: vi.fn(),
  routerPush: vi.fn(),
}));

vi.mock("@/api/client", () => ({ ApiError: class ApiError extends Error {}, api: mocks }));
vi.mock("@/stores/session", () => ({ useSession: () => ({ token: { value: "test-token" } }) }));
vi.mock("@/components/confirmation", () => ({ requestConfirmation: mocks.requestConfirmation }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: mocks.routerPush }) }));

const run: AiCandidateRun = {
  id: "run-1", trigger: "manual", tradeDate: "2026-08-11", status: "completed", progress: 100, requestedTopN: 10,
  strategies: ["trend_event", "quality_growth", "value_repair"], algorithmVersion: "ai-candidate-v1", marketRegime: { name: "neutral", threshold: 70, asOf: "2026-08-11", evidence: [] }, dataQuality: { itemCount: 1 }, modelSnapshot: {}, errorMessage: null, createdAt: "2026-08-11T10:00:00.000Z", startedAt: "2026-08-11T10:00:00.000Z", completedAt: "2026-08-11T10:01:00.000Z",
};
const item: AiCandidateItem = {
  id: "item-1", runId: "run-1", strategy: "trend_event", rank: 1, score: 78.2, percentile: 78.2, selected: true,
  instrument: { id: "instrument-1", code: "600000", exchange: "sh", name: "浦发银行", assetType: "stock" },
  scoreSnapshot: { trend: 82, volumeLiquidity: 76, overheatControl: 74 },
  evidenceSnapshot: [{ id: "trend-20", label: "20日涨跌", value: "8.25%", source: "market-history", asOf: "2026-08-11" }],
  explanation: { summary: "量化评分达到研究阈值。", action: "observe", thesis: ["趋势确认"], counterEvidence: ["事件覆盖有限"], referencePriceLow: 10, referencePriceHigh: 11, invalidationPrice: 9, validUntil: "2026-08-25", uncertainty: "中等", evidenceIds: ["trend-20"] },
  aiStatus: "local", dataQuality: "complete", rejectionReason: null, cycleId: "cycle-1", createdAt: "2026-08-11T10:01:00.000Z",
};

describe("AiCandidatesView", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.listAiCandidateRuns.mockResolvedValue({ items: [run] });
    mocks.getAiCandidateRunDetail.mockResolvedValue({ run, items: [item], evaluations: [], logs: [] });
    mocks.requestConfirmation.mockResolvedValue(false);
  });

  test("uses date records as the primary navigation and keeps strategy tabs in the detail", async () => {
    const wrapper = mount(AiCandidatesView);
    await flushPromises();
    expect(wrapper.text()).toContain("运行记录");
    expect(wrapper.text()).toContain("2026-08-11");
    expect(wrapper.text()).toContain("浦发银行");
    expect(wrapper.text()).toContain("20日涨跌");
    expect(wrapper.text()).not.toContain("今日候选");
    expect(wrapper.text()).not.toContain("历史推荐");
    expect(wrapper.text()).not.toContain("研究工作台");
    expect(wrapper.text()).not.toContain("以日期保存候选记录");
    const valueTab = wrapper.findAll(".candidate-strategy-tabs button").find((button) => button.text().includes("低估值"));
    if (valueTab === undefined) throw new Error("value strategy tab missing");
    await valueTab.trigger("click");
    expect(wrapper.text()).toContain("低估值修复");
  });

  test("uses a full-width holdings-style table and opens the K-line dialog from a row", async () => {
    const source = await import("./AiCandidatesView.vue?raw");
    expect(source.default).toContain("<InstrumentKLineDialog");
    expect(source.default).toMatch(/\.candidate-table-frame\s*\{[^}]*overflow-x:\s*hidden;[^}]*width:\s*100%;/s);
    expect(source.default).toMatch(/\.candidate-table\s*\{[^}]*table-layout:\s*fixed;[^}]*width:\s*100%;/s);

    const wrapper = mount(AiCandidatesView, {
      global: {
        stubs: {
          InstrumentKLineDialog: {
            props: ["instrument"],
            template: "<div v-if=\"instrument\" data-kline-dialog>{{ instrument.name }}</div>",
          },
        },
      },
    });
    await flushPromises();
    await wrapper.get(".candidate-table tbody tr").trigger("click");
    expect(wrapper.get("[data-kline-dialog]").text()).toBe("浦发银行");
  });

  test("labels the detail score and places actions beside the title", async () => {
    const wrapper = mount(AiCandidatesView);
    await flushPromises();

    expect(wrapper.get(".candidate-score-box > span").text()).toBe("评分");
    expect(wrapper.find(".candidate-detail > header .candidate-detail-actions").exists()).toBe(true);
    expect(wrapper.findAll(".candidate-detail-actions")).toHaveLength(1);
  });

  test("matches the holdings table typography and highlights the action column", async () => {
    const source = await import("./AiCandidatesView.vue?raw");

    expect(source.default).toMatch(/\.candidate-table th, \.candidate-table td\s*\{[^}]*font-family:\s*inherit;[^}]*font-size:\s*13px;/s);
    expect(source.default).toMatch(/\.candidate-table \.candidate-action\s*\{[^}]*color:\s*#8fe8df;[^}]*font-weight:\s*650;/s);
  });

  test("uses the Trend Analysis shell baseline for date records and details", async () => {
    const source = await import("./AiCandidatesView.vue?raw");

    expect(source.default).toMatch(/\.candidate-page-header\s*\{[^}]*border-bottom:\s*1px solid #2b4057;/s);
    expect(source.default).toMatch(/\.candidate-record-layout\s*\{[^}]*grid-template-columns:\s*260px minmax\(0, 1fr\);[^}]*\}/s);
    expect(source.default).toMatch(/\.candidate-record-list\s*\{[^}]*background:\s*#0d1727;[^}]*border-right:\s*1px solid #293d56;/s);
  });

  test("opens effect evaluation as a separate route", async () => {
    const wrapper = mount(AiCandidatesView);
    await flushPromises();
    await wrapper.findAll(".candidate-header-actions button").find((button) => button.text().includes("效果评估"))?.trigger("click");
    expect(mocks.routerPush).toHaveBeenCalledWith("/analysis/ai-candidates/evaluation");
  });

  test("deletes a date record through the confirmation flow", async () => {
    mocks.requestConfirmation.mockResolvedValue(true);
    const wrapper = mount(AiCandidatesView);
    await flushPromises();
    await wrapper.get(".candidate-date-delete").trigger("click");
    await flushPromises();
    expect(mocks.requestConfirmation).toHaveBeenCalledWith(expect.objectContaining({ title: "删除候选记录", confirmLabel: "删除记录" }));
    expect(mocks.deleteAiCandidateDate).toHaveBeenCalledWith("test-token", "2026-08-11");
  });

  test("asks before replacing an existing current-date record", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const todayRun = { ...run, tradeDate: today };
    mocks.listAiCandidateRuns.mockResolvedValue({ items: [todayRun] });
    mocks.getAiCandidateRunDetail.mockResolvedValue({ run: todayRun, items: [item], evaluations: [], logs: [] });
    const wrapper = mount(AiCandidatesView);
    await flushPromises();
    await wrapper.findAll(".candidate-header-actions button").find((button) => button.text().includes("运行候选"))?.trigger("click");
    await flushPromises();
    expect(mocks.requestConfirmation).toHaveBeenCalledWith(expect.objectContaining({ title: "当日候选记录已存在", confirmLabel: "替换候选" }));
    expect(mocks.createAiCandidateRun).not.toHaveBeenCalled();
  });
});
