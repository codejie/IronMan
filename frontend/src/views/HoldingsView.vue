<script setup lang="ts">
import { ChevronDown, ChevronRight, CirclePlus, RefreshCw, Trash2, X } from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import InstrumentKLineDialog from "@/components/InstrumentKLineDialog.vue";
import InstrumentPickerDialog from "@/components/InstrumentPickerDialog.vue";
import { api, ApiError, type BatmanHoldingWorkspace, type BatmanHoldingWorkspaceRecord, type HoldingAction, type HoldingOperation, type Instrument } from "@/api/client";
import { useSession } from "@/stores/session";
import { formatDateTime } from "@/utils/date-format";
import { instrumentCodeLabel } from "./instrument-kline-presentation";
import { holdingDetailRouteQuery } from "./holding-detail-presentation";
import { holdingProfitSummary, holdingQuoteDateLabel } from "./holdings-presentation";

type Dialog = "create" | "operation" | "capital" | "delete-holding" | "delete-operation";

const { token } = useSession();
const router = useRouter();
const workspace = ref<BatmanHoldingWorkspace | null>(null);
const expanded = ref<string[]>([]);
const operations = ref<Record<string, HoldingOperation[]>>({});
const showClosed = ref(false);
const useLocalData = ref(false);
const dialog = ref<Dialog | null>(null);
const isInstrumentPickerOpen = ref(false);
const selectedHolding = ref<BatmanHoldingWorkspaceRecord | null>(null);
const selectedOperation = ref<HoldingOperation | null>(null);
const selectedInstrument = ref<Instrument | null>(null);
const selectedKlineInstrument = ref<BatmanHoldingWorkspaceRecord["instrument"] | null>(null);
const quantity = ref("100");
const price = ref("");
const fee = ref("0");
const occurredAt = ref(nowInputValue());
const note = ref("");
const action = ref<HoldingAction>("buy");
const capitalAmount = ref("");
const capitalNote = ref("");
const errorMessage = ref("");
const isLoading = ref(false);
const isSaving = ref(false);

const activeRecords = computed(() => workspace.value?.active ?? []);
const closedRecords = computed(() => workspace.value?.closed ?? []);
const profitSummary = computed(() => workspace.value === null ? null : holdingProfitSummary(workspace.value.summary, closedRecords.value));
const dailyDifferenceTotal = computed(() => Number(activeRecords.value.reduce((sum, item) => sum + (item.dailyDifference ?? 0), 0).toFixed(6)));
const overflowTitleObservers = new WeakMap<HTMLElement, ResizeObserver>();

