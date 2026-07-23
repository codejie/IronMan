<script setup lang="ts">
import { BarChart3, Bot, ChevronDown, ChevronRight, CirclePlus, ClipboardList, LoaderCircle, Play, RotateCcw, Save, Search, Square, Trash2, X } from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import InstrumentSearch from "@/components/InstrumentSearch.vue";
import TrendReportChart from "@/components/TrendReportChart.vue";
import {
  api,
  ApiError,
  type Instrument,
  type TrendDateRange,
  type TrendDirection,
  type TrendIndicatorDefinition,
  type TrendIndicatorSelection,
  type TrendReportWindow,
  type TrendRun,
  type TrendRunLog,
  type TrendRunReport,
  type TrendStrategy,
  type TrendStrategyTargets,
  type TrendTargetScope
} from "@/api/client";
import { useSession } from "@/stores/session";
import { formatDateTime } from "@/utils/date-format";
import { requestConfirmation } from "@/components/confirmation";

type ReportFilter = "all" | TrendDirection | "failed" | "high" | "medium";
type StrategyDraft = Omit<TrendStrategy, "id" | "createdAt" | "updatedAt">;

const { token } = useSession();
const strategies = ref<TrendStrategy[]>([]);
const catalog = ref<TrendIndicatorDefinition[]>([]);
const runs = ref<TrendRun[]>([]);
const reports = ref<TrendRunReport[]>([]);
const logs = ref<TrendRunLog[]>([]);
const strategyTargets = ref<TrendStrategyTargets | null>(null);
const selectedStrategyId = ref<string | null>(null);
const selectedRunId = ref<string | null>(null);
const selectedReportId = ref<string | null>(null);
const reportFilter = ref<ReportFilter>("all");
const isLoading = ref(false);
const isSaving = ref(false);
const isRunning = ref(false);
const isStrategyDrawerOpen = ref(false);
const isStrategyManagerOpen = ref(false);
const isGeneratingAi = ref(false);
const isLogsOpen = ref(false);
const deletingRunId = ref<string | null>(null);
const aiAvailable = ref(false);
const aiInterpretation = ref("");
const errorMessage = ref("");
const noticeMessage = ref("");
const toastMessage = ref("");
let stream: EventSource | undefined;
let toastTimer: number | undefined;

function emptyDraft(): StrategyDraft {
  return {
    name: "",
    remarks: "",
    targetScope: "holdings_watchlist",
    dataRange: { preset: "6m" },
    reportWindow: "7d",
    backtestConfig: null,
    customInstrumentIds: [],
    indicators: [
      { indicatorId: "MA", parameters: { period: 20 }, enabled: true, displayOrder: 0 },
      { indicatorId: "MACD", parameters: { fast: 12, slow: 26, signal: 9 }, enabled: true, displayOrder: 1 }
    ]
  };
}

const draft = ref<StrategyDraft>(emptyDraft());
const selectedStrategy = computed(() => strategies.value.find((strategy) => strategy.id === selectedStrategyId.value) ?? null);
const selectedRun = computed(() => runs.value.find((run) => run.id === selectedRunId.value) ?? null);
const selectedReport = computed(() => reports.value.find((report) => report.id === selectedReportId.value) ?? reports.value[0] ?? null);
const selectedIndicatorIds = computed(() => new Set(draft.value.indicators.filter((indicator) => indicator.enabled !== false).map((indicator) => indicator.indicatorId)));
const selectedCatalog = computed(() => catalog.value.filter((definition) => selectedIndicatorIds.value.has(definition.id)));
const isRunActive = computed(() => selectedRun.value?.status === "queued" || selectedRun.value?.status === "running");
const filteredReports = computed(() => reports.value.filter((report) => {
  if (reportFilter.value === "all") return true;
  if (reportFilter.value === "failed") return report.result.error !== null;
  if (reportFilter.value === "high" || reportFilter.value === "medium") return report.result.error === null && report.result.risk.level === reportFilter.value;
  return report.result.error === null && report.result.direction === reportFilter.value;
}));

const scopeOptions: Array<{ value: TrendTargetScope; label: string }> = [
  { value: "holdings", label: "持仓记录" },
  { value: "watchlist", label: "自选列表" },
  { value: "holdings_watchlist", label: "持仓 + 自选" },
  { value: "custom", label: "自定义标的" },
  { value: "all", label: "全市场" }
];
const rangeOptions: Array<{ value: TrendDateRange["preset"]; label: string }> = [{ value: "3m", label: "3个月" }, { value: "6m", label: "6个月" }, { value: "1y", label: "1年" }, { value: "2y", label: "2年" }, { value: "custom", label: "自定义" }];
const reportWindowOptions: Array<{ value: TrendReportWindow; label: string }> = [{ value: "1d", label: "1天" }, { value: "3d", label: "3天" }, { value: "7d", label: "7天" }, { value: "30d", label: "30天" }, { value: "all", label: "全部" }];

function message(error: unknown, fallback: string): string { return error instanceof ApiError ? error.message : fallback; }
function cloneDraft(strategy: TrendStrategy): StrategyDraft { return { name: strategy.name, remarks: strategy.remarks, targetScope: strategy.targetScope, dataRange: { ...strategy.dataRange }, reportWindow: strategy.reportWindow, backtestConfig: strategy.backtestConfig, customInstrumentIds: [...strategy.customInstrumentIds], indicators: strategy.indicators.map((item) => ({ ...item, parameters: { ...item.parameters } })) }; }
function rangeLabel(range: TrendDateRange): string { return range.preset === "custom" ? `${range.startDate ?? ""} 至 ${range.endDate ?? ""}` : rangeOptions.find((item) => item.value === range.preset)?.label ?? range.preset; }
function scopeLabel(scope: TrendTargetScope): string { return scopeOptions.find((item) => item.value === scope)?.label ?? scope; }
function directionLabel(direction: TrendDirection): string { return direction === "bullish" ? "多头" : direction === "bearish" ? "空头" : "中性"; }
function directionTone(direction: TrendDirection): string { return direction === "bullish" ? "up" : direction === "bearish" ? "down" : ""; }
function riskLabel(level: "high" | "medium" | "low"): string { return level === "high" ? "高风险" : level === "medium" ? "观察" : "低风险"; }
function typeLabel(type: TrendRunReport["result"]["instrument"]["assetType"]): string { return type === "fund" ? "基金" : type === "index" ? "指数" : "股票"; }
function strategyOptionLabel(strategy: TrendStrategy): string { return `[${scopeLabel(strategy.targetScope)}] ${strategy.name}: ${strategy.remarks.trim() || "未填写描述"}`; }
function runTitle(run: TrendRun): string {
  if (run.status === "completed") return run.overallDirection === "bullish" ? "偏多" : run.overallDirection === "bearish" ? "偏空" : "中性";
  return run.status === "running" || run.status === "queued" ? "计算中" : run.status === "cancelled" ? "已停止" : "失败";
}
function runTone(run: TrendRun): string { return run.status === "completed" && run.overallDirection !== null ? directionTone(run.overallDirection) : run.status; }
function formatPrice(value: number | null): string { return value === null ? "--" : value.toFixed(value < 10 ? 4 : 2); }

