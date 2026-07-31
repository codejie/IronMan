<script setup lang="ts">
import { Bell, Plus, RefreshCw, Target, Trash2, Wifi, WifiOff, X } from "lucide-vue-next";
import { onBeforeUnmount, onMounted, ref } from "vue";
import InstrumentKLineDialog from "@/components/InstrumentKLineDialog.vue";
import InstrumentPickerDialog from "@/components/InstrumentPickerDialog.vue";
import QuickAlertDialog from "@/components/QuickAlertDialog.vue";
import { api, ApiError, type Instrument, type WatchlistWorkspace, type WatchlistWorkspaceEntry } from "@/api/client";
import { useSession } from "@/stores/session";
import { formatDateTime } from "@/utils/date-format";
import { DEFAULT_REALTIME_ENABLED, watchlistCodeLabel } from "./watchlist-presentation";

type Dialog = "create" | "target" | "delete";
type SelectedInstrument = Pick<Instrument, "id" | "code" | "exchange" | "name" | "assetType">;

const { token } = useSession();
const items = ref<WatchlistWorkspaceEntry[]>([]);
const dialog = ref<Dialog | null>(null);
const selectedEntry = ref<WatchlistWorkspaceEntry | null>(null);
const alertEntry = ref<WatchlistWorkspaceEntry | null>(null);
const selectedKlineInstrument = ref<SelectedInstrument | null>(null);
const useHistoricalData = ref(true);
const realtimeEnabled = ref(DEFAULT_REALTIME_ENABLED);
const updatedAt = ref<string | null>(null);
const targetPrice = ref("");
const errorMessage = ref("");
const isLoading = ref(false);
const isSaving = ref(false);
const overflowTitleObservers = new WeakMap<HTMLElement, ResizeObserver>();
let stream: EventSource | undefined;

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
    applyWorkspace(await api.watchlistWorkspace(token.value, refresh && useHistoricalData.value));
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "自选行情加载失败";
  } finally {
    isLoading.value = false;
  }
}

function applyWorkspace(workspace: WatchlistWorkspace, timestamp = new Date().toISOString()): void {
  items.value = workspace.items;
  updatedAt.value = timestamp;
}

function openCreate(): void {
  errorMessage.value = "";
  dialog.value = "create";
}

function openTarget(entry: WatchlistWorkspaceEntry): void {
  selectedEntry.value = entry;
  targetPrice.value = entry.targetPrice === null ? "" : String(entry.targetPrice);
  errorMessage.value = "";
  dialog.value = "target";
}

function openDelete(entry: WatchlistWorkspaceEntry): void {
  selectedEntry.value = entry;
  errorMessage.value = "";
  dialog.value = "delete";
}

function openQuickAlert(entry: WatchlistWorkspaceEntry): void {
  alertEntry.value = entry;
}

function closeQuickAlert(): void {
  alertEntry.value = null;
}

function alertDirection(entry: WatchlistWorkspaceEntry): "above" | "below" {
  if (entry.targetPrice !== null && entry.latestPrice !== null && entry.targetPrice < entry.latestPrice)
    return "below";
  return "above";
}

function closeDialog(): void {
  dialog.value = null;
  selectedEntry.value = null;
  errorMessage.value = "";
}

async function create(instrument: SelectedInstrument): Promise<void> {
  if (token.value === null || isSaving.value) return;
  isSaving.value = true;
  try {
    await api.createWatchlist(token.value, { instrumentId: instrument.id, note: "" });
    closeDialog();
    await load();
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "增加自选失败";
  } finally {
    isSaving.value = false;
  }
}

function viewKline(instrument: SelectedInstrument): void {
  selectedKlineInstrument.value = instrument;
}

function closeKlineDialog(): void {
  selectedKlineInstrument.value = null;
}

async function saveTarget(): Promise<void> {
  if (token.value === null || selectedEntry.value === null || isSaving.value) return;
  isSaving.value = true;
  try {
    await api.updateWatchlist(token.value, { id: selectedEntry.value.id, targetPrice: targetPrice.value === "" ? null : Number(targetPrice.value) });
    closeDialog();
    await load();
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "目标价更新失败";
  } finally {
    isSaving.value = false;
  }
}

async function remove(): Promise<void> {
  if (token.value === null || selectedEntry.value === null || isSaving.value) return;
  isSaving.value = true;
  try {
    await api.deleteWatchlist(token.value, selectedEntry.value.id);
    closeDialog();
    await load();
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "删除自选失败";
  } finally {
    isSaving.value = false;
  }
}

function disconnectRealtime(): void {
  stream?.close();
  stream = undefined;
  realtimeEnabled.value = false;
}