function updateOverflowTitles(element: HTMLElement): void {
  window.requestAnimationFrame(() => {
    for (const cell of element.querySelectorAll<HTMLTableCellElement>("td")) {
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

async function toggleDetails(holding: BatmanHoldingWorkspaceRecord): Promise<void> {
  if (expanded.value.includes(holding.id)) {
    expanded.value = expanded.value.filter((id) => id !== holding.id);
    return;
  }
  if (token.value === null) return;
  errorMessage.value = "";
  try {
    operations.value = { ...operations.value, [holding.id]: (await api.holdingDetail(token.value, holding.id)).transactions };
    expanded.value = [...expanded.value, holding.id];
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "持股记录加载失败";
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

function openOperation(holding: BatmanHoldingWorkspaceRecord): void {
  selectedHolding.value = holding;
  action.value = "buy";
  quantity.value = "100";
  price.value = "";
  fee.value = "0";
  occurredAt.value = nowInputValue();
  note.value = "";
  errorMessage.value = "";
  dialog.value = "operation";
}

function openCapital(): void {
  capitalAmount.value = "";
  capitalNote.value = "";
  errorMessage.value = "";
  dialog.value = "capital";
}

function openDeleteHolding(holding: BatmanHoldingWorkspaceRecord): void {
  selectedHolding.value = holding;
  errorMessage.value = "";
  dialog.value = "delete-holding";
}

function openDeleteOperation(holding: BatmanHoldingWorkspaceRecord, operation: HoldingOperation): void {
  selectedHolding.value = holding;
  selectedOperation.value = operation;
  errorMessage.value = "";
  dialog.value = "delete-operation";
}

function closeDialog(): void {
  dialog.value = null;
  isInstrumentPickerOpen.value = false;
  selectedHolding.value = null;
  selectedOperation.value = null;
  selectedInstrument.value = null;
  errorMessage.value = "";
}

function viewKline(instrument: BatmanHoldingWorkspaceRecord["instrument"]): void {
  selectedKlineInstrument.value = instrument;
}

function closeKlineDialog(): void {
  selectedKlineInstrument.value = null;
}

function viewHoldingDetail(holding: BatmanHoldingWorkspaceRecord, records: BatmanHoldingWorkspaceRecord[]): void {
  void router.push({ path: "/holding/detail", query: holdingDetailRouteQuery(holding.id, records.map((item) => item.id)) });
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

async function createOperation(): Promise<void> {
  if (token.value === null || selectedHolding.value === null || isSaving.value) return;
  isSaving.value = true;
  try {
    await api.addHoldingTransaction(token.value, { holdingId: selectedHolding.value.id, action: action.value, quantity: action.value === "interest" ? 0 : Number(quantity.value), price: Number(price.value), fee: Number(fee.value), occurredAt: toIso(occurredAt.value), note: note.value });
    const holding = selectedHolding.value;
    closeDialog();
    await load();
    await toggleDetailsAfterRefresh(holding.id);
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "增加操作失败";
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
    if (dialog.value === "delete-operation" && selectedOperation.value !== null) {
      await api.deleteHoldingTransaction(token.value, selectedHolding.value.id, selectedOperation.value.id);
    } else {
      await api.deleteHolding(token.value, selectedHolding.value.id);
    }
    closeDialog();
    await load();
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "删除记录失败";
  } finally {
    isSaving.value = false;
  }
}

async function toggleDetailsAfterRefresh(id: string): Promise<void> {
  if (token.value === null) return;
  const holding = activeRecords.value.find((item) => item.id === id);
  if (holding === undefined) return;
  operations.value = { ...operations.value, [id]: (await api.holdingDetail(token.value, id)).transactions };
  if (!expanded.value.includes(id)) expanded.value = [...expanded.value, id];
}

function money(value: number | null): string { return value === null ? "-" : value.toFixed(2); }
function percent(value: number | null): string { return value === null ? "-" : `${value.toFixed(2)}%`; }
function signed(value: number | null): string { return value === null ? "-" : `${value > 0 ? "+" : ""}${value.toFixed(2)}`; }
function tone(value: number | null): "up" | "down" | "" { return value === null || value === 0 ? "" : value > 0 ? "up" : "down"; }
function actionLabel(value: HoldingAction): string { return value === "buy" ? "买入" : value === "sell" ? "卖出" : "计息"; }
function nowInputValue(): string { const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset()); return now.toISOString().slice(0, 16); }
function toIso(value: string): string { return new Date(value).toISOString(); }

onMounted(load);
</script>

<template>
  <section class="batman-workspace batman-holdings">
    <div v-if="workspace" class="batman-funds">
      <div class="batman-funds-label">资金信息</div>
      <table class="batman-funds-table"><colgroup><col class="batman-funds-label-column" /><col /><col class="batman-funds-label-column" /><col /><col class="batman-funds-label-column" /><col /></colgroup><tbody>
        <tr><th>总资产</th><td colspan="5">{{ money(workspace.summary.totalAssets) }}</td></tr>
        <tr><th>可用</th><td>{{ money(workspace.summary.cashAvailable) }} / {{ percent(workspace.summary.totalAssets === 0 ? null : workspace.summary.cashAvailable / workspace.summary.totalAssets * 100) }}</td><th>成本</th><td>{{ money(workspace.summary.totalCost) }} / {{ percent(workspace.summary.totalAssets === 0 ? null : workspace.summary.totalCost / workspace.summary.totalAssets * 100) }}</td><th>本金</th><td class="batman-principal">{{ money(workspace.summary.principal) }}<button class="batman-text-button" type="button" @click="openCapital">调整</button></td></tr>
        <tr><th>市值</th><td>{{ money(workspace.summary.totalMarketValue) }}</td><th>盈亏</th><td :class="tone(profitSummary?.activeProfit ?? null)">{{ signed(profitSummary?.activeProfit ?? null) }}<span v-if="showClosed && closedRecords.length > 0 && profitSummary" class="holding-profit-breakdown">[ {{ signed(profitSummary.closedProfit) }} = {{ signed(profitSummary.totalProfit) }} ]</span></td><th>盈亏率</th><td :class="tone(profitSummary?.activeProfitRate ?? null)">{{ percent(profitSummary?.activeProfitRate ?? null) }}<span v-if="showClosed && closedRecords.length > 0 && profitSummary" class="holding-profit-breakdown">[ {{ percent(profitSummary.totalProfitRate) }} ]</span></td></tr>
      </tbody></table>
    </div>
    <div class="batman-section-divider"><span>持股记录</span></div>
    <div class="batman-toolbar"><div class="batman-toolbar-start"><button class="batman-button primary" type="button" @click="openCreate"><CirclePlus :size="15" />增加持股</button><button class="batman-button" :disabled="isLoading" type="button" @click="load(true)"><RefreshCw :class="{ spinning: isLoading }" :size="15" />刷新记录</button></div><label class="batman-checkbox"><input v-model="useLocalData" type="checkbox" />使用本地数据</label></div>
    <p v-if="errorMessage && dialog === null" class="batman-error">{{ errorMessage }}</p>
    <div class="batman-table-frame holdings-table-frame">
      <table class="batman-table holdings-table"><colgroup><col /><col /><col /><col /><col /><col /><col /><col /><col /><col /><col /><col /><col /></colgroup><thead><tr><th>#</th><th></th><th>名称/代码</th><th>持仓/占比</th><th>成本/占比</th><th>均价/价差</th><th>现价/日期</th><th title="涨跌额/涨跌幅%">涨跌额/涨跌幅%</th><th>市值/占比</th><th>盈亏/占比</th><th>盈亏率%</th><th title="昨差/昨差率%">昨差/昨差率%</th><th class="batman-action-header">操作</th></tr></thead>
        <tbody v-overflow-title>
          <template v-for="(holding, index) in activeRecords" :key="holding.id">
            <tr><td>{{ index + 1 }}</td><td><button class="batman-expander" :aria-label="`${expanded.includes(holding.id) ? '收起' : '展开'} ${holding.instrument.name}`" type="button" @click="toggleDetails(holding)"><ChevronDown v-if="expanded.includes(holding.id)" :size="16" /><ChevronRight v-else :size="16" /></button></td><td class="batman-name"><button :aria-label="`查看 ${holding.instrument.name} K线`" class="batman-name-button" type="button" @click="viewKline(holding.instrument)"><strong data-overflow-content>{{ holding.instrument.name }}</strong><span data-overflow-content>{{ instrumentCodeLabel(holding.instrument) }}</span></button></td><td>{{ holding.quantity }} / {{ percent(holding.quantityRatio) }}</td><td>{{ money(holding.costCashFlow) }} / {{ percent(holding.costRatio) }}</td><td>{{ money(holding.averageCost) }} / <b :class="tone(holding.averagePriceDifference)">{{ signed(holding.averagePriceDifference) }}</b></td><td>{{ money(holding.currentPrice) }} {{ holdingQuoteDateLabel(holding.quoteDate) }}</td><td :class="tone(holding.priceChange)">{{ signed(holding.priceChange) }} / {{ percent(holding.priceChangeRate) }}</td><td>{{ money(holding.marketValue) }} / {{ percent(holding.marketValueRatio) }}</td><td :class="tone(holding.profit)">{{ signed(holding.profit) }} / {{ percent(holding.profitRatio) }}</td><td :class="tone(holding.profitRate)">{{ percent(holding.profitRate) }}</td><td :class="tone(holding.dailyDifference)">{{ signed(holding.dailyDifference) }} / {{ percent(holding.dailyDifferenceRate) }}</td><td class="batman-actions"><div class="batman-action-controls"><button class="batman-text-button" type="button" @click="viewHoldingDetail(holding, activeRecords)">详情</button><button class="batman-text-button danger" type="button" @click="openDeleteHolding(holding)"><Trash2 :size="14" />删除</button></div></td></tr>
            <tr v-if="expanded.includes(holding.id)" class="batman-operations-row"><td colspan="13"><div class="batman-operations"><div class="batman-operation-heading"><strong>操作记录（{{ operations[holding.id]?.length ?? 0 }}）</strong><button class="batman-button primary" type="button" @click="openOperation(holding)">增加操作</button></div><div class="batman-table-frame"><table class="batman-table operation-table"><thead><tr><th>#</th><th>操作</th><th>数量</th><th>价格</th><th>费用</th><th>操作时间</th><th>备注</th><th class="batman-action-header">操作</th></tr></thead><tbody v-overflow-title><tr v-for="(operation, operationIndex) in operations[holding.id]" :key="operation.id"><td>{{ operationIndex + 1 }}</td><td :class="operation.action === 'buy' ? 'up' : operation.action === 'sell' ? 'down' : ''">{{ actionLabel(operation.action) }}</td><td>{{ operation.quantity }}</td><td>{{ money(operation.price) }}</td><td>{{ money(operation.fee) }}</td><td>{{ formatDateTime(operation.occurredAt) }}</td><td>{{ operation.note || '-' }}</td><td class="batman-actions"><div class="batman-action-controls"><button class="batman-text-button danger" type="button" @click="openDeleteOperation(holding, operation)">删除</button></div></td></tr><tr v-if="(operations[holding.id]?.length ?? 0) === 0"><td class="batman-empty-cell" colspan="8">-</td></tr></tbody></table></div></div></td></tr>
          </template>
          <tr v-if="activeRecords.length === 0"><td class="batman-empty-cell" colspan="13">-</td></tr>
        </tbody>
        <tfoot v-if="workspace"><tr><td colspan="8"></td><td>{{ money(workspace.summary.totalMarketValue) }}</td><td :class="tone(profitSummary?.activeProfit ?? null)">{{ signed(profitSummary?.activeProfit ?? null) }}</td><td></td><td :class="tone(dailyDifferenceTotal)">{{ signed(dailyDifferenceTotal) }}</td><td></td></tr></tfoot>
      </table>
    </div>
    <div class="batman-section-divider closed"><span>清仓记录</span><button class="batman-text-button" type="button" @click="showClosed = !showClosed">{{ showClosed ? '隐藏' : '显示' }}</button></div>
    <div v-if="showClosed" class="batman-table-frame"><table class="batman-table closed-holdings-table"><colgroup><col /><col /><col /><col /><col /><col /></colgroup><thead><tr><th>#</th><th>名称/代码</th><th>持仓</th><th>成本</th><th>盈亏</th><th class="batman-action-header">操作</th></tr></thead><tbody v-overflow-title><tr v-for="(holding, index) in closedRecords" :key="holding.id"><td>{{ index + 1 }}</td><td class="batman-name"><button :aria-label="`查看 ${holding.instrument.name} K线`" class="batman-name-button" type="button" @click="viewKline(holding.instrument)"><strong data-overflow-content>{{ holding.instrument.name }}</strong><span data-overflow-content>{{ instrumentCodeLabel(holding.instrument) }}</span></button></td><td>{{ holding.quantity }}</td><td>{{ money(holding.costCashFlow) }}</td><td :class="tone(holding.profit)">{{ signed(holding.profit) }}</td><td class="batman-actions"><div class="batman-action-controls"><button class="batman-text-button" type="button" @click="viewHoldingDetail(holding, closedRecords)">详情</button></div></td></tr><tr v-if="closedRecords.length === 0"><td class="batman-empty-cell" colspan="6">-</td></tr></tbody></table></div>
    <InstrumentPickerDialog :open="isInstrumentPickerOpen" title="新增持股记录" @close="closeInstrumentPicker" @confirm="selectHoldingInstrument" />
    <div v-if="dialog" class="batman-dialog-backdrop" @click.self="closeDialog"><section class="batman-dialog" aria-modal="true" role="dialog"><header><strong>{{ dialog === 'create' ? '增加持股' : dialog === 'operation' ? `增加操作 · ${selectedHolding?.instrument.name ?? ''}` : dialog === 'capital' ? '资金调整' : '确认删除' }}</strong><button aria-label="关闭对话框" class="batman-icon-button" title="关闭" type="button" @click="closeDialog"><X :size="17" /></button></header><form v-if="dialog === 'create'" class="batman-form" @submit.prevent="createHolding"><p v-if="selectedInstrument" class="batman-selected">{{ selectedInstrument.name }} / {{ selectedInstrument.code }}</p><label>数量<input v-model="quantity" min="0.0001" required step="any" type="number" /></label><label>价格<input v-model="price" min="0" required step="0.001" type="number" /></label><label>费用<input v-model="fee" min="0" required step="0.001" type="number" /></label><label>操作时间<input v-model="occurredAt" required type="datetime-local" /></label><label>备注<input v-model.trim="note" maxlength="500" /></label><p v-if="errorMessage" class="batman-error">{{ errorMessage }}</p><footer><button class="batman-button" type="button" @click="closeDialog">取消</button><button class="batman-button primary" :disabled="selectedInstrument === null || isSaving" type="submit" @click.prevent="createHolding">确定</button></footer></form><form v-else-if="dialog === 'operation'" class="batman-form" @submit.prevent="createOperation"><label>操作<select v-model="action"><option value="buy">买入</option><option value="sell">卖出</option><option value="interest">计息</option></select></label><label v-if="action !== 'interest'">数量<input v-model="quantity" min="0.0001" required step="any" type="number" /></label><label>{{ action === 'interest' ? '计息金额' : '价格' }}<input v-model="price" min="0" required step="0.001" type="number" /></label><label>费用<input v-model="fee" min="0" required step="0.001" type="number" /></label><label>操作时间<input v-model="occurredAt" required type="datetime-local" /></label><label>备注<input v-model.trim="note" maxlength="500" /></label><p v-if="errorMessage" class="batman-error">{{ errorMessage }}</p><footer><button class="batman-button" type="button" @click="closeDialog">取消</button><button class="batman-button primary" :disabled="isSaving" type="submit" @click.prevent="createOperation">确定</button></footer></form><form v-else-if="dialog === 'capital'" class="batman-form" @submit.prevent="adjustCapital"><label>资金调整<input v-model="capitalAmount" placeholder="增加为正，提取为负" required step="0.01" type="number" /></label><label>备注<input v-model.trim="capitalNote" maxlength="500" /></label><p v-if="errorMessage" class="batman-error">{{ errorMessage }}</p><footer><button class="batman-button" type="button" @click="closeDialog">取消</button><button class="batman-button primary" :disabled="isSaving" type="submit" @click.prevent="adjustCapital">确定</button></footer></form><div v-else class="batman-confirm"><p>{{ dialog === 'delete-holding' ? `删除“${selectedHolding?.instrument.name ?? ''}”及其全部操作记录？` : `删除${selectedOperation ? actionLabel(selectedOperation.action) : ''}操作记录？` }}</p><p v-if="errorMessage" class="batman-error">{{ errorMessage }}</p><footer><button class="batman-button" type="button" @click="closeDialog">取消</button><button class="batman-button danger" :disabled="isSaving" type="button" @click="deleteCurrent">删除</button></footer></div></section></div>
    <InstrumentKLineDialog :instrument="selectedKlineInstrument" @close="closeKlineDialog" />
  </section>
</template>

<style scoped>
.holding-profit-breakdown { color: #8fa1b4 !important; font-weight: 600; margin-left: 5px; }
.batman-holdings :deep(.batman-table th) { font-size: 13px; }
</style>
