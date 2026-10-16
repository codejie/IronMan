<script setup lang="ts">
import { Bot, ChartNoAxesCombined, ChevronRight, LoaderCircle, MessageSquareText, Plus, Send, Sparkles, Trash2, Wrench } from "lucide-vue-next";
import { computed, nextTick, onMounted, ref } from "vue";
import {
  api,
  ApiError,
  type AiModelConfig,
  type AssistantConversationMessage,
  type AssistantConversationSummary,
  type AssistantReplyMetadata
} from "@/api/client";
import AssistantChartCard from "@/components/AssistantChartCard.vue";
import { requestConfirmation } from "@/components/confirmation";
import MarkdownPreview from "@/components/MarkdownPreview.vue";
import { useSession } from "@/stores/session";

type ConsultationMessage = AssistantConversationMessage;

const { token } = useSession();
const models = ref<AiModelConfig[]>([]);
const selectedModelId = ref("");
const messages = ref<ConsultationMessage[]>([]);
const conversations = ref<AssistantConversationSummary[]>([]);
const activeConversationId = ref("");
const prompt = ref("");
const autoChart = ref(true);
const isLoading = ref(false);
const isConversationLoading = ref(false);
const deletingConversationId = ref<string | null>(null);
const errorMessage = ref("");
const messageList = ref<HTMLElement>();
let conversationRequest = 0;

const selectedModel = computed(() => models.value.find((model) => model.id === selectedModelId.value) ?? null);
const enabledModels = computed(() => models.value.filter((model) => model.enabled));
const quickPrompts = [
  { label: "我的资产概览", text: "请总结我的当前持仓、自选和可用资金，并提示需要优先关注的风险。" },
  { label: "持仓风险检查", text: "请检查我的当前持仓，按风险优先级给出需要观察的条件和仓位纪律建议。" },
  { label: "自选机会梳理", text: "请梳理我的自选标的，说明我可以继续跟踪的趋势和风险信号。" },
  { label: "K线技术分析", text: "请展示 600000 的 K线、MA 和 MACD，并说明趋势、关键观察位与风险条件。" }
];

onMounted(() => void initialize());

async function initialize(): Promise<void> {
  await Promise.all([loadModels(), loadConversations()]);
}

async function loadModels(): Promise<void> {
  if (token.value === null) return;
  try {
    const result = await api.getAiConfig(token.value);
    models.value = result.models;
    const preferred = result.models.find((model) => model.enabled && model.default) ?? result.models.find((model) => model.enabled);
    selectedModelId.value = preferred?.id ?? "";
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "AI 模型配置加载失败";
  }
}

async function loadConversations(): Promise<void> {
  if (token.value === null) return;
  try {
    const result = await api.listAssistantConversations(token.value);
    conversations.value = result.items;
    if (result.items[0] === undefined) {
      await newChat();
      return;
    }
    await selectConversation(result.items[0].id);
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "AI 会话加载失败";
  }
}

async function newChat(): Promise<void> {
  if (token.value === null || isLoading.value || isConversationLoading.value) return;
  isConversationLoading.value = true;
  errorMessage.value = "";
  try {
    const conversation = await api.createAssistantConversation(token.value);
    activeConversationId.value = conversation.id;
    messages.value = [];
    prompt.value = "";
    upsertConversation(conversation);
    await scrollToLatest();
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "新建 AI 对话失败";
  } finally {
    isConversationLoading.value = false;
  }
}

async function selectConversation(id: string): Promise<void> {
  if (token.value === null || id === activeConversationId.value || isLoading.value || isConversationLoading.value) return;
  const request = ++conversationRequest;
  isConversationLoading.value = true;
  errorMessage.value = "";
  try {
    const conversation = await api.getAssistantConversation(token.value, id);
    if (request !== conversationRequest) return;
    activeConversationId.value = conversation.id;
    messages.value = conversation.messages;
    upsertConversation(conversation);
    await scrollToLatest();
  } catch (error) {
    if (request === conversationRequest) errorMessage.value = error instanceof ApiError ? error.message : "AI 会话读取失败";
  } finally {
    if (request === conversationRequest) isConversationLoading.value = false;
  }
}

