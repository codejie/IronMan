<script setup lang="ts">
import { LineChart } from "echarts/charts";
import { AxisPointerComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { init, use, type ECharts } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { FundHistoryEvent, FundHistoryPoint } from "@/api/client";

const props = defineProps<{ points: FundHistoryPoint[]; events: FundHistoryEvent[] }>();
const element = ref<HTMLDivElement | null>(null);
let chart: ECharts | undefined;
let resizeObserver: ResizeObserver | undefined;

use([LineChart, GridComponent, LegendComponent, TooltipComponent, AxisPointerComponent, CanvasRenderer]);

function render(): void {
  if (element.value === null) return;
  chart ??= init(element.value);
  const dates = props.points.map((point) => point.tradeDate);
  const pointByDate = new Map(props.points.map((point) => [point.tradeDate, point]));
  const eventGroups = new Map<string, FundHistoryEvent[]>();
  for (const event of props.events) {
    eventGroups.set(event.tradeDate, [...(eventGroups.get(event.tradeDate) ?? []), event]);
  }
  const eventMarks = [...eventGroups].flatMap(([date, events]) => {
    const point = pointByDate.get(date);
    return point === undefined ? [] : [{
      name: events.map((event) => event.label).join("、"),
      coord: [date, point.totalAssets],
      value: events.length,
      symbol: "pin",
      symbolSize: 31,
      itemStyle: { color: events.some((event) => event.kind === "close") ? "#db8b63" : "#c2a85d" },
      label: { color: "#0b1320", fontSize: 10, formatter: events.length > 1 ? String(events.length) : "" },
    }];
  });

  chart.setOption({
    animation: false,
    backgroundColor: "transparent",
    color: ["#62d4ca", "#e0777d", "#70a7dc", "#d7b45d"],
    legend: { top: 0, right: 0, textStyle: { color: "#9db0c4", fontSize: 11 }, itemWidth: 14, itemHeight: 7 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: "#5b7189" } },
      backgroundColor: "#101b2b",
      borderColor: "#405872",
      textStyle: { color: "#dce8f3", fontSize: 12 },
      valueFormatter: (value: unknown) => formatMoney(Number(value)),
    },
    grid: { left: 16, right: 18, top: 39, bottom: 18, containLabel: true },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: dates,
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
      lineSeries("总资产", props.points.map((point) => point.totalAssets), 2.2, eventMarks),
      lineSeries("持仓市值", props.points.map((point) => point.marketValue), 1.5),
      lineSeries("可用资金", props.points.map((point) => point.cashAvailable), 1.35),
      lineSeries("本金", props.points.map((point) => point.principal), 1.35, undefined, "dashed"),
    ],
  }, true);
}

function lineSeries(name: string, data: number[], width: number, markPoint?: unknown[], type: "solid" | "dashed" = "solid") {
  return {
    name,
    type: "line" as const,
    data,
    showSymbol: false,
    connectNulls: false,
    lineStyle: { width, type },
    emphasis: { focus: "series" as const },
    ...(markPoint === undefined ? {} : {
      markPoint: {
        data: markPoint,
        tooltip: {
          formatter: (input: unknown) => {
            const parameter = input as { name?: string };
            return parameter.name ?? "资金事件";
          },
        },
      },
    }),
  };
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
watch(() => [props.points, props.events], render, { deep: true });
onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  chart?.dispose();
});
</script>

<template><div ref="element" class="funds-asset-trend-chart" role="img" aria-label="资产变化趋势图"></div></template>

<style scoped>
.funds-asset-trend-chart { height: 340px; min-width: 0; width: 100%; }
@media (max-width: 760px) { .funds-asset-trend-chart { height: 310px; } }
</style>
