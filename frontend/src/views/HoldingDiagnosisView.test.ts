import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import HoldingDiagnosisView from "./HoldingDiagnosisView.vue";

const mocks = vi.hoisted(() => ({
  deleteAllHoldingDiagnosisReports: vi.fn(),
  deleteHoldingDiagnosisReport: vi.fn(),
  getHoldingDiagnosisReport: vi.fn(),
  getHoldingDiagnosisRun: vi.fn(),
  listHoldingDiagnosisRuns: vi.fn(),
  startHoldingDiagnosis: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    deleteAllHoldingDiagnosisReports: mocks.deleteAllHoldingDiagnosisReports,
    deleteHoldingDiagnosisReport: mocks.deleteHoldingDiagnosisReport,
    getHoldingDiagnosisReport: mocks.getHoldingDiagnosisReport,
    getHoldingDiagnosisRun: mocks.getHoldingDiagnosisRun,
    listHoldingDiagnosisRuns: mocks.listHoldingDiagnosisRuns,
    startHoldingDiagnosis: mocks.startHoldingDiagnosis,
  },
}));

const confirmation = vi.hoisted(() => ({ requestConfirmation: vi.fn() }));
vi.mock("@/components/confirmation", () => ({
  requestConfirmation: confirmation.requestConfirmation,
}));
vi.mock("@/stores/session", () => ({
  useSession: () => ({ token: { value: "test-token" } }),
}));

const run = {
  id: "run-1",
  trigger: "manual" as const,
  status: "completed" as const,
  progress: 100,
  errorMessage: null,
  createdAt: "2026-08-03T07:30:00.000Z",
  reportId: "report-1",
};

const runningRun = {
  id: "run-running",
  trigger: "manual" as const,
  status: "running" as const,
  progress: 35,
  errorMessage: null,
  createdAt: "2026-08-03T11:18:09.000Z",
  reportId: null,
};

const report = {
  id: "report-1",
  runId: "run-1",
  body: "趋势呈修复状态，仍需等待价格与成交量确认。",
  errorMessage: null,
  aiStatus: {
    state: "completed" as const,
    model: { id: "model-1", name: "本地工作台助手", provider: "ollama" },
    message: "AI 已完成诊断。",
  },
  marketAsOf: "2026-08-03",
  createdAt: "2026-08-03T07:30:00.000Z",
  items: [
    {
      id: "item-1",
      instrument: {
        id: "instrument-1",
        code: "600000",
        exchange: "sh",
        name: "浦发银行",
        assetType: "stock",
      },
      quantity: 100,
      averageCost: 10,
      currentPrice: 10.5,
      profit: 50,
      dataQuality: "complete" as const,
      analysis: "价格站回短期均线，后续关注量能。",
      methods: [
        { kind: "ai_analysis" as const, name: "本地工作台助手", rationale: "模型综合持仓与行情。" },
        { kind: "local_function" as const, name: "MACD", version: "local-trend-v1", parameters: { fast: 12, slow: 26, signal: 9 }, dataWindow: 60, rationale: "本地趋势算法。" },
        { kind: "hybrid_analysis" as const, name: "AI 与本地算法综合判断", rationale: "双重证据。" },
      ],
      recommendation: {
        direction: "observe" as const,
        timing: "下一交易日确认后",
        referencePriceLow: 10.2,
        referencePriceHigh: 10.8,
        invalidationPrice: 9.9,
        validUntil: "2026-08-07",
        uncertainty: "样本与行情变化需要持续复核。",
      },
      chart: {
        source: "tencent" as const,
        bars: [{ date: "2026-08-03", open: 10, close: 10.5, high: 10.6, low: 9.9, volume: 1200 }],
        indicators: [],
        turningPoints: [{ date: "2026-08-03", direction: "bullish" as const, price: 10.5, title: "MACD 转强", reason: "DIF 上穿 DEA", methods: [{ kind: "local_function" as const, name: "MACD", rationale: "本地趋势算法。" }] }],
      },
    },
    {
      id: "item-2",
      instrument: {
        id: "instrument-2",
        code: "510300",
        exchange: "fund",
        name: "沪深300ETF",
        assetType: "fund",
      },
      quantity: 200,
      averageCost: 4,
      currentPrice: 4.2,
      profit: 40,
      dataQuality: "partial" as const,
      analysis: "ETF 仍需结合指数方向和资金流复核。",
      methods: [{ kind: "local_function" as const, name: "本地行情与指标摘要", rationale: "本地数据回退。" }],
      recommendation: {
        direction: "hold" as const,
        timing: "等待指数确认",
        referencePriceLow: 4,
        referencePriceHigh: 4.3,
        invalidationPrice: 3.9,
        validUntil: null,
        uncertainty: "市场波动可能放大。",
      },
      chart: {
        source: "tencent" as const,
        bars: [{ date: "2026-08-03", open: 4, close: 4.2, high: 4.25, low: 3.98, volume: 2200 }],
        indicators: [],
        turningPoints: [],
      },
    },
  ],
  sources: [
    {
      id: "source-1",
      sourceId: "cninfo",
      sourceName: "巨潮资讯",
      type: "disclosure" as const,
      title: "浦发银行公告检索入口",
      publishedAt: null,
      fetchedAt: "2026-08-03T07:30:00.000Z",
      availability: "link_only" as const,
      url: "https://www.cninfo.com.cn/new/commonUrl?url=disclosure/list/notice&code=600000",
      itemId: "item-1",
      summary: "浦发银行的公告检索入口已准备，本次没有读取公告正文。",
      highlights: ["披露范围：定期报告、临时公告", "状态：仅保留检索摘要"],
    },
  ],
};