function toggleRealtime(): void {
  if (realtimeEnabled.value) {
    disconnectRealtime();
    return;
  }
  if (token.value === null) return;
  errorMessage.value = "";
  const next = api.streamWatchlist(token.value);
  stream = next;
  realtimeEnabled.value = true;
  next.addEventListener("snapshot", (event) => {
    if (stream !== next) return;
    const snapshot = JSON.parse((event as MessageEvent<string>).data) as WatchlistWorkspace & { updatedAt?: string };
    applyWorkspace(snapshot, snapshot.updatedAt ?? new Date().toISOString());
  });
  next.addEventListener("error", () => {
    if (stream !== next) return;
    disconnectRealtime();
    errorMessage.value = "实时行情连接已断开，可手动刷新或重新连接";
  });
}

function price(value: number | null, digits = 2): string {
  return value === null ? "-" : value.toFixed(digits);
}

function signed(value: number | null, suffix = "", digits = 2): string {
  return value === null ? "-" : `${value > 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`;
}

function tone(value: number | null): "up" | "down" | "" {
  return value === null || value === 0 ? "" : value > 0 ? "up" : "down";
}

function updateTime(value: string | null): string {
  return value === null ? "-" : formatDateTime(value);
}

onMounted(() => { void load(); });
onBeforeUnmount(disconnectRealtime);
</script>

<template>
  <section class="batman-workspace batman-watchlist">
    <div class="batman-toolbar watchlist-toolbar">
      <div class="batman-toolbar-start"><button class="batman-button primary" type="button" @click="openCreate"><Plus :size="15" />增加自选</button></div>
      <div class="batman-toolbar-end"><label class="batman-checkbox"><input v-model="useHistoricalData" type="checkbox" />使用历史数据接口</label><span class="watchlist-updated-at" title="最近一次行情更新">{{ updateTime(updatedAt) }}</span><button :class="['batman-button', { active: realtimeEnabled }]" type="button" @click="toggleRealtime"><Wifi v-if="realtimeEnabled" :size="15" /><WifiOff v-else :size="15" />实时 {{ realtimeEnabled ? 'On' : 'Off' }}</button><button class="batman-button" :disabled="isLoading" type="button" @click="load(true)"><RefreshCw :class="{ spinning: isLoading }" :size="15" />刷新</button></div>
    </div>
    <p v-if="errorMessage && dialog === null" class="batman-error">{{ errorMessage }}</p>
    <div class="batman-table-frame">
      <table class="batman-table watchlist-table"><colgroup><col /><col /><col /><col /><col /><col /><col /><col /><col /></colgroup><thead><tr><th>#</th><th>持有</th><th>名称/代码</th><th>最新价/目标价/差值</th><th>昨收/今开</th><th>最高价/最低价/差值</th><th>涨跌幅/振幅</th><th>量比/换手率</th><th class="batman-action-header">操作</th></tr></thead>
        <tbody v-overflow-title>
          <tr v-for="(item, index) in items" :key="item.id"><td>{{ index + 1 }}</td><td>{{ item.isHeld ? '是' : '否' }}</td><td class="batman-name"><button :aria-label="`查看 ${item.instrument.name} K线`" class="batman-name-button" type="button" @click="viewKline(item.instrument)"><strong data-overflow-content>{{ item.instrument.name }}</strong><span data-overflow-content>{{ watchlistCodeLabel(item.instrument) }}</span></button></td><td class="batman-stack"><strong>{{ price(item.latestPrice) }}</strong><span>{{ price(item.targetPrice) }}</span><b :class="tone(item.targetPriceDifference)">{{ signed(item.targetPriceDifference) }}</b></td><td class="batman-stack"><span>{{ price(item.previousClose) }}</span><span>{{ price(item.openPrice) }}</span></td><td class="batman-stack"><span>{{ price(item.highPrice) }}</span><span>{{ price(item.lowPrice) }}</span><b :class="tone(item.priceChange)">{{ signed(item.priceChange) }}</b></td><td class="batman-stack"><b :class="tone(item.priceChangeRate)">{{ signed(item.priceChangeRate, '%') }}</b><span>{{ price(item.amplitudeRate) }}%</span></td><td class="batman-stack"><span>{{ price(item.volumeRatio) }}</span><span>{{ item.turnoverRate === null ? '-' : `${price(item.turnoverRate)}%` }}</span></td><td class="batman-actions"><div class="batman-action-controls"><button :aria-label="`为 ${item.instrument.name} 设置提醒`" class="batman-icon-button" data-hint="设置提醒" data-hint-position="top" type="button" @click="openQuickAlert(item)"><Bell :size="15" /></button><button :aria-label="`设置 ${item.instrument.name} 目标价`" class="batman-icon-button" data-hint="设置目标价" data-hint-position="top" type="button" @click="openTarget(item)"><Target :size="14" /></button><button :aria-label="`删除 ${item.instrument.name} 自选`" class="batman-icon-button danger" data-hint="删除自选" data-hint-position="top" type="button" @click="openDelete(item)"><Trash2 :size="14" /></button></div></td></tr>
          <tr v-if="items.length === 0"><td class="batman-empty-cell" colspan="9">-</td></tr>
        </tbody>
      </table>
    </div>
    <InstrumentPickerDialog :busy="isSaving" :error-message="dialog === 'create' ? errorMessage : ''" :open="dialog === 'create'" title="新增自选" @close="closeDialog" @confirm="create" />
    <QuickAlertDialog :current-price="alertEntry?.latestPrice" :initial-direction="alertEntry === null ? 'above' : alertDirection(alertEntry)" :initial-price="alertEntry?.targetPrice" :instrument="alertEntry?.instrument ?? null" kind="target_price" :open="alertEntry !== null" scope-type="watchlist" title="设置目标价提醒" @close="closeQuickAlert" />
    <div v-if="dialog && dialog !== 'create'" class="batman-dialog-backdrop" @click.self="closeDialog"><section class="batman-dialog" aria-modal="true" role="dialog"><header><strong>{{ dialog === 'target' ? '设置目标价格' : '删除自选' }}</strong><button aria-label="关闭对话框" class="batman-icon-button" title="关闭" type="button" @click="closeDialog"><X :size="17" /></button></header><form v-if="dialog === 'target'" class="batman-form" @submit.prevent="saveTarget"><label>目标价格<input v-model="targetPrice" min="0.0001" placeholder="留空清除" step="0.001" type="number" /></label><p v-if="errorMessage" class="batman-error">{{ errorMessage }}</p><footer><button class="batman-button" type="button" @click="closeDialog">取消</button><button class="batman-button primary" :disabled="isSaving" type="submit" @click.prevent="saveTarget">确定</button></footer></form><div v-else class="batman-confirm"><p>确认删除“{{ selectedEntry?.instrument.name }}”自选记录？</p><p v-if="errorMessage" class="batman-error">{{ errorMessage }}</p><footer><button class="batman-button" type="button" @click="closeDialog">取消</button><button class="batman-button danger" :disabled="isSaving" type="button" @click="remove">删除</button></footer></div></section></div>
    <InstrumentKLineDialog :instrument="selectedKlineInstrument" @close="closeKlineDialog" />
  </section>
