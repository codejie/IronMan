<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { BarChart3, Check, CirclePlus, Clock3, RefreshCw, Sparkles, Trash2 } from "lucide-vue-next";
import { api, ApiError, type AiCandidateItem, type AiCandidateRun, type CandidateStrategy } from "@/api/client";
import { requestConfirmation } from "@/components/confirmation";
import InstrumentKLineDialog from "@/components/InstrumentKLineDialog.vue";
import { useSession } from "@/stores/session";

const strategyTabs: Array<{ value: CandidateStrategy; label: string }> = [
  { value: "trend_event", label: "趋势事件" },
  { value: "quality_growth", label: "质量成长" },
  { value: "value_repair", label: "低估值修复" },
];
const { token } = useSession();
const router = useRouter();
const strategy = ref<CandidateStrategy>("trend_event");
const topN = ref<5 | 10 | 20>(10);
const selectedRunId = ref<string | null>(null);
const selectedItemId = ref<string | null>(null);
const selectedKlineInstrument = ref<AiCandidateItem["instrument"] | null>(null);
const run = ref<AiCandidateRun | null>(null);
const items = ref<AiCandidateItem[]>([]);
const runs = ref<AiCandidateRun[]>([]);
const isLoading = ref(false);
const isRunning = ref(false);
const deletingDate = ref<string | null>(null);
const notice = ref("");
const errorMessage = ref("");
let loadSequence = 0;
let pollTimer: number | undefined;

const strategyItems = computed(() => items.value.filter((item) => item.strategy === strategy.value));
const selectedItem = computed(() => strategyItems.value.find((item) => item.id === selectedItemId.value) ?? strategyItems.value[0] ?? null);
const strategyLabel = computed(() => strategyTabs.find((item) => item.value === strategy.value)?.label ?? strategy.value);

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function statusLabel(status: AiCandidateRun["status"]): string {
  return status === "completed" ? "已完成" : status === "partial" ? "部分完成" : status === "running" ? "运行中" : status === "queued" ? "排队中" : status === "cancelled" ? "已停止" : "失败";
}

function statusTone(status: AiCandidateRun["status"]): string {
  return status === "completed" ? "completed" : status === "partial" ? "partial" : status;
}

function openCandidateKline(item: AiCandidateItem): void {
  selectedItemId.value = item.id;
  selectedKlineInstrument.value = item.instrument;
}

function closeCandidateKline(): void {
  selectedKlineInstrument.value = null;
}

function itemCount(record: AiCandidateRun): number {
  const count = record.dataQuality.itemCount;
  return typeof count === "number" ? count : 0;
}

async function loadRuns(preferSelected = true): Promise<void> {
  if (token.value === null) return;
  const requestId = ++loadSequence;
  stopPolling();
  isLoading.value = true;
  errorMessage.value = "";
  try {
    const result = await api.listAiCandidateRuns(token.value, 60);
    if (requestId !== loadSequence) return;
    runs.value = result.items;
    const preferred = preferSelected && selectedRunId.value !== null && result.items.some((item) => item.id === selectedRunId.value)
      ? selectedRunId.value
      : result.items[0]?.id ?? null;
    if (preferred === null) {
      run.value = null;
      items.value = [];
      selectedRunId.value = null;
      selectedItemId.value = null;
      return;
    }
    await loadRun(preferred);
  } catch (error) {
    errorMessage.value = message(error, "读取候选运行记录失败");
  } finally {
    isLoading.value = false;
  }
}

async function loadRun(id: string): Promise<void> {
  if (token.value === null) return;
  const requestId = ++loadSequence;
  stopPolling();
  try {
    const detail = await api.getAiCandidateRunDetail(token.value, id);
    if (requestId !== loadSequence) return;
    run.value = detail.run;
    items.value = detail.items;
    selectedRunId.value = id;
    selectedItemId.value = detail.items.find((item) => item.strategy === strategy.value)?.id ?? null;
    topN.value = detail.run.requestedTopN;
    if (detail.run.status === "queued" || detail.run.status === "running") startPolling();
  } catch (error) {
    errorMessage.value = message(error, "读取候选运行详情失败");
  }
}

