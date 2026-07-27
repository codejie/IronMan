<script setup lang="ts">
import { BarChart3, Maximize2, Minimize2 } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import type { AssistantChart, AssistantTrendChart, TrendIndicatorRunResult } from "@/api/client";
import KLineChart from "@/components/KLineChart.vue";
import type { KlineAnnotation, KlineOverlay } from "@/components/kline-analysis";

const props = defineProps<{ chart: AssistantChart }>();

const colors = ["#6581da", "#92c978", "#ffbd4b", "#c985d7", "#56c4c9", "#ed7777", "#61bbe0", "#e881b2"];
const mainIndicators = new Set(["MA", "SAR", "BOLL", "VWAP", "AVGPRICE", "MEDPRICE"]);
const hiddenIndicators = new Set(["CDLHAMMER", "CDLENGULFING", "CDLMORNINGSTAR", "CDLDOJI", "CDLEVENINGSTAR", "CDL3WHITESOLDIERS", "CDL3BLACKCROWS", "CDLDARKCLOUDCOVER"]);
const activeIndicatorIds = ref<string[]>(props.chart.trend?.indicators.map((item) => item.indicatorId) ?? []);
const isExpanded = ref(false);

const trend = computed(() => props.chart.trend!);
const indicatorIds = computed(() => trend.value.indicators.map((item) => item.indicatorId));
const visibleIndicators = computed(() => trend.value.indicators.filter((item) => activeIndicatorIds.value.includes(item.indicatorId)));
const overlays = computed(() => visibleIndicators.value.flatMap((indicator, index) => indicatorOverlays(indicator, index)));
const hasSubIndicators = computed(() => overlays.value.some((item) => item.placement === "sub"));
const annotations = computed<KlineAnnotation[]>(() => trend.value.turningPoints
  .filter((point) => activeIndicatorIds.value.includes(point.indicatorId))
  .map((point) => ({
    indicatorId: point.indicatorId,
    date: point.date,
    price: point.price,
    direction: point.direction,
    level: point.level,
    title: point.title,
    reason: point.reason,
    color: point.direction === "bullish" ? "#fa7575" : "#68d991"
  })));

watch(
  () => props.chart.id,
  () => { activeIndicatorIds.value = props.chart.trend?.indicators.map((item) => item.indicatorId) ?? []; }
);

function toggleIndicator(indicatorId: string): void {
  activeIndicatorIds.value = activeIndicatorIds.value.includes(indicatorId)
    ? activeIndicatorIds.value.filter((item) => item !== indicatorId)
    : [...activeIndicatorIds.value, indicatorId];
}

function indicatorOverlays(result: TrendIndicatorRunResult, indicatorIndex: number): KlineOverlay[] {
  if (hiddenIndicators.has(result.indicatorId)) return [];
  const placement: KlineOverlay["placement"] = mainIndicators.has(result.indicatorId) ? "main" : "sub";
  return Object.entries(result.lines).map(([line, values], lineIndex) => ({
    id: `assistant-trend-${result.indicatorId}-${line}`,
    name: `${result.indicatorId} ${line.toUpperCase()}`,
    placement,
    kind: line === "hist" ? "bar" : "line",
    values,
    color: colors[(indicatorIndex * 3 + lineIndex) % colors.length]!
  }));
}

function assetLabel(assetType: AssistantChart["instrument"]["assetType"]): string {
  return assetType === "stock" ? "股票" : assetType === "index" ? "指数" : "基金";
}

function directionLabel(direction: AssistantTrendChart["assessment"]["direction"]): string {
  return direction === "bullish" ? "偏多" : direction === "bearish" ? "偏空" : "中性";
}

function riskLabel(level: AssistantTrendChart["assessment"]["risk"]["level"]): string {
  return level === "high" ? "高风险" : level === "medium" ? "中风险" : "低风险";
}
</script>

