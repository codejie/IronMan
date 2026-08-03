import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import SystemConfigurationView from "./SystemConfigurationView.vue";

const mocks = vi.hoisted(() => ({
  getDataSourceConfig: vi.fn(),
  marketOverview: vi.fn(),
  getMarketSnapshotSettings: vi.fn(),
  updateMarketSnapshotSettings: vi.fn(),
  marketSnapshotStatus: vi.fn(),
  deleteMarketSnapshots: vi.fn(),
  getAlertSettings: vi.fn(),
  updateAlertSettings: vi.fn(),
  fundHistoryStatus: vi.fn(),
  recalculateFundHistory: vi.fn(),
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
    getAlertSettings: mocks.getAlertSettings,
    updateAlertSettings: mocks.updateAlertSettings,
    fundHistoryStatus: mocks.fundHistoryStatus,
    recalculateFundHistory: mocks.recalculateFundHistory,
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
    mocks.getAlertSettings.mockReset();
    mocks.updateAlertSettings.mockReset();
    mocks.fundHistoryStatus.mockReset();
    mocks.recalculateFundHistory.mockReset();
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
});
