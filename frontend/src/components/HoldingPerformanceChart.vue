<script setup lang="ts">
import { BarChart, CandlestickChart, LineChart, ScatterChart } from "echarts/charts";
import { AxisPointerComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { init, use, type ECharts } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { HoldingChartTrace, PriceBar } from "@/api/client";
import { formatDate } from "@/utils/date-format";
import {
  buildKlineAnnotationLabels,
  buildKlineAnnotationVisuals,
  layoutKlineAnnotationLabels,
  lineVisualStyle,
  movingAverage,
  type KlineAnnotation,
  type KlineAnnotationLabel,
  type KlineSubchart
} from "./kline-analysis";

const props = withDefaults(
  defineProps<{
    bars: PriceBar[];
    trace: HoldingChartTrace[];
    maPeriods?: number[];
    subchart?: KlineSubchart;
    macdLines?: Record<string, Array<number | null>> | null;
    annotations?: KlineAnnotation[];
  }>(),
  { maPeriods: () => [], subchart: "macd", macdLines: null, annotations: () => [] }
);

const maColors = ["#6581da", "#92c978", "#ffbd4b", "#c985d7", "#56c4c9", "#ed7777"];
/** 与下方 grid[1] 保持一致：K 线网格占图表 34% 起始、35% 高度。 */
const KLINE_GRID_TOP_RATIO = 0.34;
const KLINE_GRID_HEIGHT_RATIO = 0.35;
const element = ref<HTMLDivElement | null>(null);
const activeOperationKeys = ref<string[]>([]);
const operationPositions = ref<Record<string, { left: number; pointTop: number; labelTop: number; side: "left" | "right" }>>({});
let chart: ECharts | undefined;
let resizeObserver: ResizeObserver | undefined;

use([BarChart, CandlestickChart, LineChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent, AxisPointerComponent, CanvasRenderer]);

/** 操作标注的 HTML 标签数据：标签与三角标记分离，放在 K 线网格上下沿。 */
const operationLabels = computed<KlineAnnotationLabel[]>(() => {
  const labels = props.bars.map((bar) => formatDate(bar.date));
  return buildKlineAnnotationLabels(
    props.annotations,
    props.bars.map((bar, index) => ({ date: bar.date, label: labels[index]!, close: bar.close }))
  );
});

const activeOperations = computed<KlineAnnotationLabel[]>(() =>
  activeOperationKeys.value.flatMap((key) => {
    const label = operationLabels.value.find((item) => item.key === key);
    return label === undefined ? [] : [label];
  })
);

const activeOperationTitle = computed(() => {
  const first = activeOperations.value[0];
  return first === undefined ? "操作记录" : `操作记录 · ${first.axisLabel}`;
});

const activeOperationConnectors = computed(() =>
  activeOperationKeys.value.flatMap((key) => {
    const position = operationPositions.value[key];
    const label = operationLabels.value.find((item) => item.key === key);
    if (position === undefined || label === undefined) return [];
    const connectorOffset = position.side === "right" ? 10 : -10;
    return [{
      key,
      color: label.color,
      x1: position.left,
      y1: position.pointTop,
      x2: position.left + connectorOffset,
      y2: position.labelTop
    }];
  })
);

function operationLabelStyle(label: KlineAnnotationLabel): Record<string, string> {
  const position = operationPositions.value[label.key];
  if (position === undefined) return { display: "none" };
  return {
    left: `${position.left}px`,
    top: `${position.labelTop}px`,
    borderColor: label.color,
    color: label.color
  };
}

function operationLabelClass(label: KlineAnnotationLabel): Array<string | Record<string, boolean>> {
  const position = operationPositions.value[label.key];
  return [
    "holding-operation-anchor",
    `holding-operation-anchor--${position?.side ?? "right"}`,
    { "is-active": activeOperationKeys.value.includes(label.key) }
  ];
}

function activateOperation(key: string): void {
  const label = operationLabels.value.find((item) => item.key === key);
  if (label === undefined) {
    clearActiveOperations();
    return;
  }
  // 同一天的多条操作合并为一条标注；激活时统一高亮该日期的标签。
  activeOperationKeys.value = operationLabels.value
    .filter((item) => item.axisLabel === label.axisLabel)
    .map((item) => item.key);
}

function clearActiveOperations(): void {
  activeOperationKeys.value = [];
}

function operationKeyFromEvent(raw: unknown): string | null {
  const data = (raw as { data?: unknown } | null)?.data;
  if (typeof data !== "object" || data === null) return null;
  const key = (data as { operationKey?: unknown }).operationKey;
  return typeof key === "string" ? key : null;
}

function handleChartMouseOver(raw: unknown): void {
  const key = operationKeyFromEvent(raw);
  if (key === null) return;
  activateOperation(key);
}

function handleAxisPointer(raw: unknown): void {
  const axesInfo = (raw as { axesInfo?: Array<{ axisDim?: string; axisIndex?: number; value?: unknown }> } | null)?.axesInfo;
  const axisInfo = axesInfo?.find((item) => item.axisDim === "x" && item.axisIndex === 1);
  if (axisInfo === undefined) return;
  const labels = props.bars.map((bar) => formatDate(bar.date));
  const axisLabel = typeof axisInfo.value === "number"
    ? labels[axisInfo.value] ?? null
    : typeof axisInfo.value === "string" ? axisInfo.value : null;
  if (axisLabel === null) {
    clearActiveOperations();
    return;
  }
  activeOperationKeys.value = operationLabels.value
    .filter((label) => label.axisLabel === axisLabel)
    .map((label) => label.key);
}

/** 把每条操作标签排布到 K 线网格上下沿，并用虚线连回对应标记。 */
function updateOperationPositions(): void {
  const chartInstance = chart;
  if (chartInstance === undefined || element.value === null) return;
  const chartHeight = chartInstance.getHeight();
  const gridTop = chartHeight * KLINE_GRID_TOP_RATIO;
  const gridBottom = gridTop + chartHeight * KLINE_GRID_HEIGHT_RATIO;
  const points = operationLabels.value.flatMap((label) => {
    const [left, top] = chartInstance.convertToPixel(
      { xAxisIndex: 1, yAxisIndex: 4 },
      [label.axisLabel, label.price]
    ) as [number, number];
    if (!Number.isFinite(left) || !Number.isFinite(top)) return [];
    return [{ label, left, pointTop: Math.max(gridTop + 8, Math.min(gridBottom - 8, top)) }];
  });
  const placements = layoutKlineAnnotationLabels(
    points.map((point) => ({ key: point.label.key, left: point.left, pointTop: point.pointTop, title: point.label.title })),
    chartInstance.getWidth(),
    gridTop,
    gridBottom
  );
  operationPositions.value = points.reduce<Record<string, { left: number; pointTop: number; labelTop: number; side: "left" | "right" }>>((result, point) => {
    const placement = placements[point.label.key];
    if (placement === undefined) return result;
    result[point.label.key] = {
      left: point.left,
      pointTop: point.pointTop,
      labelTop: placement.labelTop,
      side: placement.side
    };
    return result;
  }, {});
}

function render(): void {
  if (element.value === null) return;
  chart ??= init(element.value);
  clearActiveOperations();

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

  const annotationSeries = (() => {
    const points = props.bars.map((bar, index) => ({
      date: bar.date,
      label: labels[index]!,
      close: bar.close
    }));
    const visuals = buildKlineAnnotationVisuals(props.annotations, points);
    if (visuals.length === 0) return [];
    const data = visuals.map(({ key, marker }) => ({
      name: marker.name,
      value: marker.coord,
      symbol: marker.symbol,
      symbolRotate: marker.symbolRotate,
      symbolSize: marker.symbolSize,
      symbolOffset: marker.symbolOffset,
      itemStyle: marker.itemStyle,
      operationKey: key
    }));
    return [{
      type: "scatter" as const,
      name: "操作",
      xAxisIndex: 1,
      yAxisIndex: 4,
      z: 30,
      tooltip: { show: false },
      data
    }];
  })();

  chart.setOption({
    animation: false,
    backgroundColor: "transparent",
    legend: {
      bottom: 0,
      itemHeight: 8,
      itemWidth: 12,
      textStyle: { color: "#aabbd0", fontSize: 11 },
      data: ["持有数量", "均价", "市值", "盈亏", "K线", ...maSeries.map((series) => series.name), ...secondarySeries.map((series) => series.name), ...annotationSeries.map((series) => series.name)]
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
      { left: 56, right: 24, top: `${KLINE_GRID_TOP_RATIO * 100}%`, height: `${KLINE_GRID_HEIGHT_RATIO * 100}%` },
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
      ...annotationSeries,
      ...secondarySeries
    ]
  }, { notMerge: true });
  updateOperationPositions();
}

onMounted(() => {
  if (element.value === null) return;
  resizeObserver = new ResizeObserver(() => {
    chart?.resize();
    updateOperationPositions();
  });
  resizeObserver.observe(element.value);
  render();
  chart?.on("mouseover", handleChartMouseOver);
  chart?.on("updateAxisPointer", handleAxisPointer);
  chart?.on("globalout", clearActiveOperations);
});

watch(() => [props.bars, props.trace, props.maPeriods, props.subchart, props.macdLines, props.annotations], render, { deep: true });
onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  chart?.off("mouseover", handleChartMouseOver);
  chart?.off("updateAxisPointer", handleAxisPointer);
  chart?.off("globalout", clearActiveOperations);
  chart?.dispose();
});
</script>