<template>
  <section class="assistant-trend-card">
    <header>
      <div class="assistant-trend-title">
        <BarChart3 :size="16" />
        <strong>{{ chart.instrument.name }} {{ chart.instrument.code }}</strong>
        <span>[{{ assetLabel(chart.instrument.assetType) }}]</span>
      </div>
      <button class="batman-icon-button" title="放大趋势图表" type="button" @click="isExpanded = true"><Maximize2 :size="16" /></button>
    </header>
    <div class="assistant-trend-toolbar">
      <span>{{ chart.title }} · {{ directionLabel(trend.assessment.direction) }} · {{ riskLabel(trend.assessment.risk.level) }}</span>
      <div class="assistant-trend-toggles" aria-label="显示趋势指标">
        <button
          v-for="indicatorId in indicatorIds"
          :key="indicatorId"
          :aria-pressed="activeIndicatorIds.includes(indicatorId)"
          :class="{ active: activeIndicatorIds.includes(indicatorId) }"
          type="button"
          @click="toggleIndicator(indicatorId)"
        >{{ indicatorId }}</button>
      </div>
    </div>
    <KLineChart
      :annotations="annotations"
      :bars="chart.bars"
      :overlays="overlays"
      :subchart="hasSubIndicators ? 'macd' : 'volume'"
      height="390px"
    />
    <footer>本地趋势引擎 · {{ chart.bars.length }} 根日线 · {{ annotations.length }} 个已识别拐点</footer>
  </section>

  <div v-if="isExpanded" class="batman-dialog-backdrop" @click.self="isExpanded = false">
    <section class="batman-dialog wide assistant-trend-modal" aria-modal="true" role="dialog">
      <header>
        <strong>{{ chart.instrument.name }} {{ chart.instrument.code }} [{{ assetLabel(chart.instrument.assetType) }}]</strong>
        <button aria-label="关闭趋势图表" class="batman-icon-button" title="关闭" type="button" @click="isExpanded = false"><Minimize2 :size="17" /></button>
      </header>
      <div class="assistant-trend-toolbar modal-toolbar">
        <span>{{ chart.title }} · {{ directionLabel(trend.assessment.direction) }} · {{ riskLabel(trend.assessment.risk.level) }}</span>
        <div class="assistant-trend-toggles" aria-label="显示趋势指标">
          <button
            v-for="indicatorId in indicatorIds"
            :key="indicatorId"
            :aria-pressed="activeIndicatorIds.includes(indicatorId)"
            :class="{ active: activeIndicatorIds.includes(indicatorId) }"
            type="button"
            @click="toggleIndicator(indicatorId)"
          >{{ indicatorId }}</button>
        </div>
      </div>
      <KLineChart
        :annotations="annotations"
        :bars="chart.bars"
        :overlays="overlays"
        :subchart="hasSubIndicators ? 'macd' : 'volume'"
        height="min(70vh, 680px)"
      />
    </section>
  </div>
</template>

<style scoped>
.assistant-trend-card { background: #101b2c; border: 1px solid #304861; border-radius: 7px; margin-top: 10px; overflow: hidden; }
.assistant-trend-card > header { align-items: center; border-bottom: 1px solid #263b53; display: flex; justify-content: space-between; min-height: 42px; padding: 0 10px 0 12px; }
.assistant-trend-title { align-items: center; color: #91dcd4; display: flex; gap: 7px; min-width: 0; }.assistant-trend-title strong { color: #eaf6ff; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.assistant-trend-title span { color: #9bb0c6; font-size: 11px; white-space: nowrap; }
.assistant-trend-toolbar { align-items: center; color: #9bb0c6; display: flex; font-size: 11px; gap: 10px; justify-content: space-between; min-height: 34px; padding: 5px 12px; }.assistant-trend-toolbar > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.assistant-trend-toggles { display: inline-flex; flex: 0 0 auto; overflow-x: auto; }.assistant-trend-toggles button { background: #17263a; border: 1px solid #38516c; color: #a8bbce; font-size: 11px; line-height: 24px; min-width: 40px; padding: 0 7px; }.assistant-trend-toggles button + button { border-left-color: #293f57; margin-left: -1px; }.assistant-trend-toggles button:first-child { border-radius: 4px 0 0 4px; }.assistant-trend-toggles button:last-child { border-radius: 0 4px 4px 0; }.assistant-trend-toggles button.active { background: #276f76; border-color: #58c9be; color: #f0ffff; position: relative; z-index: 1; }
.assistant-trend-card > footer { border-top: 1px solid #263b53; color: #849ab1; font-size: 11px; padding: 7px 12px; }.assistant-trend-modal { max-width: 1220px; }.assistant-trend-modal > header { align-items: center; border-bottom: 1px solid #2c4059; color: #edf7ff; display: flex; font-size: 16px; justify-content: space-between; margin-bottom: 10px; padding-bottom: 12px; }.modal-toolbar { padding-left: 0; padding-right: 0; }
@media (max-width: 860px) { .assistant-trend-toolbar { align-items: flex-start; flex-direction: column; }.assistant-trend-toggles { max-width: 100%; } }
</style>