async function createRun(): Promise<void> {
  if (token.value === null || isRunning.value) return;
  const targetDate = runs.value[0]?.tradeDate ?? currentTradeDate();
  const existing = runs.value.find((record) => record.tradeDate === targetDate);
  if (existing !== undefined && (existing.status === "queued" || existing.status === "running")) {
    notice.value = "当日候选正在运行，请稍候查看结果";
    return;
  }
  if (existing !== undefined) {
    const confirmed = await requestConfirmation({
      title: "当日候选记录已存在",
      message: `已存在 ${targetDate} 的候选记录，是否替换？替换完成后该日期只保留新的候选记录。`,
      confirmLabel: "替换候选",
      cancelLabel: "暂不替换",
    });
    if (!confirmed) return;
  }
  isRunning.value = true;
  notice.value = "候选分析已排队";
  errorMessage.value = "";
  try {
    const result = await api.createAiCandidateRun(token.value, { topN: topN.value });
    run.value = result;
    items.value = [];
    selectedRunId.value = result.id;
    selectedItemId.value = null;
    const existingIndex = runs.value.findIndex((record) => record.tradeDate === result.tradeDate);
    if (existingIndex >= 0) runs.value.splice(existingIndex, 1, result);
    else runs.value.unshift(result);
    startPolling();
  } catch (error) {
    errorMessage.value = message(error, "创建候选分析失败");
  } finally {
    isRunning.value = false;
  }
}

async function deleteDate(record: AiCandidateRun): Promise<void> {
  if (token.value === null || deletingDate.value !== null) return;
  const confirmed = await requestConfirmation({
    title: "删除候选记录",
    message: `确定删除 ${record.tradeDate} 的候选记录吗？该日期的替换版本和效果评估样本也会一并删除。`,
    confirmLabel: "删除记录",
    cancelLabel: "取消",
  });
  if (!confirmed) return;
  deletingDate.value = record.tradeDate;
  errorMessage.value = "";
  try {
    await api.deleteAiCandidateDate(token.value, record.tradeDate);
    notice.value = `${record.tradeDate} 候选记录已删除`;
    const index = runs.value.findIndex((item) => item.tradeDate === record.tradeDate);
    runs.value = runs.value.filter((item) => item.tradeDate !== record.tradeDate);
    if (selectedRunId.value === record.id || run.value?.tradeDate === record.tradeDate) {
      const next = runs.value[index] ?? runs.value[index - 1] ?? runs.value[0];
      if (next === undefined) {
        run.value = null;
        items.value = [];
        selectedRunId.value = null;
        selectedItemId.value = null;
      } else {
        await loadRun(next.id);
      }
    }
  } catch (error) {
    errorMessage.value = message(error, "删除候选记录失败");
  } finally {
    deletingDate.value = null;
  }
}

function currentTradeDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function startPolling(): void {
  stopPolling();
  pollTimer = window.setInterval(() => void refreshRun(), 700);
  void refreshRun();
}

function stopPolling(): void {
  if (pollTimer !== undefined) window.clearInterval(pollTimer);
  pollTimer = undefined;
}

async function refreshRun(): Promise<void> {
  if (token.value === null || selectedRunId.value === null) return;
  const runId = selectedRunId.value;
  try {
    const detail = await api.getAiCandidateRunDetail(token.value, runId);
    if (selectedRunId.value !== runId) return;
    run.value = detail.run;
    items.value = detail.items;
    if (detail.run.status !== "queued" && detail.run.status !== "running") {
      stopPolling();
      const index = runs.value.findIndex((record) => record.tradeDate === detail.run.tradeDate);
      if (index >= 0) runs.value.splice(index, 1, detail.run);
    }
  } catch {
    stopPolling();
  }
}

function selectStrategy(next: CandidateStrategy): void {
  strategy.value = next;
  selectedItemId.value = strategyItems.value[0]?.id ?? null;
}

