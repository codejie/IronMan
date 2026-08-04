<script setup lang="ts">
import {
  Bot,
  ChartNoAxesCombined,
  ExternalLink,
  FileClock,
  LoaderCircle,
  RefreshCw,
  Trash2,
} from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  api,
  ApiError,
  type HoldingDiagnosisItem,
  type HoldingDiagnosisMethod,
  type HoldingDiagnosisReport,
  type HoldingDiagnosisRun,
} from "@/api/client";
import { requestConfirmation } from "@/components/confirmation";
import KLineChart from "@/components/KLineChart.vue";
import type { KlineAnnotation } from "@/components/kline-analysis";
import { useSession } from "@/stores/session";
import { formatDateTime } from "@/utils/date-format";

type ReportRun = Pick<
  HoldingDiagnosisRun,
  | "id"
  | "trigger"
  | "status"
  | "progress"
  | "errorMessage"
  | "createdAt"
  | "reportId"
>;

const { token } = useSession();
const runs = ref<ReportRun[]>([]);
const report = ref<HoldingDiagnosisReport | null>(null);
const activeItemId = ref<string | null>(null);
const loadingReportId = ref<string | null>(null);
const isLoading = ref(false);
const isGenerating = ref(false);
const deletingReportId = ref<string | null>(null);
const errorMessage = ref("");
let pollTimer: ReturnType<typeof setTimeout> | undefined;

const activeReportId = computed(() => report.value?.id ?? null);
const activeItem = computed(() => {
  if (report.value === null) return null;
  return report.value.items.find((item) => item.id === activeItemId.value) ?? report.value.items[0] ?? null;
});

onMounted(() => void loadArchive());
onBeforeUnmount(() => {
  if (pollTimer !== undefined) clearTimeout(pollTimer);
});

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function statusLabel(status: ReportRun["status"]): string {
  const labels: Record<ReportRun["status"], string> = {
    queued: "排队中",
    running: "生成中",
    completed: "已完成",
    partial: "部分完成",
    failed: "生成失败",
    cancelled: "已取消",
  };
  return labels[status];
}

function triggerLabel(trigger: ReportRun["trigger"]): string {
  return trigger === "scheduled" ? "自动" : "手动";
}

function dataQualityLabel(value: HoldingDiagnosisItem["dataQuality"]): string {
  const labels: Record<HoldingDiagnosisItem["dataQuality"], string> = {
    complete: "数据完整",
    partial: "数据部分可用",
    stale: "数据可能过期",
    unavailable: "行情不可用",
  };
  return labels[value];
}

function methodKindLabel(value: HoldingDiagnosisMethod["kind"]): string {
  const labels: Record<HoldingDiagnosisMethod["kind"], string> = {
    ai_analysis: "AI 分析",
    local_function: "本地函数",
    hybrid_analysis: "综合判断",
  };
  return labels[value];
}

function recommendationLabel(value: HoldingDiagnosisItem["recommendation"]["direction"]): string {
  const labels: Record<HoldingDiagnosisItem["recommendation"]["direction"], string> = {
    add_evaluation: "关注加仓条件",
    reduce_evaluation: "关注减仓条件",
    hold: "持有复核",
    observe: "继续观察",
    research_further: "补充研究",
  };
  return labels[value];
}

function aiStatusLabel(value: HoldingDiagnosisReport["aiStatus"]["state"]): string {
  const labels: Record<HoldingDiagnosisReport["aiStatus"]["state"], string> = {
    completed: "AI 已完成诊断",
    local: "本地行情与指标摘要",
    timeout: "AI 超时，已使用本地摘要",
    unavailable: "AI 不可用，已使用本地摘要",
  };
  return labels[value];
}

function formatPrice(value: number | null): string {
  if (value === null) return "--";
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
}

function formatParameters(method: HoldingDiagnosisMethod): string {
  const parameters = Object.entries(method.parameters ?? {});
  if (parameters.length === 0) return method.dataWindow === undefined ? "" : `${method.dataWindow} 个交易日`;
  const summary = parameters.map(([key, value]) => `${key}=${value}`).join(", ");
  return method.dataWindow === undefined ? summary : `${summary} · ${method.dataWindow} 个交易日`;
}

