import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import SystemConfigurationView from "./SystemConfigurationView.vue";

const mocks = vi.hoisted(() => ({
  getDataSourceConfig: vi.fn(),
  marketOverview: vi.fn(),
  getMarketSnapshotSettings: vi.fn(),
  updateMarketSnapshotSettings: vi.fn(),
  marketSnapshotStatus: vi.fn(),
  deleteMarketSnapshots: vi.fn(),
  getAiConfig: vi.fn(),
  listOpenCodeGoModels: vi.fn(),
  getAiCandidateSettings: vi.fn(),
  updateAiCandidateSettings: vi.fn(),
  getAlertSettings: vi.fn(),
  getHoldingDiagnosisSettings: vi.fn(),
  holdingDiagnosisSourceCatalog: vi.fn(),
  updateAlertSettings: vi.fn(),
  fundHistoryStatus: vi.fn(),
  recalculateFundHistory: vi.fn(),
  updateHoldingDiagnosisSettings: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    getDataSourceConfig: mocks.getDataSourceConfig,
    marketOverview: mocks.marketOverview,
    getMarketSnapshotSettings: mocks.getMarketSnapshotSettings,
    updateMarketSnapshotSettings: mocks.updateMarketSnapshotSettings,
    marketSnapshotStatus: mocks.marketSnapshotStatus,
    deleteMarketSnapshots: mocks.deleteMarketSnapshots,
    getAiConfig: mocks.getAiConfig,
    listOpenCodeGoModels: mocks.listOpenCodeGoModels,
    getAiCandidateSettings: mocks.getAiCandidateSettings,
    updateAiCandidateSettings: mocks.updateAiCandidateSettings,
    getAlertSettings: mocks.getAlertSettings,
    getHoldingDiagnosisSettings: mocks.getHoldingDiagnosisSettings,
    holdingDiagnosisSourceCatalog: mocks.holdingDiagnosisSourceCatalog,
    updateAlertSettings: mocks.updateAlertSettings,
    fundHistoryStatus: mocks.fundHistoryStatus,
    recalculateFundHistory: mocks.recalculateFundHistory,
    updateHoldingDiagnosisSettings: mocks.updateHoldingDiagnosisSettings,
  },
}));

vi.mock("@/stores/session", () => ({
  useSession: () => ({ currentUser: { value: { role: "user" } }, token: { value: "test-token" } }),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ query: { section: "backup" } }),
}));

vi.mock("@/components/confirmation", () => ({
  requestConfirmation: mocks.confirm,
}));