function showToast(message: string): void {
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastMessage.value = message;
  toastTimer = window.setTimeout(() => {
    toastMessage.value = "";
    toastTimer = undefined;
  }, 2400);
}

function openCreateStrategy(): void {
  selectedStrategyId.value = null;
  draft.value = emptyDraft();
  isStrategyManagerOpen.value = false;
  isStrategyDrawerOpen.value = true;
  errorMessage.value = "";
}
function openEditStrategy(strategy = selectedStrategy.value): void {
  if (strategy === null) { openCreateStrategy(); return; }
  selectedStrategyId.value = strategy.id;
  draft.value = cloneDraft(strategy);
  isStrategyManagerOpen.value = false;
  isStrategyDrawerOpen.value = true;
  errorMessage.value = "";
}
function selectStrategy(strategy: TrendStrategy): void {
  selectedStrategyId.value = strategy.id;
  draft.value = cloneDraft(strategy);
  errorMessage.value = "";
  noticeMessage.value = "";
  aiInterpretation.value = "";
  void loadRuns(strategy.id);
  void loadStrategyTargets(strategy.id);
}
function selectStrategyFromHeader(): void {
  const strategy = selectedStrategy.value;
  if (strategy !== null) selectStrategy(strategy);
}
function duplicateStrategy(strategy: TrendStrategy): void {
  selectedStrategyId.value = null;
  draft.value = { ...cloneDraft(strategy), name: `${strategy.name} 副本` };
  isStrategyManagerOpen.value = false;
  isStrategyDrawerOpen.value = true;
}

async function loadInitial(): Promise<void> {
  if (token.value === null) return;
  isLoading.value = true;
  errorMessage.value = "";
  try {
    const [catalogResult, strategiesResult, aiConfig] = await Promise.all([
      api.trendIndicatorCatalog(token.value),
      api.listTrendStrategies(token.value),
      api.getAiConfig(token.value)
    ]);
    catalog.value = catalogResult.items;
    strategies.value = strategiesResult.items;
    aiAvailable.value = aiConfig.models.some((model) => model.enabled && model.provider !== "local");
    if (strategies.value[0] !== undefined) selectStrategy(strategies.value[0]);
  } catch (error) {
    errorMessage.value = message(error, "加载趋势策略失败");
  } finally {
    isLoading.value = false;
  }
}

async function saveStrategy(): Promise<void> {
  if (token.value === null || isSaving.value) return;
  if (draft.value.name.trim() === "") { errorMessage.value = "请填写策略名称"; return; }
  if (draft.value.indicators.filter((item) => item.enabled !== false).length === 0) { errorMessage.value = "请至少选择一个指标"; return; }
  isSaving.value = true;
  errorMessage.value = "";
  try {
    const current = selectedStrategy.value;
    const saved = current === null
      ? await api.createTrendStrategy(token.value, draft.value)
      : await api.updateTrendStrategy(token.value, { ...draft.value, id: current.id, createdAt: current.createdAt, updatedAt: current.updatedAt });
    const index = strategies.value.findIndex((item) => item.id === saved.id);
    if (index === -1) strategies.value = [saved, ...strategies.value];
    else strategies.value.splice(index, 1, saved);
    selectedStrategyId.value = saved.id;
    draft.value = cloneDraft(saved);
    isStrategyDrawerOpen.value = false;
    noticeMessage.value = "策略已保存";
    await Promise.all([loadRuns(saved.id), loadStrategyTargets(saved.id)]);
  } catch (error) {
    errorMessage.value = message(error, "保存趋势策略失败");
  } finally {
    isSaving.value = false;
  }
}

async function removeStrategy(strategy = selectedStrategy.value): Promise<void> {
  if (token.value === null || strategy === null || isSaving.value) return;
  if (!await requestConfirmation({ title: "删除趋势策略", message: `删除“${strategy.name}”后，对应运行记录和报告也会移除。确定继续吗？`, confirmLabel: "删除", tone: "danger" })) return;
  isSaving.value = true;
  try {
    await api.deleteTrendStrategy(token.value, strategy.id);
    strategies.value = strategies.value.filter((item) => item.id !== strategy.id);
    isStrategyDrawerOpen.value = false;
    isStrategyManagerOpen.value = false;
    const next = strategies.value[0] ?? null;
    selectedStrategyId.value = next?.id ?? null;
    draft.value = next === null ? emptyDraft() : cloneDraft(next);
    if (next === null) { runs.value = []; reports.value = []; logs.value = []; strategyTargets.value = null; }
    else await Promise.all([loadRuns(next.id), loadStrategyTargets(next.id)]);
  } catch (error) {
    errorMessage.value = message(error, "删除趋势策略失败");
  } finally {
    isSaving.value = false;
  }
}

function toggleIndicator(definition: TrendIndicatorDefinition): void {
  const index = draft.value.indicators.findIndex((item) => item.indicatorId === definition.id);
  if (index >= 0) { draft.value.indicators.splice(index, 1); return; }
  draft.value.indicators.push({ indicatorId: definition.id, parameters: Object.fromEntries(definition.parameters.map((parameter) => [parameter.key, parameter.defaultValue])), enabled: true, displayOrder: draft.value.indicators.length });
}
function selectedIndicator(id: string): TrendIndicatorSelection | undefined { return draft.value.indicators.find((item) => item.indicatorId === id); }
function addCustomTarget(instrument: Instrument): void { if (!draft.value.customInstrumentIds.includes(instrument.id)) draft.value.customInstrumentIds.push(instrument.id); }
function removeCustomTarget(id: string): void { draft.value.customInstrumentIds = draft.value.customInstrumentIds.filter((item) => item !== id); }

async function loadRuns(strategyId: string): Promise<void> {
  if (token.value === null) return;
  try {
    runs.value = (await api.listTrendRuns(token.value, strategyId)).items.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const active = runs.value.find((run) => run.status === "queued" || run.status === "running");
    const preferred = active ?? runs.value[0];
    if (preferred !== undefined) await selectRun(preferred.id);
    else { selectedRunId.value = null; selectedReportId.value = null; reports.value = []; logs.value = []; }
  } catch (error) { errorMessage.value = message(error, "读取趋势任务失败"); }
}

async function loadStrategyTargets(strategyId: string): Promise<void> {
  if (token.value === null) return;
  strategyTargets.value = null;
  try {
    const targets = await api.listTrendStrategyTargets(token.value, strategyId);
    if (selectedStrategyId.value === strategyId) strategyTargets.value = targets;
  }
  catch (error) { strategyTargets.value = null; errorMessage.value = message(error, "读取策略范围失败"); }
}

