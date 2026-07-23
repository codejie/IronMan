<script setup lang="ts">
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw } from "lucide-vue-next";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import HoldingPerformanceChart from "@/components/HoldingPerformanceChart.vue";
import {
  KLINE_PREFERENCES_KEY,
  MA_PERIODS,
  parseKlinePreferences,
  type KlineSubchart
} from "@/components/kline-analysis";
import { api, ApiError, type HoldingChartData } from "@/api/client";
import { useSession } from "@/stores/session";
import { formatDate, formatDateTime } from "@/utils/date-format";
import { instrumentTypeLabel } from "./instrument-kline-presentation";
import { holdingDetailRouteQuery, holdingNavigationTarget } from "./holding-detail-presentation";

type DetailTable = "operations" | "trace";

const route = useRoute();
const router = useRouter();
const { token } = useSession();
const initialPreferences = parseKlinePreferences(localStorage.getItem(KLINE_PREFERENCES_KEY));
const data = ref<HoldingChartData | null>(null);
const maPeriods = ref<number[]>(initialPreferences.maPeriods);
const subchart = ref<KlineSubchart>(initialPreferences.subchart);
const macdLines = ref<Record<string, Array<number | null>> | null>(null);
const selectedTable = ref<DetailTable>("operations");
const isLoading = ref(false);
const errorMessage = ref("");
let requestVersion = 0;

const holdingId = computed(() => typeof route.query.id === "string" ? route.query.id : "");
const holdingIds = computed(() => {
  const raw = typeof route.query.ids === "string" ? route.query.ids : "";
  const ids = raw.split(",").filter((id) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id));
  return ids.includes(holdingId.value) ? ids : holdingId.value === "" ? [] : [holdingId.value];
});
const currentIndex = computed(() => holdingIds.value.indexOf(holdingId.value));
const visibleBars = computed(() => data.value?.bars ?? []);
const visibleTrace = computed(() => data.value?.trace ?? []);
const latestTrace = computed(() => visibleTrace.value.at(-1) ?? data.value?.trace.at(-1) ?? null);
const summary = computed(() => data.value === null || latestTrace.value === null ? null : {
  currentPrice: visibleBars.value.at(-1)?.close ?? null,
  marketValue: latestTrace.value.marketValue,
  profit: latestTrace.value.profit,
  profitRate: latestTrace.value.netCost === 0 ? null : latestTrace.value.profit / Math.abs(latestTrace.value.netCost) * 100
});

function savePreferences(): void {
  const persisted = parseKlinePreferences(localStorage.getItem(KLINE_PREFERENCES_KEY));
  localStorage.setItem(KLINE_PREFERENCES_KEY, JSON.stringify({ range: persisted.range, maPeriods: maPeriods.value, subchart: subchart.value }));
}

async function load(refresh = false): Promise<void> {
  const accessToken = token.value;
  const id = holdingId.value;
  if (accessToken === null || id === "") {
    errorMessage.value = "缺少有效的持仓记录。";
    return;
  }
  const version = ++requestVersion;
  isLoading.value = true;
  errorMessage.value = "";
  try {
    const result = await api.holdingChart(accessToken, id, refresh);
    if (version !== requestVersion) return;
    data.value = result;
    macdLines.value = result.macdLines;
  } catch (error) {
    if (version !== requestVersion) return;
    errorMessage.value = error instanceof ApiError ? error.message : "持仓详情加载失败";
  } finally {
    if (version === requestVersion) isLoading.value = false;
  }
}

function toggleMa(period: number): void {
  maPeriods.value = maPeriods.value.includes(period)
    ? maPeriods.value.filter((item) => item !== period)
    : [...maPeriods.value, period].sort((left, right) => left - right);
  savePreferences();
}

function selectSubchart(value: KlineSubchart): void {
  subchart.value = value;
}

function navigate(offset: number): void {
  const id = holdingNavigationTarget(holdingIds.value, holdingId.value, offset);
  if (id === null) return;
  void router.push({ path: "/holding/detail", query: holdingDetailRouteQuery(id, holdingIds.value) });
}

function money(value: number | null): string { return value === null ? "-" : value.toFixed(2); }
function signed(value: number | null): string { return value === null ? "-" : `${value > 0 ? "+" : ""}${value.toFixed(2)}`; }
function percent(value: number | null): string { return value === null ? "-" : `${value.toFixed(2)}%`; }
function tone(value: number | null): "up" | "down" | "" { return value === null || value === 0 ? "" : value > 0 ? "up" : "down"; }
function actionLabel(value: "buy" | "sell" | "interest"): string { return value === "buy" ? "买入" : value === "sell" ? "卖出" : "计息"; }