describe("SystemConfigurationView", () => {
  beforeEach(() => {
    mocks.getDataSourceConfig.mockReset();
    mocks.marketOverview.mockReset();
    mocks.getMarketSnapshotSettings.mockReset();
    mocks.updateMarketSnapshotSettings.mockReset();
    mocks.marketSnapshotStatus.mockReset();
    mocks.deleteMarketSnapshots.mockReset();
    mocks.getAiConfig.mockReset();
    mocks.listOpenCodeGoModels.mockReset();
    mocks.getAiCandidateSettings.mockReset();
    mocks.updateAiCandidateSettings.mockReset();
    mocks.getAlertSettings.mockReset();
    mocks.getHoldingDiagnosisSettings.mockReset();
    mocks.holdingDiagnosisSourceCatalog.mockReset();
    mocks.updateAlertSettings.mockReset();
    mocks.fundHistoryStatus.mockReset();
    mocks.recalculateFundHistory.mockReset();
    mocks.updateHoldingDiagnosisSettings.mockReset();
    mocks.confirm.mockReset();
    mocks.getDataSourceConfig.mockResolvedValue({ primary: "tencent", fallback: "mock" });
    mocks.marketOverview.mockResolvedValue({ instrumentCount: 0, cachedBarCount: 0, latestCacheAt: null });
    mocks.getMarketSnapshotSettings.mockResolvedValue({
      enabled: false,
      mode: "auto",
      startTime: "09:30",
      endTime: "15:00",
      intervalMinutes: 15,
      scope: "holdings",
      retentionDays: 5,
    });
    mocks.updateMarketSnapshotSettings.mockResolvedValue({
      enabled: true,
      mode: "manual",
      startTime: "09:30",
      endTime: "15:00",
      intervalMinutes: 15,
      scope: "holdings_watchlist",
      retentionDays: 5,
    });
    mocks.marketSnapshotStatus.mockResolvedValue({
      totalCount: 0,
      firstCapturedAt: null,
      lastCapturedAt: null,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastCaptureMode: null,
      lastTargetCount: 0,
      lastCapturedCount: 0,
      lastSkippedCount: 0,
      lastFailedCount: 0,
      lastError: null,
    });
    mocks.deleteMarketSnapshots.mockResolvedValue({ deleted: 0 });
    mocks.getAiConfig.mockResolvedValue({
      models: [{ id: "local", name: "本地工作台助手", provider: "local", enabled: true, default: true }],
      systemPrompt: "test",
      defaultSystemPrompt: "test",
    });
    mocks.getAiCandidateSettings.mockResolvedValue({
      enabled: true,
      strategies: ["trend_event", "quality_growth", "value_repair"],
      topN: 10,
      explanationValidityDays: 10,
      maxValidityDays: 20,
      scheduledTime: "18:30",
      retentionDays: 30,
    });
    mocks.updateAiCandidateSettings.mockResolvedValue({
      enabled: true,
      strategies: ["trend_event", "quality_growth", "value_repair"],
      topN: 10,
      explanationValidityDays: 10,
      maxValidityDays: 20,
      scheduledTime: "18:30",
      retentionDays: 20,
    });
    mocks.getAlertSettings.mockResolvedValue({
      systemMode: "suggest",
      defaultCooldownMinutes: 60,
      autoScanEnabled: false,
      scanIntervalMinutes: 5,
      quietHours: null,
    });
    mocks.updateAlertSettings.mockResolvedValue({
      systemMode: "suggest",
      defaultCooldownMinutes: 60,
      autoScanEnabled: true,
      scanIntervalMinutes: 15,
      quietHours: null,
    });
    mocks.fundHistoryStatus.mockResolvedValue({
      coveredFrom: "2026-04-01",
      coveredTo: "2026-07-30",
      dirtyFrom: "2026-07-20",
      status: "dirty",
      lastError: null,
      calculationVersion: 1,
      updatedAt: "2026-07-30T08:00:00.000Z",
      tradeDayCount: 82,
    });
    mocks.recalculateFundHistory.mockResolvedValue({
      points: [],
      events: [],
      summary: {},
      state: {
        coveredFrom: "2025-07-31",
        coveredTo: "2026-07-30",
        dirtyFrom: null,
        status: "idle",
        lastError: null,
        calculationVersion: 1,
        updatedAt: "2026-07-31T08:00:00.000Z",
        tradeDayCount: 240,
      },
    });
    mocks.getHoldingDiagnosisSettings.mockResolvedValue({
      enabled: false,
      scheduledTime: "15:30",
      sourceIds: ["all"],
      reportPreference: "优先识别趋势与风险。",
      lookbackTradingDays: 60,
      maxFunctionBatches: 2,
      maxExternalSourcesPerHolding: 3,
    });
    mocks.holdingDiagnosisSourceCatalog.mockResolvedValue({
      items: [
        { id: "market", label: "当前行情主备源", description: "行情", kind: "market" },
        { id: "cninfo", label: "巨潮资讯", description: "公告", kind: "external" },
      ],
    });
    mocks.updateHoldingDiagnosisSettings.mockResolvedValue({
      enabled: true,
      scheduledTime: "15:45",
      sourceIds: ["market", "cninfo"],
      reportPreference: "风险优先。",
      lookbackTradingDays: 120,
      maxFunctionBatches: 3,
      maxExternalSourcesPerHolding: 5,
    });
    mocks.confirm.mockResolvedValue(true);
  });

  test("saves automatic rule scanning settings from the rules section", async () => {
    const wrapper = mount(SystemConfigurationView);
    await flushPromises();

    const rulesNav = wrapper.findAll(".system-configuration-nav-item").find((button) => button.text().includes("规则"));
    if (rulesNav === undefined) throw new Error("rules section was not rendered");
    await rulesNav.trigger("click");

    const form = wrapper.get("form[aria-label='规则配置']");
    await form.get("input[aria-label='自动扫描']").setValue(true);
    await form.get("input[aria-label='扫描间隔']").setValue("15");
    await form.trigger("submit");
    await flushPromises();

    expect(mocks.updateAlertSettings).toHaveBeenCalledWith("test-token", {
      autoScanEnabled: true,
      scanIntervalMinutes: 15,
    });
    expect(wrapper.text()).toContain("规则自动扫描已保存");
  });

  test("shows derived history status and rebuilds it through the shared confirmation", async () => {
    const wrapper = mount(SystemConfigurationView);
    await flushPromises();

    expect(wrapper.text()).toContain("资金趋势历史数据");
    expect(wrapper.text()).toContain("82 个交易日");
    const rebuild = wrapper.findAll("button").find((button) => button.text().includes("重新计算"));
    if (rebuild === undefined) throw new Error("fund history rebuild control was not rendered");
    await rebuild.trigger("click");
    await flushPromises();

    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "重新计算资金趋势" }));
    expect(mocks.recalculateFundHistory).toHaveBeenCalledWith("test-token");
    expect(wrapper.text()).toContain("资金趋势历史已重新计算");
  });

  test("configures the intraday snapshot master switch and collection mode", async () => {
    const wrapper = mount(SystemConfigurationView);
    await flushPromises();

    const marketNav = wrapper.findAll(".system-configuration-nav-item").find((button) => button.text().includes("行情"));
    if (marketNav === undefined) throw new Error("market section was not rendered");
    await marketNav.trigger("click");
    const snapshotRow = wrapper.findAll(".system-configuration-row").find((row) => row.text().includes("盘中行情快照"));
    if (snapshotRow === undefined) throw new Error("snapshot setting row was not rendered");
    await snapshotRow.find(".batman-button").trigger("click");
    await flushPromises();

    const form = wrapper.get("form.system-dialog-form");
    await form.get("input[aria-label='开启盘中行情快照']").setValue(true);
    const selects = form.findAll("select");
    await selects[0]!.setValue("manual");
    await selects[1]!.setValue("holdings_watchlist");
    await form.trigger("submit");
    await flushPromises();

    expect(mocks.updateMarketSnapshotSettings).toHaveBeenCalledWith("test-token", {
      enabled: true,
      mode: "manual",
      startTime: "09:30",
      endTime: "15:00",
      intervalMinutes: 15,
      scope: "holdings_watchlist",
      retentionDays: 5,
    });
    expect(wrapper.text()).toContain("盘中行情快照配置已保存");
  });

  test("saves holding diagnosis scheduling, source, and report preferences", async () => {
    const wrapper = mount(SystemConfigurationView);
    await flushPromises();

    const diagnosisNav = wrapper
      .findAll(".system-configuration-nav-item")
      .find((button) => button.text().includes("持仓诊断"));
    if (diagnosisNav === undefined) throw new Error("holding diagnosis section was not rendered");
    await diagnosisNav.trigger("click");

    const form = wrapper.get("form[aria-label='持仓诊断配置']");
    await form.get("input[aria-label='开启自动持仓诊断']").setValue(true);
    await form.get("input[aria-label='持仓诊断生成时间']").setValue("15:45");
    await form.get("input[aria-label='使用全部资料源']").setValue(false);
    await form.get("input[aria-label='选择 巨潮资讯']").setValue(true);
    await form.get("input[aria-label='选择 当前行情主备源']").setValue(true);
    await form.get("textarea[aria-label='报告倾向']").setValue("风险优先。");
    const selects = form.findAll("select");
    await selects[0]!.setValue("120");
    await selects[1]!.setValue("3");
    await selects[2]!.setValue("5");
    await form.trigger("submit");
    await flushPromises();

    expect(mocks.updateHoldingDiagnosisSettings).toHaveBeenCalledWith("test-token", {
      enabled: true,
      scheduledTime: "15:45",
      sourceIds: ["market", "cninfo"],
      reportPreference: "风险优先。",
      lookbackTradingDays: 120,
      maxFunctionBatches: 3,
      maxExternalSourcesPerHolding: 5,
    });
    expect(wrapper.text()).toContain("持仓诊断配置已保存");
  });

  test("saves AI candidate date retention settings", async () => {
    const wrapper = mount(SystemConfigurationView);
    await flushPromises();
    const candidateNav = wrapper.findAll(".system-configuration-nav-item").find((button) => button.text().includes("AI 候选"));
    if (candidateNav === undefined) throw new Error("AI candidate section was not rendered");
    await candidateNav.trigger("click");
    const form = wrapper.get("form[aria-label='AI 候选配置']");
    await form.get("select[aria-label='AI 候选记录保留天数']").setValue("20");
    await form.trigger("submit");
    await flushPromises();
    expect(mocks.updateAiCandidateSettings).toHaveBeenCalledWith("test-token", { retentionDays: 20 });
    expect(wrapper.text()).toContain("AI 候选记录保留设置已保存");
  });

  test("keeps AI models in a compact collapsible list and expands a new model for editing", async () => {
    const wrapper = mount(SystemConfigurationView);
    await flushPromises();

    const aiNav = wrapper
      .findAll(".system-configuration-nav-item")
      .find((button) => button.text().includes("AI 服务"));
    if (aiNav === undefined) throw new Error("AI section was not rendered");
    await aiNav.trigger("click");

    const aiConfigRow = wrapper
      .findAll(".system-configuration-row")
      .find((row) => row.text().includes("模型配置"));
    if (aiConfigRow === undefined) throw new Error("AI configuration row was not rendered");
    await aiConfigRow.get(".batman-button").trigger("click");
    await flushPromises();

    expect(wrapper.get(".batman-dialog").classes()).toContain("system-ai-modal");
    const firstModel = wrapper.get(".system-ai-model");
    const firstSummary = firstModel.get(".system-ai-model-summary-toggle");
    expect(firstSummary.attributes("aria-expanded")).toBe("true");
    await firstSummary.trigger("click");
    expect(firstSummary.attributes("aria-expanded")).toBe("false");
    expect(firstModel.find(".system-ai-grid").exists()).toBe(false);
    await firstSummary.trigger("click");

    const addModel = wrapper
      .findAll("button")
      .find((button) => button.text().includes("新增模型"));
    if (addModel === undefined) throw new Error("add model control was not rendered");
    await addModel.trigger("click");
    await flushPromises();

    const models = wrapper.findAll(".system-ai-model");
    expect(models).toHaveLength(2);
    expect(models[0]!.get(".system-ai-model-summary-toggle").attributes("aria-expanded")).toBe("false");
    expect(models[1]!.get(".system-ai-model-summary-toggle").attributes("aria-expanded")).toBe("true");
    const modelNameInput = models[1]!.get("input[aria-label='模型名称']");
    await modelNameInput.setValue("诊断助手");
    expect((modelNameInput.element as HTMLInputElement).value).toBe("诊断助手");
  });

  async function openAiModelDialog(wrapper: VueWrapper): Promise<VueWrapper> {
    const aiNav = wrapper
      .findAll(".system-configuration-nav-item")
      .find((button) => button.text().includes("AI 服务"));
    if (aiNav === undefined) throw new Error("AI section was not rendered");
    await aiNav.trigger("click");

    const aiConfigRow = wrapper
      .findAll(".system-configuration-row")
      .find((row) => row.text().includes("模型配置"));
    if (aiConfigRow === undefined) throw new Error("AI configuration row was not rendered");
    await aiConfigRow.get(".batman-button").trigger("click");
    await flushPromises();

    const modelCard = wrapper.get(".system-ai-model");
    const providerSelect = modelCard.get("select[aria-label='模型服务商 1']");
    await providerSelect.setValue("opencode_go");
    await providerSelect.trigger("change");
    return wrapper;
  }

  test("auto-fills baseUrl and model when OpenCode Go is selected", async () => {
    const wrapper = mount(SystemConfigurationView);
    await flushPromises();
    await openAiModelDialog(wrapper);

    const modelCard = wrapper.get(".system-ai-model");
    const baseUrlInput = modelCard.get("input[aria-label='模型 Base URL 1']");
    const modelInput = modelCard.get("input[aria-label='模型标识 1']");
    expect((baseUrlInput.element as HTMLInputElement).value).toBe("https://opencode.ai/zen/go/v1");
    expect((modelInput.element as HTMLInputElement).value).toBe("step-5-preview-free");
  });

  test("fetches the OpenCode Go model catalog and fills the model input from the list", async () => {
    mocks.listOpenCodeGoModels.mockResolvedValue({
      models: [{ id: "step-5-preview-free" }, { id: "opencode-gpt-5" }],
    });
    const wrapper = mount(SystemConfigurationView);
    await flushPromises();
    await openAiModelDialog(wrapper);

    const fetchButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("获取模型列表"));
    if (fetchButton === undefined) throw new Error("model catalog control was not rendered");
    await fetchButton.trigger("click");
    await flushPromises();

    expect(mocks.listOpenCodeGoModels).toHaveBeenCalledWith("test-token");
    const catalogItem = wrapper
      .findAll(".system-ai-catalog button")
      .find((button) => button.text() === "opencode-gpt-5");
    if (catalogItem === undefined) throw new Error("catalog item was not rendered");
    await catalogItem.trigger("click");
    await flushPromises();

    const modelInput = wrapper.get("input[aria-label='模型标识 1']");
    expect((modelInput.element as HTMLInputElement).value).toBe("opencode-gpt-5");
  });

  test("shows an inline error and keeps the model value when the catalog fetch fails", async () => {
    mocks.listOpenCodeGoModels.mockRejectedValue(new Error("upstream unavailable"));
    const wrapper = mount(SystemConfigurationView);
    await flushPromises();
    await openAiModelDialog(wrapper);

    const modelInput = wrapper.get("input[aria-label='模型标识 1']");
    await modelInput.setValue("keep-me");

    const fetchButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("获取模型列表"));
    if (fetchButton === undefined) throw new Error("model catalog control was not rendered");
    await fetchButton.trigger("click");
    await flushPromises();

    const error = wrapper.find(".system-ai-grid .system-configuration-feedback.error");
    expect(error.exists()).toBe(true);
    expect(error.text()).toContain("获取模型列表失败");
    expect(wrapper.findAll(".system-ai-catalog")).toHaveLength(0);
    expect((wrapper.get("input[aria-label='模型标识 1']").element as HTMLInputElement).value).toBe("keep-me");
  });
});
