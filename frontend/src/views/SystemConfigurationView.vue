<script setup lang="ts">
import {
  ArchiveRestore,
  Bell,
  BrainCircuit,
  CalendarDays,
  Check,
  ChevronRight,
  CirclePlus,
  Clock3,
  DatabaseBackup,
  Download,
  Eraser,
  FileUp,
  RefreshCw,
  RotateCcw,
  Save,
  ServerCog,
  Settings2,
  ShieldAlert,
  Trash2,
  Upload,
  X,
} from "lucide-vue-next";
import type { Component } from "vue";
import { computed, onMounted, ref } from "vue";
import {
  api,
  ApiError,
  type AiModelConfig,
  type AiProvider,
  type AlertSettings,
  type DataSourceConfig,
  type MarketSource,
  type TradingCalendar,
  type UserExport,
} from "@/api/client";
import { requestConfirmation } from "@/components/confirmation";
import { useSession } from "@/stores/session";
import { formatDateTime } from "@/utils/date-format";

type SectionId = "backup" | "market" | "rules" | "ai" | "maintenance";
type Dialog = "source" | "calendar" | "ai" | "prompt" | "import" | "clear" | null;

interface SectionItem {
  id: SectionId;
  label: string;
  icon: Component;
  adminOnly?: boolean;
}

interface CalendarDay {
  date: string;
  day: number;
  isTradeDay: boolean;
  isWeekend: boolean;
}

interface CalendarMonth {
  label: string;
  offset: number;
  days: CalendarDay[];
}

const { currentUser, token } = useSession();
const activeSection = ref<SectionId>("backup");
const dialog = ref<Dialog>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const feedback = ref<{ kind: "success" | "error"; message: string } | null>(
  null,
);
const isBusy = ref(false);
const refreshResult = ref<{
  requested: number;
  refreshed: number;
  failed: number;
} | null>(null);
const marketOverview = ref<{
  instrumentCount: number;
  cachedBarCount: number;
  latestCacheAt: string | null;
} | null>(null);
const importedData = ref<unknown>(null);
const importFileName = ref("");
const sourceDraft = ref<DataSourceConfig>({
  primary: "tencent",
  fallback: "mock",
});
const calendarYear = ref(new Date().getFullYear());
const tradeDaySet = ref(new Set<string>());
const calendarLoading = ref(false);
const aiModels = ref<AiModelConfig[]>([]);
const aiSystemPrompt = ref("");
const defaultAiSystemPrompt = ref("");
const autoScanEnabledDraft = ref(false);
const scanIntervalMinutesDraft = ref("5");

const sections: SectionItem[] = [
  { id: "backup", label: "数据与备份", icon: DatabaseBackup },
  { id: "market", label: "行情与日历", icon: CalendarDays },
  { id: "rules", label: "规则", icon: Bell },
  { id: "ai", label: "AI 服务", icon: BrainCircuit },
  { id: "maintenance", label: "维护", icon: ShieldAlert, adminOnly: true },
];
const visibleSections = computed(() =>
  sections.filter(
    (section) => !section.adminOnly || currentUser.value?.role === "admin",
  ),
);
const isAdmin = computed(() => currentUser.value?.role === "admin");
const calendarTradeCount = computed(() => tradeDaySet.value.size);
const calendarMonths = computed<CalendarMonth[]>(() =>
  buildCalendarMonths(calendarYear.value, tradeDaySet.value),
);
const sourceOptions: Array<{
  value: MarketSource;
  label: string;
  description: string;
}> = [
  {
    value: "akshare",
    label: "AkShare 本地服务",
    description: "本机 Python Provider，支持股票、指数和 ETF 专用行情",
  },
  {
    value: "tencent",
    label: "腾讯财经",
    description: "轻量行情接口，适合单标的读取",
  },
  {
    value: "eastmoney",
    label: "东方财富",
    description: "覆盖范围较广的备用行情源",
  },
  { value: "mock", label: "本地模拟", description: "离线演示与稳定回退数据" },
];
const providerOptions: Array<{ value: AiProvider; label: string }> = [
  { value: "local", label: "本地工作台助手" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "ollama", label: "Ollama" },
  { value: "openai_compatible", label: "OpenAI 兼容" },
];

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function notify(kind: "success" | "error", text: string): void {
  feedback.value = { kind, message: text };
}

function clearFeedback(): void {
  feedback.value = null;
}

function sourceLabel(source: MarketSource): string {
  return (
    sourceOptions.find((option) => option.value === source)?.label ?? source
  );
}

function formatTime(value: string | null): string {
  return value === null ? "尚未写入缓存" : formatDateTime(value);
}

async function loadMarketConfig(): Promise<void> {
  if (token.value === null) return;
  const [config, overview] = await Promise.all([
    api.getDataSourceConfig(token.value),
    api.marketOverview(token.value),
  ]);
  sourceDraft.value = { ...config };
  marketOverview.value = overview;
}

function applyRuleSettings(settings: AlertSettings): void {
  autoScanEnabledDraft.value = settings.autoScanEnabled;
  scanIntervalMinutesDraft.value = String(settings.scanIntervalMinutes);
}

async function loadRuleSettings(): Promise<void> {
  if (token.value === null) return;
  applyRuleSettings(await api.getAlertSettings(token.value));
}

