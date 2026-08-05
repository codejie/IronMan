<script setup lang="ts">
import { BarChart, CandlestickChart, LineChart, ScatterChart } from "echarts/charts";
import { AxisPointerComponent, GridComponent, LegendComponent, TitleComponent, TooltipComponent } from "echarts/components";
import { init, use, type ECharts } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { PriceBar } from "@/api/client";
import { formatDate } from "@/utils/date-format";
import {
  buildKlineAnnotationLabels,
  buildKlineAnnotationVisuals,
  fixedKlineTooltipPosition,
  layoutKlineAnnotationLabels,
  lineVisualStyle,
  movingAverage,
  type KlineAnnotation,
  type KlineAnnotationLabel,
  type KlineOverlay,
  type KlineSubchart
} from "./kline-analysis";

const props = withDefaults(
  defineProps<{
    bars: PriceBar[];
    maPeriods?: number[];
    subchart?: KlineSubchart;
    macdLines?: Record<string, Array<number | null>> | null;
    overlays?: KlineOverlay[];
    annotations?: KlineAnnotation[];
    title?: string;
    height?: string;
    xAxisLabels?: string[];
    intradayMode?: boolean;
    averagePrice?: number | null;
    chartType?: "kline" | "line";
  }>(),
  { maPeriods: () => [], subchart: "volume", macdLines: null, overlays: () => [], annotations: () => [], title: "", height: "520px", intradayMode: false, averagePrice: null, chartType: "line" }
);

defineEmits<{
  (e: "update:chartType", value: "kline" | "line"): void;
}>();

const maColors = ["#6581da", "#92c978", "#ffbd4b", "#c985d7", "#56c4c9", "#ed7777"];
const element = ref<HTMLDivElement | null>(null);
const activeAnnotationKeys = ref<string[]>([]);
const annotationPositions = ref<Record<string, { left: number; pointTop: number; labelTop: number; side: "left" | "right" }>>({});
let chart: ECharts | undefined;
let resizeObserver: ResizeObserver | undefined;

use([BarChart, CandlestickChart, LineChart, ScatterChart, GridComponent, LegendComponent, TitleComponent, TooltipComponent, AxisPointerComponent, CanvasRenderer]);

const annotationLabels = computed(() => {
  const labels = chartLabels();
  return buildKlineAnnotationLabels(
    props.annotations,
    props.bars.map((bar, index) => ({ date: bar.date, label: labels[index]!, close: bar.close }))
  );
});

function chartLabels(): string[] {
  return props.xAxisLabels?.length === props.bars.length
    ? props.xAxisLabels
    : props.bars.map((bar) => formatDate(bar.date));
}

const activeAnnotationConnectors = computed(() => {
  return activeAnnotationKeys.value.flatMap((key) => {
    const position = annotationPositions.value[key];
    const annotation = annotationLabels.value.find((item) => item.key === key);
    if (position === undefined || annotation === undefined) return [];
    const connectorOffset = position.side === "right" ? 10 : -10;
    return [{
      key,
      color: annotation.color,
      x1: position.left,
      y1: position.pointTop,
      x2: position.left + connectorOffset,
      y2: position.labelTop
    }];
  });
});

const activeTurningPointTooltips = computed(() => {
  return activeAnnotationKeys.value.flatMap((key) => {
    const annotation = annotationLabels.value.find((item) => item.key === key);
    return annotation === undefined ? [] : [annotation];
  });
});

function annotationLabelStyle(annotation: KlineAnnotationLabel): Record<string, string> {
  const position = annotationPositions.value[annotation.key];
  if (position === undefined) return { display: "none" };
  return {
    left: `${position.left}px`,
    top: `${position.labelTop}px`,
    borderColor: annotation.color,
    color: annotation.color
  };
}

function annotationLabelClass(annotation: KlineAnnotationLabel): Array<string | Record<string, boolean>> {
  const position = annotationPositions.value[annotation.key];
  return [
    "kline-annotation-anchor",
    `kline-annotation-anchor--${position?.side ?? "right"}`,
    { "is-active": activeAnnotationKeys.value.includes(annotation.key) }
  ];
}