function annotations(item: HoldingDiagnosisItem): KlineAnnotation[] {
  return item.chart.turningPoints.map((point) => ({
    date: point.date,
    price: point.price,
    direction: point.direction,
    level: point.direction === "bullish" ? "info" : "warning",
    title: point.title,
    reason: point.reason,
    color: point.direction === "bullish" ? "#fa7575" : "#68d991",
  }));
}

function sourcesFor(item: HoldingDiagnosisItem) {
  return report.value?.sources.filter((source) => source.itemId === item.id) ?? [];
}

function selectItem(item: HoldingDiagnosisItem): void {
  activeItemId.value = item.id;
}

async function loadArchive(preferredReportId?: string): Promise<void> {
  if (token.value === null) return;
  isLoading.value = true;
  try {
    const result = await api.listHoldingDiagnosisRuns(token.value);
    runs.value = result.items;
    const nextReportId = preferredReportId
      ?? activeReportId.value
      ?? result.items.find((item) => item.reportId !== null)?.reportId
      ?? null;
    if (nextReportId === null) {
      report.value = null;
      return;
    }
    await loadReport(nextReportId);
  } catch (error) {
    errorMessage.value = errorText(error, "持仓诊断归档加载失败");
  } finally {
    isLoading.value = false;
  }
}

async function loadReport(reportId: string): Promise<void> {
  if (token.value === null || loadingReportId.value === reportId) return;
  loadingReportId.value = reportId;
  errorMessage.value = "";
  try {
    const next = await api.getHoldingDiagnosisReport(token.value, reportId);
    report.value = next;
    activeItemId.value = next.items[0]?.id ?? null;
  } catch (error) {
    errorMessage.value = errorText(error, "持仓诊断报告加载失败");
  } finally {
    loadingReportId.value = null;
  }
}

async function selectRun(item: ReportRun): Promise<void> {
  if (item.reportId === null) return;
  await loadReport(item.reportId);
}

async function generate(): Promise<void> {
  if (token.value === null || isGenerating.value) return;
  isGenerating.value = true;
  errorMessage.value = "";
  try {
    const run = await api.startHoldingDiagnosis(token.value);
    if (run.reportId !== null) {
      await loadArchive(run.reportId);
    } else {
      runs.value = [run, ...runs.value.filter((item) => item.id !== run.id)];
      await pollRun(run.id);
    }
  } catch (error) {
    errorMessage.value = errorText(error, "持仓诊断生成失败");
  } finally {
    isGenerating.value = false;
  }
}

async function pollRun(runId: string, attempt = 0): Promise<void> {
  if (token.value === null || attempt >= 30) {
    if (attempt >= 30) errorMessage.value = "报告仍在生成，可稍后刷新归档查看。";
    return;
  }
  const current = await api.getHoldingDiagnosisRun(token.value, runId);
  runs.value = [current, ...runs.value.filter((item) => item.id !== current.id)];
  if (current.reportId !== null) {
    await loadArchive(current.reportId);
    return;
  }
  if (current.status === "failed" || current.status === "cancelled") {
    errorMessage.value = current.errorMessage ?? "持仓诊断未能生成报告";
    return;
  }
  await new Promise<void>((resolve) => {
    pollTimer = setTimeout(resolve, 2_000);
  });
  await pollRun(runId, attempt + 1);
}

async function deleteReport(item: ReportRun): Promise<void> {
  if (token.value === null || item.reportId === null || deletingReportId.value !== null) return;
  const confirmed = await requestConfirmation({
    title: "删除持仓诊断报告",
    message: `将删除 ${formatDateTime(item.createdAt)} 的报告及其图表快照、建议和来源记录。此操作不可恢复。`,
    confirmLabel: "删除",
    tone: "danger",
  });
  if (!confirmed) return;

  deletingReportId.value = item.reportId;
  try {
    await api.deleteHoldingDiagnosisReport(token.value, item.reportId);
    if (report.value?.id === item.reportId) report.value = null;
    await loadArchive();
  } catch (error) {
    errorMessage.value = errorText(error, "删除持仓诊断报告失败");
  } finally {
    deletingReportId.value = null;
  }
}
</script>