async function saveRuleSettings(): Promise<void> {
  if (token.value === null || isBusy.value) return;
  const scanIntervalMinutes = Number(scanIntervalMinutesDraft.value);
  if (!Number.isInteger(scanIntervalMinutes) || scanIntervalMinutes < 1 || scanIntervalMinutes > 10_080) {
    notify("error", "扫描间隔必须在 1 到 10080 分钟之间");
    return;
  }
  isBusy.value = true;
  clearFeedback();
  try {
    applyRuleSettings(await api.updateAlertSettings(token.value, {
      autoScanEnabled: autoScanEnabledDraft.value,
      scanIntervalMinutes,
    }));
    notify("success", autoScanEnabledDraft.value ? "规则自动扫描已保存" : "规则自动扫描已关闭");
  } catch (error) {
    notify("error", message(error, "保存规则扫描配置失败"));
  } finally {
    isBusy.value = false;
  }
}

async function openSourceDialog(): Promise<void> {
  if (token.value === null) return;
  clearFeedback();
  try {
    sourceDraft.value = { ...(await api.getDataSourceConfig(token.value)) };
    dialog.value = "source";
  } catch (error) {
    notify("error", message(error, "读取行情源配置失败"));
  }
}

async function saveSource(): Promise<void> {
  if (token.value === null) return;
  isBusy.value = true;
  try {
    sourceDraft.value = await api.updateDataSourceConfig(
      token.value,
      sourceDraft.value,
    );
    dialog.value = null;
    notify("success", "行情源配置已保存");
  } catch (error) {
    notify("error", message(error, "保存行情源配置失败"));
  } finally {
    isBusy.value = false;
  }
}

async function openCalendarDialog(): Promise<void> {
  dialog.value = "calendar";
  await loadCalendar();
}

async function loadCalendar(): Promise<void> {
  if (token.value === null) return;
  calendarLoading.value = true;
  try {
    const calendar = await api.getTradingCalendar(
      token.value,
      calendarYear.value,
    );
    applyCalendar(calendar);
  } catch (error) {
    notify("error", message(error, "读取交易日配置失败"));
  } finally {
    calendarLoading.value = false;
  }
}

function applyCalendar(calendar: TradingCalendar): void {
  calendarYear.value = calendar.year;
  tradeDaySet.value = new Set(calendar.tradeDays);
}

function toggleTradeDay(date: string): void {
  const next = new Set(tradeDaySet.value);
  if (next.has(date)) next.delete(date);
  else next.add(date);
  tradeDaySet.value = next;
}

async function saveCalendar(): Promise<void> {
  if (token.value === null) return;
  isBusy.value = true;
  try {
    const calendar = await api.updateTradingCalendar(token.value, {
      year: calendarYear.value,
      tradeDays: [...tradeDaySet.value].sort(),
    });
    applyCalendar(calendar);
    dialog.value = null;
    notify("success", `已保存 ${calendar.year} 年交易日配置`);
  } catch (error) {
    notify("error", message(error, "保存交易日配置失败"));
  } finally {
    isBusy.value = false;
  }
}

async function refreshMarketData(): Promise<void> {
  if (token.value === null || isBusy.value) return;
  isBusy.value = true;
  refreshResult.value = null;
  clearFeedback();
  try {
    refreshResult.value = await api.refreshReferencedMarketData(token.value);
    marketOverview.value = await api.marketOverview(token.value);
    const result = refreshResult.value;
    notify(
      result.failed === 0 ? "success" : "error",
      `行情刷新完成：${result.refreshed}/${result.requested} 成功${result.failed ? `，${result.failed} 个失败` : ""}`,
    );
  } catch (error) {
    notify("error", message(error, "刷新行情失败"));
  } finally {
    isBusy.value = false;
  }
}

async function exportData(): Promise<void> {
  if (token.value === null || isBusy.value) return;
  isBusy.value = true;
  clearFeedback();
  try {
    const payload = await api.exportData(token.value);
    downloadExport(payload);
    notify("success", "当前账户数据已导出");
  } catch (error) {
    notify("error", message(error, "导出数据失败"));
  } finally {
    isBusy.value = false;
  }
}

