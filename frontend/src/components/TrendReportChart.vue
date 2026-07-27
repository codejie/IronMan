<script setup lang="ts">
import { computed, ref, watch } from "vue";
import KLineChart from "@/components/KLineChart.vue";
import type { TrendIndicatorDefinition, TrendRunReport, TrendStrategy } from "@/api/client";
import { buildTrendChartPresentation, buildTrendIndicatorParameterSummary, type TrendChartMode } from "@/views/trend-report-presentation";

const props = defineProps<{
  report: TrendRunReport;
  definitions: TrendIndicatorDefinition[];
  strategy: TrendStrategy | null;
}>();

const trendMaPeriods = [5, 10, 15, 20, 30, 60] as const;
const mode = ref<TrendChartMode>("combined");
const selectedIndicatorIds = ref<string[]>([]);
const selectedMaPeriods = ref<number[]>([5, 10, 20]);

const visibleDefinitions = computed(() => props.definitions.filter((definition) => props.report.result.indicators.some((result) => result.indicatorId === definition.id) && definition.chart !== "hidden"));
const combinedIndicatorSummary = computed(() => visibleDefinitions.value.map((definition) => definition.id).join(" · "));
const presentation = computed(() => buildTrendChartPresentation(props.report, props.definitions, mode.value, selectedIndicatorIds.value));
const hasSubIndicators = computed(() => presentation.value.subOverlays.length > 0);
const activeIndicatorSummary = computed(() => selectedIndicatorIds.value
  .map((indicatorId) => buildTrendIndicatorParameterSummary(props.definitions, props.strategy?.indicators ?? [], indicatorId))
  .filter((summary): summary is string => summary !== null)
  .join("  |  "));

function selectMode(nextMode: TrendChartMode): void {
  mode.value = nextMode;
  if (nextMode === "indicator" && selectedIndicatorIds.value.length === 0 && visibleDefinitions.value[0] !== undefined) {
    selectedIndicatorIds.value = [visibleDefinitions.value[0].id];
  }
}

function toggleIndicator(indicatorId: string): void {
  if (selectedIndicatorIds.value.includes(indicatorId)) {
    if (selectedIndicatorIds.value.length > 1) selectedIndicatorIds.value = selectedIndicatorIds.value.filter((item) => item !== indicatorId);
    return;
  }
  selectedIndicatorIds.value = [...selectedIndicatorIds.value, indicatorId];
}

function toggleMaPeriod(period: number): void {
  selectedMaPeriods.value = selectedMaPeriods.value.includes(period)
    ? selectedMaPeriods.value.filter((item) => item !== period)
    : [...selectedMaPeriods.value, period].sort((left, right) => left - right);
}

watch(
  () => props.report.id,
  () => {
    mode.value = "combined";
    selectedIndicatorIds.value = [];
  }
);
</script>

<template>
  <section class="trend-report-chart">
    <header class="trend-report-chart-header">
      <div class="trend-chart-instrument">
        <strong>{{ report.result.instrument.name }}</strong>
        <span>{{ report.result.instrument.code }} [{{ report.result.instrument.assetType === 'fund' ? '基金' : report.result.instrument.assetType === 'index' ? '指数' : '股票' }}]</span>
      </div>
      <div class="trend-chart-middle">
        <div v-if="mode === 'kline'" class="trend-ma-picker" aria-label="选择移动平均线" role="group">
          <button v-for="period in trendMaPeriods" :key="period" :class="{ active: selectedMaPeriods.includes(period) }" type="button" @click="toggleMaPeriod(period)">MA{{ period }}</button>
        </div>
        <div v-else-if="mode === 'indicator'" class="trend-indicator-controls">
          <span v-if="activeIndicatorSummary !== ''" class="trend-indicator-summary">{{ activeIndicatorSummary }}</span>
          <div class="trend-indicator-picker" aria-label="选择趋势指标" role="group">
            <button v-for="definition in visibleDefinitions" :key="definition.id" :class="{ active: selectedIndicatorIds.includes(definition.id) }" type="button" @click="toggleIndicator(definition.id)">{{ definition.id }}</button>
          </div>
        </div>
        <span v-else class="trend-combined-summary">{{ combinedIndicatorSummary }}</span>
      </div>
      <div class="trend-chart-mode-buttons" aria-label="图表显示方式" role="group">
        <button :class="{ active: mode === 'combined' }" type="button" @click="selectMode('combined')">组合</button>
        <button :class="{ active: mode === 'indicator' }" type="button" @click="selectMode('indicator')">指标</button>
        <button :class="{ active: mode === 'kline' }" type="button" @click="selectMode('kline')">K线</button>
      </div>
    </header>
    <KLineChart
      :annotations="presentation.annotations"
      :bars="report.result.bars"
      height="472px"
      :ma-periods="mode === 'kline' ? selectedMaPeriods : []"
      :overlays="[...presentation.mainOverlays, ...presentation.subOverlays]"
      :subchart="mode === 'kline' || !hasSubIndicators ? 'volume' : 'macd'"
      title=""
    />
    <footer class="trend-chart-legend">
      <span><i class="bullish" />多头拐点</span>
      <span><i class="bearish" />空头 / 风险拐点</span>
      <span v-if="presentation.annotations.length">共 {{ presentation.annotations.length }} 个已识别拐点</span>
    </footer>
  </section>
