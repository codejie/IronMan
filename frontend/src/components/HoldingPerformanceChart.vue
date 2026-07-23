<script setup lang="ts">
import { BarChart, CandlestickChart, LineChart } from "echarts/charts";
import { AxisPointerComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { init, use, type ECharts } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { HoldingChartTrace, PriceBar } from "@/api/client";
import { formatDate } from "@/utils/date-format";
import { lineVisualStyle, movingAverage, type KlineSubchart } from "./kline-analysis";

const props = withDefaults(
  defineProps<{
    bars: PriceBar[];
    trace: HoldingChartTrace[];
    maPeriods?: number[];
    subchart?: KlineSubchart;
    macdLines?: Record<string, Array<number | null>> | null;
  }>(),
  { maPeriods: () => [], subchart: "macd", macdLines: null }
);

const maColors = ["#6581da", "#92c978", "#ffbd4b", "#c985d7", "#56c4c9", "#ed7777"];
const element = ref<HTMLDivElement | null>(null);
let chart: ECharts | undefined;
let resizeObserver: ResizeObserver | undefined;

use([BarChart, CandlestickChart, LineChart, GridComponent, LegendComponent, TooltipComponent, AxisPointerComponent, CanvasRenderer]);

function render(): void {
  if (element.value === null) return;
  chart ??= init(element.value);

  const dates = props.bars.map((bar) => bar.date);
  const labels = dates.map(formatDate);
  const traceByDate = new Map(props.trace.map((item) => [item.date, item]));
  const maSeries = props.maPeriods.map((period, index) => ({
    type: "line" as const,
    name: `MA${period}`,
    xAxisIndex: 1,
    yAxisIndex: 4,
    data: movingAverage(props.bars.map((bar) => bar.close), period),
    showSymbol: false,
    smooth: true,
    ...lineVisualStyle(maColors[index % maColors.length]!, 1.5)
  }));
  const secondarySeries = props.subchart === "macd"
    ? [
        { type: "bar" as const, name: "MACD", xAxisIndex: 2, yAxisIndex: 5, data: props.macdLines?.hist ?? [], itemStyle: { color: (params: { value: unknown }) => Number(params.value) >= 0 ? "#fa7575" : "#68d991" } },
        { type: "line" as const, name: "DIF", xAxisIndex: 2, yAxisIndex: 5, data: props.macdLines?.dif ?? [], showSymbol: false, ...lineVisualStyle("#ef6b6b", 1.2) },
        { type: "line" as const, name: "DEA", xAxisIndex: 2, yAxisIndex: 5, data: props.macdLines?.dea ?? [], showSymbol: false, ...lineVisualStyle("#61bbe0", 1.2) }
      ]
    : [
        {
          type: "bar" as const,
          name: "成交量",
          xAxisIndex: 2,
          yAxisIndex: 5,
          data: props.bars.map((bar) => bar.volume),
          itemStyle: { color: (params: { dataIndex: number }) => {
            const bar = props.bars[params.dataIndex];
            return bar !== undefined && bar.close >= bar.open ? "#fa7575" : "#68d991";
          } }
        }
      ];

  chart.setOption({
    animation: false,
    backgroundColor: "transparent",
    legend: {
      bottom: 0,
      itemHeight: 8,
      itemWidth: 12,
      textStyle: { color: "#aabbd0", fontSize: 11 },
      data: ["持有数量", "均价", "市值", "盈亏", "K线", ...maSeries.map((series) => series.name), ...secondarySeries.map((series) => series.name)]
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#172337",
      borderColor: "#30445d",
      textStyle: { color: "#e8f1ff" },
      axisPointer: { type: "cross" }
    },
    axisPointer: { link: [{ xAxisIndex: "all" }], lineStyle: { color: "#65d7ca" } },
    grid: [
      { left: 56, right: 122, top: 12, height: "22%" },
      { left: 56, right: 24, top: "34%", height: "35%" },
      { left: 56, right: 24, top: "72%", height: "12%" }
    ],
    xAxis: [
      { type: "category", gridIndex: 0, data: labels, boundaryGap: false, axisLabel: { show: false }, axisLine: { lineStyle: { color: "#52708e" } } },
      { type: "category", gridIndex: 1, data: labels, boundaryGap: false, axisLabel: { show: false }, axisLine: { lineStyle: { color: "#52708e" } } },
      { type: "category", gridIndex: 2, data: labels, boundaryGap: false, axisLabel: { color: "#91a4bd", hideOverlap: true }, axisLine: { lineStyle: { color: "#52708e" } } }
    ],
    yAxis: [
      { type: "value", gridIndex: 0, scale: true, name: "均价", axisLabel: { color: "#91a4bd" }, splitLine: { lineStyle: { color: "#24354f" } } },
      { type: "value", gridIndex: 0, position: "right", scale: true, name: "市值", axisLabel: { color: "#91a4bd" }, splitLine: { show: false } },
      { type: "value", gridIndex: 0, position: "right", offset: 42, scale: true, name: "盈亏", axisLabel: { color: "#91a4bd" }, splitLine: { show: false } },
      { type: "value", gridIndex: 0, position: "right", offset: 84, min: 0, scale: false, name: "数量", axisLabel: { color: "#91a4bd" }, splitLine: { show: false } },
      { type: "value", gridIndex: 1, scale: true, axisLabel: { color: "#91a4bd" }, splitLine: { lineStyle: { color: "#24354f" } } },
      { type: "value", gridIndex: 2, scale: true, axisLabel: { color: "#91a4bd" }, splitLine: { lineStyle: { color: "#24354f" } } }
    ],
    series: [
      { type: "bar", name: "持有数量", xAxisIndex: 0, yAxisIndex: 3, data: dates.map((date) => traceByDate.get(date)?.quantity ?? null), barMaxWidth: 10, itemStyle: { color: "#4d7bcf", opacity: 0.58 } },
      { type: "line", name: "均价", xAxisIndex: 0, yAxisIndex: 0, data: dates.map((date) => traceByDate.get(date)?.averageCost ?? null), showSymbol: false, ...lineVisualStyle("#ffbd4b", 1.7) },
      { type: "line", name: "市值", xAxisIndex: 0, yAxisIndex: 1, data: dates.map((date) => traceByDate.get(date)?.marketValue ?? null), showSymbol: false, ...lineVisualStyle("#65d7ca", 1.7) },
      { type: "line", name: "盈亏", xAxisIndex: 0, yAxisIndex: 2, data: dates.map((date) => traceByDate.get(date)?.profit ?? null), showSymbol: false, ...lineVisualStyle("#ec8389", 1.7) },
      { type: "candlestick", name: "K线", xAxisIndex: 1, yAxisIndex: 4, data: props.bars.map((bar) => [bar.open, bar.close, bar.low, bar.high]), itemStyle: { color: "#fa7575", color0: "#68d991", borderColor: "#fa7575", borderColor0: "#68d991" } },
      ...maSeries,
      ...secondarySeries
    ]
  }, { notMerge: true });
}

onMounted(() => {
  if (element.value === null) return;
  resizeObserver = new ResizeObserver(() => chart?.resize());
  resizeObserver.observe(element.value);
  render();
});

watch(() => [props.bars, props.trace, props.maPeriods, props.subchart, props.macdLines], render, { deep: true });
onBeforeUnmount(() => { resizeObserver?.disconnect(); chart?.dispose(); });
</script>

<template><div ref="element" class="holding-performance-chart" /></template>

<style scoped>
.holding-performance-chart { height: min(64vh, 630px); min-height: 490px; width: 100%; }
</style>
