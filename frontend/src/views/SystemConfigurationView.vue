<script setup lang="ts">
import {
  ArchiveRestore,
  Bell,
  BrainCircuit,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  Clock3,
  DatabaseBackup,
  Download,
  Eraser,
  FileUp,
  LineChart,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  Save,
  ServerCog,
  Settings2,
  ShieldAlert,
  Trash2,
  Upload,
  X,
} from "lucide-vue-next";
import type { Component } from "vue";
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import {
  api,
  ApiError,
  type AiModelConfig,
  type AiProvider,
  type AlertSettings,
  type AiCandidateSettings,
  type DataSourceConfig,
  type FundHistoryState,
  type HoldingDiagnosisSettings,
  type HoldingDiagnosisSourceCatalogItem,
  type IntradayDisplaySource,
  type MarketSnapshotSettings,
  type MarketSnapshotStatus,
  type MarketSource,
  type TradingCalendar,
  type UserExport,
} from "@/api/client";
import { requestConfirmation } from "@/components/confirmation";
import { useSession } from "@/stores/session";
import { formatDateTime } from "@/utils/date-format";

type SectionId = "backup" | "market" | "diagnosis" | "candidate" | "rules" | "ai" | "maintenance";
type Dialog = "snapshot" | "source" | "calendar" | "ai" | "prompt" | "import" | "clear" | null;

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
const route = useRoute();
const activeSection = ref<SectionId>(isSectionId(route.query.section) ? route.query.section : "backup");
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
  primary: "eastmoney",
  fallback: "tencent",
});
const snapshotDraft = ref<MarketSnapshotSettings>({
  enabled: false,
  mode: "auto",
  startTime: "09:30",
  endTime: "15:00",
  intervalMinutes: 15,
  scope: "holdings",
  retentionDays: 5,
});
const snapshotStatus = ref<MarketSnapshotStatus | null>(null);
const intradaySourceDraft = ref<IntradayDisplaySource>("snapshot");
const intradaySourceSaving = ref(false);
const calendarYear = ref(new Date().getFullYear());
const tradeDaySet = ref(new Set<string>());
const calendarLoading = ref(false);
const aiModels = ref<AiModelConfig[]>([]);
const aiModelList = ref<HTMLElement | null>(null);
const expandedAiModel = ref<AiModelConfig | null>(null);
const aiModelCatalog = ref<string[]>([]);
const aiModelCatalogLoading = ref(false);
const aiModelCatalogError = ref<string | null>(null);
const aiSystemPrompt = ref("");
const defaultAiSystemPrompt = ref("");
const autoScanEnabledDraft = ref(false);
const scanIntervalMinutesDraft = ref("5");
const fundHistoryState = ref<FundHistoryState | null>(null);
const isFundHistoryRecalculating = ref(false);
const diagnosisSettings = ref<HoldingDiagnosisSettings>({
  enabled: false,
  scheduledTime: "15:30",
  sourceIds: ["all"],
  reportPreference: "优先识别趋势、风险、关键价格与需要确认的信息；给出条件化建议，不承诺收益。",
  lookbackTradingDays: 60,
  maxFunctionBatches: 2,
  maxExternalSourcesPerHolding: 3,
});
const diagnosisSources = ref<HoldingDiagnosisSourceCatalogItem[]>([]);
const diagnosisModelName = ref("未配置");
const candidateSettings = ref<AiCandidateSettings>({
  enabled: true,
  strategies: ["trend_event", "quality_growth", "value_repair"],
  topN: 10,
  explanationValidityDays: 10,
  maxValidityDays: 20,
  scheduledTime: "18:30",
  retentionDays: 30,
});

