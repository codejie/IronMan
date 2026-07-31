import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import SystemConfigurationView from "./SystemConfigurationView.vue";

const mocks = vi.hoisted(() => ({
  getAlertSettings: vi.fn(),
  getDataSourceConfig: vi.fn(),
  marketOverview: vi.fn(),
  updateAlertSettings: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    getAlertSettings: mocks.getAlertSettings,
    getDataSourceConfig: mocks.getDataSourceConfig,
    marketOverview: mocks.marketOverview,
    updateAlertSettings: mocks.updateAlertSettings,
  },
}));

vi.mock("@/components/confirmation", () => ({
  requestConfirmation: vi.fn(),
}));

vi.mock("@/stores/session", () => ({
  useSession: () => ({
    currentUser: { value: { role: "user" } },
    token: { value: "test-token" },
  }),
}));

describe("SystemConfigurationView", () => {
  beforeEach(() => {
    mocks.getDataSourceConfig.mockReset();
    mocks.marketOverview.mockReset();
    mocks.getAlertSettings.mockReset();
    mocks.updateAlertSettings.mockReset();
    mocks.getDataSourceConfig.mockResolvedValue({ primary: "tencent", fallback: "mock" });
    mocks.marketOverview.mockResolvedValue({ instrumentCount: 0, cachedBarCount: 0, latestCacheAt: null });
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
});