function openEvaluation(): void {
  void router.push("/analysis/ai-candidates/evaluation");
}

function scoreGroup(item: AiCandidateItem, key: string): string {
  const value = item.scoreSnapshot[key];
  return typeof value === "number" ? value.toFixed(0) : "--";
}

function actionLabel(action: string): string {
  return action === "wait_breakout" ? "等待突破" : action === "wait_pullback" ? "等待回踩" : action === "research_further" ? "继续研究" : action === "avoid" ? "回避" : "观察";
}

function qualityLabel(value: AiCandidateItem["dataQuality"]): string {
  return value === "complete" ? "完整" : value === "partial" ? "部分" : value === "stale" ? "滞后" : "不可用";
}

async function addToWatchlist(): Promise<void> {
  if (token.value === null || selectedItem.value === null) return;
  try {
    await api.createWatchlist(token.value, {
      instrumentId: selectedItem.value.instrument.id,
      note: "来自 AI 候选",
      ...(selectedItem.value.explanation?.referencePriceHigh === null || selectedItem.value.explanation?.referencePriceHigh === undefined ? {} : { targetPrice: selectedItem.value.explanation.referencePriceHigh }),
    });
    notice.value = `${selectedItem.value.instrument.name} 已加入自选`;
  } catch (error) {
    errorMessage.value = message(error, "加入自选失败");
  }
}

async function createCandidateAlert(): Promise<void> {
  if (token.value === null || selectedItem.value === null) return;
  const threshold = selectedItem.value.explanation?.invalidationPrice;
  if (threshold === null || threshold === undefined || threshold <= 0) {
    notice.value = "该候选暂未提供有效失效价，请在提醒中心配置阈值";
    return;
  }
  try {
    await api.createAlert(token.value, { instrumentId: selectedItem.value.instrument.id, direction: "below", threshold, cooldownMinutes: 240 });
    notice.value = `${selectedItem.value.instrument.name} 已创建跌破提醒`;
  } catch (error) {
    errorMessage.value = message(error, "创建提醒失败");
  }
}

onMounted(() => void loadRuns(false));
onBeforeUnmount(stopPolling);
</script>