</template>

<style scoped>
.batman-watchlist { max-width: none; }.watchlist-toolbar { align-items: center; }.watchlist-updated-at { color: #8ea3b8; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; min-width: 62px; text-align: right; }.batman-button.active { background: #1c504c; border-color: #5ac8bf; color: #e8fffb; }.watchlist-table { min-width: 0; width: 100%; }.watchlist-table th:nth-child(1), .watchlist-table td:nth-child(1) { text-align: center; width: 42px; }.watchlist-table th:nth-child(2), .watchlist-table td:nth-child(2) { text-align: center; width: 52px; }.watchlist-table th:nth-child(3), .watchlist-table td:nth-child(3) { width: 13%; }.watchlist-table th:nth-child(4), .watchlist-table td:nth-child(4) { width: 15%; }.watchlist-table th:nth-child(5), .watchlist-table td:nth-child(5) { width: 10%; }.watchlist-table th:nth-child(6), .watchlist-table td:nth-child(6) { width: 15%; }.watchlist-table th:nth-child(7), .watchlist-table td:nth-child(7) { width: 11%; }.watchlist-table th:nth-child(8), .watchlist-table td:nth-child(8) { width: 11%; }.watchlist-table th:nth-child(9), .watchlist-table td:nth-child(9) { width: 112px; }.watchlist-table th, .watchlist-table td { padding-bottom: 6px; padding-top: 6px; }.watchlist-table td { overflow: hidden; text-overflow: ellipsis; }.watchlist-table td.batman-actions { overflow: visible; }.watchlist-table .batman-icon-button[data-hint] { z-index: 1; }.watchlist-table .batman-icon-button[data-hint][data-hint-position="top"]::after { bottom: calc(100% + 6px); top: auto; transform: translate(-50%, 2px); }.watchlist-table .batman-icon-button[data-hint][data-hint-position="top"]:hover::after, .watchlist-table .batman-icon-button[data-hint][data-hint-position="top"]:focus-visible::after { transform: translate(-50%, 0); }.watchlist-table .batman-name strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.watchlist-table .batman-name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.watchlist-table .batman-stack { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.watchlist-table .batman-stack > strong, .watchlist-table .batman-stack > span, .watchlist-table .batman-stack > b { display: inline; }.watchlist-table .batman-stack > * + *::before { color: #758aa2; content: ' · '; font-weight: 400; }.watchlist-table .batman-action-controls { min-height: 32px; }
</style>