async function selectRun(runId: string): Promise<void> {
  if (token.value === null) return;
  selectedRunId.value = runId;
  aiInterpretation.value = "";
  isLogsOpen.value = false;
  logs.value = [];
  try {
    const [reportResult, run] = await Promise.all([
      api.listTrendReports(token.value, runId),
      api.getTrendRun(token.value, runId)
    ]);
    reports.value = reportResult.items;
    replaceRun(run);
    selectedReportId.value = reports.value.some((report) => report.id === selectedReportId.value) ? selectedReportId.value : reports.value[0]?.id ?? null;
    if (run.status === "queued" || run.status === "running") connect(runId);
    else disconnect();
  } catch (error) { errorMessage.value = message(error, "读取趋势报告失败"); }
}

async function startRun(): Promise<void> {
  const strategy = selectedStrategy.value;
  if (token.value === null || strategy === null || isRunning.value) return;
  isRunning.value = true;
  errorMessage.value = "";
  noticeMessage.value = "";
  try {
    const estimate = await api.estimateTrendRun(token.value, strategy.id);
    if (estimate.targetTotal === 0) throw new Error("当前目标范围没有可分析标的");
    if (estimate.confirmationToken !== null && !await requestConfirmation({ title: "确认全市场计算", message: `本次将分析 ${estimate.targetTotal} 个标的，计算可能需要较长时间。确定开始吗？`, confirmLabel: "开始计算" })) return;
    const run = await api.startTrendRun(token.value, strategy.id, estimate.confirmationToken ?? undefined);
    runs.value = [run, ...runs.value];
    selectedRunId.value = run.id;
    selectedReportId.value = null;
    reports.value = [];
    logs.value = [];
    isLogsOpen.value = false;
    aiInterpretation.value = "";
    connect(run.id);
  } catch (error) {
    errorMessage.value = message(error, "启动趋势计算失败");
  } finally {
    isRunning.value = false;
  }
}

async function cancelRun(): Promise<void> {
  const run = selectedRun.value;
  if (token.value === null || run === null) return;
  try { replaceRun(await api.cancelTrendRun(token.value, run.id)); }
  catch (error) { errorMessage.value = message(error, "停止趋势计算失败"); }
}

async function deleteRun(run: TrendRun): Promise<void> {
  if (token.value === null || deletingRunId.value !== null || run.status === "queued" || run.status === "running") return;
  if (!await requestConfirmation({ title: "删除运行记录", message: `删除 ${formatDateTime(run.createdAt)} 的运行记录及其报告后不可恢复。确定删除吗？`, confirmLabel: "删除", tone: "danger" })) return;
  deletingRunId.value = run.id;
  try {
    await api.deleteTrendRun(token.value, run.id);
    runs.value = runs.value.filter((item) => item.id !== run.id);
    if (selectedRunId.value === run.id) {
      const next = runs.value[0];
      if (next === undefined) {
        selectedRunId.value = null;
        selectedReportId.value = null;
        reports.value = [];
        logs.value = [];
      } else await selectRun(next.id);
    }
    showToast("运行记录已删除");
  } catch (error) { errorMessage.value = message(error, "删除运行记录失败"); }
  finally { deletingRunId.value = null; }
}

async function toggleLogs(): Promise<void> {
  if (selectedRunId.value === null || token.value === null) return;
  isLogsOpen.value = !isLogsOpen.value;
  if (!isLogsOpen.value) return;
  try { logs.value = (await api.listTrendLogs(token.value, selectedRunId.value)).items; }
  catch (error) { errorMessage.value = message(error, "读取执行日志失败"); }
}

async function createReminder(report: TrendRunReport): Promise<void> {
  if (token.value === null || report.result.error !== null || report.result.risk.reminder === null) return;
  const reminder = report.result.risk.reminder;
  const relation = reminder.direction === "below" ? "跌破" : "突破";
  if (!await requestConfirmation({ title: "创建风险提醒", message: `为 ${report.result.instrument.name} 创建“${relation} ${reminder.threshold.toFixed(4)}”风险提醒吗？`, confirmLabel: "创建提醒" })) return;
  try {
    await api.createAlert(token.value, { instrumentId: report.result.instrument.id, direction: reminder.direction, threshold: reminder.threshold, cooldownMinutes: reminder.cooldownMinutes });
    noticeMessage.value = `${report.result.instrument.name} 的风险提醒已创建`;
  } catch (error) { errorMessage.value = message(error, "创建风险提醒失败"); }
}

async function interpretSelectedReport(): Promise<void> {
  if (token.value === null || selectedRunId.value === null || selectedReport.value === null || isGeneratingAi.value) return;
  isGeneratingAi.value = true;
  try {
    const result = await api.interpretTrendReport(token.value, selectedRunId.value, selectedReport.value.id);
    aiInterpretation.value = result.content;
  } catch (error) { errorMessage.value = message(error, "AI 解读失败"); }
  finally { isGeneratingAi.value = false; }
}