<template>
  <section class="batman-workspace ai-candidates-workspace" aria-label="AI候选">
    <header class="candidate-page-header">
      <div>
        <h1>AI 候选</h1>
      </div>
      <div class="candidate-header-actions">
        <label>Top N<select v-model.number="topN"><option :value="5">5</option><option :value="10">10</option><option :value="20">20</option></select></label>
        <button class="batman-button" type="button" @click="openEvaluation"><BarChart3 :size="15" />效果评估</button>
        <button class="batman-button primary" :disabled="isRunning || isLoading" type="button" @click="createRun"><RefreshCw :class="{ spinning: isRunning }" :size="15" />运行候选</button>
      </div>
    </header>
    <div v-if="notice" class="candidate-notice" role="status"><Check :size="14" />{{ notice }}</div>
    <p v-if="errorMessage" class="batman-error">{{ errorMessage }}</p>
    <div class="candidate-record-layout">
      <aside class="candidate-record-list" aria-label="运行记录">
        <header><div><strong>运行记录</strong><span>按日期倒序 · {{ runs.length }} 条</span></div><Clock3 :size="15" /></header>
        <div v-if="runs.length === 0" class="candidate-record-empty"><Sparkles :size="20" /><strong>暂无候选记录</strong><span>运行一次候选分析后会按日期保存。</span></div>
        <div v-else class="candidate-date-list">
          <article v-for="record in runs" :key="record.id" :class="['candidate-date-item', { active: selectedRunId === record.id }]">
            <button class="candidate-date-select" type="button" @click="loadRun(record.id)">
              <span class="candidate-date-heading"><strong>{{ record.tradeDate }}</strong><em v-if="record.tradeDate === currentTradeDate()">当前日期</em></span>
              <span class="candidate-date-meta"><span :class="['candidate-status-dot', statusTone(record.status)]"></span>{{ statusLabel(record.status) }} · Top {{ record.requestedTopN }}</span>
              <span class="candidate-date-meta">{{ itemCount(record) }} 个评分项 · {{ record.trigger === "scheduled" ? "自动生成" : "手动运行" }}</span>
            </button>
            <button class="batman-icon-button danger candidate-date-delete" :aria-label="`删除 ${record.tradeDate} 记录`" :disabled="deletingDate !== null || record.status === 'queued' || record.status === 'running'" title="删除记录" type="button" @click="deleteDate(record)"><Trash2 :size="14" /></button>
          </article>
        </div>
      </aside>
      <div class="candidate-record-detail">
        <div class="candidate-status-strip"><span><Clock3 :size="14" />{{ run ? `信号日 ${run.tradeDate}` : "等待运行记录" }}</span><span v-if="run" :class="['candidate-status', statusTone(run.status)]">{{ statusLabel(run.status) }}<template v-if="run.status === 'running'"> {{ run.progress }}%</template></span><span v-if="run?.marketRegime">市场状态 {{ run.marketRegime.name === "strong" ? "强势" : run.marketRegime.name === "risk" ? "风险" : "中性" }} · 入选阈值 {{ run.marketRegime.threshold }}</span></div>
        <template v-if="run">
          <nav class="candidate-strategy-tabs" aria-label="候选策略"><button v-for="tab in strategyTabs" :key="tab.value" :class="{ active: strategy === tab.value }" type="button" @click="selectStrategy(tab.value)"><BarChart3 :size="14" />{{ tab.label }}</button></nav>
          <div class="candidate-layout">
            <section class="candidate-table-section">
              <header><div><strong>{{ run.tradeDate }} 候选</strong><span>{{ strategyLabel }} · {{ strategyItems.length }} 个评分项</span></div><small>算法 {{ run.algorithmVersion }}</small></header>
              <div class="batman-table-frame candidate-table-frame">
                <table class="batman-table candidate-table">
                  <colgroup><col /><col /><col /><col /><col /><col /><col /><col /></colgroup>
                  <thead><tr><th>排名</th><th>标的</th><th>评分</th><th>趋势</th><th>流动性</th><th>风险控制</th><th>操作建议</th><th>数据</th></tr></thead>
                  <tbody>
                    <tr v-for="item in strategyItems" :key="item.id" :aria-label="`查看 ${item.instrument.name} K线`" :class="{ selected: selectedItem?.id === item.id }" role="button" tabindex="0" @click="openCandidateKline(item)" @keydown.enter.prevent="openCandidateKline(item)" @keydown.space.prevent="openCandidateKline(item)">
                      <td><strong>{{ item.rank ?? '-' }}</strong></td>
                      <td class="batman-name"><button :aria-label="`查看 ${item.instrument.name} K线`" class="batman-name-button" type="button" @click.stop="openCandidateKline(item)"><strong>{{ item.instrument.name }}</strong><span>{{ item.instrument.code }}</span></button></td>
                      <td><span :class="['candidate-score', item.selected ? 'selected' : '']">{{ item.score.toFixed(1) }}</span></td>
                      <td>{{ scoreGroup(item, 'trend') }}</td><td>{{ scoreGroup(item, 'volumeLiquidity') }}</td><td>{{ scoreGroup(item, 'overheatControl') }}</td>
                      <td><span v-if="item.explanation" class="candidate-action">{{ actionLabel(item.explanation.action) }}</span><span v-else class="candidate-muted">量化待审</span></td>
                      <td><span :class="['candidate-quality', item.dataQuality]">{{ qualityLabel(item.dataQuality) }}</span></td>
                    </tr>
                    <tr v-if="strategyItems.length === 0"><td colspan="8" class="batman-empty-cell">暂无满足阈值的{{ strategyLabel }}候选</td></tr>
                  </tbody>
                </table>
              </div>
            </section>
            <aside class="candidate-detail" aria-label="候选详情"><template v-if="selectedItem"><header><div><p>{{ selectedItem.instrument.code }} · {{ selectedItem.instrument.exchange.toUpperCase() }}</p><h2>{{ selectedItem.instrument.name }}</h2></div><div class="candidate-detail-heading-side"><div class="candidate-score-box"><span>评分</span><strong class="candidate-score-large">{{ selectedItem.score.toFixed(1) }}</strong></div><div class="candidate-detail-actions"><button class="batman-button" type="button" @click="addToWatchlist"><CirclePlus :size="14" />加入自选</button><button class="batman-button" type="button" @click="createCandidateAlert"><Clock3 :size="14" />创建跌破提醒</button></div></div></header><div class="candidate-detail-grid"><div><span>策略</span><strong>{{ strategyLabel }}</strong></div><div><span>有效至</span><strong>{{ selectedItem.explanation?.validUntil ?? '--' }}</strong></div><div><span>数据质量</span><strong>{{ qualityLabel(selectedItem.dataQuality) }}</strong></div><div><span>周期</span><strong>5 · 10 · 20 日</strong></div></div><div v-if="selectedItem.explanation" class="candidate-explanation"><div class="candidate-action-line"><Sparkles :size="14" /><strong>{{ actionLabel(selectedItem.explanation.action) }}</strong></div><p>{{ selectedItem.explanation.summary }}</p><div class="candidate-columns"><div><span>支持证据</span><ul><li v-for="line in selectedItem.explanation.thesis" :key="line">{{ line }}</li></ul></div><div><span>反向证据</span><ul><li v-for="line in selectedItem.explanation.counterEvidence" :key="line">{{ line }}</li></ul></div></div></div><div class="candidate-evidence"><header><strong>证据快照</strong><span>{{ selectedItem.evidenceSnapshot.length }} 条</span></header><dl><template v-for="evidence in selectedItem.evidenceSnapshot" :key="evidence.id"><dt>{{ evidence.label }}</dt><dd>{{ typeof evidence.value === 'number' ? evidence.value.toLocaleString() : evidence.value }} <small>{{ evidence.source }} · {{ evidence.asOf }}</small></dd></template></dl></div></template><div v-else class="candidate-detail-empty"><Sparkles :size="24" /><strong>选择一个候选</strong><span>查看评分拆解、证据与有限条件建议</span></div></aside>
          </div>
        </template>
        <div v-else class="candidate-record-placeholder"><Sparkles :size="25" /><strong>选择运行记录</strong><span>按日期打开候选记录，并查看三种策略的评分结果。</span></div>
      </div>
    </div>
    <InstrumentKLineDialog :instrument="selectedKlineInstrument" @close="closeCandidateKline" />
  </section>