</template>

<style scoped>
.trend-report-chart { background: #101b2d; border: 1px solid #2b425f; border-radius: 7px; min-width: 0; padding: 11px; }
.trend-report-chart-header { align-items: center; display: grid; gap: 10px; grid-template-columns: fit-content(230px) minmax(0, 1fr) auto; margin-bottom: 8px; min-width: 0; }
.trend-chart-instrument { align-items: baseline; display: flex; gap: 5px; max-width: 230px; min-width: 0; overflow: hidden; white-space: nowrap; }.trend-chart-instrument strong { color: #e6f2fb; flex: 0 1 auto; font-size: 13px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }.trend-chart-instrument span { color: #8da4bc; flex: 0 0 auto; font-size: 11px; overflow: hidden; text-overflow: ellipsis; }
.trend-chart-middle { align-items: center; display: flex; justify-content: center; min-width: 0; overflow: hidden; }.trend-chart-mode-buttons, .trend-ma-picker, .trend-indicator-picker, .trend-indicator-controls { display: inline-flex; flex-wrap: nowrap; }
.trend-indicator-controls { align-items: center; gap: 8px; justify-content: flex-end; min-width: 0; overflow: hidden; width: 100%; }.trend-indicator-picker, .trend-ma-picker { flex: 0 1 auto; justify-content: flex-end; min-width: 0; overflow: hidden; }
.trend-indicator-summary { color: #a9c4d8; flex: 1 1 auto; font-size: 10px; min-width: 0; overflow: hidden; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
.trend-combined-summary { color: #9ab8cc; display: block; font-size: 11px; max-width: 100%; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.trend-chart-mode-buttons { flex: 0 0 auto; margin-left: auto; }
.trend-chart-mode-buttons button, .trend-ma-picker button, .trend-indicator-picker button { background: #162236; border: 1px solid #344963; color: #b9c8d9; cursor: pointer; font-size: 11px; min-height: 26px; padding: 0 8px; }
.trend-chart-mode-buttons button + button, .trend-ma-picker button + button, .trend-indicator-picker button + button { margin-left: -1px; }.trend-chart-mode-buttons button:first-child, .trend-ma-picker button:first-child, .trend-indicator-picker button:first-child { border-radius: 4px 0 0 4px; }.trend-chart-mode-buttons button:last-child, .trend-ma-picker button:last-child, .trend-indicator-picker button:last-child { border-radius: 0 4px 4px 0; }
.trend-chart-mode-buttons button.active, .trend-ma-picker button.active, .trend-indicator-picker button.active { background: #267b83; border-color: #58cfc6; color: #efffff; position: relative; z-index: 1; }
.trend-report-chart :deep(.kline-chart-shell) { min-width: 0; width: 100%; }.trend-report-chart :deep(.kline-chart) { width: 100%; }.trend-chart-legend { color: #94a9bd; display: flex; flex-wrap: wrap; font-size: 10px; gap: 11px; margin-top: 6px; }.trend-chart-legend i { border-radius: 50%; display: inline-block; height: 7px; margin-right: 4px; width: 7px; }.trend-chart-legend .bullish { background: #fa7575; }.trend-chart-legend .bearish { background: #68d991; }
@media (max-width: 700px) { .trend-report-chart-header { align-items: flex-start; display: flex; flex-direction: column; }.trend-chart-instrument { max-width: 100%; }.trend-chart-middle { justify-content: flex-start; width: 100%; }.trend-indicator-controls { justify-content: flex-start; }.trend-indicator-summary { max-width: 100%; text-align: left; }.trend-chart-mode-buttons { margin-left: 0; } }
</style>