function annotationDirectionLabel(annotation: KlineAnnotationLabel): string {
  if (annotation.direction === "bullish") return "多头拐点";
  return annotation.level === "risk" || annotation.level === "warning" ? "风险拐点" : "空头拐点";
}

function updateAnnotationPositions(): void {
  const chartInstance = chart;
  if (chartInstance === undefined || element.value === null) return;
  const chartHeight = chartInstance.getHeight();
  const gridTop = props.title === "" ? 18 : 44;
  const gridBottom = gridTop + chartHeight * 0.52;
  const annotationPoints = annotationLabels.value.flatMap((annotation) => {
    const [left, top] = chartInstance.convertToPixel(
      { xAxisIndex: 0, yAxisIndex: 0 },
      [annotation.axisLabel, annotation.price]
    ) as [number, number];
    if (!Number.isFinite(left) || !Number.isFinite(top)) return [];
    return [{ annotation, left, pointTop: Math.max(gridTop + 8, Math.min(gridBottom - 8, top)) }];
  });
  const placements = layoutKlineAnnotationLabels(
    annotationPoints.map((point) => ({ key: point.annotation.key, left: point.left, pointTop: point.pointTop, title: point.annotation.title })),
    chartInstance.getWidth(),
    gridTop,
    gridBottom
  );
  const positions = annotationPoints.reduce<Record<string, { left: number; pointTop: number; labelTop: number; side: "left" | "right" }>>((result, point) => {
    const placement = placements[point.annotation.key];
    if (placement === undefined) return result;
    result[point.annotation.key] = {
      left: point.left,
      pointTop: point.pointTop,
      labelTop: placement.labelTop,
      side: placement.side
    };
    return result;
  }, {});
  annotationPositions.value = positions;
}

function annotationKeyFromEvent(event: { seriesName?: string; data?: unknown }): string | null {
  if (event.seriesName !== "趋势拐点" || typeof event.data !== "object" || event.data === null) return null;
  const key = (event.data as { annotationKey?: unknown }).annotationKey;
  return typeof key === "string" ? key : null;
}

function setActiveAnnotationKeys(keys: string[]): void {
  activeAnnotationKeys.value = [...new Set(keys)];
}

function annotationKeysForAxisLabel(axisLabel: string): string[] {
  return annotationLabels.value.filter((annotation) => annotation.axisLabel === axisLabel).map((annotation) => annotation.key);
}

function handleChartMouseOver(event: { seriesName?: string; data?: unknown }): void {
  const key = annotationKeyFromEvent(event);
  const annotation = annotationLabels.value.find((item) => item.key === key);
  setActiveAnnotationKeys(annotation === undefined ? [] : annotationKeysForAxisLabel(annotation.axisLabel));
}

function handleAxisPointer(event: unknown): void {
  const axesInfo = (event as { axesInfo?: Array<{ axisDim?: string; axisIndex?: number; value?: unknown }> }).axesInfo;
  const axisInfo = axesInfo?.find((item) => item.axisDim === "x" && item.axisIndex === 0);
  if (axisInfo === undefined) return;
  const axisLabel = typeof axisInfo.value === "number"
    ? chartLabels()[axisInfo.value] ?? null
    : typeof axisInfo.value === "string" ? axisInfo.value : null;
  setActiveAnnotationKeys(axisLabel === null ? [] : annotationKeysForAxisLabel(axisLabel));
}

function clearActiveAnnotations(): void {
  setActiveAnnotationKeys([]);
}