async function deleteConversation(conversation: AssistantConversationSummary): Promise<void> {
  if (token.value === null || isLoading.value || isConversationLoading.value || deletingConversationId.value !== null) return;
  const confirmed = await requestConfirmation({
    title: "删除会话",
    message: `删除“${conversation.title}”及其中全部消息后不可恢复。确定删除吗？`,
    confirmLabel: "删除",
    tone: "danger"
  });
  if (!confirmed) return;

  deletingConversationId.value = conversation.id;
  errorMessage.value = "";
  try {
    await api.deleteAssistantConversation(token.value, conversation.id);
    const wasActive = activeConversationId.value === conversation.id;
    conversations.value = conversations.value.filter((item) => item.id !== conversation.id);
    if (!wasActive) return;

    activeConversationId.value = "";
    messages.value = [];
    const next = conversations.value[0];
    if (next === undefined) await newChat();
    else await selectConversation(next.id);
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "删除 AI 会话失败";
  } finally {
    deletingConversationId.value = null;
  }
}

function upsertConversation(conversation: AssistantConversationSummary): void {
  conversations.value = [...conversations.value.filter((item) => item.id !== conversation.id), conversation]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
}

function useQuickPrompt(text: string): void {
  prompt.value = text;
}

async function sendMessage(): Promise<void> {
  const message = prompt.value.trim();
  if (token.value === null || !message || isLoading.value) return;
  if (selectedModelId.value === "") {
    errorMessage.value = "请先在系统配置中启用 AI 模型";
    return;
  }
  if (activeConversationId.value === "") {
    await newChat();
    if (activeConversationId.value === "") return;
  }
  const userMessage: ConsultationMessage = { id: crypto.randomUUID(), role: "user", content: message, createdAt: new Date().toISOString() };
  messages.value.push(userMessage);
  prompt.value = "";
  isLoading.value = true;
  errorMessage.value = "";
  await scrollToLatest();
  try {
    const result = await api.chat(token.value, message, {
      modelId: selectedModelId.value,
      autoChart: autoChart.value,
      conversationId: activeConversationId.value
    });
    const userMessageIndex = messages.value.findIndex((item) => item.id === userMessage.id);
    if (userMessageIndex >= 0) messages.value.splice(userMessageIndex, 1, result.userMessage);
    messages.value.push(result.assistantMessage);
    activeConversationId.value = result.conversation.id;
    upsertConversation(result.conversation);
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "AI 咨询请求失败，请稍后重试";
  } finally {
    isLoading.value = false;
    await scrollToLatest();
  }
}

function handlePromptKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void sendMessage();
  }
}

async function scrollToLatest(): Promise<void> {
  await nextTick();
  const container = messageList.value;
  if (container === undefined || typeof container.scrollTo !== "function") return;
  container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
}

function providerLabel(model: AiModelConfig | null): string {
  if (model === null) return "未选择";
  return model.provider === "local" ? "本地工具" : model.provider === "ollama" ? "Ollama" : model.provider === "deepseek" ? "DeepSeek" : model.provider === "opencode_go" ? "OpenCode Go" : "OpenAI 兼容";
}

function toolLabel(name: AssistantReplyMetadata["tools"][number]["name"]): string {
  const labels: Record<AssistantReplyMetadata["tools"][number]["name"], string> = {
    resolve_instrument: "标的检索",
    get_account_overview: "账户概览",
    get_watchlist: "自选列表",
    get_market_snapshot: "最新行情",
    get_market_history: "历史行情",
    get_technical_indicators: "技术指标",
    get_technical_ranking: "外部技术榜单",
    get_market_information_links: "外部资讯入口",
    get_market_cloud: "大盘云图",
    calculate_trend: "趋势计算与拐点",
    build_chart: "图表生成"
  };
  return labels[name];
}

</script>