function downloadExport(payload: UserExport): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const day = payload.exportedAt.slice(0, 10).replaceAll("-", "");
  anchor.href = url;
  anchor.download = `ironman-export-${day}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function chooseImport(): void {
  fileInput.value?.click();
}

async function readImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file === undefined) return;
  clearFeedback();
  try {
    const parsed = JSON.parse(await file.text()) as unknown;
    if (typeof parsed !== "object" || parsed === null)
      throw new Error("invalid");
    importedData.value = parsed;
    importFileName.value = file.name;
    dialog.value = "import";
  } catch {
    notify("error", "导入文件不是有效的 IronMan JSON 备份");
  }
}

async function importData(): Promise<void> {
  if (token.value === null || importedData.value === null) return;
  isBusy.value = true;
  try {
    await api.importData(token.value, importedData.value);
    dialog.value = null;
    importedData.value = null;
    importFileName.value = "";
    notify("success", "当前账户数据已导入");
  } catch (error) {
    notify("error", message(error, "导入数据失败"));
  } finally {
    isBusy.value = false;
  }
}

async function openAiDialog(): Promise<void> {
  if (token.value === null) return;
  clearFeedback();
  try {
    const config = await api.getAiConfig(token.value);
    aiModels.value = cloneModels(config.models);
    dialog.value = "ai";
  } catch (error) {
    notify("error", message(error, "读取 AI 服务配置失败"));
  }
}

async function openAiPromptDialog(): Promise<void> {
  if (token.value === null) return;
  clearFeedback();
  try {
    const config = await api.getAiConfig(token.value);
    aiSystemPrompt.value = config.systemPrompt;
    defaultAiSystemPrompt.value = config.defaultSystemPrompt;
    dialog.value = "prompt";
  } catch (error) {
    notify("error", message(error, "读取 AI 提示词设置失败"));
  }
}

function cloneModels(models: AiModelConfig[]): AiModelConfig[] {
  return models.map((model) => ({ ...model, apiKey: "" }));
}

function addAiModel(): void {
  const id = `model_${Date.now()}`;
  aiModels.value.push({
    id,
    name: `AI 模型 ${aiModels.value.length + 1}`,
    provider: "ollama",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen2.5:7b",
    apiKey: "",
    enabled: true,
    default: aiModels.value.length === 0,
    apiKeyConfigured: false,
  });
}

function removeAiModel(index: number): void {
  if (aiModels.value.length <= 1) {
    notify("error", "至少保留一个 AI 模型配置");
    return;
  }
  aiModels.value.splice(index, 1);
  ensureDefaultModel();
}

function selectDefaultModel(index: number): void {
  aiModels.value.forEach((model, modelIndex) => {
    model.default = modelIndex === index;
    if (modelIndex === index) model.enabled = true;
  });
}

function onProviderChange(model: AiModelConfig): void {
  if (model.provider === "local") {
    model.baseUrl = "";
    model.model = "";
    model.apiKey = "";
  } else if (model.provider === "deepseek") {
    model.baseUrl = "https://api.deepseek.com";
    model.model = "deepseek-chat";
  } else if (model.provider === "ollama") {
    model.baseUrl = "http://localhost:11434/v1";
    model.model = "qwen2.5:7b";
  }
}

function ensureDefaultModel(): void {
  const current = aiModels.value.find(
    (model) => model.enabled && model.default,
  );
  if (current !== undefined) return;
  const firstEnabled = aiModels.value.find((model) => model.enabled);
  if (firstEnabled !== undefined) firstEnabled.default = true;
}

async function restoreDefaultAiSystemPrompt(): Promise<void> {
  if (aiSystemPrompt.value === defaultAiSystemPrompt.value) return;
  const confirmed = await requestConfirmation({
    title: "恢复默认提示词",
    message: "这会替换当前尚未保存的提示词内容。",
    confirmLabel: "恢复默认",
  });
  if (confirmed) aiSystemPrompt.value = defaultAiSystemPrompt.value;
}

async function saveAiConfig(): Promise<void> {
  if (token.value === null) return;
  ensureDefaultModel();
  isBusy.value = true;
  try {
    const payload = {
      models: aiModels.value.map((model) => ({
        id: model.id,
        name: model.name,
        provider: model.provider,
        baseUrl: model.baseUrl || undefined,
        model: model.model || undefined,
        apiKey: model.apiKey || undefined,
        enabled: model.enabled,
        default: model.default,
      })),
    };
    const config = await api.updateAiConfig(token.value, payload);
    aiModels.value = cloneModels(config.models);
    dialog.value = null;
    notify("success", "AI 服务配置已保存");
  } catch (error) {
    notify("error", message(error, "保存 AI 服务配置失败"));
  } finally {
    isBusy.value = false;
  }
}

async function saveAiSystemPrompt(): Promise<void> {
  if (token.value === null) return;
  isBusy.value = true;
  try {
    const config = await api.getAiConfig(token.value);
    const saved = await api.updateAiConfig(token.value, {
      models: config.models,
      systemPrompt: aiSystemPrompt.value,
    });
    aiSystemPrompt.value = saved.systemPrompt;
    defaultAiSystemPrompt.value = saved.defaultSystemPrompt;
    dialog.value = null;
    notify("success", "AI 提示词设置已保存");
  } catch (error) {
    notify("error", message(error, "保存 AI 提示词设置失败"));
  } finally {
    isBusy.value = false;
  }
}

function openClearDialog(): void {
  if (!isAdmin.value) return;
  clearFeedback();
  dialog.value = "clear";
}

async function clearMarketCache(): Promise<void> {
  if (token.value === null || !isAdmin.value) return;
  isBusy.value = true;
  try {
    const result = await api.clearMarketCache(token.value);
    marketOverview.value = await api.marketOverview(token.value);
    dialog.value = null;
    notify("success", `已清除 ${result.deletedBars} 条共享行情缓存`);
  } catch (error) {
    notify("error", message(error, "清除行情缓存失败"));
  } finally {
    isBusy.value = false;
  }
}

function closeDialog(): void {
  if (!isBusy.value) dialog.value = null;
}

onMounted(async () => {
  try {
    await Promise.all([loadMarketConfig(), loadRuleSettings()]);
  } catch (error) {
    notify("error", message(error, "加载系统配置失败"));
  }
});

function buildCalendarMonths(
  year: number,
  tradeDays: Set<string>,
): CalendarMonth[] {
  return Array.from({ length: 12 }, (_, monthIndex) => {
    const first = new Date(year, monthIndex, 1);
    const offset = (first.getDay() + 6) % 7;
    const days: CalendarDay[] = [];
    const cursor = new Date(year, monthIndex, 1);
    while (cursor.getMonth() === monthIndex) {
      const date = `${year}-${`${monthIndex + 1}`.padStart(2, "0")}-${`${cursor.getDate()}`.padStart(2, "0")}`;
      const weekday = cursor.getDay();
      days.push({
        date,
        day: cursor.getDate(),
        isTradeDay: tradeDays.has(date),
        isWeekend: weekday === 0 || weekday === 6,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return { label: `${monthIndex + 1} 月`, offset, days };
  });
}
</script>

<template>
  <section class="batman-workspace system-configuration" aria-label="系统配置">
    <div class="system-configuration-layout">
      <aside class="system-configuration-nav" aria-label="系统配置分区">
        <div class="system-configuration-nav-heading">系统配置</div>
        <button
          v-for="section in visibleSections"
          :key="section.id"
          :class="[
            'system-configuration-nav-item',
            { active: activeSection === section.id },
          ]"
          type="button"
          @click="activeSection = section.id"
        >
          <component :is="section.icon" :size="16" />
          <span>{{ section.label }}</span>
          <ChevronRight :size="14" />
        </button>
      </aside>

      <main class="system-configuration-content">
        <p
          v-if="feedback"
          :class="['system-configuration-feedback', feedback.kind]"
        >
          {{ feedback.message }}
        </p>

        <template v-if="activeSection === 'backup'">
          <header class="system-configuration-heading">
            <div>
              <h1>数据与备份</h1>
              <p>导出或恢复当前账户的业务数据，账户之间彼此隔离。</p>
            </div>
          </header>
          <div class="system-configuration-rows">
            <section class="system-configuration-row">
              <div class="setting-row-icon"><Download :size="18" /></div>
              <div>
                <h2>导出数据</h2>
                <p>
                  下载当前账户的持仓、自选、资金、策略和个人设置 JSON 备份。
                </p>
              </div>
              <button
                class="batman-button primary"
                :disabled="isBusy"
                type="button"
                @click="exportData"
              >
                <Download :size="15" />导出
              </button>
            </section>
            <section class="system-configuration-row">
              <div class="setting-row-icon"><Upload :size="18" /></div>
              <div>
                <h2>导入数据</h2>
                <p>
                  导入会替换当前账户已有业务数据，不会影响其他账户和共享标的库。
                </p>
              </div>
              <button
                class="batman-button"
                :disabled="isBusy"
                type="button"
                @click="chooseImport"
              >
                <FileUp :size="15" />选择文件
              </button>
            </section>
          </div>
          <input
            ref="fileInput"
            accept="application/json,.json"
            class="system-file-input"
            type="file"
            @change="readImportFile"
          />
        </template>

        <template v-else-if="activeSection === 'market'">
          <header class="system-configuration-heading">
            <div>
              <h1>行情与日历</h1>
              <p>
                配置当前账户的行情来源、交易日覆盖规则，并刷新当前账户实际使用的标的。
              </p>
            </div>
          </header>
          <div class="system-configuration-rows">
            <section class="system-configuration-row">
              <div class="setting-row-icon"><Settings2 :size="18" /></div>
              <div>
                <h2>行情源</h2>
                <p>
                  首选 {{ sourceLabel(sourceDraft.primary) }}，备用
                  {{ sourceLabel(sourceDraft.fallback) }}。
                </p>
              </div>
              <button
                class="batman-button"
                type="button"
                @click="openSourceDialog"
              >
                <ServerCog :size="15" />配置
              </button>
            </section>
            <section class="system-configuration-row">
              <div class="setting-row-icon"><CalendarDays :size="18" /></div>
              <div>
                <h2>交易日</h2>
                <p>
                  按年度覆盖交易日；默认以工作日为基础，可手动调整假期与特殊交易日。
                </p>
              </div>
              <button
                class="batman-button"
                type="button"
                @click="openCalendarDialog"
              >
                <CalendarDays :size="15" />编辑
              </button>
            </section>
            <section class="system-configuration-row">
              <div class="setting-row-icon"><RefreshCw :size="18" /></div>
              <div>
                <h2>刷新已使用标的</h2>
                <p>
                  仅刷新当前账户自选和持仓引用的日线缓存，不执行全市场数据下载。
                </p>
                <small v-if="refreshResult"
                  >最近一次：{{ refreshResult.refreshed }}/{{
                    refreshResult.requested
                  }}
                  成功</small
                >
              </div>
              <button
                class="batman-button primary"
                :disabled="isBusy"
                type="button"
                @click="refreshMarketData"
              >
                <RefreshCw :class="{ spinning: isBusy }" :size="15" />刷新
              </button>
            </section>
          </div>
        </template>

        <template v-else-if="activeSection === 'rules'">
          <header class="system-configuration-heading">
            <div>
              <h1>规则</h1>
              <p>配置当前账户提醒规则的自动扫描频率。</p>
            </div>
          </header>
          <form aria-label="规则配置" class="system-configuration-rows system-rule-settings" @submit.prevent="saveRuleSettings">
            <section class="system-configuration-row">
              <div class="setting-row-icon"><Bell :size="18" /></div>
              <div>
                <h2>自动扫描</h2>
                <p>按设定间隔检查当前账户已启用的提醒规则。</p>
              </div>
              <label class="batman-checkbox system-rule-toggle"><input v-model="autoScanEnabledDraft" aria-label="自动扫描" :disabled="isBusy" type="checkbox" /><span>{{ autoScanEnabledDraft ? "已开启" : "已关闭" }}</span></label>
            </section>
            <section class="system-configuration-row">
              <div class="setting-row-icon"><Clock3 :size="18" /></div>
              <div>
                <h2>扫描间隔</h2>
                <p>自动扫描开启后，按此周期检查一次提醒规则。</p>
              </div>
              <label class="system-rule-interval"><span>分钟</span><input v-model="scanIntervalMinutesDraft" aria-label="扫描间隔" :disabled="isBusy" max="10080" min="1" required step="1" type="number" /></label>
            </section>
            <footer class="system-rule-settings-footer"><button class="batman-button primary" :disabled="isBusy" type="submit"><Save :size="15" />保存规则配置</button></footer>
          </form>
        </template>

        <template v-else-if="activeSection === 'ai'">
          <header class="system-configuration-heading">
            <div>
              <h1>AI 服务</h1>
              <p>
                维护当前账户可用的模型连接。密钥只在保存时提交，读取时不会回显。
              </p>
            </div>
          </header>
          <div class="system-configuration-rows">
            <section class="system-configuration-row">
              <div class="setting-row-icon"><BrainCircuit :size="18" /></div>
              <div>
                <h2>模型配置</h2>
                <p>
                  支持本地工作台助手、DeepSeek、Ollama 和 OpenAI
                  兼容服务，可设置默认模型。
                </p>
              </div>
              <button class="batman-button" type="button" @click="openAiDialog">
                <Settings2 :size="15" />配置
              </button>
            </section>
            <section class="system-configuration-row">
              <div class="setting-row-icon"><BrainCircuit :size="18" /></div>
              <div>
                <h2>提示词设置</h2>
                <p>
                  限定 DeepSeek、Ollama 和 OpenAI 兼容模型在 AI 咨询中的职责、工具使用与回答边界。
                </p>
              </div>
              <button class="batman-button" type="button" @click="openAiPromptDialog">
                <Settings2 :size="15" />设置
              </button>
            </section>
          </div>
        </template>

        <template v-else>
          <header class="system-configuration-heading">
            <div>
              <h1>维护</h1>
              <p>共享行情缓存影响所有账户，以下操作仅对管理员开放。</p>
            </div>
          </header>
          <div class="system-configuration-rows danger">
            <section class="system-configuration-row">
              <div class="setting-row-icon danger"><Eraser :size="18" /></div>
              <div>
                <h2>清除行情缓存</h2>
                <p>
                  当前缓存
                  {{ marketOverview?.cachedBarCount ?? 0 }} 条，最近写入
                  {{
                    formatTime(marketOverview?.latestCacheAt ?? null)
                  }}。清除后下次访问会重新获取行情。
                </p>
              </div>
              <button
                class="batman-button danger"
                :disabled="isBusy"
                type="button"
                @click="openClearDialog"
              >
                <Trash2 :size="15" />清除缓存
              </button>
            </section>
          </div>
        </template>
      </main>
    </div>

    <div v-if="dialog" class="batman-dialog-backdrop" @click.self="closeDialog">
      <section
        :class="[
          'batman-dialog',
          { wide: dialog === 'calendar' || dialog === 'ai' || dialog === 'prompt' },
        ]"
        aria-modal="true"
        role="dialog"
      >
        <header>
          <strong>{{
            dialog === "source"
              ? "行情源配置"
              : dialog === "calendar"
                ? "交易日配置"
                : dialog === "ai"
                  ? "AI 服务配置"
                  : dialog === "prompt"
                    ? "AI 提示词设置"
                    : dialog === "import"
                      ? "确认导入数据"
                      : "清除行情缓存"
          }}</strong
          ><button
            aria-label="关闭"
            class="batman-icon-button"
            :disabled="isBusy"
            title="关闭"
            type="button"
            @click="closeDialog"
          >
            <X :size="17" />
          </button>
        </header>

        <form
          v-if="dialog === 'source'"
          class="system-dialog-form"
          @submit.prevent="saveSource"
        >
          <label
            ><span>首选数据源</span
            ><select v-model="sourceDraft.primary">
              <option
                v-for="option in sourceOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select></label
          >
          <label
            ><span>备用数据源</span
            ><select v-model="sourceDraft.fallback">
              <option
                v-for="option in sourceOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select></label
          >
          <div class="source-help">
            <p v-for="option in sourceOptions" :key="option.value">
              <b>{{ option.label }}</b
              ><span>{{ option.description }}</span>
            </p>
          </div>
          <footer>
            <button
              class="batman-button"
              :disabled="isBusy"
              type="button"
              @click="closeDialog"
            >
              取消</button
            ><button
              class="batman-button primary"
              :disabled="isBusy"
              type="submit"
            >
              <Save :size="15" />保存
            </button>
          </footer>
        </form>

        <div v-else-if="dialog === 'calendar'" class="system-calendar-dialog">
          <div class="system-calendar-toolbar">
            <label
              >年份<input
                v-model.number="calendarYear"
                :disabled="calendarLoading || isBusy"
                max="2100"
                min="2000"
                type="number"
                @change="loadCalendar"
            /></label>
            <div>
              <b>{{ calendarTradeCount }}</b
              ><span>个交易日</span><small>点击日期切换交易状态</small>
            </div>
          </div>
          <div v-if="calendarLoading" class="system-calendar-loading">
            正在读取交易日配置…
          </div>
          <div v-else class="system-calendar-grid">
            <section
              v-for="month in calendarMonths"
              :key="month.label"
              class="system-calendar-month"
            >
              <h2>{{ month.label }}</h2>
              <div class="system-weekdays">
                <span
                  v-for="label in ['一', '二', '三', '四', '五', '六', '日']"
                  :key="label"
                  >{{ label }}</span
                >
              </div>
              <div class="system-days">
                <span
                  v-for="offset in month.offset"
                  :key="`blank-${month.label}-${offset}`"
                  class="system-day blank"
                /><button
                  v-for="day in month.days"
                  :key="day.date"
                  :class="[
                    'system-day',
                    { trade: day.isTradeDay, weekend: day.isWeekend },
                  ]"
                  :title="`${day.date} · ${day.isTradeDay ? '交易日' : '非交易日'}`"
                  type="button"
                  @click="toggleTradeDay(day.date)"
                >
                  {{ day.day }}
                </button>
              </div>
            </section>
          </div>
          <footer>
            <button
              class="batman-button"
              :disabled="isBusy"
              type="button"
              @click="closeDialog"
            >
              取消</button
            ><button
              class="batman-button primary"
              :disabled="isBusy || calendarLoading"
              type="button"
              @click="saveCalendar"
            >
              <Check :size="15" />保存
            </button>
          </footer>
        </div>

        <form v-else-if="dialog === 'prompt'" class="system-ai-prompt-dialog" @submit.prevent="saveAiSystemPrompt">
          <section class="system-ai-prompt">
            <header>
              <div>
                <b>提示词设置</b>
                <p>
                  作为 DeepSeek、Ollama 和 OpenAI 兼容模型的系统提示词。本地工作台助手继续使用受控的本地规则。
                </p>
              </div>
              <button class="batman-button" :disabled="isBusy || aiSystemPrompt === defaultAiSystemPrompt" type="button" @click="restoreDefaultAiSystemPrompt">
                <RotateCcw :size="15" />恢复默认
              </button>
            </header>
            <textarea v-model="aiSystemPrompt" :disabled="isBusy" aria-label="AI 系统提示词" maxlength="20000" placeholder="输入系统提示词" rows="10" />
            <small>{{ aiSystemPrompt.length }} / 20000</small>
          </section>
          <footer>
            <button class="batman-button" :disabled="isBusy" type="button" @click="closeDialog">取消</button>
            <button class="batman-button primary" :disabled="isBusy" type="submit"><Save :size="15" />保存</button>
          </footer>
        </form>

        <div v-else-if="dialog === 'ai'" class="system-ai-dialog">
          <div class="system-ai-toolbar">
            <span>模型连接</span
            ><button
              class="batman-button primary"
              type="button"
              @click="addAiModel"
            >
              <CirclePlus :size="15" />新增模型
            </button>
          </div>
          <div class="system-ai-list">
            <section
              v-for="(model, index) in aiModels"
              :key="model.id"
              class="system-ai-model"
            >
              <header>
                <div>
                  <b>{{ model.name || model.id }}</b
                  ><small>{{
                    model.default
                      ? "默认模型"
                      : model.enabled
                        ? "已启用"
                        : "已停用"
                  }}</small>
                </div>
                <div class="system-ai-model-actions">
                  <label class="batman-checkbox"
                    ><input
                      v-model="model.enabled"
                      type="checkbox"
                      @change="ensureDefaultModel"
                    />启用</label
                  ><label class="batman-checkbox"
                    ><input
                      :checked="model.default"
                      name="default-ai-model"
                      type="radio"
                      @change="selectDefaultModel(index)"
                    />默认</label
                  ><button
                    aria-label="删除模型"
                    class="batman-icon-button danger"
                    :disabled="aiModels.length <= 1"
                    title="删除模型"
                    type="button"
                    @click="removeAiModel(index)"
                  >
                    <Trash2 :size="16" />
                  </button>
                </div>
              </header>
              <div class="system-ai-grid">
                <label
                  ><span>配置 ID</span
                  ><input v-model.trim="model.id" maxlength="80" /></label
                ><label
                  ><span>名称</span
                  ><input v-model.trim="model.name" maxlength="80" /></label
                ><label
                  ><span>服务商</span
                  ><select
                    v-model="model.provider"
                    @change="onProviderChange(model)"
                  >
                    <option
                      v-for="provider in providerOptions"
                      :key="provider.value"
                      :value="provider.value"
                    >
                      {{ provider.label }}
                    </option>
                  </select></label
                ><label
                  ><span>模型</span
                  ><input
                    v-model.trim="model.model"
                    :disabled="model.provider === 'local'"
                    maxlength="200" /></label
                ><label class="span-2"
                  ><span>Base URL</span
                  ><input
                    v-model.trim="model.baseUrl"
                    :disabled="model.provider === 'local'"
                    maxlength="500"
                    placeholder="https://…/v1" /></label
                ><label class="span-2"
                  ><span>API Key</span
                  ><input
                    v-model="model.apiKey"
                    :disabled="model.provider === 'local'"
                    :placeholder="
                      model.apiKeyConfigured
                        ? '已保存；留空保持不变'
                        : model.provider === 'ollama'
                          ? '可选'
                          : '必填'
                    "
                    maxlength="1000"
                    type="password"
                /></label>
              </div>
            </section>
          </div>
          <footer>
            <button
              class="batman-button"
              :disabled="isBusy"
              type="button"
              @click="closeDialog"
            >
              取消</button
            ><button
              class="batman-button primary"
              :disabled="isBusy"
              type="button"
              @click="saveAiConfig"
            >
              <Save :size="15" />保存
            </button>
          </footer>
        </div>

        <div v-else-if="dialog === 'import'" class="batman-confirm">
          <p>
            确认导入 <b>{{ importFileName }}</b
            >？这会替换当前账户已有的业务数据，其他账户不会受影响。
          </p>
          <footer>
            <button
              class="batman-button"
              :disabled="isBusy"
              type="button"
              @click="closeDialog"
            >
              取消</button
            ><button
              class="batman-button primary"
              :disabled="isBusy"
              type="button"
              @click="importData"
            >
              <ArchiveRestore :size="15" />确认导入
            </button>
          </footer>
        </div>

        <div v-else class="batman-confirm">
          <p>
            确认清除所有账户共用的行情缓存？下次查看自选或持仓时会重新请求行情数据。
          </p>
          <footer>
            <button
              class="batman-button"
              :disabled="isBusy"
              type="button"
              @click="closeDialog"
            >
              取消</button
            ><button
              class="batman-button danger"
              :disabled="isBusy"
              type="button"
              @click="clearMarketCache"
            >
              <Eraser :size="15" />清除
            </button>
          </footer>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.system-configuration-layout {
  display: grid;
  grid-template-columns: 176px minmax(0, 1fr);
  min-height: min(690px, calc(100dvh - 58px));
}
.system-configuration-nav {
  border-right: 1px solid #2a3d56;
  padding: 10px 12px 10px 0;
}
.system-configuration-nav-heading {
  color: #eff9ff;
  font-size: 15px;
  font-weight: 750;
  margin: 8px 10px 17px;
}
.system-configuration-nav-item {
  align-items: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 5px;
  color: #a5b8cc;
  display: flex;
  font-size: 13px;
  gap: 9px;
  margin: 3px 0;
  min-height: 38px;
  padding: 0 9px;
  text-align: left;
  width: 100%;
}
.system-configuration-nav-item svg:last-child {
  margin-left: auto;
  opacity: 0;
}
.system-configuration-nav-item:hover {
  background: #152438;
  border-color: #2c4a64;
  color: #eefaff;
}
.system-configuration-nav-item.active {
  background: #1c3a4a;
  border-color: #39726f;
  color: #d6fffa;
}
.system-configuration-nav-item.active svg {
  color: #69d8cb;
}
.system-configuration-nav-item.active svg:last-child {
  opacity: 1;
}
.system-configuration-content {
  min-width: 0;
  padding: 8px 0 0 28px;
}
.system-configuration-heading {
  align-items: flex-start;
  display: flex;
  justify-content: space-between;
  margin: 3px 0 24px;
}
.system-configuration-heading h1 {
  color: #eef8ff;
  font-size: 19px;
  line-height: 1.2;
  margin: 0;
}
.system-configuration-heading p {
  color: #8197ad;
  font-size: 13px;
  line-height: 1.6;
  margin: 7px 0 0;
}
.system-configuration-feedback {
  border: 1px solid;
  border-radius: 5px;
  font-size: 13px;
  margin: 0 0 18px;
  padding: 9px 11px;
}
.system-configuration-feedback.success {
  background: #14362f;
  border-color: #2e8475;
  color: #aef0df;
}
.system-configuration-feedback.error {
  background: #3b2026;
  border-color: #8d4c59;
  color: #ffb7bd;
}
.system-configuration-rows {
  border-top: 1px solid #2a3d56;
}
.system-configuration-row {
  align-items: center;
  border-bottom: 1px solid #263950;
  display: grid;
  gap: 13px;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  min-height: 86px;
  padding: 14px 0;
}
.system-configuration-row h2 {
  color: #e9f5fe;
  font-size: 14px;
  margin: 0 0 5px;
}
.system-configuration-row p {
  color: #899fb4;
  font-size: 12px;
  line-height: 1.55;
  margin: 0;
  max-width: 720px;
}
.system-configuration-row small {
  color: #69d8cb;
  display: block;
  font-size: 12px;
  margin-top: 5px;
}
.setting-row-icon {
  align-items: center;
  background: #17283a;
  border: 1px solid #31506a;
  border-radius: 5px;
  color: #70d7cf;
  display: inline-flex;
  height: 31px;
  justify-content: center;
  width: 31px;
}
.setting-row-icon.danger {
  background: #3a2027;
  border-color: #814854;
  color: #ff9da5;
}
.system-configuration-rows.danger {
  border-top-color: #77434c;
}
.system-file-input {
  display: none;
}
.system-dialog-form {
  display: grid;
  gap: 14px;
}
.system-dialog-form label,
.system-ai-grid label,
.system-calendar-toolbar label {
  color: #b9c9d9;
  display: grid;
  font-size: 12px;
  font-weight: 650;
  gap: 6px;
}
.system-dialog-form select,
.system-ai-grid input,
.system-ai-grid select,
.system-calendar-toolbar input,
.system-ai-prompt textarea {
  background: #1d293b;
  border: 1px solid #3a506d;
  border-radius: 5px;
  color: #edf6ff;
  min-height: 36px;
  padding: 0 9px;
}
.system-dialog-form select:focus,
.system-ai-grid input:focus,
.system-ai-grid select:focus,
.system-calendar-toolbar input:focus,
.system-ai-prompt textarea:focus {
  border-color: #65d7ca;
  outline: 1px solid #65d7ca;
}
.source-help {
  border-top: 1px solid #2a3d56;
  display: grid;
  gap: 7px;
  padding-top: 12px;
}
.source-help p {
  color: #8499ae;
  display: grid;
  font-size: 12px;
  gap: 3px;
  margin: 0;
}
.source-help b {
  color: #cae0ef;
}
.system-dialog-form footer,
.system-calendar-dialog footer,
.system-ai-dialog > footer,
.system-ai-prompt-dialog > footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 3px;
}
.system-calendar-dialog {
  display: grid;
  gap: 14px;
}
.system-calendar-toolbar {
  align-items: end;
  border-bottom: 1px solid #2a3d56;
  display: flex;
  justify-content: space-between;
  padding-bottom: 12px;
}
.system-calendar-toolbar label {
  grid-template-columns: auto 96px;
  align-items: center;
}
.system-calendar-toolbar label input {
  width: 96px;
}
.system-calendar-toolbar > div {
  align-items: baseline;
  color: #8aa0b5;
  display: flex;
  font-size: 12px;
  gap: 6px;
}
.system-calendar-toolbar b {
  color: #d6fff8;
  font-size: 15px;
}
.system-calendar-toolbar small {
  color: #758da3;
  margin-left: 8px;
}
.system-calendar-loading {
  align-items: center;
  color: #91a7bc;
  display: flex;
  justify-content: center;
  min-height: 420px;
}
.system-calendar-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  max-height: min(68vh, 690px);
  overflow-y: auto;
  padding-right: 3px;
}
.system-calendar-month {
  border: 1px solid #2a4058;
  border-radius: 5px;
  padding: 8px;
}
.system-calendar-month h2 {
  color: #dbe9f3;
  font-size: 12px;
  margin: 0 0 7px;
}
.system-weekdays,
.system-days {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
}
.system-weekdays span {
  color: #70869d;
  font-size: 10px;
  padding: 2px 0 5px;
  text-align: center;
}
.system-day {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 3px;
  color: #7890a6;
  display: inline-flex;
  font-size: 11px;
  height: 23px;
  justify-content: center;
  min-width: 0;
  padding: 0;
}
.system-day.trade {
  background: #1b514d;
  color: #d9fffa;
}
.system-day.weekend:not(.trade) {
  color: #596d80;
}
.system-day:hover {
  background: #31546b;
  color: #fff;
}
.system-day.blank {
  pointer-events: none;
}
.system-ai-dialog {
  display: grid;
  gap: 13px;
}
.system-ai-prompt-dialog {
  display: grid;
  gap: 13px;
}
.system-ai-prompt {
  border: 1px solid #2a4058;
  border-radius: 6px;
  display: grid;
  gap: 9px;
  padding: 13px;
}
.system-ai-prompt > header {
  align-items: flex-start;
  display: flex;
  gap: 16px;
  justify-content: space-between;
}
.system-ai-prompt b {
  color: #eff9ff;
  font-size: 13px;
}
.system-ai-prompt p {
  color: #8197ad;
  font-size: 12px;
  line-height: 1.5;
  margin: 4px 0 0;
  max-width: 610px;
}
.system-ai-prompt textarea {
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
    monospace;
  font-size: 12px;
  line-height: 1.55;
  min-height: 184px;
  padding: 9px;
  resize: vertical;
}
.system-ai-prompt small {
  color: #71889f;
  font-size: 11px;
  justify-self: end;
}
.system-ai-toolbar {
  align-items: center;
  display: flex;
  justify-content: space-between;
}
.system-ai-toolbar > span {
  color: #b7c9db;
  font-size: 13px;
  font-weight: 700;
}
.system-ai-list {
  display: grid;
  gap: 12px;
  max-height: min(62vh, 630px);
  overflow-y: auto;
  padding-right: 3px;
}
.system-ai-model {
  border: 1px solid #2a4058;
  border-radius: 6px;
  padding: 13px;
}
.system-ai-model > header {
  align-items: center;
  border-bottom: 1px solid #2a4058;
  display: flex;
  justify-content: space-between;
  margin-bottom: 12px;
  padding: 0 0 10px;
}
.system-ai-model > header b {
  color: #eff9ff;
  font-size: 13px;
}
.system-ai-model > header small {
  color: #79cfc6;
  display: block;
  font-size: 11px;
  margin-top: 3px;
}
.system-ai-model-actions {
  align-items: center;
  display: flex;
  gap: 10px;
}
.system-ai-model-actions .batman-icon-button.danger:hover {
  color: #ff929b;
}
.system-ai-grid {
  display: grid;
  gap: 11px 12px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.system-ai-grid label.span-2 {
  grid-column: span 2;
}
.system-ai-grid input:disabled {
  color: #6f8193;
  opacity: 0.72;
}
.system-rule-settings-footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 14px;
}
.system-rule-toggle {
  justify-self: end;
}
.system-rule-interval {
  align-items: center;
  color: #a9bed1;
  display: flex;
  font-size: 12px;
  gap: 8px;
}
.system-rule-interval input {
  background: #1d293b;
  border: 1px solid #3a506d;
  border-radius: 5px;
  color: #edf6ff;
  min-height: 36px;
  padding: 0 9px;
  text-align: right;
  width: 96px;
}
.system-rule-interval input:focus {
  border-color: #65d7ca;
  outline: 1px solid #65d7ca;
}
@media (max-width: 1220px) {
  .system-calendar-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .system-ai-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .system-ai-grid label.span-2 {
    grid-column: span 2;
  }
}
</style>