</template>

<style scoped>
.candidate-detail-heading-side { align-items: flex-end; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.candidate-score-box { align-items: flex-end; display: flex; flex-direction: column; gap: 1px; }
.candidate-score-box > span { color: #9ab0c1; font-size: 10px; line-height: 1; }
.candidate-detail-actions { display: flex; flex-wrap: wrap; gap: 7px; justify-content: flex-end; }
.candidate-detail-actions .batman-button { font-size: 11px; min-height: 30px; }
.ai-candidates-workspace { max-width: none; }.candidate-page-header { align-items: flex-end; border-bottom: 1px solid #2b4057; display: flex; justify-content: space-between; margin-bottom: 10px; padding-bottom: 12px; }.candidate-eyebrow { align-items: center; color: #7ddbd0; display: flex; font-size: 11px; gap: 6px; margin: 0 0 4px; }.candidate-page-header h1 { color: #eff8ff; font-size: 23px; margin: 0; }.candidate-page-header p:not(.candidate-eyebrow) { color: #91a6ba; font-size: 12px; margin: 5px 0 0; }.candidate-header-actions { align-items: center; display: flex; gap: 8px; }.candidate-header-actions label { align-items: center; color: #a8bbcc; display: inline-flex; font-size: 12px; gap: 6px; }.candidate-header-actions select { background: #172438; border: 1px solid #3a526e; border-radius: 5px; color: #e7f1f8; min-height: 31px; padding: 0 8px; }.candidate-notice { align-items: center; background: #17322f; border: 1px solid #2d756d; color: #bff7ef; display: flex; font-size: 12px; gap: 6px; margin-bottom: 10px; padding: 8px 10px; }.candidate-record-layout { display: grid; gap: 12px; grid-template-columns: minmax(220px, .34fr) minmax(0, 1fr); }.candidate-record-list, .candidate-table-section, .candidate-detail, .candidate-record-placeholder { border: 1px solid #2c425b; background: #111d2c; }.candidate-record-list { min-height: 500px; }.candidate-record-list > header { align-items: center; border-bottom: 1px solid #2c425b; color: #7d97ac; display: flex; justify-content: space-between; padding: 10px 12px; }.candidate-record-list > header div { display: grid; gap: 2px; }.candidate-record-list > header strong { color: #e4f0f7; font-size: 13px; }.candidate-record-list > header span { color: #8299ae; font-size: 10px; }.candidate-date-list { display: grid; gap: 5px; padding: 7px; }.candidate-date-item { align-items: stretch; border: 1px solid transparent; display: flex; min-width: 0; }.candidate-date-item.active { background: #183047; border-color: #55c8be; }.candidate-date-select { background: transparent; border: 0; color: #dbeaf1; cursor: pointer; display: grid; gap: 5px; min-width: 0; padding: 9px; text-align: left; width: 100%; }.candidate-date-heading { align-items: center; display: flex; gap: 6px; min-width: 0; }.candidate-date-heading strong { color: #e9f6fb; font-size: 13px; }.candidate-date-heading em { color: #79ddcf; font-size: 9px; font-style: normal; }.candidate-date-meta { color: #8da4b7; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.candidate-status-dot { background: #e0b862; border-radius: 50%; display: inline-block; height: 6px; margin-right: 4px; width: 6px; }.candidate-status-dot.completed { background: #71d9cb; }.candidate-status-dot.partial { background: #e0b862; }.candidate-status-dot.failed, .candidate-status-dot.cancelled { background: #e98282; }.candidate-date-delete { align-self: center; flex: 0 0 auto; margin-right: 5px; }.candidate-record-empty, .candidate-record-placeholder { align-items: center; color: #7890a5; display: flex; flex-direction: column; gap: 7px; justify-content: center; min-height: 300px; padding: 20px; text-align: center; }.candidate-record-empty strong, .candidate-record-placeholder strong { color: #c9dce7; font-size: 13px; }.candidate-record-empty span, .candidate-record-placeholder span { font-size: 11px; line-height: 1.5; }.candidate-record-detail { min-width: 0; }.candidate-status-strip { align-items: center; color: #94a9bd; display: flex; flex-wrap: wrap; font-size: 11px; gap: 16px; margin: 0 0 8px; }.candidate-status-strip span { align-items: center; display: inline-flex; gap: 5px; }.candidate-status { color: #f2d58b; }.candidate-status.completed { color: #7de1d2; }.candidate-status.partial { color: #edc77b; }.candidate-strategy-tabs { border-bottom: 1px solid #2d4059; display: flex; gap: 3px; margin-bottom: 9px; overflow-x: auto; }.candidate-strategy-tabs button { align-items: center; background: transparent; border: 0; border-bottom: 2px solid transparent; color: #9cafc1; display: inline-flex; font-size: 13px; gap: 6px; min-height: 35px; padding: 0 12px; white-space: nowrap; }.candidate-strategy-tabs button.active { border-bottom-color: #67d6cb; color: #d6fff9; }.candidate-layout { display: grid; gap: 12px; grid-template-columns: minmax(0, 1.55fr) minmax(300px, .75fr); }.candidate-table-section > header { align-items: center; display: flex; justify-content: space-between; padding: 10px 12px; }.candidate-table-section > header div { display: grid; gap: 2px; }.candidate-table-section > header strong { color: #e4f0f7; font-size: 13px; }.candidate-table-section > header span { color: #8299ae; font-size: 11px; }.candidate-table-section > header small { color: #8199ae; font-size: 10px; }.candidate-table-frame { border: 0; border-top: 1px solid #2c425b; border-radius: 0; overflow-x: auto; }.candidate-table { min-width: 760px; }.candidate-table th, .candidate-table td { padding: 8px 9px; }.candidate-table td strong { color: #e7f4fb; display: block; font-size: 12px; }.candidate-table td small { color: #7e96ad; display: block; font-size: 10px; margin-top: 2px; }.candidate-table tbody tr { cursor: pointer; }.candidate-table tbody tr.selected td, .candidate-table tbody tr:hover td { background: #183047; }.candidate-score { color: #bfd0df; font-variant-numeric: tabular-nums; font-weight: 700; }.candidate-score.selected { color: #77dfd1; }.candidate-action { color: #c8e9eb; font-size: 11px; }.candidate-quality { font-size: 10px; }.candidate-quality.complete { color: #7edfd0; }.candidate-quality.partial { color: #eacb84; }.candidate-quality.stale, .candidate-quality.unavailable { color: #ef9999; }.candidate-muted { color: #778da1; font-size: 11px; }.candidate-detail { padding: 13px; }.candidate-detail > header { align-items: flex-start; border-bottom: 1px solid #2b4057; display: flex; justify-content: space-between; padding-bottom: 10px; }.candidate-detail > header p { color: #7d97ac; font-size: 10px; margin: 0 0 3px; }.candidate-detail h2 { color: #eef8fc; font-size: 17px; margin: 0; }.candidate-score-large { color: #75ddce; font-size: 25px; font-weight: 750; }.candidate-detail-grid { display: grid; gap: 7px; grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 10px 0; }.candidate-detail-grid div { background: #172538; padding: 7px 8px; }.candidate-detail-grid span, .candidate-columns > div > span { color: #8299ae; display: block; font-size: 10px; }.candidate-detail-grid strong { color: #dcebf3; display: block; font-size: 11px; margin-top: 3px; }.candidate-explanation { border-top: 1px solid #2c4258; padding-top: 10px; }.candidate-action-line { align-items: center; color: #9ff1e5; display: flex; font-size: 12px; gap: 6px; }.candidate-explanation p { color: #bed0dd; font-size: 12px; line-height: 1.55; margin: 8px 0; }.candidate-columns { display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); }.candidate-columns ul { color: #a8bac9; font-size: 11px; line-height: 1.5; margin: 5px 0 0; padding-left: 15px; }.candidate-evidence { border-top: 1px solid #2c4258; margin-top: 11px; padding-top: 10px; }.candidate-evidence header { align-items: center; display: flex; justify-content: space-between; }.candidate-evidence header strong { color: #dcebf3; font-size: 12px; }.candidate-evidence header span { color: #7892a9; font-size: 10px; }.candidate-evidence dl { display: grid; grid-template-columns: 1fr 1fr; margin: 8px 0 12px; }.candidate-evidence dt, .candidate-evidence dd { border-bottom: 1px solid #24384e; font-size: 10px; margin: 0; padding: 5px 2px; }.candidate-evidence dt { color: #8199ae; }.candidate-evidence dd { color: #d6e9f0; text-align: right; }.candidate-evidence dd small { color: #7890a4; display: block; font-size: 9px; margin-top: 2px; }.candidate-detail-empty { align-items: center; color: #7890a5; display: flex; flex-direction: column; gap: 7px; justify-content: center; min-height: 300px; text-align: center; }.candidate-detail-empty strong { color: #c9dce7; font-size: 13px; }.candidate-detail-empty span { font-size: 11px; }.spinning { animation: candidate-spin .9s linear infinite; }@keyframes candidate-spin { to { transform: rotate(360deg); } }@media (max-width: 1100px) { .candidate-record-layout { grid-template-columns: minmax(190px, .4fr) minmax(0, 1fr); }.candidate-layout { grid-template-columns: 1fr; } }@media (max-width: 720px) { .candidate-page-header { align-items: flex-start; flex-direction: column; gap: 12px; }.candidate-header-actions { flex-wrap: wrap; width: 100%; }.candidate-header-actions .batman-button { flex: 1; }.candidate-record-layout { grid-template-columns: 1fr; }.candidate-record-list { min-height: auto; }.candidate-date-list { max-height: 280px; overflow-y: auto; }.candidate-columns { grid-template-columns: 1fr; } }
.candidate-date-item { border: 0; border-left: 2px solid transparent; }
.candidate-date-item:hover { background: #17283e; }
.candidate-date-item.active { background: #182d45; border-left-color: #65d7ca; }

/* Match the holdings table density and let the table fill its available column. */
.candidate-table-section { background: transparent; border: 0; min-width: 0; }
.candidate-table-frame { background: #121b2b; border: 1px solid #2d4059; border-radius: 7px; margin-top: 0; overflow-x: hidden; width: 100%; }
.candidate-table { min-width: 0; table-layout: fixed; width: 100%; }
.candidate-table th, .candidate-table td { font-family: inherit; font-size: 13px; line-height: 1.45; overflow: hidden; padding: 10px 11px; text-overflow: ellipsis; }
.candidate-table th { font-size: 13px; font-weight: 650; padding-left: 11px; padding-right: 11px; }
.candidate-table th:nth-child(1), .candidate-table td:nth-child(1) { text-align: center; width: 6%; }
.candidate-table th:nth-child(2), .candidate-table td:nth-child(2) { width: 17%; }
.candidate-table th:nth-child(3), .candidate-table td:nth-child(3) { width: 9%; }
.candidate-table th:nth-child(4), .candidate-table td:nth-child(4) { width: 10%; }
.candidate-table th:nth-child(5), .candidate-table td:nth-child(5) { width: 11%; }
.candidate-table th:nth-child(6), .candidate-table td:nth-child(6) { width: 12%; }
.candidate-table th:nth-child(7), .candidate-table td:nth-child(7) { width: 23%; }
.candidate-table th:nth-child(8), .candidate-table td:nth-child(8) { width: 12%; }
.candidate-table tbody tr { cursor: pointer; }
.candidate-table tbody tr:focus-visible > td { background: #1c3146; outline: 1px solid #65d7ca; outline-offset: -1px; }
.candidate-table .batman-name strong { font-size: 13px; }
.candidate-table .batman-name span { font-size: 13px; }
.candidate-table .candidate-action { color: #8fe8df; font-size: 13px; font-weight: 650; }
.candidate-table .candidate-muted { color: #b3c3d3; font-size: 13px; }

/* Match the Trend Analysis shell: a single bordered workspace with a compact left rail. */
.candidate-page-header { align-items: center; }
.candidate-header-actions { flex-wrap: wrap; justify-content: flex-end; }
.candidate-record-layout { background: #101a2a; border: 1px solid #2d4059; border-radius: 7px; gap: 0; grid-template-columns: 190px minmax(0, 1fr); overflow: hidden; }
.candidate-record-list { background: #0d1727; border: 0; border-right: 1px solid #293d56; border-radius: 0; min-height: 500px; }
.candidate-record-detail { min-width: 0; padding: 13px; }

@media (max-width: 1100px) { .candidate-record-layout { grid-template-columns: 190px minmax(0, 1fr); } }
@media (max-width: 720px) { .candidate-record-layout { grid-template-columns: 1fr; }.candidate-record-list { border-bottom: 1px solid #293d56; border-right: 0; } }
.candidate-record-layout { grid-template-columns: 260px minmax(0, 1fr); }
@media (max-width: 1080px) { .candidate-record-layout { grid-template-columns: 238px minmax(0, 1fr); } }
@media (max-width: 840px) { .candidate-record-layout { grid-template-columns: 1fr; } }
</style>