function selectReport(report: TrendRunReport): void { selectedReportId.value = report.id; aiInterpretation.value = ""; }
function connect(runId: string): void {
  if (token.value === null || stream !== undefined) return;
  const next = api.streamTrendRun(token.value, runId);
  stream = next;
  const parse = <T>(event: Event): T => JSON.parse((event as MessageEvent<string>).data) as T;
  next.addEventListener("snapshot", (event) => { if (stream === next) replaceRun(parse<TrendRun>(event)); });
  next.addEventListener("progress", (event) => { if (stream === next) replaceRun(parse<TrendRun>(event)); });
  next.addEventListener("report", (event) => {
    if (stream !== next) return;
    const report = parse<TrendRunReport>(event);
    const index = reports.value.findIndex((item) => item.instrumentId === report.instrumentId);
    if (index >= 0) reports.value.splice(index, 1, report); else reports.value.push(report);
    selectedReportId.value ??= report.id;
  });
  next.addEventListener("log", (event) => { if (stream === next && isLogsOpen.value) logs.value.push(parse<TrendRunLog>(event)); });
  for (const type of ["completed", "failed", "cancelled"] as const) next.addEventListener(type, (event) => {
    if (stream !== next) return;
    replaceRun(parse<TrendRun>(event));
    disconnect();
    if (selectedRunId.value === runId) void selectRun(runId);
  });
  next.addEventListener("error", () => { if (stream === next && isRunActive.value) errorMessage.value = "趋势任务连接已断开，可重新选择任务恢复报告"; });
}
function disconnect(): void { stream?.close(); stream = undefined; }
function replaceRun(run: TrendRun): void {
  const index = runs.value.findIndex((item) => item.id === run.id);
  if (index >= 0) runs.value.splice(index, 1, run);
  else runs.value = [run, ...runs.value];
  runs.value.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

onMounted(() => { void loadInitial(); });
onBeforeUnmount(() => {
  disconnect();
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
});
</script>

<template>
  <section class="batman-workspace trend-report-workspace">
    <Transition name="trend-toast">
      <p v-if="toastMessage" class="trend-toast" role="status">{{ toastMessage }}</p>
    </Transition>
    <header class="trend-page-header">
      <h1>趋势计算</h1>
      <div class="trend-header-actions">
        <label class="trend-strategy-select">
          <span>趋势策略:</span>
          <select v-model="selectedStrategyId" aria-label="当前趋势策略" @change="selectStrategyFromHeader">
            <option v-for="strategy in strategies" :key="strategy.id" :value="strategy.id">{{ strategyOptionLabel(strategy) }}</option>
          </select>
        </label>
        <button class="batman-button" :disabled="selectedStrategy === null" type="button" @click="() => openEditStrategy()"><BarChart3 :size="15" />编辑策略</button>
        <button class="batman-button" type="button" @click="openCreateStrategy"><CirclePlus :size="15" />新建策略</button>
      </div>
    </header>
    <p v-if="errorMessage" class="batman-error">{{ errorMessage }}</p><p v-else-if="noticeMessage" class="trend-notice">{{ noticeMessage }}</p>

    <div v-if="isLoading" class="trend-loading"><LoaderCircle :size="18" />正在加载趋势工作台...</div>
    <div v-else-if="selectedStrategy !== null" class="trend-report-layout">
      <aside class="trend-run-rail">
        <div class="trend-run-actions" aria-label="趋势运行操作">
          <button v-if="isRunActive" class="batman-button danger" type="button" @click="cancelRun"><Square :size="13" />停止</button>
          <button v-else class="batman-button primary" :disabled="isRunning" type="button" @click="startRun"><Play :size="14" />{{ isRunning ? '预估中' : '开始计算' }}</button>
          <button class="batman-button" disabled title="回测功能即将推出" type="button"><RotateCcw :size="13" />回测</button>
        </div>
        <section class="trend-run-section">
          <div class="trend-rail-heading"><strong>运行记录</strong><span>{{ runs.length }}</span></div>
          <div class="trend-run-list">
            <article v-for="run in runs" :key="run.id" :class="['trend-run-item', { active: run.id === selectedRunId }]">
              <button type="button" @click="selectRun(run.id)">
                <i :class="['trend-status-dot', run.status]" />
                <strong :class="runTone(run)">{{ runTitle(run) }}</strong>
                <small>{{ run.targetCompleted }}/{{ run.targetTotal }} · {{ formatDateTime(run.createdAt) }}</small>
              </button>
              <button :aria-label="`删除 ${formatDateTime(run.createdAt)} 的运行记录`" class="trend-run-delete" :disabled="deletingRunId === run.id || run.status === 'queued' || run.status === 'running'" type="button" @click="deleteRun(run)"><Trash2 :size="13" /></button>
            </article>
            <p v-if="runs.length === 0" class="trend-empty">尚无计算记录</p>
          </div>
        </section>

        <section class="trend-strategy-summary">
          <header><strong>策略信息</strong></header>
          <dl>
            <div><dt>跨度</dt><dd>{{ rangeLabel(selectedStrategy.dataRange) }}</dd></div>
            <div><dt>指标</dt><dd>{{ selectedStrategy.indicators.map((item) => item.indicatorId).join('、') || '--' }}</dd></div>
            <div><dt>窗口</dt><dd>{{ reportWindowOptions.find((item) => item.value === selectedStrategy?.reportWindow)?.label ?? '--' }}</dd></div>
          </dl>
          <div class="trend-target-summary"><strong>范围</strong><span v-if="selectedStrategy.targetScope === 'all'">全市场</span>
            <div v-else-if="strategyTargets" class="trend-target-table-wrap"><table class="trend-target-table"><thead><tr><th>名称/代码</th><th>当前价格</th></tr></thead><tbody><tr v-for="item in strategyTargets.items" :key="item.instrument.id"><td><strong>{{ item.instrument.name }}</strong><span>{{ item.instrument.code }} [{{ typeLabel(item.instrument.assetType) }}]</span></td><td>{{ formatPrice(item.currentPrice) }}</td></tr><tr v-if="strategyTargets.items.length === 0"><td colspan="2">当前范围没有可展示标的</td></tr></tbody></table></div>
            <span v-else>加载范围中...</span>
          </div>
        </section>

        <section class="trend-log-panel">
          <header><strong><ClipboardList :size="14" />执行日志</strong><button class="batman-text-button" :disabled="selectedRunId === null" type="button" @click="toggleLogs"><ChevronDown v-if="isLogsOpen" :size="13" /><ChevronRight v-else :size="13" />{{ isLogsOpen ? '收起' : '显示' }}</button></header>
          <ol v-if="isLogsOpen"><li v-for="log in logs" :key="log.id" :class="log.level"><time>{{ formatDateTime(log.createdAt) }}</time><span>{{ log.message }}</span></li><li v-if="logs.length === 0">暂无日志</li></ol>
        </section>
      </aside>

      <main class="trend-report-main">
        <section class="trend-report-section">
          <header>
            <div><h2>运行报告</h2></div>
            <div class="trend-report-filters"><button v-for="filter in ['all', 'bullish', 'bearish', 'neutral', 'high', 'medium', 'failed'] as ReportFilter[]" :key="filter" :class="{ active: reportFilter === filter }" type="button" @click="reportFilter = filter">{{ filter === 'all' ? '全部' : filter === 'failed' ? '失败' : filter === 'high' ? '高风险' : filter === 'medium' ? '观察' : directionLabel(filter) }}</button></div>
          </header>
          <div class="trend-report-table-wrap"><table class="trend-report-table"><thead><tr><th>标的</th><th>趋势</th><th>最新信号</th><th>风险</th><th>建议</th><th>操作</th></tr></thead><tbody>
            <tr v-for="report in filteredReports" :key="report.id" :class="{ selected: report.id === selectedReport?.id }" @click="selectReport(report)">
              <td><strong>{{ report.result.instrument.name }}</strong><span>{{ report.result.instrument.code }} [{{ typeLabel(report.result.instrument.assetType) }}]</span></td>
              <td :class="directionTone(report.result.direction)">{{ report.result.error === null ? directionLabel(report.result.direction) : '-' }}</td>
              <td>{{ report.result.error ?? report.result.risk.evidence.slice(0, 2).join('；') }}</td>
              <td><span v-if="report.result.error === null" :class="['trend-risk-pill', report.result.risk.level]">{{ riskLabel(report.result.risk.level) }}</span><span v-else>失败</span></td>
              <td>{{ report.result.error === null ? report.result.risk.suggestedAction : '--' }}</td>
              <td class="trend-report-actions"><button class="batman-text-button" :disabled="report.result.error !== null || report.result.risk.reminder === null" type="button" @click.stop="createReminder(report)">创建提醒</button><button class="batman-text-button" :disabled="report.result.error !== null || !aiAvailable || isGeneratingAi" type="button" @click.stop="selectReport(report); interpretSelectedReport()"><Bot :size="13" />AI 解读</button></td>
            </tr>
            <tr v-if="filteredReports.length === 0"><td colspan="6" class="trend-empty-cell">{{ isRunActive ? '正在计算，报告会随已完成的标的实时刷新' : selectedRun ? '暂无匹配报告' : '启动计算后在这里查看报告' }}</td></tr>
          </tbody></table></div>
        </section>

        <TrendReportChart v-if="selectedReport && selectedReport.result.error === null" :definitions="catalog" :report="selectedReport" :strategy="selectedStrategy" />
        <section v-if="selectedReport" class="trend-ai-card"><header><strong><Bot :size="14" />AI 解读</strong><button v-if="aiAvailable" :disabled="selectedReport.result.error !== null || isGeneratingAi" class="batman-text-button" type="button" @click="interpretSelectedReport">{{ isGeneratingAi ? '生成中' : '生成解读' }}</button></header><p v-if="!aiAvailable">配置远程 AI 模型后，可基于本地趋势和风险证据生成补充解读。</p><p v-else-if="selectedReport.result.error !== null">当前报告没有可供 AI 解读的有效行情结果。</p><p v-else-if="!aiInterpretation">AI 仅解释本地趋势、指标和风险证据，不改变计算结论。</p><p v-else class="trend-ai-content">{{ aiInterpretation }}</p></section>
      </main>
    </div>

    <div v-if="isStrategyDrawerOpen" class="trend-drawer-backdrop" @click.self="isStrategyDrawerOpen = false"><aside class="trend-strategy-drawer" role="dialog"><header><div><h2>{{ selectedStrategy ? '编辑策略' : '新建策略' }}</h2><p>设置范围、时间跨度和趋势指标。</p></div><button aria-label="关闭策略编辑" class="batman-icon-button" type="button" @click="isStrategyDrawerOpen = false"><X :size="17" /></button></header><div class="trend-drawer-scroll"><div class="trend-editor-grid"><label>策略名称<input v-model.trim="draft.name" maxlength="120" placeholder="例如：持仓趋势观察" /></label><label>报告窗口<select v-model="draft.reportWindow"><option v-for="option in reportWindowOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label><label class="wide">备注<input v-model.trim="draft.remarks" maxlength="1000" placeholder="记录这套策略的使用场景" /></label></div><div class="trend-choice-row"><span>目标范围</span><div class="trend-choice-group"><button v-for="option in scopeOptions" :key="option.value" :class="{ active: draft.targetScope === option.value }" type="button" @click="draft.targetScope = option.value">{{ option.label }}</button></div></div><div v-if="draft.targetScope === 'custom'" class="trend-custom-targets"><InstrumentSearch @select="addCustomTarget" /><div class="trend-target-chips"><span v-for="id in draft.customInstrumentIds" :key="id"><code>{{ id }}</code><button :aria-label="`移除 ${id}`" type="button" @click="removeCustomTarget(id)">×</button></span><em v-if="draft.customInstrumentIds.length === 0">请检索并添加至少一个标的</em></div></div><div class="trend-choice-row"><span>行情跨度</span><div class="trend-choice-group"><button v-for="option in rangeOptions" :key="option.value" :class="{ active: draft.dataRange.preset === option.value }" type="button" @click="draft.dataRange = { preset: option.value }">{{ option.label }}</button></div><div v-if="draft.dataRange.preset === 'custom'" class="trend-date-inputs"><input v-model="draft.dataRange.startDate" type="date" /><span>至</span><input v-model="draft.dataRange.endDate" type="date" /></div></div><div class="trend-indicator-area"><div class="trend-choice-row"><span>指标</span><small>支持趋势、动量、波动、量能、价格、形态与周期指标</small></div><div class="trend-indicator-catalog"><button v-for="definition in catalog" :key="definition.id" :class="{ active: selectedIndicatorIds.has(definition.id) }" type="button" @click="toggleIndicator(definition)"><strong>{{ definition.id }}</strong><span>{{ definition.label }}</span></button></div><div v-if="selectedCatalog.length" class="trend-parameters"><div v-for="definition in selectedCatalog" :key="definition.id" class="trend-parameter-row"><strong>{{ definition.id }}</strong><label v-for="parameter in definition.parameters" :key="parameter.key">{{ parameter.label }}<input v-model.number="selectedIndicator(definition.id)!.parameters![parameter.key]" :max="parameter.max" :min="parameter.min" :step="parameter.step ?? 1" type="number" /></label><span v-if="definition.parameters.length === 0">使用默认计算参数</span></div></div></div></div><footer><button v-if="selectedStrategy" class="batman-button danger" :disabled="isSaving" type="button" @click="() => removeStrategy()"><Trash2 :size="15" />删除</button><span /><button class="batman-button primary" :disabled="isSaving" type="button" @click="saveStrategy"><Save :size="15" />{{ isSaving ? '保存中' : '保存策略' }}</button></footer></aside></div>

    <div v-if="isStrategyManagerOpen" class="trend-drawer-backdrop" @click.self="isStrategyManagerOpen = false"><section class="trend-strategy-manager" role="dialog"><header><div><h2>管理策略</h2><p>选择、复制或删除趋势策略。</p></div><button aria-label="关闭策略管理" class="batman-icon-button" type="button" @click="isStrategyManagerOpen = false"><X :size="17" /></button></header><div class="trend-manager-list"><article v-for="strategy in strategies" :key="strategy.id" :class="{ active: strategy.id === selectedStrategyId }"><button type="button" @click="selectStrategy(strategy); isStrategyManagerOpen = false"><strong>{{ strategy.name }}</strong><span>{{ scopeLabel(strategy.targetScope) }} · {{ rangeLabel(strategy.dataRange) }} · {{ strategy.indicators.length }} 项指标</span></button><div><button class="batman-text-button" type="button" @click="openEditStrategy(strategy)">编辑</button><button class="batman-text-button" type="button" @click="duplicateStrategy(strategy)">复制</button><button class="batman-text-button danger" type="button" @click="removeStrategy(strategy)">删除</button></div></article><p v-if="strategies.length === 0" class="trend-empty">尚未创建策略</p></div><footer><button class="batman-button primary" type="button" @click="openCreateStrategy"><CirclePlus :size="15" />新建策略</button></footer></section></div>
  </section>
</template>

<style scoped>
.trend-report-workspace { max-width: 1820px; }.trend-page-header { align-items: center; border-bottom: 1px solid #26384f; display: flex; gap: 18px; justify-content: space-between; margin-bottom: 14px; padding: 2px 0 14px; }.trend-eyebrow { color: #68d9ca; font-size: 10px; font-weight: 700; letter-spacing: .09em; margin: 0 0 4px; text-transform: uppercase; }.trend-page-header h1 { color: #edf7ff; font-size: 22px; margin: 0; }.trend-page-header p:not(.trend-eyebrow) { color: #91a6bc; font-size: 12px; margin: 5px 0 0; }.trend-header-actions { align-items: center; display: flex; flex-wrap: wrap; gap: 7px; justify-content: flex-end; }.trend-header-actions select { background: #162236; border: 1px solid #344963; border-radius: 4px; color: #d8e8f6; font-size: 12px; min-height: 31px; padding: 0 8px; }.trend-notice { color: #74dab1; font-size: 12px; margin: 0 0 9px; }.trend-loading, .trend-no-strategy { align-items: center; background: #101b2d; border: 1px solid #2d4059; border-radius: 7px; color: #a8bfd1; display: flex; gap: 9px; min-height: 140px; justify-content: center; padding: 20px; }.trend-no-strategy { flex-direction: column; }.trend-no-strategy strong { color: #e9f5fb; }.trend-no-strategy span { color: #8da4ba; font-size: 12px; }.trend-report-layout { background: #101a2a; border: 1px solid #2d4059; border-radius: 7px; display: grid; grid-template-columns: 190px minmax(0, 1fr) 260px; min-width: 0; overflow: hidden; }.trend-run-rail, .trend-risk-rail { background: #0d1727; padding: 10px; }.trend-run-rail { border-right: 1px solid #293d56; }.trend-risk-rail { border-left: 1px solid #293d56; }.trend-rail-heading { align-items: center; color: #dcebf6; display: flex; font-size: 12px; justify-content: space-between; margin: 2px 2px 8px; }.trend-rail-heading span { background: #22364e; border-radius: 10px; color: #9cb5ca; font-size: 10px; padding: 2px 7px; }.trend-run-item { background: transparent; border: 1px solid transparent; border-radius: 5px; color: #aebfd2; display: grid; gap: 3px 6px; grid-template-columns: 7px 1fr; margin-bottom: 3px; padding: 8px; text-align: left; width: 100%; }.trend-run-item:hover, .trend-run-item.active { background: #183345; border-color: #3d747a; }.trend-run-item strong { color: #e3eff8; font-size: 11px; }.trend-run-item small { color: #839bb2; font-size: 10px; grid-column: 2; }.trend-status-dot { background: #8494a6; border-radius: 50%; height: 7px; margin-top: 3px; width: 7px; }.trend-status-dot.running, .trend-status-dot.queued { background: #f2bd5d; }.trend-status-dot.completed { background: #69d991; }.trend-status-dot.failed { background: #ff7d82; }.trend-strategy-summary { border-top: 1px solid #273c55; color: #8ea5ba; display: grid; font-size: 10px; gap: 4px; margin: 14px 2px 0; padding-top: 11px; }.trend-strategy-summary strong { color: #cfdeec; font-size: 11px; }.trend-empty { color: #8096aa; font-size: 11px; margin: 15px 4px; }.trend-report-main { display: grid; gap: 12px; min-width: 0; padding: 13px; }.trend-overview-grid { display: grid; gap: 9px; grid-template-columns: 1.4fr repeat(3, minmax(0, 1fr)); }.trend-overview-grid article { background: #111f32; border: 1px solid #2a425f; border-radius: 6px; display: grid; gap: 3px; min-height: 73px; padding: 10px; }.trend-overview-grid span { color: #8fa6bd; font-size: 10px; }.trend-overview-grid strong { color: #c5d5e4; font-size: 19px; }.trend-overview-grid strong.bullish { color: #63da9b; }.trend-overview-grid strong.down, .trend-overview-grid .risk strong { color: #ff8b91; }.trend-overview-grid .warning strong { color: #f7c765; }.trend-overview-grid small { color: #849cb2; font-size: 10px; }.trend-report-section > header { align-items: flex-end; display: flex; gap: 10px; justify-content: space-between; }.trend-report-section h2 { color: #e3eff8; font-size: 14px; margin: 0; }.trend-report-section p { color: #8da4bb; font-size: 11px; margin: 4px 0 0; }.trend-report-filters { display: flex; flex-wrap: wrap; justify-content: flex-end; }.trend-report-filters button { background: #162236; border: 1px solid #344963; color: #b9c8d9; cursor: pointer; font-size: 10px; margin-left: -1px; min-height: 25px; padding: 0 7px; }.trend-report-filters button:first-child { border-radius: 4px 0 0 4px; margin-left: 0; }.trend-report-filters button:last-child { border-radius: 0 4px 4px 0; }.trend-report-filters button.active { background: #267b83; border-color: #58cfc6; color: #efffff; position: relative; z-index: 1; }.trend-report-table-wrap { border: 1px solid #2a3e57; border-radius: 5px; margin-top: 8px; overflow: auto; }.trend-report-table { border-collapse: collapse; min-width: 700px; width: 100%; }.trend-report-table th, .trend-report-table td { border-bottom: 1px solid #26384f; color: #b8c7d5; font-size: 11px; padding: 8px; text-align: left; }.trend-report-table th { background: #1a293d; color: #8ea5bd; font-size: 10px; }.trend-report-table tbody tr { cursor: pointer; }.trend-report-table tbody tr:hover, .trend-report-table tbody tr.selected { background: #153044; }.trend-report-table td:first-child strong, .trend-report-table td:first-child span { display: block; }.trend-report-table td:first-child strong { color: #edf6fb; }.trend-report-table td:first-child span { color: #7f96ad; font-size: 10px; margin-top: 2px; }.trend-report-table .up { color: #61d899; }.trend-report-table .down { color: #ff8b91; }.trend-risk-pill { border-radius: 10px; display: inline-block; font-size: 10px; padding: 2px 6px; }.trend-risk-pill.low { background: #143d31; color: #65d99d; }.trend-risk-pill.medium { background: #4a3d20; color: #ffd06b; }.trend-risk-pill.high { background: #4b2931; color: #ff9ca1; }.trend-empty-cell { color: #8296a9 !important; height: 62px; text-align: center !important; }.trend-log-panel { border-top: 1px solid #293c54; padding-top: 8px; }.trend-log-panel > strong { align-items: center; color: #cfe0ec; display: flex; font-size: 11px; gap: 6px; }.trend-log-panel ol { display: grid; gap: 4px; list-style: none; margin: 6px 0 0; max-height: 90px; overflow: auto; padding: 0; }.trend-log-panel li { color: #9db0c2; display: grid; font-size: 10px; gap: 8px; grid-template-columns: 136px 1fr; }.trend-log-panel li.error { color: #ff8e92; }.trend-log-panel time { color: #778da4; font-family: ui-monospace, monospace; }.trend-risk-item { border-bottom: 1px solid #283d56; display: grid; gap: 6px; padding: 10px 1px; }.trend-risk-item strong { display: block; font-size: 11px; }.trend-risk-item strong.high { color: #ff8b91; }.trend-risk-item strong.medium { color: #f7c765; }.trend-risk-item strong.low { color: #62d899; }.trend-risk-item span { color: #8099b2; font-size: 10px; }.trend-risk-item p { color: #b5c6d7; font-size: 10px; line-height: 1.45; margin: 0; }.trend-risk-item small { color: #889eb4; font-size: 10px; line-height: 1.4; }.trend-risk-item .batman-button { justify-self: start; min-height: 27px; padding: 0 8px; }.trend-ai-card { background: #132238; border: 1px dashed #395a78; border-radius: 6px; margin-top: 14px; padding: 9px; }.trend-ai-card header { align-items: center; display: flex; justify-content: space-between; }.trend-ai-card strong { align-items: center; color: #72d8d0; display: flex; font-size: 11px; gap: 5px; }.trend-ai-card p { color: #9eb1c4; font-size: 10px; line-height: 1.55; margin: 8px 0 0; }.trend-ai-card .trend-ai-content { color: #d0dfec; white-space: pre-wrap; }.trend-drawer-backdrop { align-items: stretch; background: #0207129e; display: flex; inset: 0; justify-content: flex-end; position: fixed; z-index: 80; }.trend-strategy-drawer { background: #101b2d; border-left: 1px solid #36506c; display: grid; grid-template-rows: auto 1fr auto; max-width: 760px; width: min(760px, 96vw); }.trend-strategy-drawer > header, .trend-strategy-manager > header { align-items: flex-start; border-bottom: 1px solid #2b405c; display: flex; justify-content: space-between; padding: 15px; }.trend-strategy-drawer h2, .trend-strategy-manager h2 { color: #edf7ff; font-size: 16px; margin: 0; }.trend-strategy-drawer header p, .trend-strategy-manager header p { color: #8fa6bd; font-size: 11px; margin: 5px 0 0; }.trend-drawer-scroll { overflow: auto; padding: 15px; }.trend-strategy-drawer footer, .trend-strategy-manager footer { align-items: center; border-top: 1px solid #2b405c; display: flex; gap: 8px; padding: 12px 15px; }.trend-strategy-drawer footer > span { flex: 1; }.trend-editor-grid { display: grid; gap: 10px; grid-template-columns: minmax(220px, 2fr) minmax(130px, .8fr); }.trend-editor-grid label, .trend-parameter-row label { color: #a9bdcf; display: grid; font-size: 11px; font-weight: 650; gap: 5px; }.trend-editor-grid .wide { grid-column: 1 / -1; }.trend-editor-grid input, .trend-editor-grid select, .trend-date-inputs input, .trend-parameter-row input { background: #1b293c; border: 1px solid #3a506d; border-radius: 4px; color: #ecf5fc; min-height: 31px; padding: 0 8px; }.trend-choice-row { align-items: flex-start; display: flex; gap: 10px; margin-top: 14px; }.trend-choice-row > span { color: #a9bdcf; flex: 0 0 58px; font-size: 11px; font-weight: 700; padding-top: 7px; }.trend-choice-row small { color: #8296aa; font-size: 10px; padding-top: 7px; }.trend-choice-group { display: inline-flex; flex-wrap: wrap; }.trend-choice-group button { background: #162236; border: 1px solid #344963; color: #b9c8d9; cursor: pointer; font-size: 11px; margin-left: -1px; min-height: 29px; padding: 0 8px; }.trend-choice-group button:first-child { border-radius: 4px 0 0 4px; margin-left: 0; }.trend-choice-group button:last-child { border-radius: 0 4px 4px 0; }.trend-choice-group button.active { background: #276d82; border-color: #56b7bf; color: #f2ffff; position: relative; }.trend-custom-targets { background: #0e1726; border: 1px solid #2a3d55; border-radius: 5px; margin: 9px 0 0 68px; padding: 10px; }.trend-target-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }.trend-target-chips span { align-items: center; background: #1d3447; border: 1px solid #3b6671; border-radius: 4px; color: #c1e3e5; display: inline-flex; font-size: 10px; gap: 5px; padding: 3px 5px; }.trend-target-chips button { background: transparent; border: 0; color: #9cc3c7; font-size: 15px; line-height: 1; padding: 0; }.trend-target-chips em { color: #8094a8; font-size: 10px; font-style: normal; }.trend-date-inputs { align-items: center; display: flex; gap: 6px; }.trend-date-inputs span { color: #8ea3b7; font-size: 11px; }.trend-indicator-area { border-top: 1px solid #25384f; margin-top: 15px; padding-top: 2px; }.trend-indicator-catalog { display: grid; gap: 6px; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); margin: 9px 0 0 68px; }.trend-indicator-catalog button { background: #162236; border: 1px solid #304861; border-radius: 4px; color: #9db0c3; cursor: pointer; display: grid; gap: 2px; min-height: 40px; padding: 6px 8px; text-align: left; }.trend-indicator-catalog button.active { background: #1b3c4a; border-color: #4da49f; }.trend-indicator-catalog strong { color: #dceaf5; font-size: 10px; }.trend-indicator-catalog span { font-size: 10px; }.trend-parameters { background: #0e1726; border: 1px solid #293c54; border-radius: 5px; display: grid; gap: 7px; margin: 10px 0 0 68px; padding: 9px; }.trend-parameter-row { align-items: center; display: flex; flex-wrap: wrap; gap: 8px 10px; }.trend-parameter-row > strong { color: #73d9d0; font-family: ui-monospace, monospace; font-size: 10px; min-width: 72px; }.trend-parameter-row label { align-items: center; grid-template-columns: auto 68px; }.trend-parameter-row input { min-height: 26px; padding: 0 5px; }.trend-parameter-row > span { color: #8398ac; font-size: 10px; }.trend-strategy-manager { background: #101b2d; border: 1px solid #36506c; border-radius: 8px; display: grid; grid-template-rows: auto 1fr auto; margin: auto; max-height: min(680px, 90vh); max-width: 720px; width: min(720px, 94vw); }.trend-manager-list { overflow: auto; padding: 10px; }.trend-manager-list article { align-items: center; border: 1px solid transparent; border-radius: 5px; display: flex; gap: 8px; justify-content: space-between; padding: 8px; }.trend-manager-list article:hover, .trend-manager-list article.active { background: #173145; border-color: #3d737a; }.trend-manager-list article > button { background: transparent; border: 0; color: inherit; cursor: pointer; display: grid; flex: 1; gap: 3px; padding: 0; text-align: left; }.trend-manager-list strong { color: #e4f0f8; font-size: 12px; }.trend-manager-list span { color: #849cb2; font-size: 10px; }.trend-manager-list article > div { display: flex; gap: 5px; }.trend-manager-list .danger { color: #ff999d; }
@media (max-width: 1280px) { .trend-report-layout { grid-template-columns: 170px minmax(0, 1fr); }.trend-risk-rail { border-left: 0; border-top: 1px solid #293d56; grid-column: 1 / -1; }.trend-risk-rail { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }.trend-risk-rail .trend-rail-heading { grid-column: 1 / -1; }.trend-risk-rail .trend-ai-card { margin-top: 0; } }
@media (max-width: 920px) { .trend-page-header { align-items: flex-start; flex-direction: column; }.trend-header-actions { justify-content: flex-start; }.trend-report-layout { grid-template-columns: 1fr; }.trend-run-rail { border-bottom: 1px solid #293d56; border-right: 0; }.trend-run-rail { display: flex; flex-wrap: wrap; gap: 5px; }.trend-run-rail .trend-rail-heading, .trend-run-rail .trend-strategy-summary { flex-basis: 100%; }.trend-run-item { flex: 1 1 150px; margin: 0; }.trend-overview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.trend-report-section > header { align-items: flex-start; flex-direction: column; }.trend-report-filters { justify-content: flex-start; }.trend-choice-row { flex-wrap: wrap; }.trend-choice-row > span { flex-basis: 100%; padding-top: 0; }.trend-custom-targets, .trend-indicator-catalog, .trend-parameters { margin-left: 0; } }
@media (max-width: 600px) { .trend-overview-grid { grid-template-columns: 1fr 1fr; }.trend-header-actions select { max-width: 100%; width: 100%; }.trend-editor-grid { grid-template-columns: 1fr; }.trend-editor-grid .wide { grid-column: auto; }.trend-log-panel li { grid-template-columns: 1fr; gap: 2px; } }

.trend-toast { background: #173d34; border: 1px solid #56b99b; border-radius: 5px; box-shadow: 0 12px 28px #0208148c; color: #dcfff1; font-size: 12px; left: 50%; margin: 0; padding: 9px 14px; position: fixed; top: 18px; transform: translateX(-50%); z-index: 120; }
.trend-toast-enter-active, .trend-toast-leave-active { transition: opacity .18s ease, transform .18s ease; }
.trend-toast-enter-from, .trend-toast-leave-to { opacity: 0; transform: translate(-50%, -8px); }

/* The report workspace intentionally keeps the control rail compact so results stay primary. */
.trend-report-workspace { max-width: none; }
.trend-page-header { min-height: 38px; }
.trend-header-actions { flex: 1; }
.trend-strategy-select { align-items: center; color: #aebfd0; display: flex; flex: 0 1 33.333%; font-size: 12px; gap: 7px; max-width: 540px; min-width: 230px; }
.trend-strategy-select span { flex: 0 0 auto; font-weight: 650; }
.trend-header-actions .trend-strategy-select select { flex: 1; max-width: none; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.trend-report-layout { grid-template-columns: 260px minmax(0, 1fr); }
.trend-run-rail { background: #0d1727; border-right: 1px solid #293d56; display: grid; gap: 14px; grid-template-rows: auto auto minmax(0, 1fr) auto; min-height: 0; padding: 12px; }
.trend-run-section { min-width: 0; }
.trend-run-actions { border-bottom: 1px solid #273c55; display: flex; gap: 6px; padding-bottom: 10px; }
.trend-run-actions .batman-button { flex: 1; font-size: 11px; justify-content: center; min-height: 29px; padding: 0 6px; }
.trend-run-list { max-height: 212px; overflow: auto; padding-right: 2px; }
.trend-run-item { align-items: stretch; background: transparent; border: 1px solid transparent; display: grid; gap: 3px; grid-template-columns: minmax(0, 1fr) 28px; margin: 0 0 3px; padding: 3px; }
.trend-run-item > button:first-child { background: transparent; border: 0; color: #aebfd2; cursor: pointer; display: grid; gap: 3px 6px; grid-template-columns: 7px minmax(0, 1fr); min-width: 0; padding: 5px; text-align: left; }
.trend-run-item:hover, .trend-run-item.active { background: #183345; border-color: #3d747a; }
.trend-run-item strong { color: #e3eff8; font-size: 11px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.trend-run-item strong.up { color: #61d899; }.trend-run-item strong.down { color: #ff8b91; }
.trend-run-item small { color: #839bb2; font-size: 10px; grid-column: 2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.trend-run-delete { align-self: center; background: transparent; border: 0; color: #8ca0b5; cursor: pointer; display: grid; place-items: center; padding: 5px; }
.trend-run-delete:hover:not(:disabled) { color: #ff9298; }.trend-run-delete:disabled { cursor: not-allowed; opacity: .35; }
.trend-status-dot.cancelled { background: #8e9baa; }.trend-status-dot.failed { background: #ff7d82; }
.trend-strategy-summary { border-top: 1px solid #273c55; display: flex; flex-direction: column; gap: 9px; margin: 0; min-height: 0; padding: 11px 0 0; }
.trend-strategy-summary > header, .trend-log-panel > header { align-items: center; display: flex; justify-content: space-between; }
.trend-strategy-summary > header > strong, .trend-log-panel > header > strong { align-items: center; color: #cfdeec; display: flex; font-size: 12px; gap: 5px; }
.trend-strategy-summary dl { display: grid; gap: 1px; margin: 0; }
.trend-strategy-summary dl div { display: grid; grid-template-columns: 42px minmax(0, 1fr); }
.trend-strategy-summary dt { color: #7f97af; font-size: 10px; }.trend-strategy-summary dd { color: #c7d7e4; font-size: 10px; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.trend-target-summary { display: flex; flex: 1; flex-direction: column; gap: 5px; min-height: 0; }.trend-target-summary > strong { color: #8fa7bd; font-size: 10px; }.trend-target-summary > span { color: #c7d7e4; font-size: 10px; }
.trend-target-table-wrap { border: 1px solid #283d56; border-radius: 4px; flex: 1; min-height: 112px; overflow: auto; }
.trend-target-table { border-collapse: collapse; font-size: 10px; width: 100%; }.trend-target-table th, .trend-target-table td { border-bottom: 1px solid #23364c; padding: 5px; text-align: left; }.trend-target-table th { background: #15243a; color: #8da5bc; font-size: 9px; position: sticky; top: 0; }.trend-target-table td { color: #c3d2df; }.trend-target-table td:last-child { text-align: right; white-space: nowrap; }.trend-target-table td strong, .trend-target-table td span { display: block; }.trend-target-table td strong { color: #e4eef7; }.trend-target-table td span { color: #849bb0; margin-top: 2px; }
.trend-log-panel { border-top: 1px solid #293c54; padding-top: 10px; }.trend-log-panel ol { max-height: 155px; }.trend-log-panel li { grid-template-columns: 1fr; gap: 2px; }.trend-log-panel time { font-size: 9px; }
.trend-report-main { gap: 12px; padding: 14px; }.trend-report-section > header { align-items: center; }.trend-report-section h2 { font-size: 15px; }.trend-report-table-wrap { max-height: 322px; }.trend-report-table { min-width: 850px; table-layout: fixed; }.trend-report-table th, .trend-report-table td { font-size: 12px; padding: 8px 9px; }.trend-report-table th { font-weight: 750; position: sticky; top: 0; z-index: 1; }.trend-report-table th:nth-child(1) { width: 12%; }.trend-report-table th:nth-child(2) { width: 6%; }.trend-report-table th:nth-child(3) { width: 20%; }.trend-report-table th:nth-child(4) { width: 6%; }.trend-report-table th:nth-child(5) { width: 41%; }.trend-report-table th:nth-child(6) { width: 15%; }.trend-report-actions { cursor: default; white-space: nowrap; }.trend-report-actions .batman-text-button { align-items: center; display: inline-flex; gap: 3px; margin-right: 7px; }.trend-report-actions .batman-text-button:disabled { cursor: not-allowed; opacity: .45; }
.trend-ai-card { margin-top: 0; }.trend-ai-card .batman-text-button:disabled { cursor: not-allowed; opacity: .45; }
@media (max-width: 1080px) { .trend-report-layout { grid-template-columns: 238px minmax(0, 1fr); }.trend-strategy-select { min-width: min(420px, 55vw); }.trend-run-list { max-height: 215px; } }
@media (max-width: 840px) { .trend-report-layout { grid-template-columns: 1fr; }.trend-run-rail { border-bottom: 1px solid #293d56; border-right: 0; }.trend-run-section { max-width: none; }.trend-run-list { max-height: 210px; }.trend-strategy-select { flex-basis: 100%; }.trend-header-actions .trend-strategy-select select { min-width: 0; width: 100%; } }
</style>
