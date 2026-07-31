import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AlertRule } from "@/api/client";
import AlertCenterView from "./AlertCenterView.vue";

const mocks = vi.hoisted(() => ({
  acceptAlertSuggestion: vi.fn(),
  deleteAlertRule: vi.fn(),
  evaluateAlerts: vi.fn(),
  getAlertSettings: vi.fn(),
  listAlertEvents: vi.fn(),
  listAlertRules: vi.fn(),
  listAlertSuggestions: vi.fn(),
  updateAlertEventStatus: vi.fn(),
  updateAlertSettings: vi.fn()
}));

vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    acceptAlertSuggestion: mocks.acceptAlertSuggestion,
    deleteAlertRule: mocks.deleteAlertRule,
    evaluateAlerts: mocks.evaluateAlerts,
    getAlertSettings: mocks.getAlertSettings,
    listAlertEvents: mocks.listAlertEvents,
    listAlertRules: mocks.listAlertRules,
    listAlertSuggestions: mocks.listAlertSuggestions,
    updateAlertEventStatus: mocks.updateAlertEventStatus,
    updateAlertSettings: mocks.updateAlertSettings
  }
}));

vi.mock("@/components/confirmation", () => ({
  requestConfirmation: vi.fn(),
}));

vi.mock("@/stores/session", () => ({
  useSession: () => ({ token: { value: "test-token" } })
}));

describe("AlertCenterView", () => {
  test("uses hint-based icons for table actions", async () => {
    const source = await import("./AlertCenterView.vue?raw");

    expect(source.default).toContain('data-hint="标为已读"');
    expect(source.default).toContain('data-hint="处理提醒"');
    expect(source.default).toContain('data-hint="删除规则"');
    expect(source.default).toContain('data-hint="启用建议"');
    expect(source.default).not.toContain('title="删除规则"');
  });

  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getAlertSettings.mockResolvedValue({
      systemMode: "suggest",
      defaultCooldownMinutes: 60,
      quietHours: null
    });
    mocks.listAlertEvents.mockResolvedValue({ items: [event()] });
    mocks.listAlertRules.mockResolvedValue({ items: [rule()] });
    mocks.listAlertSuggestions.mockResolvedValue({ items: [suggestion()] });
    mocks.updateAlertEventStatus.mockResolvedValue({ ...event(), status: "resolved" });
    mocks.evaluateAlerts.mockResolvedValue({ triggered: 1 });
    mocks.deleteAlertRule.mockResolvedValue({ deleted: true });
    mocks.acceptAlertSuggestion.mockResolvedValue({
      suggestion: { ...suggestion(), status: "accepted" },
      rule: rule({ source: "system" })
    });
    mocks.updateAlertSettings.mockResolvedValue({
      systemMode: "auto",
      defaultCooldownMinutes: 120,
      quietHours: null
    });
  });

  test("loads reminder events, rules, suggestions and handles primary actions", async () => {
    const wrapper = mount(AlertCenterView);
    await flushPromises();

    expect(wrapper.text()).toContain("沪深300ETF 价格提醒");
    expect(wrapper.text()).toContain("待处理建议");

    await wrapper.get('button[aria-label="处理提醒"]').trigger("click");
    await flushPromises();
    expect(mocks.updateAlertEventStatus).toHaveBeenCalledWith("test-token", {
      id: "event-1",
      status: "resolved"
    });

    await wrapper.get('button[aria-label="扫描提醒"]').trigger("click");
    await flushPromises();
    expect(mocks.evaluateAlerts).toHaveBeenCalledWith("test-token");

    await wrapper.get('button[aria-label="规则"]').trigger("click");
    expect(wrapper.find('form[aria-label="新建规则"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("创建规则");

    const { requestConfirmation } = await import("@/components/confirmation");
    vi.mocked(requestConfirmation).mockResolvedValue(true);
    await wrapper.get('button[aria-label="删除规则 价格规则"]').trigger("click");
    await flushPromises();
    expect(mocks.deleteAlertRule).toHaveBeenCalledWith("test-token", "rule-1");

    await wrapper.get('button[aria-label="系统建议"]').trigger("click");
    await wrapper.get('button[aria-label="启用建议"]').trigger("click");
    await flushPromises();
    expect(mocks.acceptAlertSuggestion).toHaveBeenCalledWith("test-token", "suggestion-1");

    await wrapper.get('button[aria-label="设置"]').trigger("click");
    await wrapper.get('select[aria-label="系统自主提醒"]').setValue("auto");
    await wrapper.get('input[aria-label="默认冷却分钟"]').setValue("120");
    await wrapper.get('form[aria-label="提醒设置"]').trigger("submit");
    await flushPromises();
    expect(mocks.updateAlertSettings).toHaveBeenCalledWith("test-token", {
      defaultCooldownMinutes: 120,
      quietHours: null,
      systemMode: "auto"
    });
  });
});

function rule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: "rule-1",
    name: "价格规则",
    kind: "price_threshold" as const,
    source: "manual" as const,
    severity: "warning" as const,
    instrumentId: "instrument-1",
    scopeType: "instrument" as const,
    condition: { direction: "above" as const, threshold: 1 },
    direction: "above" as const,
    threshold: 1,
    cooldownMinutes: 60,
    enabled: true,
    lastTriggeredAt: null,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    ...overrides
  };
}

function event() {
  return {
    id: "event-1",
    alertId: "rule-1",
    ruleId: "rule-1",
    instrumentId: "instrument-1",
    severity: "warning" as const,
    status: "unread" as const,
    title: "沪深300ETF 价格提醒",
    message: "最新价高于 1",
    price: 1.2,
    snapshot: {},
    triggeredAt: "2026-07-29T01:00:00.000Z",
    readAt: null,
    acknowledgedAt: null,
    resolvedAt: null,
    snoozedUntil: null,
    createdAt: "2026-07-29T01:00:00.000Z"
  };
}

function suggestion() {
  return {
    id: "suggestion-1",
    source: "trend" as const,
    instrumentId: "instrument-1",
    title: "趋势风险提醒",
    message: "关键价位需要观察",
    severity: "risk" as const,
    ruleKind: "price_threshold" as const,
    condition: { direction: "below" as const, threshold: 0.9 },
    cooldownMinutes: 240,
    status: "pending" as const,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    acceptedAt: null,
    ignoredAt: null
  };
}
