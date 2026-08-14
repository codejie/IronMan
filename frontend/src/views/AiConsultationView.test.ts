import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import AiConsultationView from "./AiConsultationView.vue";

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  getAiConfig: vi.fn(),
  createAssistantConversation: vi.fn(),
  deleteAssistantConversation: vi.fn(),
  listAssistantConversations: vi.fn(),
  getAssistantConversation: vi.fn(),
  push: vi.fn()
}));

vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    chat: mocks.chat,
    getAiConfig: mocks.getAiConfig,
    createAssistantConversation: mocks.createAssistantConversation,
    deleteAssistantConversation: mocks.deleteAssistantConversation,
    listAssistantConversations: mocks.listAssistantConversations,
    getAssistantConversation: mocks.getAssistantConversation
  }
}));

const confirmation = vi.hoisted(() => ({ requestConfirmation: vi.fn() }));

vi.mock("@/components/confirmation", () => ({ requestConfirmation: confirmation.requestConfirmation }));

vi.mock("@/stores/session", () => ({
  useSession: () => ({ token: { value: "test-token" } })
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: mocks.push })
}));

describe("AiConsultationView", () => {
  beforeEach(() => {
    mocks.chat.mockReset();
    mocks.getAiConfig.mockReset();
    mocks.createAssistantConversation.mockReset();
    mocks.deleteAssistantConversation.mockReset();
    mocks.listAssistantConversations.mockReset();
    mocks.getAssistantConversation.mockReset();
    mocks.push.mockReset();
    mocks.getAiConfig.mockResolvedValue({
      models: [{ id: "local", name: "本地工作台助手", provider: "local", enabled: true, default: true, apiKeyConfigured: false }]
    });
    confirmation.requestConfirmation.mockReset();
    confirmation.requestConfirmation.mockResolvedValue(true);
    mocks.listAssistantConversations.mockResolvedValue({ items: [] });
    mocks.createAssistantConversation.mockResolvedValue({
      id: "conversation-1",
      title: "新对话",
      lastMessagePreview: null,
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z",
      messages: []
    });
  });

  test("sends the selected model with automatic chart preference and renders returned chart cards", async () => {
    mocks.chat.mockResolvedValue({
      provider: "local",
      modelId: "local",
      modelName: "本地工作台助手",
      content: "## 趋势结论\n\n- **关注** 均线与 MACD\n\n| 指标 | 数值 |\n| --- | --- |\n| MA20 | 10.20 |",
      fallbackReason: undefined,
      tools: [{ id: "tool-1", name: "build_chart", status: "completed", summary: "已生成 K 线与指标图表" }],
      charts: [{ id: "chart-1", title: "浦发银行 600000 · 日线", instrument: { id: "instrument-1", code: "600000", exchange: "sh", name: "浦发银行", assetType: "stock" }, source: "mock", bars: [], indicators: [] }],
      conversation: { id: "conversation-1", title: "展示 600000 的 K线", lastMessagePreview: "第二轮", createdAt: "2026-07-27T00:00:00.000Z", updatedAt: "2026-07-27T00:01:00.000Z" },
      userMessage: { id: "user-1", role: "user", content: "展示 600000 的 K线", createdAt: "2026-07-27T00:00:00.000Z" },
      assistantMessage: {
        id: "assistant-1",
        role: "assistant",
        content: "## 趋势结论\n\n- **关注** 均线与 MACD\n\n| 指标 | 数值 |\n| --- | --- |\n| MA20 | 10.20 |",
        result: {
          provider: "local",
          modelId: "local",
          modelName: "本地工作台助手",
          fallbackReason: undefined,
          tools: [{ id: "tool-1", name: "build_chart", status: "completed", summary: "已生成 K 线与指标图表" }],
          charts: [{ id: "chart-1", title: "浦发银行 600000 · 日线", instrument: { id: "instrument-1", code: "600000", exchange: "sh", name: "浦发银行", assetType: "stock" }, source: "mock", bars: [], indicators: [] }]
        },
        createdAt: "2026-07-27T00:01:00.000Z"
      }
    });
    const wrapper = mount(AiConsultationView, {
      global: { stubs: { AssistantChartCard: { props: ["chart"], template: "<div class='chart-card-stub'>{{ chart.title }}</div>" } } }
    });
    await flushPromises();

    await wrapper.get("textarea").setValue("展示 600000 的 K线");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(mocks.chat).toHaveBeenCalledWith("test-token", "展示 600000 的 K线", { modelId: "local", autoChart: true, conversationId: "conversation-1" });
    expect(wrapper.get(".markdown-preview h2").text()).toBe("趋势结论");
    expect(wrapper.get(".markdown-preview table").text()).toContain("MA20");
    expect(wrapper.text()).toContain("浦发银行 600000 · 日线");
    expect(wrapper.text()).toContain("本地工具 1 项");
  });

  test("keeps automatic charts enabled without exposing composer controls", async () => {
    const wrapper = mount(AiConsultationView);
    await flushPromises();

    const composer = wrapper.get(".ai-composer");
    const controls = composer.get(".ai-composer-controls");
    const controlChildren = controls.element.children;

    expect(composer.find("input[type='checkbox']").exists()).toBe(false);
    expect(composer.text()).not.toContain("自动附带图表");
    expect(composer.text()).not.toContain("Ollama");
    expect(controlChildren[0]?.tagName).toBe("TEXTAREA");
    expect(controlChildren[1]?.classList.contains("ai-send-button")).toBe(true);
  });

  test("uses a quick prompt without immediately sending it", async () => {
    const wrapper = mount(AiConsultationView);
    await flushPromises();

    await wrapper.get(".ai-quick-prompt").trigger("click");

    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toContain("当前持仓");
    expect(mocks.chat).not.toHaveBeenCalled();
  });

  test("keeps quick prompts in a fixed bottom region below the scrollable conversation list", async () => {
    mocks.listAssistantConversations.mockResolvedValue({
      items: [
        { id: "conversation-1", title: "最新会话", lastMessagePreview: "最新内容", createdAt: "2026-07-27T00:00:00.000Z", updatedAt: "2026-07-27T00:02:00.000Z" },
        { id: "conversation-2", title: "较早会话", lastMessagePreview: "较早内容", createdAt: "2026-07-27T00:00:00.000Z", updatedAt: "2026-07-27T00:01:00.000Z" }
      ]
    });
    mocks.getAssistantConversation.mockImplementation(async (_token: string, id: string) => ({
      id,
      title: id === "conversation-1" ? "最新会话" : "较早会话",
      lastMessagePreview: id === "conversation-1" ? "最新内容" : "较早内容",
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: id === "conversation-1" ? "2026-07-27T00:02:00.000Z" : "2026-07-27T00:01:00.000Z",
      messages: []
    }));
    const wrapper = mount(AiConsultationView);
    await flushPromises();

    const panel = wrapper.get(".ai-prompt-panel");
    const sections = Array.from(panel.element.children);
    const conversationList = panel.get(".ai-conversation-list").element;
    const quickPromptPanel = panel.get(".ai-quick-prompts").element;
    const rows = panel.findAll(".ai-conversation-item");

    expect(sections.indexOf(conversationList)).toBeLessThan(sections.indexOf(quickPromptPanel));
    expect(rows).toHaveLength(2);
    expect(quickPromptPanel.querySelector(".ai-quick-prompt-heading")).not.toBeNull();
    expect(quickPromptPanel.querySelectorAll(".ai-quick-prompt")).toHaveLength(4);
    expect(quickPromptPanel.querySelector(".ai-capability-note")).not.toBeNull();
  });

  test("uses the archive-style selected state without conversation hover styling", async () => {
    const source = await import("./AiConsultationView.vue?raw");

    expect(source.default).toMatch(/\.ai-conversation-item\.active\s*\{[^}]*background:\s*#172b41;[^}]*box-shadow:\s*inset 3px 0 #57cfc6;/s);
    expect(source.default).toMatch(/\.ai-conversation-item\s*\{[^}]*border-radius:\s*0;/s);
    expect(source.default).toMatch(/\/\*\s*\.ai-conversation-item:hover/);
    expect(source.default).toMatch(/\/\*\s*\.ai-conversation-delete:hover/);
  });

  test("uses the Trend Analysis shell baseline for the conversation workspace", async () => {
    const source = await import("./AiConsultationView.vue?raw");

    expect(source.default).toMatch(/\.ai-consultation-header\s*\{[^}]*border-bottom:\s*1px solid #26384f;[^}]*padding:\s*2px 0 14px;/s);
    expect(source.default).toMatch(/\.ai-consultation-layout\s*\{[^}]*grid-template-columns:\s*260px minmax\(0, 1fr\);[^}]*\}/s);
    expect(source.default).toMatch(/\.ai-prompt-panel\s*\{[^}]*background:\s*#0d1727;[^}]*border-right:\s*1px solid #293d56;/s);
  });

  test("uses a compact left-panel command for a new conversation", async () => {
    const wrapper = mount(AiConsultationView);
    await flushPromises();

    expect(wrapper.text()).not.toContain("使用本地行情、指标与账户数据完成可核验的分析。");
    expect(wrapper.get(".ai-conversation-heading .ai-new-chat").text()).toContain("新建");
    expect(wrapper.find(".ai-model-control .ai-new-chat").exists()).toBe(false);
    expect(wrapper.find(".ai-model-control button[title='模型配置']").exists()).toBe(false);
  });

  test("keeps messages in a dedicated scroll region separate from the composer", async () => {
    const wrapper = mount(AiConsultationView);
    await flushPromises();

    const chatPanel = wrapper.get(".ai-chat-panel");
    expect(chatPanel.get("[data-scroll-region='messages']").attributes("aria-label")).toBe("AI 对话消息");
    expect(chatPanel.find("[data-scroll-region='messages'] .ai-composer").exists()).toBe(false);
    expect(chatPanel.find(".ai-composer").exists()).toBe(true);
  });

  test("keeps the conversation list ordered by updated time when selecting an older conversation", async () => {
    mocks.listAssistantConversations.mockResolvedValue({
      items: [
        { id: "recent", title: "最新会话", lastMessagePreview: "最新内容", createdAt: "2026-07-27T00:00:00.000Z", updatedAt: "2026-07-27T00:03:00.000Z" },
        { id: "older", title: "较早会话", lastMessagePreview: "较早内容", createdAt: "2026-07-27T00:00:00.000Z", updatedAt: "2026-07-27T00:01:00.000Z" }
      ]
    });
    mocks.getAssistantConversation.mockImplementation(async (_token: string, id: string) => ({
      id,
      title: id === "recent" ? "最新会话" : "较早会话",
      lastMessagePreview: id === "recent" ? "最新内容" : "较早内容",
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: id === "recent" ? "2026-07-27T00:03:00.000Z" : "2026-07-27T00:01:00.000Z",
      messages: []
    }));

    const wrapper = mount(AiConsultationView);
    await flushPromises();

    const titles = () => wrapper.findAll(".ai-conversation-item strong").map((item) => item.text());
    expect(titles()).toEqual(["最新会话", "较早会话"]);

    await wrapper.findAll(".ai-conversation-select")[1]!.trigger("click");
    await flushPromises();

    expect(titles()).toEqual(["最新会话", "较早会话"]);
  });

  test("deletes the active conversation after confirmation and opens the next conversation", async () => {
    mocks.listAssistantConversations.mockResolvedValue({
      items: [
        { id: "conversation-1", title: "持仓风险", lastMessagePreview: "第一条", createdAt: "2026-07-27T00:00:00.000Z", updatedAt: "2026-07-27T00:02:00.000Z" },
        { id: "conversation-2", title: "自选机会", lastMessagePreview: "第二条", createdAt: "2026-07-27T00:00:00.000Z", updatedAt: "2026-07-27T00:01:00.000Z" }
      ]
    });
    mocks.getAssistantConversation.mockImplementation(async (_token: string, id: string) => ({
      id,
      title: id === "conversation-1" ? "持仓风险" : "自选机会",
      lastMessagePreview: id === "conversation-1" ? "第一条" : "第二条",
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:02:00.000Z",
      messages: [{ id: `${id}-message`, role: "user", content: id === "conversation-1" ? "第一条" : "第二条", createdAt: "2026-07-27T00:00:00.000Z" }]
    }));
    mocks.deleteAssistantConversation.mockResolvedValue({ deleted: true });

    const wrapper = mount(AiConsultationView);
    await flushPromises();
    await wrapper.get("[data-conversation-delete='conversation-1']").trigger("click");
    await flushPromises();

    expect(confirmation.requestConfirmation).toHaveBeenCalledWith(expect.objectContaining({ title: "删除会话", tone: "danger" }));
    expect(mocks.deleteAssistantConversation).toHaveBeenCalledWith("test-token", "conversation-1");
    expect(wrapper.get(".ai-conversation-list").text()).not.toContain("持仓风险");
    expect(wrapper.get(".ai-message-list").text()).toContain("第二条");
  });

  test("loads a saved conversation and clears the visible context for a new chat", async () => {
    mocks.listAssistantConversations.mockResolvedValue({
      items: [{ id: "saved-1", title: "持仓风险", lastMessagePreview: "请继续分析", createdAt: "2026-07-26T00:00:00.000Z", updatedAt: "2026-07-27T00:00:00.000Z" }]
    });
    mocks.getAssistantConversation.mockResolvedValue({
      id: "saved-1",
      title: "持仓风险",
      lastMessagePreview: "请继续分析",
      createdAt: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z",
      messages: [{ id: "saved-message", role: "user", content: "请继续分析", createdAt: "2026-07-27T00:00:00.000Z" }]
    });
    mocks.createAssistantConversation.mockResolvedValue({
      id: "fresh-1",
      title: "新对话",
      lastMessagePreview: null,
      createdAt: "2026-07-27T00:01:00.000Z",
      updatedAt: "2026-07-27T00:01:00.000Z",
      messages: []
    });

    const wrapper = mount(AiConsultationView);
    await flushPromises();
    expect(wrapper.text()).toContain("请继续分析");

    await wrapper.get(".ai-new-chat").trigger("click");
    await flushPromises();

    expect(mocks.createAssistantConversation).toHaveBeenCalledTimes(1);
    expect(wrapper.get(".ai-message-list").text()).not.toContain("请继续分析");
    expect(wrapper.get(".ai-message-list").text()).toContain("从一个分析问题开始");
  });
});