function render(): void {
  if (element.value === null) return;
  chart ??= init(element.value);

  const labels = chartLabels();
  const isIntraday = props.intradayMode;
  const chartType = props.chartType;
  const closePrices = props.bars.map((bar) => bar.close);
  const volumes = props.bars.map((bar) => bar.volume);

  const maSeries = props.maPeriods.map((period, index) => ({
    type: "line" as const,
    name: `MA${period}`,
    data: movingAverage(closePrices, period),
    showSymbol: false,
    smooth: true,
    ...lineVisualStyle(maColors[index % maColors.length]!, 1.5)
  }));
  const overlaySeries = (overlay: KlineOverlay) => {
    const axis = overlay.placement === "main" ? 0 : 1;
    return overlay.kind === "bar"
      ? { type: "bar" as const, name: overlay.name, xAxisIndex: axis, yAxisIndex: axis, data: overlay.values, itemStyle: { color: overlay.color } }
      : { type: "line" as const, name: overlay.name, xAxisIndex: axis, yAxisIndex: axis, data: overlay.values, showSymbol: false, ...lineVisualStyle(overlay.color, 1.35) };
  };
  const mainOverlaySeries = props.overlays.filter((overlay) => overlay.placement === "main").map(overlaySeries);
  const subOverlaySeries = props.overlays.filter((overlay) => overlay.placement === "sub").map(overlaySeries);
  const secondarySeries = subOverlaySeries.length > 0
    ? subOverlaySeries
    : props.subchart === "macd"
      ? [
          {
            type: "bar" as const,
            name: "MACD",
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: props.macdLines?.hist ?? [],
            itemStyle: { color: (params: { value: unknown }) => Number(params.value) >= 0 ? "#fa7575" : "#68d991" }
          },
          { type: "line" as const, name: "DIF", xAxisIndex: 1, yAxisIndex: 1, data: props.macdLines?.dif ?? [], showSymbol: false, ...lineVisualStyle("#ef6b6b", 1.3) },
          { type: "line" as const, name: "DEA", xAxisIndex: 1, yAxisIndex: 1, data: props.macdLines?.dea ?? [], showSymbol: false, ...lineVisualStyle("#61bbe0", 1.3) }
        ]
      : [
          {
            type: "bar" as const,
            name: "成交量",
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: volumes,
            itemStyle: {
              color: (params: { dataIndex: number }) => {
                const bar = props.bars[params.dataIndex];
                return bar !== undefined && bar.close >= bar.open ? "#fa7575" : "#68d991";
              }
            }
          }
        ];
  const annotationVisuals = buildKlineAnnotationVisuals(
    props.annotations,
    props.bars.map((bar, index) => ({ date: bar.date, label: labels[index]!, close: bar.close }))
  );
  const turningPointSeries = annotationVisuals.length === 0 ? [] : [{
    type: "scatter" as const,
    name: "趋势拐点",
    xAxisIndex: 0,
    yAxisIndex: 0,
    z: 30,
    tooltip: { show: false },
    data: annotationVisuals.map(({ key, marker }) => ({
      name: marker.name,
      annotationKey: key,
      value: marker.coord,
      symbol: marker.symbol,
      symbolRotate: marker.symbolRotate,
      symbolSize: marker.symbolSize,
      symbolOffset: marker.symbolOffset,
      itemStyle: marker.itemStyle,
      label: marker.label
    }))
  }];

  // Build main chart series based on mode
  let mainSeries: any[] = [];
  let legendData: string[] = [];

  if (isIntraday) {
    if (chartType === "line") {
      // Line chart using close prices (straight line, not smooth)
      mainSeries = [
        {
          type: "line" as const,
          name: "收盘价",
          data: closePrices,
          showSymbol: true,
          symbol: "circle",
          symbolSize: 5,
          smooth: false,
          label: {
            show: true,
            position: "top",
            formatter: "{c}",
            fontSize: 10,
            color: "#aabbd0",
            backgroundColor: "rgba(20, 34, 54, 0.8)",
            borderRadius: 3,
            padding: [2, 4]
          },
          ...lineVisualStyle("#65d7ca", 1.8)
        }
      ];
      legendData = ["收盘价", ...maSeries.map((s) => s.name)];
    } else {
      // K-line chart
      mainSeries = [
        {
          type: "candlestick" as const,
          name: "K线",
          data: props.bars.map((bar) => [bar.open, bar.close, bar.low, bar.high]),
          itemStyle: { color: "#fa7575", color0: "#68d991", borderColor: "#fa7575", borderColor0: "#68d991" }
        }
      ];
      legendData = ["K线", ...maSeries.map((s) => s.name)];
    }
  } else {
    // Regular K-line chart
    mainSeries = [
      {
        type: "candlestick" as const,
        name: "K线",
        data: props.bars.map((bar) => [bar.open, bar.close, bar.low, bar.high]),
        itemStyle: { color: "#fa7575", color0: "#68d991", borderColor: "#fa7575", borderColor0: "#68d991" }
      }
    ];
    legendData = ["K线", ...maSeries.map((s) => s.name)];
  }

  // Add average price markLine if provided and in intraday mode
  const markLine = props.intradayMode && props.averagePrice !== null && props.averagePrice !== undefined
    ? {
        silent: true,
        symbol: "none",
        lineStyle: { color: "#ffbd4b", width: 1.5, type: "dashed" as const },
        data: [{ yAxis: props.averagePrice }],
        label: {
          show: true,
          position: "end" as const,
          formatter: `均价 {c}`,
          color: "#ffbd4b",
          fontSize: 10,
          backgroundColor: "rgba(20, 34, 54, 0.8)",
          borderRadius: 3,
          padding: [2, 6]
        }
      }
    : undefined;

  chart.setOption({
    animation: false,
    backgroundColor: "transparent",
    title: props.title === "" ? undefined : { text: props.title, left: 0, textStyle: { color: "#edf7ff", fontSize: 15, fontWeight: 650 } },
    legend: { bottom: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: "#aabbd0", fontSize: 11 }, data: [...legendData, ...mainOverlaySeries.map((series) => series.name), ...secondarySeries.map((series) => series.name)] },
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: "#172337",
      borderColor: "#30445d",
      textStyle: { color: "#e8f1ff" },
      axisPointer: { type: "cross" },
      position: (point: number[], _params: unknown, dom: unknown, _rect: unknown, size: { viewSize: number[]; contentSize: number[] }) => {
        if (dom instanceof HTMLElement) {
          dom.style.maxHeight = `${Math.max(0, (size.viewSize[1] ?? 0) - 24)}px`;
          dom.style.overflowY = "auto";
        }
        return fixedKlineTooltipPosition(point, size.viewSize, size.contentSize);
      }
    },
    axisPointer: { link: [{ xAxisIndex: "all" }], lineStyle: { color: "#65d7ca" } },
    grid: [
      { left: 48, right: 18, top: props.title === "" ? 18 : 44, height: "52%" },
      { left: 48, right: 18, top: "70%", height: "17%" }
    ],
    xAxis: [
      { type: "category", data: labels, boundaryGap: false, axisLine: { lineStyle: { color: "#52708e" } }, axisLabel: { color: "#91a4bd" } },
      { type: "category", gridIndex: 1, data: labels, boundaryGap: false, axisLabel: { show: false }, axisLine: { lineStyle: { color: "#52708e" } } }
    ],
    yAxis: [
      { scale: true, axisLabel: { color: "#91a4bd" }, splitLine: { lineStyle: { color: "#24354f" } } },
      { scale: true, gridIndex: 1, axisLabel: { color: "#91a4bd" }, splitLine: { lineStyle: { color: "#24354f" } } }
    ],
    series: [
      ...mainSeries,
      ...maSeries,
      ...mainOverlaySeries,
      ...secondarySeries,
      ...turningPointSeries
    ],
    ...(markLine ? { markLine } : {})
  }, { notMerge: true });
  updateAnnotationPositions();
}

