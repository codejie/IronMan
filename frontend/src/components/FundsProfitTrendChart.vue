<script setup lang="ts">
import { BarChart, LineChart } from "echarts/charts";
import { AxisPointerComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { init, use, type ECharts } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { FundHistoryPoint } from "@/api/client";

const props = defineProps<{ points: FundHistoryPoint[] }>();
const element = ref<HTMLDivElement | null>(null);
let chart: ECharts | undefined;
let resizeObserver: ResizeObserver | undefined;

use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, AxisPointerComponent, CanvasRenderer]);

function render(): void {
  if (element.value === null) return;
  chart ??= init(element.value);
  chart.setOption({
    animation: false,
    backgroundColor: "transparent",
    legend: { top: 0, right: 0, textStyle: { color: "#9db0c4", fontSize: 11 }, itemWidth: 14, itemHeight: 7 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: "rgba(82, 109, 137, .12)" } },
      backgroundColor: "#101b2b",
      borderColor: "#405872",
      textStyle: { color: "#dce8f3", fontSize: 12 },
      valueFormatter: (value: unknown) => formatMoney(Number(value)),
    },
    grid: { left: 16, right: 18, top: 39, bottom: 18, containLabel: true },
    xAxis: {
      type: "category",
      data: props.points.map((point) => point.tradeDate),
      axisLine: { lineStyle: { color: "#33485f" } },
      axisTick: { show: false },
      axisLabel: { color: "#7f94aa", fontSize: 10, formatter: (value: string) => value.slice(5) },
    },
    yAxis: {
      type: "value",
      scale: true,
      splitLine: { lineStyle: { color: "#22344a" } },
      axisLabel: { color: "#7f94aa", fontSize: 10, formatter: compactMoney },
    },
    series: [
      {
        name: "每日盈亏",
        type: "bar",
        data: props.points.map((point) => point.dailyProfit),
        barMaxWidth: 12,
        itemStyle: { color: (input: { value: number | null }) => Number(input.value) >= 0 ? "#e7767e" : "#62cb8c" },
      },
      {
        name: "累计盈亏",
        type: "line",
        data: props.points.map((point) => point.cumulativeProfit),
        showSymbol: false,
        lineStyle: { color: "#d9b65e", width: 2 },
        itemStyle: { color: "#d9b65e" },
        emphasis: { focus: "series" },
      },
    ],
  }, true);
}

function compactMoney(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`;
  if (absolute >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return value.toFixed(0);
}

function formatMoney(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-";
}

onMounted(() => {
  render();
  if (element.value !== null) {
    resizeObserver = new ResizeObserver(() => chart?.resize());
    resizeObserver.observe(element.value);
  }
});
watch(() => props.points, render, { deep: true });
onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  chart?.dispose();
});
</script>

<template><div ref="element" class="funds-profit-trend-chart" role="img" aria-label="盈亏变化趋势图"></div></template>

<style scoped>
.funds-profit-trend-chart { height: 300px; min-width: 0; width: 100%; }
@media (max-width: 760px) { .funds-profit-trend-chart { height: 280px; } }
</style>