<template>
  <section class="batman-workspace holding-diagnosis" aria-label="持仓诊断">
    <header class="holding-diagnosis-header">
      <div>
        <h1>持仓诊断</h1>
        <span v-if="report">报告日期 {{ report.marketAsOf ?? "待行情确认" }} · {{ formatDateTime(report.createdAt) }}</span>
      </div>
      <div class="holding-diagnosis-actions">
        <button
          aria-label="刷新持仓诊断归档"
          class="batman-icon-button"
          data-hint="刷新归档"
          data-hint-position="bottom"
          :disabled="isLoading || isGenerating"
          type="button"
          @click="loadArchive()"
        >
          <RefreshCw :class="{ spinning: isLoading }" :size="16" />
        </button>
        <button
          aria-label="生成持仓诊断"
          class="batman-button primary"
          :disabled="isGenerating"
          type="button"
          @click="generate"
        >
          <LoaderCircle v-if="isGenerating" class="spinning" :size="16" />
          <ChartNoAxesCombined v-else :size="16" />
          {{ isGenerating ? "生成中" : "生成诊断" }}
        </button>
      </div>
    </header>

    <p v-if="errorMessage" class="holding-diagnosis-feedback error">{{ errorMessage }}</p>

    <div class="holding-diagnosis-layout">
      <aside class="holding-diagnosis-archive" aria-label="持仓诊断报告归档">
        <header>
          <strong>报告归档</strong>
          <span>{{ runs.length }}</span>
        </header>
        <div v-if="isLoading && runs.length === 0" class="holding-diagnosis-empty">
          <LoaderCircle class="spinning" :size="20" />
        </div>
        <div v-else-if="runs.length === 0" class="holding-diagnosis-empty">
          <FileClock :size="25" />
          <span>暂无报告</span>
        </div>
        <div v-else class="holding-diagnosis-run-list">
          <article
            v-for="item in runs"
            :key="item.id"
            :class="[
              'holding-diagnosis-run',
              {
                active: item.reportId === activeReportId,
                'has-report': item.reportId !== null,
                'without-report': item.reportId === null,
              },
            ]"
          >
            <button
              class="holding-diagnosis-run-select"
              :disabled="item.reportId === null"
              type="button"
              @click="selectRun(item)"
            >
              <span>{{ triggerLabel(item.trigger) }}</span>
              <strong>{{ formatDateTime(item.createdAt) }}</strong>
              <small :class="`status-${item.status}`">{{ statusLabel(item.status) }}<template v-if="item.status === 'queued' || item.status === 'running'"> · {{ item.progress }}%</template></small>
              <em v-if="item.errorMessage">{{ item.errorMessage }}</em>
            </button>
            <button
              v-if="item.reportId"
              :aria-label="`删除 ${formatDateTime(item.createdAt)} 报告`"
              class="batman-icon-button danger holding-diagnosis-run-delete"
              data-hint="删除报告"
              data-hint-position="right"
              :disabled="isGenerating || deletingReportId !== null"
              type="button"
              @click="deleteReport(item)"
            >
              <Trash2 :size="15" />
            </button>
          </article>
        </div>
      </aside>

      <main class="holding-diagnosis-report" aria-live="polite">
        <div v-if="loadingReportId !== null" class="holding-diagnosis-loading">
          <LoaderCircle class="spinning" :size="24" />
        </div>
        <div v-else-if="report === null" class="holding-diagnosis-empty report-empty">
          <ChartNoAxesCombined :size="29" />
          <span>选择已完成的报告查看</span>
        </div>
        <template v-else>
          <section class="holding-diagnosis-summary">
            <div>
              <span>报告正文</span>
              <p>{{ report.body }}</p>
            </div>
            <div :class="['holding-diagnosis-ai-status', `ai-${report.aiStatus.state}`]">
              <Bot :size="15" />
              <span>{{ aiStatusLabel(report.aiStatus.state) }}</span>
              <small>{{ report.aiStatus.model.name }} · {{ report.aiStatus.message }}</small>
            </div>
            <small v-if="report.errorMessage">{{ report.errorMessage }}</small>
          </section>

          <nav class="holding-diagnosis-tabs" role="tablist" aria-label="报告持仓标的">
            <button
              v-for="item in report.items"
              :id="`holding-diagnosis-tab-${item.id}`"
              :key="item.id"
              :aria-controls="`holding-diagnosis-panel-${item.id}`"
              :aria-label="`查看 ${item.instrument.name} 诊断`"
              :aria-selected="activeItem?.id === item.id"
              :class="{ active: activeItem?.id === item.id }"
              role="tab"
              type="button"
              @click="selectItem(item)"
            >
              <b>{{ item.instrument.name }}</b>
              <span>{{ item.instrument.code }}</span>
            </button>
          </nav>

          <article
            v-for="item in activeItem === null ? [] : [activeItem]"
            :id="`holding-diagnosis-panel-${item.id}`"
            :key="item.id"
            :aria-labelledby="`holding-diagnosis-tab-${item.id}`"
            class="holding-diagnosis-item"
            role="tabpanel"
          >
            <header class="holding-diagnosis-item-header">
              <div>
                <h2>{{ item.instrument.name }}</h2>
                <span>{{ item.instrument.code }} · {{ item.instrument.assetType === 'stock' ? 'A 股' : item.instrument.assetType === 'index' ? '指数' : '场内 ETF' }}</span>
              </div>
              <div class="holding-diagnosis-item-status">
                <span :class="`quality-${item.dataQuality}`">{{ dataQualityLabel(item.dataQuality) }}</span>
                <b>{{ recommendationLabel(item.recommendation.direction) }}</b>
              </div>
            </header>

            <div class="holding-diagnosis-facts">
              <span>持仓 {{ formatPrice(item.quantity) }}</span>
              <span>成本 {{ formatPrice(item.averageCost) }}</span>
              <span>最新 {{ formatPrice(item.currentPrice) }}</span>
              <span>浮盈亏 {{ formatPrice(item.profit) }}</span>
            </div>

            <KLineChart
              :annotations="annotations(item)"
              :bars="item.chart.bars"
              height="360px"
              :ma-periods="[5, 20]"
              subchart="volume"
              title=""
            />

            <section v-if="item.chart.turningPoints.length" class="holding-diagnosis-turning-points">
              <h3>趋势拐点</h3>
              <div>
                <article v-for="point in item.chart.turningPoints" :key="`${point.date}-${point.title}`">
                  <b>{{ point.date }} · {{ point.title }}</b>
                  <span>{{ point.reason }}</span>
                  <small>{{ point.methods.map((method) => `${method.name}${formatParameters(method) ? ` (${formatParameters(method)})` : ''}`).join(' · ') }}</small>
                </article>
              </div>
            </section>

            <div class="holding-diagnosis-item-grid">
              <section>
                <h3>诊断</h3>
                <p>{{ item.analysis }}</p>
              </section>
              <section>
                <h3>关键条件</h3>
                <dl>
                  <div><dt>时机</dt><dd>{{ item.recommendation.timing }}</dd></div>
                  <div><dt>参考区间</dt><dd>{{ formatPrice(item.recommendation.referencePriceLow) }} - {{ formatPrice(item.recommendation.referencePriceHigh) }}</dd></div>
                  <div><dt>失效参考</dt><dd>{{ formatPrice(item.recommendation.invalidationPrice) }}</dd></div>
                  <div><dt>有效期</dt><dd>{{ item.recommendation.validUntil ?? "待后续确认" }}</dd></div>
                </dl>
                <p class="holding-diagnosis-uncertainty">{{ item.recommendation.uncertainty }}</p>
              </section>
            </div>

            <section class="holding-diagnosis-methods">
              <h3>方法与参数</h3>
              <div>
                <article v-for="method in item.methods" :key="`${method.kind}-${method.name}`">
                  <span :class="`method-${method.kind}`">{{ methodKindLabel(method.kind) }}</span>
                  <b>{{ method.name }}</b>
                  <small v-if="formatParameters(method)">{{ formatParameters(method) }}</small>
                  <p>{{ method.rationale }}</p>
                </article>
              </div>
            </section>

            <section class="holding-diagnosis-sources">
              <h3>信息来源</h3>
              <div v-if="sourcesFor(item).length" class="holding-diagnosis-source-list">
                <article v-for="source in sourcesFor(item)" :key="source.id">
                  <details>
                    <summary>
                      <b>{{ source.sourceName }}</b>
                      <span>{{ source.title }}</span>
                      <small>{{ source.availability === 'available' ? '已获取摘要' : source.availability === 'link_only' ? '仅跳转查阅' : '暂不可用' }}</small>
                    </summary>
                    <div class="holding-diagnosis-source-detail">
                      <p>{{ source.summary ?? "本次未获得可展示的来源摘要。" }}</p>
                      <ul v-if="source.highlights.length">
                        <li v-for="highlight in source.highlights" :key="highlight">{{ highlight }}</li>
                      </ul>
                      <small v-if="source.publishedAt">发布时间 {{ formatDateTime(source.publishedAt) }}</small>
                    </div>
                  </details>
                  <a
                    :aria-label="`打开 ${source.title}`"
                    :href="source.url"
                    data-hint="打开来源"
                    data-hint-position="top"
                    rel="noreferrer"
                    target="_blank"
                  ><ExternalLink :size="15" /></a>
                </article>
              </div>
              <p v-else>本次未获取可跳转的外部来源。</p>
            </section>
          </article>
        </template>
      </main>
    </div>
  </section>