watch(subchart, savePreferences);
watch(holdingId, () => { void load(); });
onMounted(() => { void load(); });
</script>

<template>
  <section class="batman-workspace holding-detail-view">
    <div class="batman-toolbar holding-detail-toolbar">
      <div class="batman-toolbar-start">
        <button class="batman-button" type="button" @click="router.push('/holding/list')"><ArrowLeft :size="15" />返回持仓</button>
        <button :disabled="currentIndex <= 0" class="batman-button" type="button" @click="navigate(-1)"><ChevronLeft :size="15" />上一个</button>
        <button :disabled="currentIndex < 0 || currentIndex >= holdingIds.length - 1" class="batman-button" type="button" @click="navigate(1)">下一个<ChevronRight :size="15" /></button>
      </div>
      <button :disabled="isLoading" class="batman-button" type="button" @click="load(true)"><RefreshCw :class="{ spinning: isLoading }" :size="15" />刷新行情</button>
    </div>

    <p v-if="errorMessage" class="batman-error">{{ errorMessage }}</p>
    <p v-else-if="isLoading && data === null" class="batman-selected">正在加载持仓详情...</p>

    <template v-if="data">
      <header class="holding-detail-heading">
        <h1>{{ data.holding.instrument.name }} <span>{{ data.holding.instrument.code }}</span> <em>[{{ instrumentTypeLabel(data.holding.instrument) }}]</em><small>{{ data.holding.status === 'active' ? '持有中' : '已清仓' }} · 创建于 {{ formatDate(data.holding.createdAt) }}</small></h1>
      </header>

      <dl class="holding-detail-summary">
        <div><dt>持有数量</dt><dd>{{ latestTrace?.quantity ?? data.holding.quantity }}</dd></div>
        <div><dt>持仓成本</dt><dd>{{ money(latestTrace?.netCost ?? data.holding.cost) }}</dd></div>
        <div><dt>持仓均价</dt><dd>{{ money(latestTrace?.averageCost ?? data.holding.averageCost) }}</dd></div>
        <div><dt>最新价</dt><dd>{{ money(summary?.currentPrice ?? null) }}</dd></div>
        <div><dt>当前市值</dt><dd>{{ money(summary?.marketValue ?? null) }}</dd></div>
        <div><dt>累计盈亏</dt><dd :class="tone(summary?.profit ?? null)">{{ signed(summary?.profit ?? null) }}</dd></div>
        <div><dt>盈亏率</dt><dd :class="tone(summary?.profitRate ?? null)">{{ percent(summary?.profitRate ?? null) }}</dd></div>
      </dl>

      <div class="holding-detail-controls">
        <div class="kline-control-group" aria-label="均线" role="group"><button v-for="period in MA_PERIODS" :key="period" :aria-pressed="maPeriods.includes(period)" :class="{ active: maPeriods.includes(period) }" type="button" @click="toggleMa(period)">MA{{ period }}</button></div>
        <div class="kline-control-group holding-detail-subchart" aria-label="副图" role="group"><button :aria-pressed="subchart === 'macd'" :class="{ active: subchart === 'macd' }" type="button" @click="selectSubchart('macd')">MACD</button><button :aria-pressed="subchart === 'volume'" :class="{ active: subchart === 'volume' }" type="button" @click="selectSubchart('volume')">成交量</button></div>
      </div>
      <div v-if="visibleBars.length" class="holding-detail-chart-frame"><HoldingPerformanceChart :bars="visibleBars" :macd-lines="macdLines" :ma-periods="maPeriods" :subchart="subchart" :trace="visibleTrace" /></div>
      <p v-else class="batman-selected">暂无可展示的历史行情。</p>

      <div class="batman-section-divider"><span>明细记录</span><div class="holding-detail-tabs"><button :class="{ active: selectedTable === 'operations' }" type="button" @click="selectedTable = 'operations'">操作记录</button><button :class="{ active: selectedTable === 'trace' }" type="button" @click="selectedTable = 'trace'">每日跟踪</button></div></div>
      <div class="batman-table-frame holding-detail-table-frame">
        <table v-if="selectedTable === 'operations'" class="batman-table holding-detail-table"><thead><tr><th>时间</th><th>操作</th><th>数量</th><th>价格</th><th>费用</th><th>资金影响</th><th>备注</th></tr></thead><tbody><tr v-for="item in data.transactions" :key="item.id"><td>{{ formatDateTime(item.occurredAt) }}</td><td :class="item.action === 'buy' ? 'up' : item.action === 'sell' ? 'down' : ''">{{ actionLabel(item.action) }}</td><td>{{ item.quantity }}</td><td>{{ money(item.price) }}</td><td>{{ money(item.fee) }}</td><td :class="tone(item.cashImpact)">{{ signed(item.cashImpact) }}</td><td>{{ item.note || '-' }}</td></tr><tr v-if="data.transactions.length === 0"><td class="batman-empty-cell" colspan="7">暂无操作记录</td></tr></tbody></table>
        <table v-else class="batman-table holding-detail-table"><thead><tr><th>日期</th><th>数量</th><th>净成本</th><th>均价</th><th>收盘价</th><th>市值</th><th>盈亏</th></tr></thead><tbody><tr v-for="item in visibleTrace" :key="item.date"><td>{{ item.date }}</td><td>{{ item.quantity }}</td><td>{{ money(item.netCost) }}</td><td>{{ money(item.averageCost) }}</td><td>{{ money(visibleBars.find((bar) => bar.date === item.date)?.close ?? null) }}</td><td>{{ money(item.marketValue) }}</td><td :class="tone(item.profit)">{{ signed(item.profit) }}</td></tr><tr v-if="visibleTrace.length === 0"><td class="batman-empty-cell" colspan="7">暂无持仓跟踪数据</td></tr></tbody></table>
      </div>
    </template>
  </section>