<template>
  <section class="ai-consultation batman-workspace">
    <header class="ai-consultation-header">
      <div>
        <h2>AI咨询</h2>
      </div>
      <div class="ai-model-control">
        <label for="ai-model">模型</label>
        <select id="ai-model" v-model="selectedModelId" :disabled="isLoading || isConversationLoading || enabledModels.length === 0">
          <option v-for="model in enabledModels" :key="model.id" :value="model.id">{{ model.name }} · {{ providerLabel(model) }}</option>
        </select>
      </div>
    </header>

    <div class="ai-consultation-layout">
      <aside class="ai-prompt-panel">
        <div class="ai-prompt-panel-heading ai-conversation-heading">
          <span class="ai-conversation-title"><MessageSquareText :size="17" /><strong>会话</strong></span>
          <button class="batman-button ai-new-chat" :disabled="isLoading || isConversationLoading" type="button" @click="newChat"><Plus :size="13" />新建</button>
        </div>
        <div class="ai-conversation-list" aria-label="AI 会话列表">
          <article
            v-for="conversation in conversations"
            :key="conversation.id"
            :class="['ai-conversation-item', { active: conversation.id === activeConversationId }]"
          >
            <button
              class="ai-conversation-select"
              :disabled="isLoading || isConversationLoading || deletingConversationId !== null"
              type="button"
              @click="selectConversation(conversation.id)"
            >
              <strong>{{ conversation.title }}</strong>
              <span>{{ conversation.lastMessagePreview ?? "等待提问" }}</span>
            </button>
            <button
              :aria-label="`删除会话 ${conversation.title}`"
              :data-conversation-delete="conversation.id"
              :disabled="isLoading || isConversationLoading || deletingConversationId !== null"
              class="ai-conversation-delete"
              title="删除会话"
              type="button"
              @click="deleteConversation(conversation)"
            ><Trash2 :size="14" /></button>
          </article>
        </div>
        <div class="ai-quick-prompts">
          <div class="ai-prompt-panel-heading ai-quick-prompt-heading"><Sparkles :size="17" /><strong>常用问题</strong></div>
          <button v-for="item in quickPrompts" :key="item.label" class="ai-quick-prompt" :disabled="isLoading || isConversationLoading" type="button" @click="useQuickPrompt(item.text)">
            <span>{{ item.label }}</span><ChevronRight :size="15" />
          </button>
          <div class="ai-capability-note">
            <ChartNoAxesCombined :size="16" />
            <p>标的走势、K线和 MA、MACD、RSI、BOLL 由本地数据服务计算与绘制。</p>
          </div>
        </div>
      </aside>

      <main class="ai-chat-panel">
        <div ref="messageList" class="ai-message-list" aria-label="AI 对话消息" aria-live="polite" data-scroll-region="messages">
          <div v-if="isConversationLoading" class="ai-empty-state">
            <LoaderCircle :size="24" class="spinning" />
            <strong>正在读取对话</strong>
          </div>
          <div v-else-if="messages.length === 0" class="ai-empty-state">
            <Bot :size="28" />
            <strong>从一个分析问题开始</strong>
            <span>可询问持仓风险、自选标的，或直接输入代码查看 K线与技术指标。</span>
          </div>
          <article v-for="item in messages" :key="item.id" :class="['ai-message', item.role]">
            <div class="ai-message-avatar"><Bot v-if="item.role === 'assistant'" :size="16" /><span v-else>我</span></div>
            <div class="ai-message-body">
              <div v-if="item.role === 'assistant'" class="ai-message-meta">
                <strong>{{ item.result?.modelName ?? "IronMan 助手" }}</strong>
                <span>{{ providerLabel(item.result ? { id: item.result.modelId, name: item.result.modelName, provider: item.result.provider, enabled: true, default: false } : null) }}</span>
              </div>
              <MarkdownPreview v-if="item.role === 'assistant'" :content="item.content" compact />
              <template v-else>
                <p v-for="(line, index) in item.content.split('\n')" :key="index">{{ line || " " }}</p>
              </template>
              <p v-if="item.result?.fallbackReason" class="ai-fallback-notice">远程模型暂不可用，已使用本地工作台数据完成回应。</p>
              <details v-if="item.result && item.result.tools.length > 0" class="ai-tool-log">
                <summary><Wrench :size="14" />本地工具 {{ item.result.tools.length }} 项</summary>
                <ul>
                  <li v-for="tool in item.result.tools" :key="tool.id" :class="tool.status">
                    <strong>{{ toolLabel(tool.name) }}</strong><span>{{ tool.summary }}</span>
                  </li>
                </ul>
              </details>
              <AssistantChartCard v-for="chart in item.result?.charts ?? []" :key="chart.id" :chart="chart" />
            </div>
          </article>
          <div v-if="isLoading" class="ai-message assistant ai-loading-message">
            <div class="ai-message-avatar"><Bot :size="16" /></div>
            <div class="ai-message-body"><LoaderCircle :size="16" class="spinning" /><span>正在读取本地数据并生成分析…</span></div>
          </div>
        </div>
        <p v-if="errorMessage" class="batman-error">{{ errorMessage }}</p>
        <form class="ai-composer" @submit.prevent="sendMessage">
          <div class="ai-composer-controls">
            <textarea v-model="prompt" :disabled="isLoading" placeholder="例如：分析 600000 的 K线与 MACD，列出关键观察位和风险条件" rows="3" @keydown="handlePromptKeydown" />
            <button :disabled="isLoading || !prompt.trim() || selectedModelId === ''" class="batman-button primary ai-send-button" type="submit">
              <LoaderCircle v-if="isLoading" :size="15" class="spinning" /><Send v-else :size="15" />发送
            </button>
          </div>
        </form>
      </main>
    </div>
  </section>
</template>

