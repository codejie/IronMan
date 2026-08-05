<script setup lang="ts">
import { Activity, Bell, ChartNoAxesCombined, CirclePlus, RefreshCw, Trash2, X } from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import InstrumentKLineDialog from "@/components/InstrumentKLineDialog.vue";
import InstrumentPickerDialog from "@/components/InstrumentPickerDialog.vue";
import KLineChart from "@/components/KLineChart.vue";
import QuickAlertDialog from "@/components/QuickAlertDialog.vue";
import { api, ApiError, type BatmanHoldingWorkspace, type BatmanHoldingWorkspaceRecord, type Instrument, type MarketSnapshotPoint, type PriceBar } from "@/api/client";
import { useSession } from "@/stores/session";
import { instrumentCodeLabel } from "./instrument-kline-presentation";
import { holdingDetailRouteQuery } from "./holding-detail-presentation";
import { holdingProfitSummary, holdingQuoteDateLabel } from "./holdings-presentation";
import { formatDateTime } from "@/utils/date-format";

type Dialog = "create" | "capital" | "delete-holding";

const { token } = useSession();
const router = useRouter();
const workspace = ref<BatmanHoldingWorkspace | null>(null);
const showClosed = ref(false);
const useLocalData = ref(false);
const dialog = ref<Dialog | null>(null);
const isInstrumentPickerOpen = ref(false);
const selectedHolding = ref<BatmanHoldingWorkspaceRecord | null>(null);
const alertHolding = ref<BatmanHoldingWorkspaceRecord | null>(null);
const selectedInstrument = ref<Instrument | null>(null);
const selectedKlineInstrument = ref<BatmanHoldingWorkspaceRecord["instrument"] | null>(null);
const quantity = ref("100");
const price = ref("");
const fee = ref("0");
const occurredAt = ref(nowInputValue());
const note = ref("");
const capitalAmount = ref("");
const capitalNote = ref("");
const errorMessage = ref("");
const isLoading = ref(false);
const isSaving = ref(false);

const intradayDialogOpen = ref(false);
const intradayData = ref<MarketSnapshotPoint[] | null>(null);
const intradayLoading = ref(false);
const intradayError = ref("");
let intradayRequestVersion = 0;
const intradayHolding = ref<BatmanHoldingWorkspaceRecord | null>(null);
const intradayChartType = ref<"kline" | "line">("line");

// Cache to track which instruments have intraday data (instrumentId -> boolean)
// null = not checked yet, true = has data, false = no data
const intradayDataCache = ref<Map<string, boolean>>(new Map());

const intradayBars = computed<PriceBar[]>(() => (intradayData.value ?? []).map((item) => ({
  date: item.capturedAt,
  open: item.open,
  close: item.close,
  high: item.high,
  low: item.low,
  volume: item.volume,
})));
const intradayLabels = computed(() => (intradayData.value ?? []).map((item) => formatIntradayLabel(item.capturedAt)));
const intradaySummary = computed(() => {
  const points = intradayData.value ?? [];
  if (points.length === 0) return "";
  const first = points[0]!;
  const last = points.at(-1)!;
  const sources = [...new Set(points.map((item) => item.source))].join(" / ");
  return `${points.length} 个快照 · ${formatDateTime(first.capturedAt)} 至 ${formatDateTime(last.capturedAt)} · ${sources}`;
});

function formatIntradayLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${month}/${day} ${hours}:${minutes}`;
}

const activeRecords = computed(() => workspace.value?.active ?? []);
const closedRecords = computed(() => workspace.value?.closed ?? []);
const profitSummary = computed(() => workspace.value === null ? null : holdingProfitSummary(workspace.value.summary, closedRecords.value));
const dailyDifferenceTotal = computed(() => Number(activeRecords.value.reduce((sum, item) => sum + (item.dailyDifference ?? 0), 0).toFixed(6)));
const overflowTitleObservers = new WeakMap<HTMLElement, ResizeObserver>();

function updateOverflowTitles(element: HTMLElement): void {
  window.requestAnimationFrame(() => {
    for (const cell of element.querySelectorAll<HTMLTableCellElement>("td")) {
      if (cell.classList.contains("batman-actions")) {
        cell.removeAttribute("title");
        continue;
      }
      const text = cell.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const hasClippedChild = [...cell.querySelectorAll<HTMLElement>("[data-overflow-content]")].some((child) => child.scrollWidth > child.clientWidth);
      cell.title = cell.scrollWidth > cell.clientWidth || hasClippedChild ? text : "";
    }
  });
}

const vOverflowTitle = {
  mounted(element: HTMLElement): void {
    const observer = new ResizeObserver(() => updateOverflowTitles(element));
    overflowTitleObservers.set(element, observer);
    observer.observe(element);
    updateOverflowTitles(element);
  },
  updated(element: HTMLElement): void {
    updateOverflowTitles(element);
  },
  unmounted(element: HTMLElement): void {
    overflowTitleObservers.get(element)?.disconnect();
    overflowTitleObservers.delete(element);
  }
};

async function load(refresh = false): Promise<void> {
  if (token.value === null) return;
  isLoading.value = true;
  errorMessage.value = "";
  try {
    workspace.value = await api.batmanHoldingWorkspace(token.value, refresh && !useLocalData.value);
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "持仓数据加载失败";
  } finally {
    isLoading.value = false;
  }
}

function openCreate(): void {
  selectedInstrument.value = null;
  quantity.value = "100";
  price.value = "";
  fee.value = "0";
  occurredAt.value = nowInputValue();
  note.value = "";
  errorMessage.value = "";
  isInstrumentPickerOpen.value = true;
}

function selectHoldingInstrument(instrument: Instrument): void {
  selectedInstrument.value = instrument;
  errorMessage.value = "";
  isInstrumentPickerOpen.value = false;
  dialog.value = "create";
}

function closeInstrumentPicker(): void {
  isInstrumentPickerOpen.value = false;
  selectedInstrument.value = null;
  errorMessage.value = "";
}

function openCapital(): void {
  capitalAmount.value = "";
  capitalNote.value = "";
  errorMessage.value = "";
  dialog.value = "capital";
}

function viewFundsTrend(): void {
  void router.push("/holding/funds/trend");
}

function openDeleteHolding(holding: BatmanHoldingWorkspaceRecord): void {
  selectedHolding.value = holding;
  errorMessage.value = "";
  dialog.value = "delete-holding";
}

function openQuickAlert(holding: BatmanHoldingWorkspaceRecord): void {
  alertHolding.value = holding;
}

function closeQuickAlert(): void {
  alertHolding.value = null;
}

function holdingAlertPrice(holding: BatmanHoldingWorkspaceRecord): number | null {
  const basePrice = holding.currentPrice ?? holding.averageCost;
  return basePrice === null ? null : Number((basePrice * 0.95).toFixed(4));
}

function closeDialog(): void {
  dialog.value = null;
  isInstrumentPickerOpen.value = false;
  selectedHolding.value = null;
  selectedInstrument.value = null;
  errorMessage.value = "";
}

function viewKline(instrument: BatmanHoldingWorkspaceRecord["instrument"]): void {
  selectedKlineInstrument.value = instrument;
}

function closeKlineDialog(): void {
  selectedKlineInstrument.value = null;
}

async function openIntraday(holding: BatmanHoldingWorkspaceRecord): Promise<void> {
  const accessToken = token.value;
  if (accessToken === null || intradayLoading.value) return;
  
  // Check cache - if we know there's no data, don't even try
  const cached = intradayDataCache.value.get(holding.instrument.id);
  if (cached === false) {
    intradayError.value = "该标的暂无分时数据";
    intradayDialogOpen.value = true;
    intradayHolding.value = holding;
    intradayData.value = null;
    return;
  }
  
  intradayDialogOpen.value = true;
  intradayHolding.value = holding;
  intradayError.value = "";
  await loadIntradayData(accessToken, holding.instrument.id);
}

function closeIntradayDialog(): void {
  if (intradayLoading.value) return;
  intradayDialogOpen.value = false;
  intradayData.value = null;
  intradayHolding.value = null;
  intradayError.value = "";
  intradayChartType.value = "line";
}

async function loadIntradayData(accessToken: string, instrumentId: string): Promise<void> {
  const version = ++intradayRequestVersion;
  intradayLoading.value = true;
  intradayError.value = "";
  try {
    const now = new Date();
    const endAt = now.toISOString();
    const startAt = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const response = await api.marketSnapshotSeries(accessToken, instrumentId, startAt, endAt);
    if (version !== intradayRequestVersion) return;
    intradayData.value = response.items;
    // Update cache: true if we got data, false if empty
    intradayDataCache.value.set(instrumentId, response.items.length > 0);
  } catch (error) {
    if (version !== intradayRequestVersion) return;
    intradayError.value = error instanceof ApiError ? error.message : "分时数据加载失败";
    // On error, don't update cache - allow retry
  } finally {
    if (version === intradayRequestVersion) intradayLoading.value = false;
  }
}

function viewHoldingDetail(holding: BatmanHoldingWorkspaceRecord, records: BatmanHoldingWorkspaceRecord[]): void {
  void router.push({ path: "/holding/detail", query: holdingDetailRouteQuery(holding.id, records.map((item) => item.id)) });
}

function viewHoldingDetailFromRow(event: MouseEvent, holding: BatmanHoldingWorkspaceRecord, records: BatmanHoldingWorkspaceRecord[]): void {
  if (isInteractiveRowTarget(event.target)) return;
  viewHoldingDetail(holding, records);
}

function viewHoldingDetailFromKeyboard(event: KeyboardEvent, holding: BatmanHoldingWorkspaceRecord, records: BatmanHoldingWorkspaceRecord[]): void {
  if ((event.key !== "Enter" && event.key !== " ") || isInteractiveRowTarget(event.target)) return;
  event.preventDefault();
  viewHoldingDetail(holding, records);
}

function isInteractiveRowTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("button, a, input, select, textarea, label") !== null;
}

async function createHolding(): Promise<void> {
  if (token.value === null || selectedInstrument.value === null || isSaving.value) return;
  isSaving.value = true;
  try {
    await api.createHolding(token.value, { instrumentId: selectedInstrument.value.id, quantity: Number(quantity.value), price: Number(price.value), fee: Number(fee.value), occurredAt: toIso(occurredAt.value), note: note.value });
    closeDialog();
    await load();
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "增加持股失败";
  } finally {
    isSaving.value = false;
  }
}

async function adjustCapital(): Promise<void> {
  if (token.value === null || isSaving.value) return;
  isSaving.value = true;
  try {
    await api.adjustCash(token.value, Number(capitalAmount.value), capitalNote.value);
    closeDialog();
    await load();
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "资金调整失败";
  } finally {
    isSaving.value = false;
  }
}

async function deleteCurrent(): Promise<void> {
  if (token.value === null || selectedHolding.value === null || isSaving.value) return;
  isSaving.value = true;
  try {
    await api.deleteHolding(token.value, selectedHolding.value.id);
    closeDialog();
    await load();
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "删除记录失败";
  } finally {
    isSaving.value = false;
  }
}

function money(value: number | null): string { return value === null ? "-" : value.toFixed(2); }
function percent(value: number | null): string { return value === null ? "-" : `${value.toFixed(2)}%`; }
function signed(value: number | null): string { return value === null ? "-" : `${value > 0 ? "+" : ""}${value.toFixed(2)}`; }
function tone(value: number | null): "up" | "down" | "" { return value === null || value === 0 ? "" : value > 0 ? "up" : "down"; }
function nowInputValue(): string { const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset()); return now.toISOString().slice(0, 16); }
function toIso(value: string): string { return new Date(value).toISOString(); }

onMounted(load);
</script>

<template>
  <section class="batman-workspace batman-holdings">
    <div v-if="workspace" class="batman-funds">
      <div class="batman-funds-heading">
        <div class="batman-funds-label">资金信息</div>
        <button aria-label="查看资金趋势" class="batman-icon-button" data-hint="查看资金趋势" data-hint-position="top" type="button" @click="viewFundsTrend">
          <ChartNoAxesCombined :size="17" />
        </button>
      </div>
      <table class="batman-funds-table"><colgroup><col class="batman-funds-label-column" /><col /><col class="batman-funds-label-column" /><col /><col class="batman-funds-label-column" /><col /></colgroup><tbody>
        <tr><th>总资产</th><td colspan="5">{{ money(workspace.summary.totalAssets) }}</td></tr>
        <tr><th>可用</th><td>{{ money(workspace.summary.cashAvailable) }} / {{ percent(workspace.summary.totalAssets === 0 ? null : workspace.summary.cashAvailable / workspace.summary.totalAssets * 100) }}</td><th>成本</th><td>{{ money(workspace.summary.totalCost) }} / {{ percent(workspace.summary.totalAssets === 0 ? null : workspace.summary.totalCost / workspace.summary.totalAssets * 100) }}</td><th>本金</th><td class="batman-principal">{{ money(workspace.summary.principal) }}<button class="batman-text-button" type="button" @click="openCapital">调整</button></td></tr>
        <tr><th>市值</th><td>{{ money(workspace.summary.totalMarketValue) }}</td><th>盈亏</th><td :class="tone(profitSummary?.activeProfit ?? null)">{{ signed(profitSummary?.activeProfit ?? null) }}<span v-if="showClosed && closedRecords.length > 0 && profitSummary" class="holding-profit-breakdown">[ {{ signed(profitSummary.closedProfit) }} = {{ signed(profitSummary.totalProfit) }} ]</span></td><th>盈亏率</th><td :class="tone(profitSummary?.activeProfitRate ?? null)">{{ percent(profitSummary?.activeProfitRate ?? null) }}<span v-if="showClosed && closedRecords.length > 0 && profitSummary" class="holding-profit-breakdown">[ {{ percent(profitSummary.totalProfitRate) }} ]</span></td></tr>
      </tbody></table>
    </div>
    <div class="batman-section-divider"><span>持股记录</span></div>
    <div class="batman-toolbar"><div class="batman-toolbar-start"><button class="batman-button primary" type="button" @click="openCreate"><CirclePlus :size="15" />增加持股</button></div><div class="batman-toolbar-end"><label class="batman-checkbox"><input v-model="useLocalData" type="checkbox" />使用本地数据</label><button class="batman-button" :disabled="isLoading" type="button" @click="load(true)"><RefreshCw :class="{ spinning: isLoading }" :size="15" />刷新</button></div></div>
    <p v-if="errorMessage && dialog === null" class="batman-error">{{ errorMessage }}</p>
    <div class="batman-table-frame holdings-table-frame">
      <table class="batman-table holdings-table"><colgroup><col /><col /><col /><col /><col /><col /><col /><col /><col /><col /><col /><col /></colgroup><thead><tr><th>#</th><th>名称/代码</th><th>持仓/占比</th><th>成本/占比</th><th>均价/价差</th><th>现价/日期</th><th title="涨跌额/涨跌幅%">涨跌额/涨跌幅%</th><th>市值/占比</th><th>盈亏/占比</th><th>盈亏率%</th><th title="昨差/昨差率%">昨差/昨差率%</th><th class="batman-action-header">操作</th></tr></thead>
        <tbody v-overflow-title>
          <tr v-for="(holding, index) in activeRecords" :key="holding.id" :aria-label="`查看 ${holding.instrument.name} 持仓详情`" :data-holding-record="holding.id" class="holding-record-row" role="link" tabindex="0" @click="viewHoldingDetailFromRow($event, holding, activeRecords)" @keydown="viewHoldingDetailFromKeyboard($event, holding, activeRecords)"><td>{{ index + 1 }}</td><td class="batman-name"><button :aria-label="`查看 ${holding.instrument.name} K线`" class="batman-name-button" type="button" @click="viewKline(holding.instrument)"><strong data-overflow-content>{{ holding.instrument.name }}</strong><span data-overflow-content>{{ instrumentCodeLabel(holding.instrument) }}</span></button></td><td>{{ holding.quantity }} / {{ percent(holding.quantityRatio) }}</td><td>{{ money(holding.costCashFlow) }} / {{ percent(holding.costRatio) }}</td><td>{{ money(holding.averageCost) }} / <b :class="tone(holding.averagePriceDifference)">{{ signed(holding.averagePriceDifference) }}</b></td><td>{{ money(holding.currentPrice) }} {{ holdingQuoteDateLabel(holding.quoteDate) }}</td><td :class="tone(holding.priceChange)">{{ signed(holding.priceChange) }} / {{ percent(holding.priceChangeRate) }}</td><td>{{ money(holding.marketValue) }} / {{ percent(holding.marketValueRatio) }}</td><td :class="tone(holding.profit)">{{ signed(holding.profit) }} / {{ percent(holding.profitRatio) }}</td><td :class="tone(holding.profitRate)">{{ percent(holding.profitRate) }}</td><td :class="tone(holding.dailyDifference)">{{ signed(holding.dailyDifference) }} / {{ percent(holding.dailyDifferenceRate) }}</td><td class="batman-actions"><div class="batman-action-controls"><button :aria-label="`查看 ${holding.instrument.name} 分时数据`" class="batman-icon-button" data-hint="分时数据" data-hint-position="top" type="button" @click="openIntraday(holding)" :disabled="intradayDataCache.get(holding.instrument.id) === false"><Activity :size="14" /></button><button :aria-label="`为 ${holding.instrument.name} 设置持仓提醒`" class="batman-icon-button" data-hint="设置提醒" data-hint-position="top" type="button" @click="openQuickAlert(holding)"><Bell :size="15" /></button><button :aria-label="`删除 ${holding.instrument.name} 持仓`" class="batman-icon-button danger" data-hint="删除持仓" data-hint-position="top" type="button" @click="openDeleteHolding(holding)"><Trash2 :size="14" /></button></div></td></tr>
          <tr v-if="activeRecords.length === 0"><td class="batman-empty-cell" colspan="12">-</td></tr>
        </tbody>
        <tfoot v-if="workspace"><tr><td colspan="7"></td><td>{{ money(workspace.summary.totalMarketValue) }}</td><td :class="tone(profitSummary?.activeProfit ?? null)">{{ signed(profitSummary?.activeProfit ?? null) }}</td><td></td><td :class="tone(dailyDifferenceTotal)">{{ signed(dailyDifferenceTotal) }}</td><td></td></tr></tfoot>
      </table>
    </div>
    <div class="batman-section-divider closed"><span>清仓记录</span><button class="batman-text-button" type="button" @click="showClosed = !showClosed">{{ showClosed ? '隐藏' : '显示' }}</button></div>
    <div v-if="showClosed" class="batman-table-frame"><table class="batman-table closed-holdings-table"><colgroup><col /><col /><col /><col /><col /></colgroup><thead><tr><th>#</th><th>名称/代码</th><th>持仓</th><th>成本</th><th>盈亏</th></tr></thead><tbody v-overflow-title><tr v-for="(holding, index) in closedRecords" :key="holding.id" :aria-label="`查看 ${holding.instrument.name} 持仓详情`" :data-holding-record="holding.id" class="holding-record-row" role="link" tabindex="0" @click="viewHoldingDetailFromRow($event, holding, closedRecords)" @keydown="viewHoldingDetailFromKeyboard($event, holding, closedRecords)"><td>{{ index + 1 }}</td><td class="batman-name"><button :aria-label="`查看 ${holding.instrument.name} K线`" class="batman-name-button" type="button" @click="viewKline(holding.instrument)"><strong data-overflow-content>{{ holding.instrument.name }}</strong><span data-overflow-content>{{ instrumentCodeLabel(holding.instrument) }}</span></button></td><td>{{ holding.quantity }}</td><td>{{ money(holding.costCashFlow) }}</td><td :class="tone(holding.profit)">{{ signed(holding.profit) }}</td></tr><tr v-if="closedRecords.length === 0"><td class="batman-empty-cell" colspan="5">-</td></tr></tbody></table></div>
    <InstrumentPickerDialog :open="isInstrumentPickerOpen" title="新增持股记录" @close="closeInstrumentPicker" @confirm="selectHoldingInstrument" />
    <QuickAlertDialog :current-price="alertHolding?.currentPrice" initial-direction="below" :initial-price="alertHolding === null ? null : holdingAlertPrice(alertHolding)" :instrument="alertHolding?.instrument ?? null" kind="price_threshold" :open="alertHolding !== null" scope-type="holdings" severity="risk" title="设置持仓提醒" @close="closeQuickAlert" />
    <div v-if="dialog" class="batman-dialog-backdrop" @click.self="closeDialog">
      <section class="batman-dialog" aria-modal="true" role="dialog">
        <header>
          <strong>{{ dialog === 'create' ? '增加持股' : dialog === 'capital' ? '资金调整' : '确认删除' }}</strong>
          <button aria-label="关闭对话框" class="batman-icon-button" title="关闭" type="button" @click="closeDialog"><X :size="17" /></button>
        </header>
        <form v-if="dialog === 'create'" class="batman-form" @submit.prevent="createHolding">
          <p v-if="selectedInstrument" class="batman-selected">{{ selectedInstrument.name }} / {{ selectedInstrument.code }}</p>
          <label>数量<input v-model="quantity" min="0.0001" required step="any" type="number" /></label>
          <label>价格<input v-model="price" min="0" required step="0.001" type="number" /></label>
          <label>费用<input v-model="fee" min="0" required step="0.001" type="number" /></label>
          <label>操作时间<input v-model="occurredAt" required type="datetime-local" /></label>
          <label>备注<input v-model.trim="note" maxlength="500" /></label>
          <p v-if="errorMessage" class="batman-error">{{ errorMessage }}</p>
          <footer><button class="batman-button" type="button" @click="closeDialog">取消</button><button class="batman-button primary" :disabled="selectedInstrument === null || isSaving" type="submit">确定</button></footer>
        </form>
        <form v-else-if="dialog === 'capital'" class="batman-form" @submit.prevent="adjustCapital">
          <label>资金调整<input v-model="capitalAmount" placeholder="增加为正，提取为负" required step="0.01" type="number" /></label>
          <label>备注<input v-model.trim="capitalNote" maxlength="500" /></label>
          <p v-if="errorMessage" class="batman-error">{{ errorMessage }}</p>
          <footer><button class="batman-button" type="button" @click="closeDialog">取消</button><button class="batman-button primary" :disabled="isSaving" type="submit">确定</button></footer>
        </form>
        <div v-else class="batman-confirm">
          <p>删除“{{ selectedHolding?.instrument.name ?? '' }}”及其全部操作记录？</p>
          <p v-if="errorMessage" class="batman-error">{{ errorMessage }}</p>
          <footer><button class="batman-button" type="button" @click="closeDialog">取消</button><button class="batman-button danger" :disabled="isSaving" type="button" @click="deleteCurrent">删除</button></footer>
        </div>
      </section>
    </div>
    <InstrumentKLineDialog :instrument="selectedKlineInstrument" @close="closeKlineDialog" />

    <div v-if="intradayDialogOpen" class="batman-dialog-backdrop" @click.self="closeIntradayDialog">
      <section class="batman-dialog wide" aria-modal="true" role="dialog">
        <header>
          <strong>
            {{ intradayHolding?.instrument.name }} {{ intradayHolding?.instrument.code }}
            <span v-if="intradayHolding?.averageCost !== null && intradayHolding?.averageCost !== undefined" class="intraday-average-price">
              | 均价 {{ intradayHolding.averageCost }}
            </span>
          </strong>
          <button aria-label="关闭分时数据对话框" class="batman-icon-button" :disabled="intradayLoading" title="关闭" type="button" @click="closeIntradayDialog"><X :size="17" /></button>
        </header>
        <div class="intraday-dialog-content">
          <p v-if="intradayLoading" class="batman-selected">正在加载分时数据...</p>
          <p v-else-if="intradayError" class="batman-error">{{ intradayError }}</p>
          <p v-else-if="!intradayData || intradayData.length === 0" class="batman-selected">暂无分时数据</p>
          <div v-else class="intraday-chart-frame">
            <div class="intraday-chart-header">
              <p class="intraday-chart-summary">{{ intradaySummary }}</p>
              <div class="intraday-chart-toggle" v-if="intradayHolding" role="group" aria-label="图表类型">
                <button
                  class="intraday-toggle-button"
                  :class="{ active: intradayChartType === 'kline' }"
                  @click="intradayChartType = 'kline'"
                  type="button"
                  title="K线"
                  :disabled="intradayLoading"
                >
                  K线
                </button>
                <button
                  class="intraday-toggle-button"
                  :class="{ active: intradayChartType === 'line' }"
                  @click="intradayChartType = 'line'"
                  type="button"
                  title="分时线"
                  :disabled="intradayLoading"
                >
                  分时线
                </button>
              </div>
            </div>
            <KLineChart
              :bars="intradayBars"
              height="min(58vh, 440px)"
              :ma-periods="[]"
              subchart="volume"
              :x-axis-labels="intradayLabels"
              intraday-mode
              :average-price="intradayHolding?.averageCost ?? null"
              :chart-type="intradayChartType"
              @update:chartType="intradayChartType = $event"
            />
          </div>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.batman-funds-heading { align-items: center; display: flex; justify-content: space-between; margin: 0 0 14px; }
.batman-funds-heading .batman-funds-label { margin: 0; }
.holding-profit-breakdown { color: #8fa1b4 !important; font-weight: 600; margin-left: 5px; }
.holding-record-row { cursor: pointer; }
.holding-record-row:focus-visible > td { background: #1c3146; outline: 1px solid #65d7ca; outline-offset: -1px; }
.batman-holdings :deep(.batman-table th) { font-size: 13px; }
.intraday-dialog-content { padding: 4px 0 0; }
.intraday-chart-frame { min-width: 0; }
.intraday-chart-header { align-items: center; display: flex; justify-content: space-between; margin: 0 0 6px; }
.intraday-chart-summary { color: #96abc2; font-size: 12px; margin: 0; }

.intraday-average-price {
  font-weight: 600;
  margin-left: 8px;
}

.intraday-chart-toggle {
  display: inline-flex;
}

.intraday-toggle-button {
  background: #162236;
  border: 1px solid #344963;
  color: #b9c8d9;
  cursor: pointer;
  font-size: 12px;
  min-width: 44px;
  padding: 4px 7px;
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
}

.intraday-toggle-button + .intraday-toggle-button {
  border-left-color: #2b3d54;
  margin-left: -1px;
}

.intraday-toggle-button:first-child {
  border-radius: 5px 0 0 5px;
}

.intraday-toggle-button:last-child {
  border-radius: 0 5px 5px 0;
}

.intraday-toggle-button:focus-visible {
  outline: 2px solid #57bdb4;
  outline-offset: 2px;
  position: relative;
  z-index: 1;
}

.intraday-toggle-button:hover:not(:disabled):not(.active) {
  background: #1e2d44;
}

.intraday-toggle-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.intraday-toggle-button.active {
  background: #2673bd;
  border-color: #4598eb;
  color: #fff;
  position: relative;
  z-index: 1;
}

.batman-icon-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
