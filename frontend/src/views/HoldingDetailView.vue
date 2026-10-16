<script setup lang="ts">
import { ArrowLeft, ChevronLeft, ChevronRight, CirclePlus, RefreshCw, Trash2, X } from "lucide-vue-next";
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
import { requestConfirmation } from "@/components/confirmation";
import { useSession } from "@/stores/session";
import { formatDate } from "@/utils/date-format";
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
const operationDialogOpen = ref(false);
const operationAction = ref<"buy" | "sell" | "interest">("buy");
const operationQuantity = ref("100");
const operationPrice = ref("");
const operationFee = ref("0");
const operationOccurredAt = ref(nowInputValue());
const operationNote = ref("");
const isLoading = ref(false);
const isSavingOperation = ref(false);
const deletingOperationId = ref<string | null>(null);
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
const dividendAmount = computed(() => {
  if (operationAction.value !== "interest") return null;
  const quantity = Number(operationQuantity.value);
  const price = Number(operationPrice.value);
  if (!Number.isFinite(quantity) || !Number.isFinite(price)) return null;
  return Number((quantity * price).toFixed(4));
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

function openOperation(): void {
  if (data.value?.holding.status !== "active") return;
  operationAction.value = "buy";
  operationQuantity.value = "100";
  operationPrice.value = "";
  operationFee.value = "0";
  operationOccurredAt.value = nowInputValue();
  operationNote.value = "";
  errorMessage.value = "";
  operationDialogOpen.value = true;
}

function closeOperationDialog(): void {
  if (isSavingOperation.value) return;
  operationDialogOpen.value = false;
  errorMessage.value = "";
}

async function createOperation(): Promise<void> {
  const accessToken = token.value;
  const holding = data.value?.holding;
  if (accessToken === null || holding === undefined || holding.status !== "active" || isSavingOperation.value) return;
  isSavingOperation.value = true;
  errorMessage.value = "";
  try {
    await api.addHoldingTransaction(accessToken, {
      holdingId: holding.id,
      action: operationAction.value,
      quantity: Number(operationQuantity.value),
      price: Number(operationPrice.value),
      fee: Number(operationFee.value),
      occurredAt: toIso(operationOccurredAt.value),
      note: operationNote.value,
    });
    operationDialogOpen.value = false;
    await load();
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "增加操作失败";
  } finally {
    isSavingOperation.value = false;
  }
}

async function deleteOperation(transaction: HoldingChartData["transactions"][number]): Promise<void> {
  const accessToken = token.value;
  const holding = data.value?.holding;
  if (accessToken === null || holding === undefined || deletingOperationId.value !== null) return;
  const confirmed = await requestConfirmation({
    title: "删除操作记录",
    message: `删除这条${actionLabel(transaction.action)}操作后，将同步回滚持仓数量和资金流水；受影响日期的资金趋势会标记为待重新计算。确定删除吗？`,
    confirmLabel: "删除",
    tone: "danger",
  });
  if (!confirmed) return;
  deletingOperationId.value = transaction.id;
  errorMessage.value = "";
  try {
    await api.deleteHoldingTransaction(accessToken, holding.id, transaction.id);
    await load();
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "删除操作记录失败";
  } finally {
    deletingOperationId.value = null;
  }
}

function money(value: number | null): string { return value === null ? "-" : value.toFixed(2); }
function signed(value: number | null): string { return value === null ? "-" : `${value > 0 ? "+" : ""}${value.toFixed(2)}`; }
function percent(value: number | null): string { return value === null ? "-" : `${value.toFixed(2)}%`; }
function tone(value: number | null): "up" | "down" | "" { return value === null || value === 0 ? "" : value > 0 ? "up" : "down"; }
function actionLabel(value: "buy" | "sell" | "interest"): string { return value === "buy" ? "买入" : value === "sell" ? "卖出" : "计息"; }
function nowInputValue(): string { const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset()); return now.toISOString().slice(0, 16); }
function toIso(value: string): string { return new Date(value).toISOString(); }

watch(operationAction, (action) => {
  if (action === "interest") operationQuantity.value = String(data.value?.holding.quantity ?? 100);
});
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
      <div v-if="selectedTable === 'operations'" class="holding-detail-operations-toolbar">
        <strong>操作记录（{{ data.transactions.length }}）</strong>
        <button v-if="data.holding.status === 'active'" :aria-label="`为 ${data.holding.instrument.name} 增加操作`" class="batman-button primary" type="button" @click="openOperation"><CirclePlus :size="15" />增加操作</button>
      </div>
      <div class="batman-table-frame holding-detail-table-frame">
        <table v-if="selectedTable === 'operations'" class="batman-table holding-detail-table"><thead><tr><th>时间</th><th>操作</th><th>数量</th><th>价格</th><th>费用</th><th>资金影响</th><th>备注</th><th class="batman-action-header">操作</th></tr></thead><tbody><tr v-for="item in data.transactions" :key="item.id"><td>{{ formatDate(item.occurredAt) }}</td><td :class="item.action === 'buy' ? 'up' : item.action === 'sell' ? 'down' : ''">{{ actionLabel(item.action) }}</td><td>{{ item.quantity }}</td><td>{{ money(item.price) }}</td><td>{{ money(item.fee) }}</td><td :class="tone(item.cashImpact)">{{ signed(item.cashImpact) }}</td><td>{{ item.note || '-' }}</td><td class="batman-actions"><div class="batman-action-controls"><button :aria-label="`删除${actionLabel(item.action)}操作`" class="batman-icon-button danger" data-hint="删除操作" data-hint-position="top" :disabled="deletingOperationId !== null" type="button" @click="deleteOperation(item)"><Trash2 :size="14" /></button></div></td></tr><tr v-if="data.transactions.length === 0"><td class="batman-empty-cell" colspan="8">暂无操作记录</td></tr></tbody></table>
        <table v-else class="batman-table holding-detail-table"><thead><tr><th>日期</th><th>数量</th><th>净成本</th><th>均价</th><th>收盘价</th><th>市值</th><th>盈亏</th></tr></thead><tbody><tr v-for="item in visibleTrace" :key="item.date"><td>{{ item.date }}</td><td>{{ item.quantity }}</td><td>{{ money(item.netCost) }}</td><td>{{ money(item.averageCost) }}</td><td>{{ money(visibleBars.find((bar) => bar.date === item.date)?.close ?? null) }}</td><td>{{ money(item.marketValue) }}</td><td :class="tone(item.profit)">{{ signed(item.profit) }}</td></tr><tr v-if="visibleTrace.length === 0"><td class="batman-empty-cell" colspan="7">暂无持仓跟踪数据</td></tr></tbody></table>
      </div>
    </template>

    <div v-if="operationDialogOpen" class="batman-dialog-backdrop" @click.self="closeOperationDialog">
      <section class="batman-dialog" aria-modal="true" role="dialog">
        <header><strong>增加操作 · {{ data?.holding.instrument.name }}</strong><button aria-label="关闭对话框" class="batman-icon-button" :disabled="isSavingOperation" title="关闭" type="button" @click="closeOperationDialog"><X :size="17" /></button></header>
        <form aria-label="新增操作" class="batman-form" @submit.prevent="createOperation">
          <label>操作<select v-model="operationAction"><option value="buy">买入</option><option value="sell">卖出</option><option value="interest">计息</option></select></label>
          <label>{{ operationAction === 'interest' ? '持仓数量' : '数量' }}<input v-model="operationQuantity" :aria-label="operationAction === 'interest' ? '持仓数量' : '数量'" min="0.0001" required step="any" type="number" /></label>
          <label>{{ operationAction === 'interest' ? '分红单价' : '价格' }}<input v-model="operationPrice" :aria-label="operationAction === 'interest' ? '分红单价' : '价格'" min="0" required step="0.001" type="number" /></label>
          <label>费用<input v-model="operationFee" aria-label="费用" min="0" required step="0.001" type="number" /></label>
          <p v-if="dividendAmount !== null" class="batman-selected">分红金额 = 持仓数量 × 分红单价：{{ money(dividendAmount) }}</p>
          <label>操作时间<input v-model="operationOccurredAt" aria-label="操作时间" required type="datetime-local" /></label>
          <label>备注<input v-model.trim="operationNote" aria-label="备注" maxlength="500" /></label>
          <p v-if="errorMessage" class="batman-error">{{ errorMessage }}</p>
          <footer><button class="batman-button" :disabled="isSavingOperation" type="button" @click="closeOperationDialog">取消</button><button class="batman-button primary" :disabled="isSavingOperation" type="submit">确定</button></footer>
        </form>
      </section>
    </div>
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
.holding-detail-subchart { margin-left: auto; }.holding-detail-chart-frame { background: #121b2b; border: 1px solid #2d4059; border-radius: 7px; padding: 2px 6px; }.holding-detail-tabs { display: inline-flex; margin-left: auto; }.holding-detail-tabs button { background: #162236; border: 1px solid #344963; color: #b9c8d9; font-size: 12px; padding: 4px 8px; }.holding-detail-tabs button + button { margin-left: -1px; }.holding-detail-tabs button.active { background: #2673bd; color: #fff; position: relative; }.holding-detail-operations-toolbar { align-items: center; display: flex; justify-content: space-between; margin: 8px 0; min-height: 32px; }.holding-detail-operations-toolbar strong { color: #dbe8f5; font-size: 13px; }.holding-detail-table { min-width: 900px; width: 100%; }.holding-detail-table-frame { margin-bottom: 24px; }
@media (max-width: 1200px) { .holding-detail-summary { grid-template-columns: repeat(4, minmax(0, 1fr)); }.holding-detail-summary > div { border-right: 1px solid #2d4059; }.holding-detail-summary > div:nth-child(4) { border-radius: 0 7px 0 0; }.holding-detail-summary > div:nth-child(5) { border-radius: 0 0 0 7px; }.holding-detail-summary > div:last-child { border-radius: 0 0 7px 0; }.holding-detail-subchart { margin-left: 0; } }
@media (max-width: 680px) { .holding-detail-operations-toolbar { align-items: flex-start; flex-direction: column; } }
</style>
