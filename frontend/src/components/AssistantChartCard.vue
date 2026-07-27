<script setup lang="ts">
import { BarChart3, Maximize2, Minimize2 } from "lucide-vue-next";
import { computed, ref } from "vue";
import type { AssistantChart, IndicatorResult, IndicatorType } from "@/api/client";
import AssistantTrendChartCard from "@/components/AssistantTrendChartCard.vue";
import KLineChart from "@/components/KLineChart.vue";
import type { KlineOverlay } from "@/components/kline-analysis";

const props = defineProps<{ chart: AssistantChart }>();

const activeIndicators = ref<IndicatorType[]>([...props.chart.indicators.map((item) => item.type)]);
const isExpanded = ref(false);
const indicatorTypes = computed(() => props.chart.indicators.map((item) => item.type));
const visibleIndicators = computed(() => props.chart.indicators.filter((item) => activeIndicators.value.includes(item.type)));
const overlays = computed(() => visibleIndicators.value.flatMap(indicatorOverlays));
const macdLines = computed(() => visibleIndicators.value.find((item) => item.type === "MACD")?.lines ?? null);
const hasSubIndicators = computed(() => overlays.value.some((item) => item.placement === "sub"));

function toggleIndicator(type: IndicatorType): void {
  activeIndicators.value = activeIndicators.value.includes(type)
    ? activeIndicators.value.filter((item) => item !== type)
    : [...activeIndicators.value, type];
}

function indicatorOverlays(result: IndicatorResult): KlineOverlay[] {
  const line = (id: string, name: string, values: Array<number | null>, placement: KlineOverlay["placement"], color: string): KlineOverlay => ({ id, name, values, placement, kind: "line", color });
  switch (result.type) {
    case "MA":
      return [line("assistant-ma", "MA20", result.lines.ma ?? [], "main", "#6581da")];
    case "BOLL":
      return [
        line("assistant-boll-upper", "BOLL 上轨", result.lines.upper ?? [], "main", "#92c978"),
        line("assistant-boll-middle", "BOLL 中轨", result.lines.middle ?? [], "main", "#ffbd4b"),
        line("assistant-boll-lower", "BOLL 下轨", result.lines.lower ?? [], "main", "#c985d7")
      ];
    case "MACD":
      return [
        { id: "assistant-macd-hist", name: "MACD", values: result.lines.hist ?? [], placement: "sub", kind: "bar", color: "#fa7575" },
        line("assistant-macd-dif", "DIF", result.lines.dif ?? [], "sub", "#ef6b6b"),
        line("assistant-macd-dea", "DEA", result.lines.dea ?? [], "sub", "#61bbe0")
      ];
    case "RSI":
      return [line("assistant-rsi", "RSI", result.lines.rsi ?? [], "sub", "#d99de8")];
  }
}

function typeLabel(type: IndicatorType): string {
  return type === "MA" ? "MA" : type === "MACD" ? "MACD" : type === "RSI" ? "RSI" : "BOLL";
}

function assetLabel(assetType: AssistantChart["instrument"]["assetType"]): string {
  return assetType === "stock" ? "股票" : assetType === "index" ? "指数" : "基金";
}
</script>