<style scoped>
.ai-consultation { display: flex; flex-direction: column; height: calc(100dvh - 56px); max-height: calc(100dvh - 56px); min-height: 0; }
.ai-consultation-header { align-items: center; display: flex; flex: 0 0 auto; gap: 18px; justify-content: space-between; margin: 0 0 14px; }
.ai-consultation-header h2 { color: #eff8ff; font-size: 22px; margin: 0; }
.ai-model-control { align-items: center; display: flex; gap: 7px; }
.ai-model-control label { color: #9bb0c5; font-size: 12px; }
.ai-model-control select, .ai-model-control option { background: #15243a; color: #e7f3ff; font-size: 13px; font-weight: 500; }
.ai-model-control select { border: 1px solid #3a536f; border-radius: 5px; min-height: 30px; min-width: 174px; padding: 0 8px; }

.ai-consultation-layout { display: grid; flex: 1 1 auto; gap: 14px; grid-template-columns: 220px minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); min-height: 0; }
.ai-prompt-panel, .ai-chat-panel { background: #101a2a; border: 1px solid #2c4059; border-radius: 8px; min-height: 0; }
.ai-prompt-panel { display: flex; flex-direction: column; gap: 6px; overflow: hidden; padding: 12px; }
.ai-prompt-panel-heading { align-items: center; border-bottom: 1px solid #273a52; color: #dcf8f5; display: flex; font-size: 13px; gap: 7px; margin-bottom: 3px; padding: 2px 2px 11px; }
.ai-prompt-panel-heading svg { color: #6cdbcf; }
.ai-conversation-heading { justify-content: space-between; }
.ai-conversation-title { align-items: center; display: inline-flex; gap: 7px; }
.ai-new-chat { font-size: 12px; min-height: 27px; padding: 0 7px; }
.ai-conversation-list { display: grid; flex: 1 1 auto; gap: 0; grid-auto-rows: 56px; min-height: 0; overflow-y: auto; padding-right: 2px; }
.ai-conversation-item { align-items: stretch; background: transparent; border: 1px solid transparent; border-radius: 0; box-sizing: border-box; color: #b6c7d8; display: grid; gap: 6px; grid-template-columns: minmax(0, 1fr) 24px; height: 56px; min-height: 56px; min-width: 0; padding: 6px 8px; }
.ai-conversation-item:not(:last-child) { border-bottom-color: #273a52; }
/* .ai-conversation-item:hover { background: #182a42; border-color: #355270; color: #eaf8ff; } */
.ai-conversation-item:not(.active):focus-within { background: #182a42; border-color: #355270; color: #eaf8ff; }
.ai-conversation-item.active { background: #172b41; box-shadow: inset 3px 0 #57cfc6; color: #eaf8ff; }
.ai-conversation-select { background: transparent; border: 0; color: inherit; display: grid; gap: 6px; min-width: 0; padding: 4px 4px; text-align: left; }
.ai-conversation-item strong, .ai-conversation-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-conversation-item strong { color: inherit; font-size: 12px; font-weight: 650; }
.ai-conversation-item span { color: #839bb2; font-size: 11px; }
.ai-conversation-delete { align-items: center; align-self: center; background: transparent; border: 0; border-radius: 4px; color: #8099b1; display: inline-flex; height: 24px; justify-content: center; opacity: 0; padding: 0; transition: color 140ms ease, opacity 140ms ease; width: 24px; }
/* .ai-conversation-item:hover .ai-conversation-delete { opacity: 1; } */
.ai-conversation-item:focus-within .ai-conversation-delete, .ai-conversation-item.active .ai-conversation-delete { opacity: 1; }
/* .ai-conversation-delete:hover:not(:disabled) { background: #352536; color: #ff9ba1; } */
.ai-quick-prompts { flex: 0 0 auto; }
.ai-quick-prompt-heading { margin-top: 7px; }
.ai-quick-prompt { align-items: center; background: transparent; border: 1px solid transparent; border-radius: 5px; color: #b6c7d8; display: flex; font-size: 12px; justify-content: space-between; min-height: 37px; padding: 0 8px; text-align: left; }
.ai-quick-prompt:hover:not(:disabled) { background: #182a42; border-color: #355270; color: #eaf8ff; }
.ai-capability-note { border-top: 1px solid #273a52; color: #8499b1; display: grid; font-size: 11px; gap: 6px; margin-top: auto; padding: 12px 3px 2px; }
.ai-capability-note svg { color: #67d7cc; }
.ai-capability-note p { line-height: 1.55; margin: 0; }

.ai-chat-panel { display: flex; flex-direction: column; overflow: hidden; }
.ai-message-list { display: flex; flex: 1 1 auto; flex-direction: column; gap: 14px; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 16px; }
.ai-empty-state { align-items: center; color: #96abc0; display: flex; flex: 1; flex-direction: column; gap: 10px; justify-content: center; text-align: center; }
.ai-empty-state svg { color: #65d7ca; }
.ai-empty-state strong { color: #e6f5ff; font-size: 15px; }
.ai-empty-state span { font-size: 12px; max-width: 400px; }
.ai-message { display: flex; gap: 9px; max-width: min(940px, 92%); }
.ai-message.user { align-self: flex-end; flex-direction: row-reverse; }
.ai-message-avatar { align-items: center; background: #1e3b51; border: 1px solid #3d627b; border-radius: 50%; color: #8ee5dc; display: inline-flex; flex: 0 0 auto; height: 29px; justify-content: center; width: 29px; }
.ai-message.user .ai-message-avatar { background: #2d696d; border-color: #66cfc4; color: #f3ffff; font-size: 12px; font-weight: 700; }
.ai-message-body { background: #152236; border: 1px solid #314963; border-radius: 7px; color: #d7e4ef; font-size: 13px; line-height: 1.65; min-width: 0; padding: 9px 11px; }
.ai-message.user .ai-message-body { background: #1d4855; border-color: #428780; color: #f0ffff; }
.ai-message-body p { margin: 0; white-space: pre-wrap; }
.ai-message-body p + p { margin-top: 5px; }
.ai-message-meta { align-items: center; color: #8eabc2; display: flex; font-size: 11px; gap: 7px; margin-bottom: 5px; }
.ai-message-meta strong { color: #78dcd1; }
.ai-fallback-notice { color: #e4c273; font-size: 11px; margin-top: 7px !important; }
.ai-loading-message .ai-message-body { align-items: center; color: #99b7c9; display: flex; gap: 7px; }
.ai-tool-log { border-top: 1px solid #2a4058; color: #9fb6c9; font-size: 11px; margin-top: 8px; padding-top: 7px; }
.ai-tool-log summary { align-items: center; cursor: pointer; display: flex; gap: 5px; }
.ai-tool-log ul { display: grid; gap: 4px; list-style: none; margin: 7px 0 0; padding: 0; }
.ai-tool-log li { align-items: baseline; display: flex; gap: 7px; }
.ai-tool-log li strong { color: #74d8cb; font-weight: 650; }
.ai-tool-log li.failed strong { color: #ff989e; }
.ai-tool-log li span { color: #8ea7bc; }
.ai-chat-panel > .batman-error { flex: 0 0 auto; margin: 0 14px 8px; }
.ai-composer { border-top: 1px solid #2b4059; flex: 0 0 auto; padding: 9px 12px 10px; }
.ai-composer-controls { align-items: stretch; display: flex; gap: 8px; }
.ai-composer textarea { background: #0e1828; border: 1px solid #354f6c; border-radius: 6px; color: #eaf5ff; flex: 1 1 auto; min-height: 68px; min-width: 0; padding: 9px 10px; resize: vertical; width: 100%; }
.ai-composer textarea:focus { border-color: #65d7ca; outline: 1px solid #65d7ca; }
.ai-send-button { flex: 0 0 78px; padding: 0 8px; }

/* Match the Trend Analysis shell and keep the conversation rail compact. */
.ai-consultation { max-width: none; }
.ai-consultation-header { border-bottom: 1px solid #26384f; margin-bottom: 14px; padding: 2px 0 14px; }
.ai-consultation-layout { background: #101a2a; border: 1px solid #2d4059; border-radius: 7px; gap: 0; grid-template-columns: 190px minmax(0, 1fr); overflow: hidden; }
.ai-prompt-panel { background: #0d1727; border: 0; border-right: 1px solid #293d56; border-radius: 0; }
.ai-chat-panel { background: transparent; border: 0; border-radius: 0; }

@media (max-width: 960px) {
  .ai-consultation-layout { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }
  .ai-prompt-panel { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ai-prompt-panel-heading, .ai-conversation-list, .ai-quick-prompts { grid-column: 1 / -1; }
  .ai-capability-note { margin-top: 4px; }
  .ai-consultation-header { align-items: stretch; flex-direction: column; }
  .ai-model-control { justify-content: flex-end; }
  .ai-prompt-panel { border-bottom: 1px solid #293d56; border-right: 0; }
}
.ai-consultation-layout { grid-template-columns: 260px minmax(0, 1fr); }
@media (max-width: 1080px) { .ai-consultation-layout { grid-template-columns: 238px minmax(0, 1fr); } }
@media (max-width: 840px) { .ai-consultation-layout { grid-template-columns: 1fr; } }
</style>