describe("HoldingDiagnosisView", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    confirmation.requestConfirmation.mockReset();
    confirmation.requestConfirmation.mockResolvedValue(true);
    mocks.listHoldingDiagnosisRuns.mockResolvedValue({ items: [runningRun, run] });
    mocks.getHoldingDiagnosisReport.mockResolvedValue(report);
    mocks.startHoldingDiagnosis.mockResolvedValue({
      ...run,
      id: "run-new",
      reportId: "report-1",
    });
    mocks.getHoldingDiagnosisRun.mockResolvedValue({ ...run, id: "run-new" });
    mocks.deleteHoldingDiagnosisReport.mockResolvedValue({ deleted: 1 });
    mocks.deleteAllHoldingDiagnosisReports.mockResolvedValue({ deleted: 1 });
  });

  test("renders report tabs, keeps in-progress runs readable, and deletes an individual report through the shared confirmation", async () => {
    const wrapper = mount(HoldingDiagnosisView, {
      global: {
        stubs: {
          KLineChart: { props: ["bars", "annotations"], template: "<div class='chart-stub' />" },
          ExternalLink: true,
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("趋势呈修复状态");
    expect(wrapper.text()).toContain("AI 与本地算法综合判断");
    expect(wrapper.text()).toContain("AI 已完成诊断");
    expect(wrapper.get("[role='tablist']").findAll("[role='tab']")).toHaveLength(2);
    expect(wrapper.get("a[href*='cninfo.com.cn']").attributes("target")).toBe("_blank");
    expect(wrapper.get("details").text()).toContain("仅保留检索摘要");
    expect(wrapper.find(".chart-stub").exists()).toBe(true);
    expect(wrapper.get(".holding-diagnosis-run.without-report").text()).toContain("生成中 · 35%");

    await wrapper.get("button[role='tab'][aria-label='查看 沪深300ETF 诊断']").trigger("click");
    expect(wrapper.text()).toContain("ETF 仍需结合指数方向和资金流复核");
    expect(wrapper.text()).not.toContain("价格站回短期均线");

    expect(wrapper.find("input[type='checkbox']").exists()).toBe(false);
    await wrapper.get("button[data-hint='删除报告']").trigger("click");
    await flushPromises();
    expect(confirmation.requestConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ title: "删除持仓诊断报告", tone: "danger" }),
    );
    expect(mocks.deleteHoldingDiagnosisReport).toHaveBeenCalledWith(
      "test-token",
      "report-1",
    );
  });

  test("starts a manual report from the report archive entry", async () => {
    const wrapper = mount(HoldingDiagnosisView, {
      global: { stubs: { KLineChart: true, ExternalLink: true } },
    });
    await flushPromises();

    await wrapper.get("button[aria-label='生成持仓诊断']").trigger("click");
    await flushPromises();
    expect(mocks.startHoldingDiagnosis).toHaveBeenCalledWith("test-token");
  });

  test("clears archived reports through the shared confirmation while keeping in-progress runs", async () => {
    mocks.listHoldingDiagnosisRuns
      .mockResolvedValueOnce({ items: [runningRun, run] })
      .mockResolvedValueOnce({ items: [runningRun] });

    const wrapper = mount(HoldingDiagnosisView, {
      global: { stubs: { KLineChart: true, ExternalLink: true } },
    });
    await flushPromises();

    await wrapper.get("button[data-hint='清空归档']").trigger("click");
    await flushPromises();

    expect(confirmation.requestConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ title: "清空持仓诊断报告归档", tone: "danger" }),
    );
    expect(mocks.deleteAllHoldingDiagnosisReports).toHaveBeenCalledWith("test-token");
    expect(wrapper.find(".holding-diagnosis-run.without-report").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("趋势呈修复状态");
  });
});