<template>
  <div class="holding-performance-chart-shell">
    <div ref="element" class="holding-performance-chart" />
    <aside v-if="activeOperations.length > 0" class="holding-operation-tip" role="status">
      <strong>{{ activeOperationTitle }}</strong>
      <div v-for="label in activeOperations" :key="label.key">
        <i :style="{ backgroundColor: label.color }" />
        <b>{{ label.title }}</b>
        <small>{{ label.reason }}</small>
      </div>
    </aside>
    <div v-if="operationLabels.length > 0" class="holding-operation-label-layer" aria-hidden="true">
      <svg v-if="activeOperationConnectors.length > 0" class="holding-operation-connector-layer" preserveAspectRatio="none">
        <line
          v-for="connector in activeOperationConnectors"
          :key="connector.key"
          :x1="connector.x1"
          :y1="connector.y1"
          :x2="connector.x2"
          :y2="connector.y2"
          :stroke="connector.color"
        />
      </svg>
      <span
        v-for="label in operationLabels"
        :key="label.key"
        :class="operationLabelClass(label)"
        :style="operationLabelStyle(label)"
      >
        <span
          class="holding-operation-label"
          @mouseenter="activateOperation(label.key)"
          @mouseleave="clearActiveOperations"
        >{{ label.title }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.holding-performance-chart-shell { position: relative; }
.holding-performance-chart { height: min(64vh, 630px); min-height: 490px; width: 100%; }
.holding-operation-label-layer { inset: 0; pointer-events: none; position: absolute; z-index: 4; }
.holding-operation-anchor { height: 0; position: absolute; width: 0; }
.holding-operation-label {
  background: rgb(20 34 54 / 78%);
  border: 1px solid;
  border-radius: 3px;
  box-shadow: 0 1px 5px rgb(0 0 0 / 18%);
  cursor: default;
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  max-width: 70px;
  opacity: 0.58;
  overflow: hidden;
  padding: 0 4px;
  pointer-events: auto;
  position: absolute;
  text-overflow: ellipsis;
  transform: translateY(-50%);
  transition: box-shadow 160ms ease, opacity 160ms ease, transform 160ms ease;
  white-space: nowrap;
}
.holding-operation-anchor--right .holding-operation-label { left: 14px; }
.holding-operation-anchor--left .holding-operation-label { right: 14px; }
.holding-operation-anchor.is-active .holding-operation-label {
  box-shadow: 0 0 0 1px currentcolor, 0 3px 12px rgb(0 0 0 / 32%);
  opacity: 1;
  transform: translateY(-50%) scale(1.08);
}
.holding-operation-connector-layer { height: 100%; inset: 0; overflow: visible; position: absolute; width: 100%; }
.holding-operation-connector-layer line { fill: none; stroke-dasharray: 3 3; stroke-width: 1.25; }
.holding-operation-tip {
  background: rgb(18 31 49 / 94%);
  border: 1px solid #36516e;
  border-radius: 4px;
  box-shadow: 0 4px 14px rgb(0 0 0 / 24%);
  color: #dceaf7;
  display: grid;
  gap: 4px;
  max-height: 18%;
  overflow: auto;
  padding: 6px 8px;
  pointer-events: none;
  position: absolute;
  right: 18px;
  top: 55%;
  width: min(288px, 38%);
  z-index: 5;
}
.holding-operation-tip > strong { color: #f0f7ff; font-size: 10px; }
.holding-operation-tip div { align-items: start; display: grid; gap: 2px 6px; grid-template-columns: 6px minmax(0, 1fr); }
.holding-operation-tip i { border-radius: 50%; height: 6px; margin-top: 4px; width: 6px; }
.holding-operation-tip b { color: #e5f0f8; font-size: 10px; }
.holding-operation-tip small { color: #9db3c8; font-size: 10px; grid-column: 2; line-height: 1.45; white-space: pre-line; }
</style>