onMounted(() => {
  if (element.value === null) return;
  resizeObserver = new ResizeObserver(() => {
    chart?.resize();
    updateAnnotationPositions();
  });
  resizeObserver.observe(element.value);
  render();
  chart?.on("mouseover", handleChartMouseOver);
  chart?.on("updateAxisPointer", handleAxisPointer);
  chart?.on("globalout", clearActiveAnnotations);
});

watch(() => [props.bars, props.maPeriods, props.subchart, props.macdLines, props.overlays, props.annotations, props.title, props.xAxisLabels, props.intradayMode, props.averagePrice, props.chartType], render, { deep: true });
onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  chart?.off("mouseover", handleChartMouseOver);
  chart?.off("updateAxisPointer", handleAxisPointer);
  chart?.off("globalout", clearActiveAnnotations);
  chart?.dispose();
});
</script>

<template>
  <div class="kline-chart-shell" :style="{ height: props.height }">
    <div ref="element" class="kline-chart" />
    <div v-if="annotationLabels.length > 0" class="kline-annotation-label-layer" aria-hidden="true">
      <svg v-if="activeAnnotationConnectors.length > 0" class="kline-annotation-connector-layer" preserveAspectRatio="none">
        <line
          v-for="connector in activeAnnotationConnectors"
          :key="connector.key"
          :x1="connector.x1"
          :y1="connector.y1"
          :x2="connector.x2"
          :y2="connector.y2"
          :stroke="connector.color"
        />
      </svg>
      <aside v-if="activeTurningPointTooltips.length > 0" class="kline-turning-point-tooltip">
        <strong>趋势拐点</strong>
        <div v-for="annotation in activeTurningPointTooltips" :key="annotation.key">
          <i :style="{ backgroundColor: annotation.color }" />
          <b>{{ annotation.title }}</b>
          <span>{{ annotationDirectionLabel(annotation) }}</span>
          <small>{{ annotation.reason }}</small>
        </div>
      </aside>
      <span
        v-for="annotation in annotationLabels"
        :key="annotation.key"
        :class="annotationLabelClass(annotation)"
        :style="annotationLabelStyle(annotation)"
      >
        <span class="kline-annotation-label">{{ annotation.title }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.kline-chart-shell {
  height: 100%;
  position: relative;
}

.kline-chart {
  height: 100%;
}

.kline-annotation-label-layer {
  inset: 0;
  pointer-events: none;
  position: absolute;
  z-index: 4;
}

.kline-annotation-anchor {
  height: 0;
  pointer-events: none;
  position: absolute;
  width: 0;
}

.kline-annotation-label {
  background: rgb(20 34 54 / 72%);
  border: 1px solid;
  border-radius: 3px;
  box-shadow: 0 1px 5px rgb(0 0 0 / 12%);
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  max-width: 70px;
  opacity: 0.48;
  overflow: hidden;
  padding: 0 4px;
  position: absolute;
  text-overflow: ellipsis;
  transform: translateY(-50%);
  transition: box-shadow 160ms ease, opacity 160ms ease, transform 160ms ease;
  white-space: nowrap;
}

.kline-annotation-anchor--right .kline-annotation-label {
  left: 14px;
}

.kline-annotation-anchor--left .kline-annotation-label {
  right: 14px;
}

.kline-annotation-connector-layer {
  height: 100%;
  inset: 0;
  overflow: visible;
  position: absolute;
  width: 100%;
}

.kline-annotation-connector-layer line {
  fill: none;
  stroke-dasharray: 3 3;
  stroke-width: 1.25;
}

.kline-turning-point-tooltip {
  background: rgb(18 31 49 / 94%);
  border: 1px solid #36516e;
  border-radius: 4px;
  box-shadow: 0 4px 14px rgb(0 0 0 / 24%);
  color: #dceaf7;
  display: grid;
  gap: 3px;
  max-height: 13%;
  overflow: auto;
  padding: 5px 7px;
  position: absolute;
  right: 18px;
  top: 55%;
  width: min(248px, 34%);
}

.kline-turning-point-tooltip > strong {
  color: #f0f7ff;
  font-size: 10px;
}

.kline-turning-point-tooltip div {
  align-items: baseline;
  display: grid;
  gap: 4px;
  grid-template-columns: 6px auto auto minmax(0, 1fr);
  min-width: 0;
}

.kline-turning-point-tooltip i {
  border-radius: 50%;
  height: 6px;
  width: 6px;
}

.kline-turning-point-tooltip b,
.kline-turning-point-tooltip span,
.kline-turning-point-tooltip small {
  font-size: 9px;
  white-space: nowrap;
}

.kline-turning-point-tooltip b { color: #e5f0f8; }
.kline-turning-point-tooltip span { color: #a6c0d5; }
.kline-turning-point-tooltip small { color: #8fa7ba; overflow: hidden; text-overflow: ellipsis; }

.kline-annotation-anchor.is-active .kline-annotation-label {
  box-shadow: 0 0 0 1px currentcolor, 0 3px 12px rgb(0 0 0 / 30%);
  opacity: 1;
  transform: translateY(-50%) scale(1.07);
}
</style>