</template>

<style scoped>
.holding-detail-toolbar { margin-bottom: 10px; }
.holding-detail-heading { border-bottom: 1px solid #2b3d55; margin-bottom: 10px; padding: 0 2px 10px; }
.holding-detail-heading h1 { align-items: baseline; color: #eff8ff; display: flex; flex-wrap: wrap; font-size: 21px; gap: 0 7px; line-height: 1.25; margin: 0; }
.holding-detail-heading h1 span { color: #b7c8d9; font-size: 16px; font-weight: 600; }
.holding-detail-heading h1 em { color: #67d6cb; font-size: 13px; font-style: normal; font-weight: 650; }
.holding-detail-heading h1 small { color: #8fa3b7; font-size: 12px; font-weight: 500; margin-left: 5px; }
.holding-detail-summary { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); margin: 0 0 10px; overflow: hidden; }
.holding-detail-summary > div { background: #121b2b; border: 1px solid #2d4059; border-right: 0; min-height: 64px; padding: 8px 10px; }
.holding-detail-summary > div:first-child { border-radius: 7px 0 0 7px; }.holding-detail-summary > div:last-child { border-radius: 0 7px 7px 0; border-right: 1px solid #2d4059; }
.holding-detail-summary dt { color: #8ea3ba; font-size: 10px; margin-bottom: 4px; }.holding-detail-summary dd { color: #eaf5fc; font-size: 14px; font-weight: 700; margin: 0; white-space: nowrap; }
.holding-detail-controls { align-items: center; display: flex; flex-wrap: wrap; gap: 6px 10px; margin: 0 0 7px; }
.kline-control-group { display: inline-flex; }.kline-control-group button { background: #162236; border: 1px solid #344963; color: #b9c8d9; cursor: pointer; font-size: 12px; min-width: 44px; padding: 4px 7px; }
.kline-control-group button + button { border-left-color: #2b3d54; margin-left: -1px; }.kline-control-group button:first-child { border-radius: 5px 0 0 5px; }.kline-control-group button:last-child { border-radius: 0 5px 5px 0; }.kline-control-group button.active { background: #2673bd; border-color: #4598eb; color: #fff; position: relative; z-index: 1; }
.holding-detail-subchart { margin-left: auto; }.holding-detail-chart-frame { background: #121b2b; border: 1px solid #2d4059; border-radius: 7px; padding: 2px 6px; }.holding-detail-tabs { display: inline-flex; margin-left: auto; }.holding-detail-tabs button { background: #162236; border: 1px solid #344963; color: #b9c8d9; font-size: 12px; padding: 4px 8px; }.holding-detail-tabs button + button { margin-left: -1px; }.holding-detail-tabs button.active { background: #2673bd; color: #fff; position: relative; }.holding-detail-table { min-width: 900px; width: 100%; }.holding-detail-table-frame { margin-bottom: 24px; }
@media (max-width: 1200px) { .holding-detail-summary { grid-template-columns: repeat(4, minmax(0, 1fr)); }.holding-detail-summary > div { border-right: 1px solid #2d4059; }.holding-detail-summary > div:nth-child(4) { border-radius: 0 7px 0 0; }.holding-detail-summary > div:nth-child(5) { border-radius: 0 0 0 7px; }.holding-detail-summary > div:last-child { border-radius: 0 0 7px 0; }.holding-detail-subchart { margin-left: 0; } }
</style>