<template>
  <AssistantTrendChartCard v-if="chart.trend !== undefined" :chart="chart" />
  <section v-else class="assistant-chart-card">
    <header>
      <div class="assistant-chart-title">
        <BarChart3 :size="16" />
        <strong>{{ chart.instrument.name }} {{ chart.instrument.code }}</strong>
        <span>[{{ assetLabel(chart.instrument.assetType) }}]</span>
      </div>
      <button class="batman-icon-button" title="放大图表" type="button" @click="isExpanded = true"><Maximize2 :size="16" /></button>
    </header>
    <div class="assistant-chart-toolbar">
      <span>{{ chart.title }}</span>
      <div v-if="indicatorTypes.length > 0" class="assistant-indicator-toggles" aria-label="显示指标">
        <button
          v-for="type in indicatorTypes"
          :key="type"
          :aria-pressed="activeIndicators.includes(type)"
          :class="{ active: activeIndicators.includes(type) }"
          type="button"
          @click="toggleIndicator(type)"
        >{{ typeLabel(type) }}</button>
      </div>
    </div>
    <KLineChart
      :bars="chart.bars"
      :macd-lines="macdLines"
      :overlays="overlays"
      :subchart="hasSubIndicators ? 'macd' : 'volume'"
      height="360px"
    />
    <footer>本地行情源：{{ chart.source }} · {{ chart.bars.length }} 根日线</footer>
  </section>

  <div v-if="isExpanded" class="batman-dialog-backdrop" @click.self="isExpanded = false">
    <section class="batman-dialog wide assistant-chart-modal" aria-modal="true" role="dialog">
      <header>
        <strong>{{ chart.instrument.name }} {{ chart.instrument.code }} [{{ assetLabel(chart.instrument.assetType) }}]</strong>
        <button aria-label="关闭图表" class="batman-icon-button" title="关闭" type="button" @click="isExpanded = false"><Minimize2 :size="17" /></button>
      </header>
      <div class="assistant-chart-toolbar modal-toolbar">
        <span>{{ chart.title }}</span>
        <div v-if="indicatorTypes.length > 0" class="assistant-indicator-toggles" aria-label="显示指标">
          <button
            v-for="type in indicatorTypes"
            :key="type"
            :aria-pressed="activeIndicators.includes(type)"
            :class="{ active: activeIndicators.includes(type) }"
            type="button"
            @click="toggleIndicator(type)"
          >{{ typeLabel(type) }}</button>
        </div>
      </div>
      <KLineChart
        :bars="chart.bars"
        :macd-lines="macdLines"
        :overlays="overlays"
        :subchart="hasSubIndicators ? 'macd' : 'volume'"
        height="min(70vh, 660px)"
      />
    </section>
  </div>
</template>

<style scoped>
.assistant-chart-card { background: #101b2c; border: 1px solid #304861; border-radius: 7px; margin-top: 10px; overflow: hidden; }
.assistant-chart-card > header { align-items: center; border-bottom: 1px solid #263b53; display: flex; justify-content: space-between; min-height: 42px; padding: 0 10px 0 12px; }
.assistant-chart-title { align-items: center; color: #91dcd4; display: flex; gap: 7px; min-width: 0; }.assistant-chart-title strong { color: #eaf6ff; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.assistant-chart-title span { color: #9bb0c6; font-size: 11px; white-space: nowrap; }
.assistant-chart-toolbar { align-items: center; color: #9bb0c6; display: flex; font-size: 11px; gap: 10px; justify-content: space-between; min-height: 34px; padding: 5px 12px; }.assistant-chart-toolbar > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.assistant-indicator-toggles { display: inline-flex; flex: 0 0 auto; }.assistant-indicator-toggles button { background: #17263a; border: 1px solid #38516c; color: #a8bbce; font-size: 11px; line-height: 24px; min-width: 40px; padding: 0 7px; }.assistant-indicator-toggles button + button { border-left-color: #293f57; margin-left: -1px; }.assistant-indicator-toggles button:first-child { border-radius: 4px 0 0 4px; }.assistant-indicator-toggles button:last-child { border-radius: 0 4px 4px 0; }.assistant-indicator-toggles button.active { background: #276f76; border-color: #58c9be; color: #f0ffff; position: relative; z-index: 1; }
.assistant-chart-card > footer { border-top: 1px solid #263b53; color: #849ab1; font-size: 11px; padding: 7px 12px; }.assistant-chart-modal { max-width: 1220px; }.assistant-chart-modal > header { align-items: center; border-bottom: 1px solid #2c4059; color: #edf7ff; display: flex; font-size: 16px; justify-content: space-between; margin-bottom: 10px; padding-bottom: 12px; }.modal-toolbar { padding-left: 0; padding-right: 0; }
@media (max-width: 860px) { .assistant-chart-toolbar { align-items: flex-start; flex-direction: column; }.assistant-indicator-toggles { flex-wrap: wrap; } }
</style>