const sections: SectionItem[] = [
  { id: "backup", label: "数据与备份", icon: DatabaseBackup },
  { id: "market", label: "行情与日历", icon: CalendarDays },
  { id: "diagnosis", label: "持仓诊断", icon: ScanSearch },
  { id: "candidate", label: "AI 候选", icon: ChartNoAxesCombined },
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
const useAllDiagnosisSources = computed(() => diagnosisSettings.value.sourceIds.includes("all"));
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
];
const providerOptions: Array<{ value: AiProvider; label: string }> = [
  { value: "local", label: "本地工作台助手" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "ollama", label: "Ollama" },
  { value: "openai_compatible", label: "OpenAI 兼容" },
  { value: "opencode_go", label: "OpenCode Go" },
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

function snapshotScopeLabel(scope: MarketSnapshotSettings["scope"]): string {
  if (scope === "watchlist") return "自选";
  if (scope === "holdings_watchlist") return "自选 + 持仓";
  return "持仓";
}

function snapshotStatusLabel(): string {
  if (!snapshotDraft.value.enabled) return "未开启";
  if (snapshotDraft.value.mode === "manual") return "手动刷新写入";
  return `自动 ${snapshotDraft.value.startTime}-${snapshotDraft.value.endTime}`;
}

function isSectionId(value: unknown): value is SectionId {
  return typeof value === "string" && ["backup", "market", "diagnosis", "candidate", "rules", "ai", "maintenance"].includes(value);
}

function fundHistoryStatusLabel(state: FundHistoryState): string {
  if (state.status === "dirty") return `待重新计算（自 ${state.dirtyFrom ?? "历史记录"}）`;
  if (state.status === "calculating") return "正在计算";
  if (state.status === "failed") return `计算失败${state.lastError ? `：${state.lastError}` : ""}`;
  return state.tradeDayCount > 0 ? "已更新" : "尚未生成";
}

async function loadFundHistoryStatus(): Promise<void> {
  if (token.value === null) return;
  fundHistoryState.value = await api.fundHistoryStatus(token.value);
}

async function recalculateFundHistory(): Promise<void> {
  if (token.value === null || isBusy.value) return;
  const confirmed = await requestConfirmation({
    title: "重新计算资金趋势",
    message: "将重建最近一年的资金趋势历史，包含活动持仓、清仓记录和历史行情。计算期间不会修改资金与交易记录。",
    confirmLabel: "重新计算",
  });
  if (!confirmed) return;
  isBusy.value = true;
  isFundHistoryRecalculating.value = true;
  clearFeedback();
  try {
    const rebuilt = await api.recalculateFundHistory(token.value);
    fundHistoryState.value = rebuilt.state;
    notify("success", "资金趋势历史已重新计算");
  } catch (error) {
    notify("error", message(error, "重新计算资金趋势历史失败"));
    await loadFundHistoryStatus().catch(() => undefined);
  } finally {
    isBusy.value = false;
    isFundHistoryRecalculating.value = false;
  }
}

async function loadMarketConfig(): Promise<void> {
  if (token.value === null) return;
  const [config, overview, settings, status, intradaySource] = await Promise.all([
    api.getDataSourceConfig(token.value),
    api.marketOverview(token.value),
    api.getMarketSnapshotSettings(token.value),
    api.marketSnapshotStatus(token.value),
    api.getIntradaySource(token.value),
  ]);
  sourceDraft.value = { ...config };
  marketOverview.value = overview;
  snapshotDraft.value = { ...settings };
  snapshotStatus.value = status;
  intradaySourceDraft.value = intradaySource.source;
}

async function saveIntradaySource(source: IntradayDisplaySource): Promise<void> {
  const accessToken = token.value;
  if (accessToken === null || intradaySourceSaving.value) return;
  intradaySourceSaving.value = true;
  try {
    const saved = await api.updateIntradaySource(accessToken, source);
    intradaySourceDraft.value = saved.source;
    notify("success", "分时数据源已保存");
  } catch (error) {
    notify("error", message(error, "分时数据源保存失败"));
    intradaySourceDraft.value = "snapshot";
  } finally {
    intradaySourceSaving.value = false;
  }
}

function applyRuleSettings(settings: AlertSettings): void {
  autoScanEnabledDraft.value = settings.autoScanEnabled;
  scanIntervalMinutesDraft.value = String(settings.scanIntervalMinutes);
}

async function loadRuleSettings(): Promise<void> {
  if (token.value === null) return;
  applyRuleSettings(await api.getAlertSettings(token.value));
}

async function loadDiagnosisSettings(): Promise<void> {
  if (token.value === null) return;
  const [settings, catalog, aiConfig] = await Promise.all([
    api.getHoldingDiagnosisSettings(token.value),
    api.holdingDiagnosisSourceCatalog(token.value),
    api.getAiConfig(token.value),
  ]);
  diagnosisSettings.value = { ...settings, sourceIds: [...settings.sourceIds] };
  diagnosisSources.value = catalog.items;
  diagnosisModelName.value = (
    aiConfig.models.find((model) => model.enabled && model.default) ??
    aiConfig.models.find((model) => model.enabled)
  )?.name ?? "未配置";
}

async function loadCandidateSettings(): Promise<void> {
  if (token.value === null) return;
  candidateSettings.value = await api.getAiCandidateSettings(token.value);
}

async function saveCandidateSettings(): Promise<void> {
  if (token.value === null || isBusy.value) return;
  isBusy.value = true;
  clearFeedback();
  try {
    candidateSettings.value = await api.updateAiCandidateSettings(token.value, {
      retentionDays: candidateSettings.value.retentionDays,
    });
    notify("success", "AI 候选记录保留设置已保存");
  } catch (error) {
    notify("error", message(error, "保存 AI 候选设置失败"));
  } finally {
    isBusy.value = false;
  }
}

function setAllDiagnosisSources(checked: boolean): void {
  diagnosisSettings.value.sourceIds = checked ? ["all"] : [];
}

function toggleDiagnosisSource(sourceId: string, checked: boolean): void {
  const current = diagnosisSettings.value.sourceIds.filter((id) => id !== "all");
  const next = checked
    ? [...new Set([...current, sourceId])]
    : current.filter((id) => id !== sourceId);
  const order = new Map(
    diagnosisSources.value.map((source, index) => [source.id, index]),
  );
  diagnosisSettings.value.sourceIds = next.sort(
    (left, right) => (order.get(left) ?? Number.MAX_SAFE_INTEGER) - (order.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
}

async function saveDiagnosisSettings(): Promise<void> {
  if (token.value === null || isBusy.value) return;
  if (diagnosisSettings.value.sourceIds.length === 0) {
    notify("error", "请至少选择一个持仓诊断资料源");
    return;
  }
  isBusy.value = true;
  clearFeedback();
  try {
    diagnosisSettings.value = await api.updateHoldingDiagnosisSettings(
      token.value,
      diagnosisSettings.value,
    );
    diagnosisSettings.value = {
      ...diagnosisSettings.value,
      sourceIds: [...diagnosisSettings.value.sourceIds],
    };
    notify("success", diagnosisSettings.value.enabled ? "持仓诊断配置已保存" : "持仓诊断自动生成已关闭");
  } catch (error) {
    notify("error", message(error, "保存持仓诊断配置失败"));
  } finally {
    isBusy.value = false;
  }
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

async function openSnapshotDialog(): Promise<void> {
  if (token.value === null) return;
  clearFeedback();
  try {
    const [settings, status] = await Promise.all([
      api.getMarketSnapshotSettings(token.value),
      api.marketSnapshotStatus(token.value),
    ]);
    snapshotDraft.value = { ...settings };
    snapshotStatus.value = status;
    dialog.value = "snapshot";
  } catch (error) {
    notify("error", message(error, "读取盘中行情快照配置失败"));
  }
}

async function saveSnapshotSettings(): Promise<void> {
  if (token.value === null || isBusy.value) return;
  isBusy.value = true;
  clearFeedback();
  try {
    snapshotDraft.value = await api.updateMarketSnapshotSettings(
      token.value,
      snapshotDraft.value,
    );
    snapshotStatus.value = await api.marketSnapshotStatus(token.value);
    dialog.value = null;
    notify(
      "success",
      snapshotDraft.value.enabled
        ? "盘中行情快照配置已保存"
        : "盘中行情快照已关闭",
    );
  } catch (error) {
    notify("error", message(error, "保存盘中行情快照配置失败"));
  } finally {
    isBusy.value = false;
  }
}

async function clearMarketSnapshots(): Promise<void> {
  if (token.value === null || isBusy.value) return;
  const confirmed = await requestConfirmation({
    title: "清空盘中行情快照",
    message: "将删除当前账户已记录的所有盘中行情快照，不影响日线缓存、持仓和资金数据。",
    confirmLabel: "清空记录",
    tone: "danger",
  });
  if (!confirmed) return;
  isBusy.value = true;
  clearFeedback();
  try {
    const result = await api.deleteMarketSnapshots(token.value);
    snapshotStatus.value = await api.marketSnapshotStatus(token.value);
    notify("success", `已清空 ${result.deleted} 条盘中行情快照`);
  } catch (error) {
    notify("error", message(error, "清空盘中行情快照失败"));
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
    await loadFundHistoryStatus();
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
    expandedAiModel.value =
      aiModels.value.find((model) => model.default) ?? aiModels.value[0] ?? null;
    resetAiModelCatalog();
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

function modelProviderLabel(provider: AiProvider): string {
  return providerOptions.find((option) => option.value === provider)?.label ?? provider;
}

function modelSummary(model: AiModelConfig): string {
  if (model.provider === "local") return modelProviderLabel(model.provider);
  return model.model
    ? `${modelProviderLabel(model.provider)} · ${model.model}`
    : modelProviderLabel(model.provider);
}

function isAiModelExpanded(model: AiModelConfig): boolean {
  return expandedAiModel.value === model;
}

function toggleAiModel(model: AiModelConfig): void {
  expandedAiModel.value = isAiModelExpanded(model) ? null : model;
}

async function addAiModel(): Promise<void> {
  const id = `model_${Date.now()}`;
  const model: AiModelConfig = {
    id,
    name: `AI 模型 ${aiModels.value.length + 1}`,
    provider: "ollama",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen2.5:7b",
    apiKey: "",
    enabled: true,
    default: aiModels.value.length === 0,
    apiKeyConfigured: false,
  };
  aiModels.value.push(model);
  expandedAiModel.value = model;

  await nextTick();
  const modelCard = aiModelList.value?.querySelector<HTMLElement>(
    `[data-model-id="${id}"]`,
  );
  if (modelCard !== undefined && typeof modelCard?.scrollIntoView === "function") {
    modelCard.scrollIntoView({ block: "nearest" });
  }
  modelCard?.querySelector<HTMLInputElement>("input[data-ai-field='name']")?.focus();
}

function removeAiModel(index: number): void {
  if (aiModels.value.length <= 1) {
    notify("error", "至少保留一个 AI 模型配置");
    return;
  }
  const [removed] = aiModels.value.splice(index, 1);
  if (expandedAiModel.value === removed) {
    expandedAiModel.value = aiModels.value[index] ?? aiModels.value[index - 1] ?? null;
  }
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
  } else if (model.provider === "opencode_go") {
    model.baseUrl = "https://opencode.ai/zen/go/v1";
    model.model = "step-5-preview-free";
  }
  resetAiModelCatalog();
}

function resetAiModelCatalog(): void {
  aiModelCatalog.value = [];
  aiModelCatalogLoading.value = false;
  aiModelCatalogError.value = null;
}

async function fetchOpenCodeGoModels(): Promise<void> {
  if (token.value === null || aiModelCatalogLoading.value) return;
  aiModelCatalog.value = [];
  aiModelCatalogError.value = null;
  aiModelCatalogLoading.value = true;
  try {
    const result = await api.listOpenCodeGoModels(token.value);
    aiModelCatalog.value = result.models.map((model) => model.id);
  } catch (error) {
    aiModelCatalogError.value = message(error, "获取模型列表失败");
  } finally {
    aiModelCatalogLoading.value = false;
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
  if (!isBusy.value) {
    dialog.value = null;
    resetAiModelCatalog();
  }
}

onMounted(async () => {
  try {
    await Promise.all([loadMarketConfig(), loadRuleSettings(), loadDiagnosisSettings(), loadCandidateSettings(), loadFundHistoryStatus()]);
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
            <section class="system-configuration-row">
              <div class="setting-row-icon"><ChartNoAxesCombined :size="18" /></div>
              <div>
                <h2>资金趋势历史数据</h2>
                <p v-if="fundHistoryState">
                  {{ fundHistoryState.coveredFrom && fundHistoryState.coveredTo ? `${fundHistoryState.coveredFrom} 至 ${fundHistoryState.coveredTo}` : "尚未生成日期范围" }}，
                  {{ fundHistoryState.tradeDayCount }} 个交易日，版本 {{ fundHistoryState.calculationVersion }}；
                  {{ fundHistoryStatusLabel(fundHistoryState) }}。
                </p>
                <p v-else>正在读取资金趋势历史状态。</p>
                <small v-if="fundHistoryState">最近计算 {{ formatDateTime(fundHistoryState.updatedAt) }}</small>
              </div>
              <button class="batman-button" :disabled="isBusy" type="button" @click="recalculateFundHistory">
                <RefreshCw :class="{ spinning: isFundHistoryRecalculating }" :size="15" />重新计算
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
              <div class="setting-row-icon"><ChartNoAxesCombined :size="18" /></div>
              <div>
                <h2>盘中行情快照</h2>
                <p>
                  {{ snapshotStatusLabel() }}，范围为{{ snapshotScopeLabel(snapshotDraft.scope) }}；仅在交易时段保存股票、指数的当日 OHLCV 数据。
                </p>
                <small v-if="snapshotStatus">
                  已记录 {{ snapshotStatus.totalCount }} 条
                  <template v-if="snapshotStatus.lastCapturedAt">，最近 {{ formatDateTime(snapshotStatus.lastCapturedAt) }}</template>
                  <template v-else>，尚无快照</template>
                </small>
              </div>
              <div class="system-market-snapshot-actions">
                <button
                  aria-label="清空盘中行情快照"
                  class="batman-icon-button danger"
                  data-hint="清空记录"
                  data-hint-position="top"
                  :disabled="isBusy || (snapshotStatus?.totalCount ?? 0) === 0"
                  type="button"
                  @click="clearMarketSnapshots"
                >
                  <Trash2 :size="15" />
                </button>
                <button class="batman-button" :disabled="isBusy" type="button" @click="openSnapshotDialog">
                  <Settings2 :size="15" />配置
                </button>
              </div>
            </section>
            <section class="system-configuration-row">
              <div class="setting-row-icon"><LineChart :size="18" /></div>
              <div>
                <h2>分时数据源</h2>
                <p>
                  仅标明分时数据的展示来源偏好；目前不影响分时数据的读取、存储与展示逻辑。
                </p>
              </div>
              <select
                aria-label="分时数据源"
                class="system-row-select"
                :disabled="isBusy || intradaySourceSaving"
                :value="intradaySourceDraft"
                @change="saveIntradaySource(($event.target as HTMLSelectElement).value as IntradayDisplaySource)"
              >
                <option value="snapshot">历史数据快照</option>
                <option value="realtime">实时分时数据</option>
              </select>
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

        <template v-else-if="activeSection === 'diagnosis'">
          <header class="system-configuration-heading">
            <div>
              <h1>持仓诊断</h1>
              <p>自动报告仅在交易日生成，手动报告在趋势分析菜单的持仓诊断页查看。</p>
            </div>
          </header>
          <form aria-label="持仓诊断配置" class="system-configuration-rows system-diagnosis-settings" @submit.prevent="saveDiagnosisSettings">
            <section class="system-configuration-row">
              <div class="setting-row-icon"><ScanSearch :size="18" /></div>
              <div>
                <h2>每日自动生成</h2>
                <p>当前默认模型：{{ diagnosisModelName }}</p>
              </div>
              <label class="batman-checkbox system-rule-toggle"><input v-model="diagnosisSettings.enabled" aria-label="开启自动持仓诊断" :disabled="isBusy" type="checkbox" /><span>{{ diagnosisSettings.enabled ? "已开启" : "已关闭" }}</span></label>
            </section>
            <section class="system-configuration-row">
              <div class="setting-row-icon"><Clock3 :size="18" /></div>
              <div>
                <h2>生成时间</h2>
                <p>按 Asia/Shanghai 时间执行。</p>
              </div>
              <input v-model="diagnosisSettings.scheduledTime" aria-label="持仓诊断生成时间" class="system-diagnosis-time" :disabled="isBusy || !diagnosisSettings.enabled" required type="time" />
            </section>
            <section class="system-diagnosis-detail">
              <div class="system-diagnosis-detail-heading">
                <h2>信息源</h2>
                <label class="batman-checkbox"><input aria-label="使用全部资料源" :checked="useAllDiagnosisSources" :disabled="isBusy" type="checkbox" @change="setAllDiagnosisSources(($event.target as HTMLInputElement).checked)" />使用全部资料源</label>
              </div>
              <div class="system-diagnosis-source-grid">
                <label v-for="source in diagnosisSources" :key="source.id" :class="{ disabled: useAllDiagnosisSources }" class="system-diagnosis-source">
                  <input :aria-label="`选择 ${source.label}`" :checked="diagnosisSettings.sourceIds.includes(source.id)" :disabled="isBusy || useAllDiagnosisSources" type="checkbox" @change="toggleDiagnosisSource(source.id, ($event.target as HTMLInputElement).checked)" />
                  <span><b>{{ source.label }}</b><small>{{ source.description }}</small></span>
                </label>
              </div>
            </section>
            <section class="system-diagnosis-detail system-diagnosis-prompt">
              <label><span>报告倾向</span><textarea v-model="diagnosisSettings.reportPreference" aria-label="报告倾向" :disabled="isBusy" maxlength="4000" rows="4" /></label>
              <small>{{ diagnosisSettings.reportPreference.length }} / 4000</small>
            </section>
            <section class="system-diagnosis-options">
              <label><span>行情窗口</span><select v-model.number="diagnosisSettings.lookbackTradingDays" :disabled="isBusy"><option :value="20">20 个交易日</option><option :value="60">60 个交易日</option><option :value="120">120 个交易日</option></select></label>
              <label><span>本地函数批次</span><select v-model.number="diagnosisSettings.maxFunctionBatches" :disabled="isBusy"><option :value="1">1 批</option><option :value="2">2 批</option><option :value="3">3 批</option></select></label>
              <label><span>每标的资料数</span><select v-model.number="diagnosisSettings.maxExternalSourcesPerHolding" :disabled="isBusy"><option :value="1">1 条</option><option :value="3">3 条</option><option :value="5">5 条</option></select></label>
            </section>
            <footer class="system-rule-settings-footer"><button class="batman-button primary" :disabled="isBusy" type="submit"><Save :size="15" />保存持仓诊断配置</button></footer>
          </form>
        </template>

        <template v-else-if="activeSection === 'candidate'">
          <header class="system-configuration-heading">
            <div>
              <h1>AI 候选</h1>
              <p>候选记录按日期保存；超出保留期限的日期会在读取或生成候选时自动清理。</p>
            </div>
          </header>
          <form aria-label="AI 候选配置" class="system-configuration-rows system-rule-settings" @submit.prevent="saveCandidateSettings">
            <section class="system-configuration-row">
              <div class="setting-row-icon"><ChartNoAxesCombined :size="18" /></div>
              <div>
                <h2>记录保留天数</h2>
                <p>最多保留 30 天；删除某个日期时，该日期的替换版本和评估样本也会一并删除。</p>
              </div>
              <label class="system-rule-interval"><span>天</span><select v-model.number="candidateSettings.retentionDays" aria-label="AI 候选记录保留天数" :disabled="isBusy"><option v-for="days in 30" :key="days" :value="days">{{ days }}</option></select></label>
            </section>
            <section class="system-configuration-row">
              <div class="setting-row-icon"><Clock3 :size="18" /></div>
              <div>
                <h2>自动候选</h2>
                <p>当前按 {{ candidateSettings.scheduledTime }} 生成，运行结果仍按日期替换当天记录。</p>
              </div>
              <span class="system-config-value">{{ candidateSettings.enabled ? "已开启" : "已关闭" }}</span>
            </section>
            <footer class="system-rule-settings-footer"><button class="batman-button primary" :disabled="isBusy" type="submit"><Save :size="15" />保存 AI 候选配置</button></footer>
          </form>
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
                  支持本地工作台助手、DeepSeek、Ollama、OpenCode Go
                  和 OpenAI 兼容服务，可设置默认模型。
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
          {
            wide: dialog === 'calendar' || dialog === 'ai' || dialog === 'prompt',
            'system-ai-modal': dialog === 'ai',
          },
        ]"
        aria-modal="true"
        role="dialog"
      >
        <header>
          <strong>{{
            dialog === "snapshot"
              ? "盘中行情快照"
              : dialog === "source"
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
          v-if="dialog === 'snapshot'"
          class="system-dialog-form"
          @submit.prevent="saveSnapshotSettings"
        >
          <label class="batman-checkbox system-snapshot-toggle">
            <input v-model="snapshotDraft.enabled" aria-label="开启盘中行情快照" :disabled="isBusy" type="checkbox" />
            <span>开启盘中行情快照</span>
          </label>
          <p class="system-snapshot-help">关闭后不会采集或写入新的快照，已有记录会保留。</p>
          <div class="system-snapshot-grid" :class="{ disabled: !snapshotDraft.enabled }">
            <label><span>采集方式</span><select v-model="snapshotDraft.mode" :disabled="isBusy || !snapshotDraft.enabled"><option value="auto">自动采集</option><option value="manual">手动刷新写入</option></select></label>
            <label><span>标的范围</span><select v-model="snapshotDraft.scope" :disabled="isBusy || !snapshotDraft.enabled"><option value="holdings">持仓</option><option value="watchlist">自选</option><option value="holdings_watchlist">自选 + 持仓</option></select></label>
            <label><span>开始时间</span><input v-model="snapshotDraft.startTime" :disabled="isBusy || !snapshotDraft.enabled || snapshotDraft.mode === 'manual'" required type="time" /></label>
            <label><span>结束时间</span><input v-model="snapshotDraft.endTime" :disabled="isBusy || !snapshotDraft.enabled || snapshotDraft.mode === 'manual'" required type="time" /></label>
            <label><span>采集间隔</span><select v-model="snapshotDraft.intervalMinutes" :disabled="isBusy || !snapshotDraft.enabled || snapshotDraft.mode === 'manual'"><option :value="1">1 分钟</option><option :value="3">3 分钟</option><option :value="5">5 分钟</option><option :value="10">10 分钟</option><option :value="15">15 分钟</option><option :value="30">30 分钟</option></select></label>
            <label><span>记录保留</span><select v-model="snapshotDraft.retentionDays" :disabled="isBusy || !snapshotDraft.enabled || snapshotDraft.mode === 'manual'"><option :value="5">5 天</option><option :value="10">10 天</option><option :value="15">15 天</option></select></label>
          </div>
          <p class="system-snapshot-help">自动采集仅在交易日的 09:30-11:30、13:00-15:00 之间执行，并在每日首次自动采集时清理过期记录；手动模式仅在持仓或自选页面刷新时写入。</p>
          <footer>
            <button class="batman-button" :disabled="isBusy" type="button" @click="closeDialog">取消</button>
            <button class="batman-button primary" :disabled="isBusy" type="submit"><Save :size="15" />保存</button>
          </footer>
        </form>

        <form
          v-else-if="dialog === 'source'"
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
          <div ref="aiModelList" class="system-ai-list">
            <section
              v-for="(model, index) in aiModels"
              :key="model.id"
              :class="['system-ai-model', { expanded: isAiModelExpanded(model) }]"
              :data-model-id="model.id"
            >
              <header class="system-ai-model-summary">
                <button
                  :aria-expanded="isAiModelExpanded(model)"
                  :aria-label="`${isAiModelExpanded(model) ? '收起' : '展开'} ${model.name || model.id} 配置`"
                  class="system-ai-model-summary-toggle"
                  type="button"
                  @click="toggleAiModel(model)"
                >
                  <ChevronDown :class="{ collapsed: !isAiModelExpanded(model) }" :size="16" />
                  <span>
                    <b>{{ model.name || model.id }}</b>
                    <small>{{ modelSummary(model) }}</small>
                  </span>
                </button>
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
              <div v-if="isAiModelExpanded(model)" class="system-ai-grid">
                <label
                  ><span>配置 ID</span
                  ><input
                    v-model.trim="model.id"
                    :aria-label="`模型配置 ID ${index + 1}`"
                    maxlength="80"
                  /></label
                ><label
                  ><span>名称</span
                  ><input
                    v-model.trim="model.name"
                    aria-label="模型名称"
                    data-ai-field="name"
                    maxlength="80"
                  /></label
                ><label
                  ><span>服务商</span
                  ><select
                    v-model="model.provider"
                    :aria-label="`模型服务商 ${index + 1}`"
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
                  ><span class="system-ai-model-picker"
                    ><input
                      v-model.trim="model.model"
                      :aria-label="`模型标识 ${index + 1}`"
                      :disabled="model.provider === 'local'"
                      maxlength="200"
                    /><button
                      class="batman-button"
                      :disabled="
                        aiModelCatalogLoading || model.provider === 'local'
                      "
                      type="button"
                      @click="fetchOpenCodeGoModels"
                      >{{
                        aiModelCatalogLoading ? "获取中…" : "获取模型列表"
                      }}</button
                    ></span
                  ></label
                ><p
                  v-if="aiModelCatalogLoading"
                  class="system-configuration-feedback"
                >
                  正在获取 OpenCode Go 模型列表…
                </p>
                <p
                  v-else-if="aiModelCatalogError !== null"
                  class="system-configuration-feedback error"
                >
                  {{ aiModelCatalogError }}
                </p>
                <ul v-if="aiModelCatalog.length > 0" class="system-ai-catalog">
                  <li v-for="modelId in aiModelCatalog" :key="modelId">
                    <button type="button" @click="model.model = modelId">
                      {{ modelId }}
                    </button>
                  </li>
                </ul>
                <label class="span-2"
                  ><span>Base URL</span
                  ><input
                    v-model.trim="model.baseUrl"
                    :aria-label="`模型 Base URL ${index + 1}`"
                    :disabled="model.provider === 'local'"
                    maxlength="500"
                    placeholder="https://…/v1" /></label
                ><label class="span-2"
                  ><span>API Key</span
                  ><input
                    v-model="model.apiKey"
                    :aria-label="`模型 API Key ${index + 1}`"
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
.system-market-snapshot-actions {
  align-items: center;
  display: flex;
  gap: 8px;
}
.system-row-select {
  appearance: none;
  background-color: #1a2638;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2370d7cf' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-position: right 10px center;
  background-repeat: no-repeat;
  border: 1px solid #3b526d;
  border-radius: 5px;
  color: #d8e5f1;
  font-size: 13px;
  min-height: 32px;
  padding: 0 30px 0 11px;
  padding-right: 30px;
}
.system-row-select:hover {
  background-color: #23334a;
  border-color: #4d6988;
}
.system-row-select:focus {
  border-color: #65d7ca;
  outline: 1px solid #65d7ca;
}
.system-row-select:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.system-row-select option {
  background-color: #1d293b;
  color: #eaf3fb;
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
.system-dialog-form input,
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
.system-dialog-form input:focus,
.system-ai-grid input:focus,
.system-ai-grid select:focus,
.system-calendar-toolbar input:focus,
.system-ai-prompt textarea:focus {
  border-color: #65d7ca;
  outline: 1px solid #65d7ca;
}
.system-snapshot-toggle {
  align-items: center;
  color: #d7e7f4;
  display: flex !important;
  font-size: 13px !important;
  gap: 8px !important;
}
.system-snapshot-help {
  color: #8499ae;
  font-size: 12px;
  line-height: 1.55;
  margin: -5px 0 0;
}
.system-snapshot-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.system-snapshot-grid.disabled {
  opacity: 0.52;
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
.batman-dialog.system-ai-modal {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 56px);
  max-width: 760px;
  overflow: hidden;
  padding: 12px 14px;
  width: min(100%, 760px);
}
.batman-dialog.system-ai-modal > header {
  flex: none;
  margin-bottom: 10px;
  padding-bottom: 9px;
}
.system-ai-dialog {
  display: grid;
  gap: 13px;
  min-height: 0;
  overflow-y: auto;
}
.system-ai-modal .system-ai-dialog {
  gap: 8px;
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
.system-ai-modal .system-ai-list {
  gap: 7px;
  max-height: min(460px, calc(100dvh - 190px));
  padding-right: 5px;
}
.system-ai-modal .system-ai-dialog > footer {
  background: #151f30;
  border-top: 1px solid #2a4058;
  bottom: 0;
  flex: none;
  margin-top: 0;
  padding-top: 8px;
  position: sticky;
  z-index: 1;
}
.system-ai-model {
  border: 1px solid #2a4058;
  border-radius: 6px;
  overflow: hidden;
}
.system-ai-model-summary {
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: space-between;
  min-height: 46px;
  padding: 6px 8px 6px 10px;
}
.system-ai-model-summary-toggle {
  align-items: center;
  background: transparent;
  border: 0;
  color: inherit;
  display: flex;
  flex: 1;
  font: inherit;
  gap: 7px;
  min-width: 0;
  padding: 0;
  text-align: left;
}
.system-ai-model-summary-toggle > svg {
  color: #8ca9be;
  flex: 0 0 auto;
  transition: transform 120ms ease;
}
.system-ai-model-summary-toggle > svg.collapsed {
  transform: rotate(-90deg);
}
.system-ai-model-summary-toggle > span {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.system-ai-model-summary b {
  color: #eff9ff;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.system-ai-model-summary small {
  color: #829bb1;
  display: block;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.system-ai-model-actions {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
}
.system-ai-model-actions .batman-icon-button.danger:hover {
  color: #ff929b;
}
.system-ai-grid {
  border-top: 1px solid #2a4058;
  display: grid;
  gap: 6px;
  grid-template-columns: 1fr;
  padding: 8px 10px 10px;
}
.system-ai-grid label,
.system-ai-grid label.span-2 {
  align-items: center;
  gap: 8px;
  grid-column: auto;
  grid-template-columns: 82px minmax(0, 1fr);
}
.system-ai-grid label > span {
  color: #9db4c7;
  white-space: nowrap;
}
.system-ai-modal .system-ai-grid input,
.system-ai-modal .system-ai-grid select {
  min-height: 32px;
}
.system-ai-grid input:disabled {
  color: #6f8193;
  opacity: 0.72;
}
.system-ai-model-picker {
  align-items: center;
  display: flex;
  gap: 8px;
  min-width: 0;
}
.system-ai-model-picker input {
  flex: 1;
  min-width: 0;
}
.system-ai-grid .system-configuration-feedback {
  margin: 0;
}
.system-ai-catalog {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  list-style: none;
  margin: 0;
  max-height: 142px;
  overflow-y: auto;
  padding: 0;
  scrollbar-gutter: stable;
}
.system-ai-catalog button {
  background: #17283a;
  border: 1px solid #31506a;
  border-radius: 5px;
  color: #b9c9d9;
  cursor: pointer;
  font-size: 12px;
  padding: 4px 9px;
}
.system-ai-catalog button:hover {
  border-color: #65d7ca;
  color: #edf6ff;
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
.system-rule-interval select {
  background: #1d293b;
  border: 1px solid #3a506d;
  border-radius: 5px;
  color: #edf6ff;
  min-height: 36px;
  padding: 0 9px;
  width: 96px;
}
.system-config-value {
  color: #7ddbd0;
  font-size: 12px;
  justify-self: end;
}
.system-diagnosis-settings {
  display: grid;
}
.system-diagnosis-time {
  background: #1d293b;
  border: 1px solid #3a506d;
  border-radius: 5px;
  color: #edf6ff;
  font: inherit;
  font-size: 12px;
  min-height: 36px;
  padding: 0 9px;
  width: 116px;
}
.system-diagnosis-detail {
  border-bottom: 1px solid #263950;
  display: grid;
  gap: 12px;
  padding: 15px 0;
}
.system-diagnosis-detail-heading {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
}
.system-diagnosis-detail-heading h2 {
  color: #9db3c8;
  font-size: 12px;
  font-weight: 600;
  margin: 0;
}
.system-diagnosis-source-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.system-diagnosis-source {
  align-items: flex-start;
  background: #132237;
  border: 1px solid #29415d;
  border-radius: 5px;
  display: flex;
  gap: 8px;
  min-height: 59px;
  padding: 9px;
}
.system-diagnosis-source:has(input:checked) {
  background: #173641;
  border-color: #4b978f;
}
.system-diagnosis-source.disabled {
  opacity: 0.58;
}
.system-diagnosis-source input {
  accent-color: #5bd3c8;
  margin: 2px 0 0;
}
.system-diagnosis-source span {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.system-diagnosis-source b {
  color: #d9ebf7;
  font-size: 12px;
}
.system-diagnosis-source small {
  color: #879eb4;
  font-size: 11px;
  line-height: 1.35;
}
.system-diagnosis-prompt {
  position: relative;
}
.system-diagnosis-prompt label {
  display: grid;
  gap: 7px;
}
.system-diagnosis-prompt label > span,
.system-diagnosis-options label > span {
  color: #9db3c8;
  font-size: 12px;
  font-weight: 600;
}
.system-diagnosis-prompt textarea {
  background: #16263a;
  border: 1px solid #35506c;
  border-radius: 5px;
  color: #e5f1fa;
  font: inherit;
  font-size: 12px;
  line-height: 1.55;
  min-height: 88px;
  padding: 8px 9px;
  resize: vertical;
}
.system-diagnosis-prompt small {
  color: #71899f;
  font-size: 11px;
  justify-self: end;
}
.system-diagnosis-options {
  border-bottom: 1px solid #263950;
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  padding: 15px 0;
}
.system-diagnosis-options label {
  display: grid;
  gap: 6px;
}
.system-diagnosis-options select {
  background: #1d293b;
  border: 1px solid #3a506d;
  border-radius: 5px;
  color: #edf6ff;
  font-size: 12px;
  min-height: 36px;
  padding: 0 8px;
}
@media (max-width: 1220px) {
  .system-calendar-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .system-diagnosis-source-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 720px) {
  .batman-dialog.system-ai-modal {
    max-height: calc(100dvh - 32px);
    padding: 12px;
  }
  .system-ai-modal .system-ai-list {
    max-height: calc(100dvh - 172px);
  }
  .system-ai-model-summary {
    align-items: flex-start;
  }
  .system-ai-model-actions {
    gap: 5px;
  }
  .system-configuration-layout {
    display: block;
  }
  .system-configuration-nav {
    border-bottom: 1px solid #2a3d56;
    border-right: 0;
    display: flex;
    gap: 5px;
    overflow-x: auto;
    padding: 5px 0 10px;
  }
  .system-configuration-nav-heading {
    display: none;
  }
  .system-configuration-nav-item {
    flex: 0 0 auto;
    width: auto;
  }
  .system-configuration-nav-item svg:last-child {
    display: none;
  }
  .system-configuration-content {
    padding: 18px 0 0;
  }
  .system-diagnosis-options {
    grid-template-columns: 1fr;
  }
}
</style>
