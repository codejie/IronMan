<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { X } from "lucide-vue-next";
import { api, ApiError, type PriceBar, type TrendIndicatorRunResult } from "@/api/client";
import KLineChart from "@/components/KLineChart.vue";
import { useSession } from "@/stores/session";
import {
  DEFAULT_KLINE_RANGE,
  DEFAULT_MA_PERIODS,
  DEFAULT_SUBCHART,
  KLINE_PREFERENCES_KEY,
  KLINE_RANGES,
  MA_PERIODS,
  parseKlinePreferences,
  type KlineAnnotation,
  type KlineOverlay,
  type KlineRange,
  type KlineSubchart
} from "./kline-analysis";
import {
  operationsToKlineAnnotations,
  type HoldingOperationWithHolding
} from "./kline-operations";
import { instrumentKlineTitle, type InstrumentKlineTarget } from "@/views/instrument-kline-presentation";

const props = defineProps<{
  instrument: InstrumentKlineTarget | null;
  barsOverride?: PriceBar[] | null;
  indicatorResults?: TrendIndicatorRunResult[] | null;
  overlays?: KlineOverlay[];
  annotations?: KlineAnnotation[];
}>();
const emit = defineEmits<{ close: [] }>();
const { token } = useSession();
const initialPreferences = parseKlinePreferences(localStorage.getItem(KLINE_PREFERENCES_KEY));

const range = ref<KlineRange>(initialPreferences.range);
const maPeriods = ref<number[]>(initialPreferences.maPeriods);
const subchart = ref<KlineSubchart>(initialPreferences.subchart);
const bars = ref<PriceBar[]>([]);
const macdLines = ref<Record<string, Array<number | null>> | null>(null);
const operations = ref<HoldingOperationWithHolding[]>([]);
const isLoading = ref(false);
const errorMessage = ref("");
let requestVersion = 0;
const hasBars = computed(() => bars.value.length > 0);

/** 操作记录映射为 K 线标注（与外部传入的 annotations 合并，按日期去重）。 */
const klineAnnotations = computed<KlineAnnotation[]>(() => {
  if (bars.value.length === 0 || operations.value.length === 0) return props.annotations ?? [];
  const fromDate = formatDate(bars.value[0]!.date);
  const toDate = formatDate(bars.value[bars.value.length - 1]!.date);
  const operationAnnotations = operationsToKlineAnnotations(operations.value, fromDate, toDate);
  // 合并外部 annotations（趋势拐点等）与操作记录标注
  const external = props.annotations ?? [];
  const operationDates = new Set(operationAnnotations.map((annotation) => annotation.date));
  const merged = [...operationAnnotations, ...external.filter((annotation) => !operationDates.has(annotation.date))];
  return merged;
});

async function loadOperations(instrumentId: string, accessToken: string): Promise<void> {
  try {
    const response = await api.addHoldingOperations(accessToken, instrumentId);
    operations.value = response.items;
  } catch {
    // 操作记录加载失败不影响 K 线展示，静默忽略
    operations.value = [];
  }
}

function formatDate(value: unknown): string {
  return String(value ?? "").slice(0, 10);
}

async function loadChart(): Promise<void> {
  const instrument = props.instrument;
  const accessToken = token.value;
  if (instrument === null || accessToken === null) return;
  const version = ++requestVersion;
  isLoading.value = true;
  errorMessage.value = "";

  try {
    // 并行加载操作记录（不阻塞 K 线加载）
    void loadOperations(instrument.id, accessToken);
    if (props.barsOverride !== undefined && props.barsOverride !== null) {
      bars.value = props.barsOverride;
      macdLines.value = props.indicatorResults?.find((result) => result.indicatorId === "MACD")?.lines ?? null;
      return;
    }
    if (subchart.value === "macd") {
      const response = await api.calculateIndicators(accessToken, instrument.id, ["MACD"], false, KLINE_RANGES[range.value].limit);
      if (version !== requestVersion) return;
      bars.value = response.bars;
      macdLines.value = response.results.find((result) => result.type === "MACD")?.lines ?? null;
    } else {
      const response = await api.history(accessToken, instrument.id, false, KLINE_RANGES[range.value].limit);
      if (version !== requestVersion) return;
      bars.value = response.bars;
      macdLines.value = null;
    }
  } catch (error) {
    if (version !== requestVersion) return;
    errorMessage.value = error instanceof ApiError ? error.message : "K线加载失败";
  } finally {
    if (version === requestVersion) isLoading.value = false;
  }
}

