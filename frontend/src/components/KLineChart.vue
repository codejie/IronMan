<script setup lang="ts">
import { BarChart, CandlestickChart } from "echarts/charts";
import { GridComponent, TitleComponent, TooltipComponent, DataZoomComponent, AxisPointerComponent } from "echarts/components";
import { init, use, type ECharts } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { IndicatorResult, PriceBar } from "@/api/client";

const props = defineProps<{ bars: PriceBar[]; indicators: IndicatorResult[]; title: string }>();
const element = ref<HTMLDivElement | null>(null);
let chart: ECharts | undefined;
let resizeObserver: ResizeObserver | undefined;

use([BarChart, CandlestickChart, GridComponent, TitleComponent, TooltipComponent, DataZoomComponent, AxisPointerComponent, CanvasRenderer]);

function render(): void {
  if (element.value === null) return;
  chart ??= init(element.value);
  const ma = props.indicators.find((indicator) => indicator.type === "MA")?.lines.ma;
  const boll = props.indicators.find((indicator) => indicator.type === "BOLL")?.lines;
  const overlays = [
    ...(ma === undefined ? [] : [{ type: "line", name: "MA20", data: ma, showSymbol: false, smooth: true, lineStyle: { color: "#e69936", width: 1.4 } }]),
    ...(boll === undefined
      ? []
      : [
          { type: "line", name: "BOLL 上轨", data: boll.upper, showSymbol: false, lineStyle: { color: "#8e6aac", width: 1 } },
          { type: "line", name: "BOLL 中轨", data: boll.middle, showSymbol: false, lineStyle: { color: "#607d9c", width: 1 } },
          { type: "line", name: "BOLL 下轨", data: boll.lower, showSymbol: false, lineStyle: { color: "#8e6aac", width: 1 } }
        ])
  ];
  chart.setOption({
    animation: false,
    backgroundColor: "transparent",
    title: { text: props.title, left: 0, textStyle: { color: "#22333b", fontSize: 15, fontWeight: 650 } },
    tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    grid: [
      { left: 48, right: 18, top: 44, height: "55%" },
      { left: 48, right: 18, top: "76%", height: "16%" }
    ],
    xAxis: [
      { type: "category", data: props.bars.map((bar) => bar.date), boundaryGap: false, axisLine: { lineStyle: { color: "#a9b6ba" } } },
      { type: "category", gridIndex: 1, data: props.bars.map((bar) => bar.date), boundaryGap: false, axisLabel: { show: false }, axisLine: { lineStyle: { color: "#a9b6ba" } } }
    ],
    yAxis: [
      { scale: true, splitLine: { lineStyle: { color: "#edf1f1" } } },
      { scale: true, gridIndex: 1, splitLine: { show: false } }
    ],
    dataZoom: [{ type: "inside", xAxisIndex: [0, 1], start: 40, end: 100 }, { type: "slider", xAxisIndex: [0, 1], bottom: 4, height: 16 }],
    series: [
      { type: "candlestick", data: props.bars.map((bar) => [bar.open, bar.close, bar.low, bar.high]), itemStyle: { color: "#d64f4f", color0: "#1f9d68", borderColor: "#d64f4f", borderColor0: "#1f9d68" } },
      ...overlays,
      { type: "bar", xAxisIndex: 1, yAxisIndex: 1, data: props.bars.map((bar) => bar.volume), itemStyle: { color: "#94b9b4" } }
    ]
  });
}

onMounted(() => {
  if (element.value === null) return;
  resizeObserver = new ResizeObserver(() => chart?.resize());
  resizeObserver.observe(element.value);
  render();
});

watch(() => [props.bars, props.indicators, props.title], render, { deep: true });
onBeforeUnmount(() => { resizeObserver?.disconnect(); chart?.dispose(); });
</script>

<template><div ref="element" class="kline-chart" /></template>