</template>

<style scoped>
.holding-diagnosis { display: flex; flex-direction: column; gap: 14px; min-height: 0; }
.holding-diagnosis-header { align-items: center; display: flex; justify-content: space-between; min-width: 0; }
.holding-diagnosis-header h1 { color: #edf7ff; font-size: 20px; margin: 0; }
.holding-diagnosis-header span { color: #8da4bc; display: block; font-size: 12px; margin-top: 3px; }
.holding-diagnosis-actions { align-items: center; display: flex; gap: 7px; }
.holding-diagnosis-feedback { border: 1px solid; border-radius: 5px; font-size: 13px; margin: 0; padding: 9px 11px; }.holding-diagnosis-feedback.error { background: #331e27; border-color: #a54d61; color: #ffc2ca; }
.holding-diagnosis-layout { display: grid; flex: 1; gap: 14px; grid-template-columns: minmax(220px, 280px) minmax(0, 1fr); min-height: 0; }
.holding-diagnosis-archive { background: #101b2d; border: 1px solid #2b425f; border-radius: 7px; display: flex; flex-direction: column; min-height: 420px; overflow: hidden; }.holding-diagnosis-archive > header { align-items: center; border-bottom: 1px solid #2b425f; color: #dfeefa; display: flex; font-size: 13px; justify-content: space-between; padding: 11px; }.holding-diagnosis-archive > header span { background: #1d3049; border-radius: 10px; color: #a8c4d7; font-size: 11px; min-width: 21px; padding: 2px 6px; text-align: center; }
.holding-diagnosis-run-list { display: flex; flex-direction: column; overflow-y: auto; }.holding-diagnosis-run { align-items: stretch; border-bottom: 1px solid #223650; display: grid; grid-template-columns: minmax(0, 1fr); min-height: 72px; }.holding-diagnosis-run.has-report { grid-template-columns: minmax(0, 1fr) 38px; }.holding-diagnosis-run.active { background: #172b41; box-shadow: inset 3px 0 #57cfc6; }.holding-diagnosis-run-select { background: transparent; border: 0; color: inherit; cursor: pointer; display: grid; gap: 2px; min-width: 0; padding: 10px 12px; text-align: left; }.holding-diagnosis-run-select:disabled { cursor: default; }.holding-diagnosis-run-select > span { color: #7fc9c5; font-size: 11px; }.holding-diagnosis-run strong { color: #e0edf8; font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.holding-diagnosis-run small { color: #9cb2c7; font-size: 11px; }.holding-diagnosis-run small.status-failed { color: #f19ca8; }.holding-diagnosis-run small.status-partial { color: #f0c878; }.holding-diagnosis-run em { color: #e5a4ad; font-size: 10px; font-style: normal; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.holding-diagnosis-run-delete { align-self: center; justify-self: center; }
.holding-diagnosis-report { background: #101b2d; border: 1px solid #2b425f; border-radius: 7px; min-height: 420px; overflow-y: auto; padding: 15px; }.holding-diagnosis-loading, .holding-diagnosis-empty { align-items: center; color: #91a8bf; display: flex; flex: 1; flex-direction: column; font-size: 13px; gap: 9px; justify-content: center; min-height: 190px; }.report-empty { min-height: 390px; }
.holding-diagnosis-summary { border-bottom: 1px solid #2b425f; display: grid; gap: 8px; padding: 0 0 14px; }.holding-diagnosis-summary > div > span, .holding-diagnosis-summary small { color: #91aac1; font-size: 11px; }.holding-diagnosis-summary p { color: #e1eef9; font-size: 14px; line-height: 1.7; margin: 0; white-space: pre-wrap; }.holding-diagnosis-summary > small { color: #e0ad78; }.holding-diagnosis-ai-status { align-items: center; border-left: 3px solid #64c9dc; display: grid; gap: 2px 7px; grid-template-columns: auto auto minmax(0, 1fr); padding: 5px 8px; }.holding-diagnosis-ai-status > svg { color: #79cce9; grid-row: span 2; }.holding-diagnosis-ai-status > span { color: #cdeafa; font-size: 12px; }.holding-diagnosis-ai-status > small { color: #9cb7ca; font-size: 11px; min-width: 0; }.holding-diagnosis-ai-status.ai-timeout, .holding-diagnosis-ai-status.ai-unavailable { border-color: #e2a75c; }.holding-diagnosis-ai-status.ai-timeout > svg, .holding-diagnosis-ai-status.ai-unavailable > svg { color: #f0bc73; }
.holding-diagnosis-tabs { border-bottom: 1px solid #2b425f; display: flex; gap: 5px; margin-top: 14px; overflow-x: auto; padding-bottom: 9px; scrollbar-width: thin; }.holding-diagnosis-tabs button { background: #142237; border: 1px solid #2a425e; border-radius: 4px; color: #a9bfd0; cursor: pointer; display: grid; flex: 0 0 auto; gap: 2px; min-width: 116px; padding: 7px 10px; text-align: left; }.holding-diagnosis-tabs button:hover { border-color: #579ea4; color: #e1f0fa; }.holding-diagnosis-tabs button.active { background: #173243; border-color: #5bc5bd; box-shadow: inset 0 -2px #5bc5bd; color: #edf9fa; }.holding-diagnosis-tabs b { font-size: 12px; font-weight: 600; }.holding-diagnosis-tabs span { color: #90a9bd; font-size: 10px; }.holding-diagnosis-tabs button.active span { color: #a7ded9; }
.holding-diagnosis-item { display: grid; gap: 13px; padding: 18px 0 0; }.holding-diagnosis-item-header { align-items: flex-start; display: flex; justify-content: space-between; gap: 14px; }.holding-diagnosis-item-header h2 { color: #edf7ff; font-size: 16px; margin: 0; }.holding-diagnosis-item-header span { color: #91a9bf; font-size: 12px; }.holding-diagnosis-item-status { align-items: flex-end; display: flex; flex-direction: column; gap: 4px; white-space: nowrap; }.holding-diagnosis-item-status span { font-size: 11px; }.holding-diagnosis-item-status b { color: #f0c878; font-size: 12px; }.quality-complete { color: #79dcb2 !important; }.quality-partial, .quality-stale { color: #f0c878 !important; }.quality-unavailable { color: #f19ca8 !important; }
.holding-diagnosis-facts { display: flex; flex-wrap: wrap; gap: 7px; }.holding-diagnosis-facts span { background: #17263a; border: 1px solid #29425e; border-radius: 4px; color: #c6d8e8; font-size: 11px; padding: 4px 7px; }
.holding-diagnosis-turning-points > div { display: flex; flex-wrap: wrap; gap: 7px; }.holding-diagnosis-turning-points article { background: #17263a; border-left: 3px solid #6dcdc3; display: grid; gap: 2px; min-width: 180px; padding: 7px 9px; }.holding-diagnosis-turning-points b { color: #dcebf6; font-size: 11px; }.holding-diagnosis-turning-points span { color: #a8bdce; font-size: 11px; }.holding-diagnosis-turning-points small { color: #ddbf78; font-size: 10px; }
.holding-diagnosis-item-grid { display: grid; gap: 18px; grid-template-columns: minmax(0, 1.1fr) minmax(230px, .9fr); }.holding-diagnosis-item-grid section, .holding-diagnosis-methods, .holding-diagnosis-sources { min-width: 0; }.holding-diagnosis-item h3 { color: #a9c4d9; font-size: 11px; font-weight: 600; letter-spacing: 0; margin: 0 0 7px; text-transform: uppercase; }.holding-diagnosis-item-grid p { color: #d6e3ee; font-size: 13px; line-height: 1.65; margin: 0; }.holding-diagnosis-item-grid dl { display: grid; gap: 5px; margin: 0; }.holding-diagnosis-item-grid dl div { display: grid; font-size: 12px; grid-template-columns: 68px minmax(0, 1fr); }.holding-diagnosis-item-grid dt { color: #899fb5; }.holding-diagnosis-item-grid dd { color: #dbeaf5; margin: 0; }.holding-diagnosis-uncertainty { color: #c8a97a !important; font-size: 11px !important; margin-top: 8px !important; }
.holding-diagnosis-methods > div { display: flex; flex-wrap: wrap; gap: 7px; }.holding-diagnosis-methods article { background: #142237; border: 1px solid #2a425e; border-radius: 4px; display: grid; gap: 3px; min-width: 160px; padding: 8px; }.holding-diagnosis-methods article > span { font-size: 10px; }.method-ai_analysis { color: #74bbe4; }.method-local_function { color: #7ed9ac; }.method-hybrid_analysis { color: #efc777; }.holding-diagnosis-methods b { color: #dfeefa; font-size: 12px; }.holding-diagnosis-methods small { color: #96adc2; font-size: 10px; }.holding-diagnosis-methods p { color: #aebfd0; font-size: 11px; line-height: 1.45; margin: 0; }
.holding-diagnosis-source-list { display: grid; gap: 5px; }.holding-diagnosis-source-list article { align-items: flex-start; background: #142237; border: 1px solid #2a425e; border-radius: 4px; display: flex; gap: 8px; padding: 7px 8px; }.holding-diagnosis-source-list details { min-width: 0; width: 100%; }.holding-diagnosis-source-list summary { cursor: pointer; display: grid; gap: 1px; list-style: none; min-width: 0; padding-right: 4px; }.holding-diagnosis-source-list summary::-webkit-details-marker { display: none; }.holding-diagnosis-source-list summary::after { color: #75cfc6; content: '+'; font-size: 14px; grid-column: 2; grid-row: 1 / span 3; justify-self: end; }.holding-diagnosis-source-list details[open] summary::after { content: '-'; }.holding-diagnosis-source-list b { color: #bbd1e3; font-size: 11px; }.holding-diagnosis-source-list summary span { color: #d7e5f0; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.holding-diagnosis-source-list small { color: #91a8be; font-size: 10px; }.holding-diagnosis-source-detail { border-top: 1px solid #2a425e; display: grid; gap: 6px; margin-top: 7px; padding-top: 7px; }.holding-diagnosis-source-detail p { color: #c7d8e5; font-size: 12px; line-height: 1.55; margin: 0; }.holding-diagnosis-source-detail ul { color: #9cb5c8; display: grid; font-size: 11px; gap: 3px; margin: 0; padding-left: 16px; }.holding-diagnosis-source-list a { align-items: center; color: #6fcec6; display: inline-flex; flex: 0 0 auto; padding: 4px; }.holding-diagnosis-sources > p { color: #91a8be; font-size: 12px; margin: 0; }
@media (max-width: 880px) { .holding-diagnosis-layout { grid-template-columns: 1fr; }.holding-diagnosis-archive { max-height: 255px; min-height: 160px; }.holding-diagnosis-report { min-height: 0; }.holding-diagnosis-run-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }.holding-diagnosis-run { border-right: 1px solid #223650; }.holding-diagnosis-item-grid { grid-template-columns: 1fr; } }
@media (max-width: 560px) { .holding-diagnosis-header { align-items: flex-start; gap: 10px; }.holding-diagnosis-actions { flex-wrap: wrap; justify-content: flex-end; }.holding-diagnosis-actions .batman-button { font-size: 12px; }.holding-diagnosis-report { padding: 11px; }.holding-diagnosis-item-header { flex-direction: column; }.holding-diagnosis-item-status { align-items: flex-start; }.holding-diagnosis-item :deep(.kline-chart-shell) { min-width: 0; }.holding-diagnosis-item :deep(.kline-chart) { width: 100%; } }
</style>