function selectRange(nextRange: KlineRange): void {
  if (range.value === nextRange) return;
  range.value = nextRange;
  void loadChart();
}

function savePreferences(): void {
  localStorage.setItem(KLINE_PREFERENCES_KEY, JSON.stringify({ range: range.value, maPeriods: maPeriods.value, subchart: subchart.value }));
}

function toggleMa(period: number): void {
  maPeriods.value = maPeriods.value.includes(period)
    ? maPeriods.value.filter((item) => item !== period)
    : [...maPeriods.value, period].sort((left, right) => left - right);
  savePreferences();
}

function selectSubchart(nextSubchart: KlineSubchart): void {
  if (subchart.value === nextSubchart) return;
  subchart.value = nextSubchart;
  savePreferences();
  void loadChart();
}

watch(
  () => [props.instrument?.id, props.barsOverride, props.indicatorResults],
  ([id]) => {
    requestVersion += 1;
    bars.value = [];
    macdLines.value = null;
    operations.value = [];
    errorMessage.value = "";
    if (id !== undefined) void loadChart();
  },
  { immediate: true }
);

watch(range, savePreferences);

onBeforeUnmount(() => { requestVersion += 1; });
</script>

<template>
  <div v-if="instrument" class="batman-dialog-backdrop" @click.self="emit('close')">
    <section class="batman-dialog wide instrument-kline-dialog" aria-modal="true" role="dialog">
      <header>
        <strong>{{ instrumentKlineTitle(instrument) }}</strong>
        <button aria-label="关闭 K 线对话框" class="batman-icon-button" title="关闭" type="button" @click="emit('close')"><X :size="17" /></button>
      </header>
      <div class="kline-analysis-controls">
        <div class="kline-control-group" aria-label="数据时间跨度" role="group">
          <button v-for="(option, key) in KLINE_RANGES" :key="key" :aria-pressed="range === key" :class="{ active: range === key }" type="button" @click="selectRange(key)">{{ option.label }}</button>
        </div>
        <div class="kline-control-group" aria-label="均线" role="group">
          <button v-for="period in MA_PERIODS" :key="period" :aria-pressed="maPeriods.includes(period)" :class="{ active: maPeriods.includes(period) }" type="button" @click="toggleMa(period)">MA{{ period }}</button>
        </div>
        <div class="kline-control-group kline-subchart-controls" aria-label="副图" role="group">
          <button :aria-pressed="subchart === 'macd'" :class="{ active: subchart === 'macd' }" type="button" @click="selectSubchart('macd')">MACD</button>
          <button :aria-pressed="subchart === 'volume'" :class="{ active: subchart === 'volume' }" type="button" @click="selectSubchart('volume')">成交量</button>
        </div>
      </div>
      <p v-if="isLoading && !hasBars" class="batman-selected">正在加载 K 线行情...</p>
      <p v-if="errorMessage" class="batman-error">{{ errorMessage }}</p>
      <p v-else-if="!isLoading && !hasBars" class="batman-selected">暂无可展示的 K 线行情</p>
      <KLineChart v-if="hasBars" :annotations="klineAnnotations" :bars="bars" height="min(62vh, 520px)" :macd-lines="macdLines" :ma-periods="maPeriods" :overlays="overlays" :subchart="subchart" title="" />
    </section>
  </div>
</template>

<style scoped>
.kline-analysis-controls { align-items: center; display: flex; flex-wrap: wrap; gap: 6px 10px; margin: 0 0 8px; }
.kline-control-group { display: inline-flex; }
.kline-control-group button { background: #162236; border: 1px solid #344963; color: #b9c8d9; cursor: pointer; font-size: 12px; min-width: 44px; padding: 4px 7px; }
.kline-control-group button + button { border-left-color: #2b3d54; margin-left: -1px; }
.kline-control-group button:first-child { border-radius: 5px 0 0 5px; }.kline-control-group button:last-child { border-radius: 0 5px 5px 0; }
.kline-control-group button:focus-visible { outline: 2px solid #57bdb4; outline-offset: 2px; position: relative; z-index: 1; }
.kline-control-group button.active { background: #2673bd; border-color: #4598eb; color: #fff; position: relative; z-index: 1; }
.kline-subchart-controls { margin-left: auto; }
@media (max-width: 760px) { .kline-subchart-controls { margin-left: 0; }.kline-control-group button { min-width: 42px; padding: 4px 6px; } }
</style>
