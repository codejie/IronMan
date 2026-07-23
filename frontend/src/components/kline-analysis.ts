export const KLINE_RANGES = {
  halfYear: { label: "半年", limit: 120 },
  oneYear: { label: "一年", limit: 250 },
  twoYears: { label: "两年", limit: 520 }
} as const;

export type KlineRange = keyof typeof KLINE_RANGES;
export type KlineSubchart = "macd" | "volume";

export interface KlineOverlay {
  id: string;
  name: string;
  placement: "main" | "sub";
  kind: "line" | "bar";
  values: Array<number | null>;
  color: string;
}

export interface KlineAnnotation {
  indicatorId?: string;
  date: string;
  price: number | null;
  direction: "bullish" | "bearish";
  level: "info" | "warning" | "risk";
  title: string;
  reason: string;
  color: string;
}

export interface KlineAnnotationVisual {
  key: string;
  marker: {
    name: string;
    coord: [string, number];
    value: string;
    symbol: "triangle";
    symbolRotate: number;
    symbolSize: [number, number];
    symbolOffset: [number, number];
    itemStyle: {
      color: string;
      borderColor: string;
      borderWidth: number;
      shadowBlur: number;
      shadowColor: string;
    };
    label: { show: false };
    tooltip: { formatter: string };
  };
  guideLine: {
    xAxis: string;
    lineStyle: { color: string; width: number; type: "dashed"; opacity: number };
    label: { show: false };
  };
}

export interface KlineAnnotationLabel {
  key: string;
  title: string;
  direction: KlineAnnotation["direction"];
  level: KlineAnnotation["level"];
  reason: string;
  color: string;
  axisLabel: string;
  price: number;
  position: number;
  lane: number;
}

export interface KlineAnnotationPlacementInput {
  key: string;
  left: number;
  pointTop: number;
  title: string;
}

export interface KlineAnnotationPlacement {
  labelTop: number;
  side: "left" | "right";
}

function annotationKey(annotation: KlineAnnotation, index: number): string {
  return `${annotation.date}:${annotation.direction}:${annotation.title}:${index}`;
}

export function buildKlineAnnotationLabels(
  annotations: KlineAnnotation[],
  points: Array<{ date: string; label: string; close: number }>
): KlineAnnotationLabel[] {
  const indexByDate = new Map(points.map((point, index) => [point.date, index]));
  const lanesByDirection: Record<KlineAnnotation["direction"], number[]> = { bullish: [], bearish: [] };
  const minimumGap = 9;
  return annotations.flatMap((annotation, annotationIndex) => {
    const index = indexByDate.get(annotation.date);
    if (index === undefined) return [];
    const point = points[index];
    if (point === undefined) return [];
    const position = points.length <= 1 ? 50 : Number((index / (points.length - 1) * 100).toFixed(3));
    const lanes = lanesByDirection[annotation.direction];
    let lane = lanes.findIndex((lastPosition) => position - lastPosition >= minimumGap);
    if (lane < 0) lane = Math.min(lanes.length, 2);
    lanes[lane] = position;
    return [{
      key: annotationKey(annotation, annotationIndex),
      title: annotation.title,
      direction: annotation.direction,
      level: annotation.level,
      reason: annotation.reason,
      color: annotation.color,
      axisLabel: point.label,
      price: annotation.price ?? point.close,
      position,
      lane
    }];
  });
}

export function layoutKlineAnnotationLabels(
  inputs: KlineAnnotationPlacementInput[],
  chartWidth: number,
  gridTop: number,
  gridBottom: number
): Record<string, KlineAnnotationPlacement> {
  const labelHeight = 14;
  const labelGap = 5;
  const labelOffset = 14;
  const laneGap = 18;
  const lanes = 5;
  const occupied: Array<{ left: number; right: number; top: number; bottom: number }> = [];
  const placements: Record<string, KlineAnnotationPlacement> = {};

  for (const input of [...inputs].sort((left, right) => left.left - right.left || left.pointTop - right.pointTop)) {
    const labelWidth = Math.min(70, Math.max(24, input.title.length * 9 + 8));
    const preferTop = input.pointTop > (gridTop + gridBottom) / 2;
    const rails = preferTop ? ["top", "bottom"] as const : ["bottom", "top"] as const;
    const sides = input.left <= chartWidth / 2 ? ["right", "left"] as const : ["left", "right"] as const;
    let selected: { left: number; right: number; top: number; bottom: number; labelTop: number; side: "left" | "right"; score: number } | undefined;

    for (const [railIndex, rail] of rails.entries()) {
      for (let lane = 0; lane < lanes; lane += 1) {
        const labelTop = rail === "top" ? gridTop + 11 + lane * laneGap : gridBottom - 11 - lane * laneGap;
        for (const [sideIndex, side] of sides.entries()) {
          const right = side === "right" ? input.left + labelOffset + labelWidth : input.left - labelOffset;
          const left = right - labelWidth;
          const top = labelTop - labelHeight / 2;
          const bottom = labelTop + labelHeight / 2;
          const overlaps = occupied.some((item) => left < item.right + labelGap && right > item.left - labelGap && top < item.bottom + labelGap && bottom > item.top - labelGap);
          const clipping = Math.max(0, -left) + Math.max(0, right - chartWidth);
          const score = (overlaps ? 100000 : 0) + clipping * 1000 + railIndex * 100 + lane * 10 + sideIndex;
          if (selected === undefined || score < selected.score) selected = { left, right, top, bottom, labelTop, side, score };
        }
      }
    }

    if (selected === undefined) continue;
    occupied.push(selected);
    placements[input.key] = { labelTop: selected.labelTop, side: selected.side };
  }

  return placements;
}

export function fixedKlineTooltipPosition(
  point: number[],
  viewSize: number[],
  contentSize: number[],
  padding = 12,
  verticalOffset = 48
): [number, number] {
  const viewWidth = viewSize[0] ?? 0;
  const viewHeight = viewSize[1] ?? 0;
  const contentWidth = contentSize[0] ?? 0;
  const contentHeight = contentSize[1] ?? 0;
  const boundedContentHeight = Math.min(contentHeight, Math.max(0, viewHeight - padding * 2));
  const x = (point[0] ?? 0) <= viewWidth / 2
    ? Math.max(padding, viewWidth - contentWidth - padding)
    : padding;
  const bottomLimit = Math.max(padding, viewHeight - boundedContentHeight - padding - verticalOffset);
  const y = Math.max(padding, Math.min((point[1] ?? 0) - boundedContentHeight / 2 - verticalOffset, bottomLimit));
  return [x, y];
}

export function buildKlineAnnotationVisuals(
  annotations: KlineAnnotation[],
  points: Array<{ date: string; label: string; close: number }>
): KlineAnnotationVisual[] {
  const pointByDate = new Map(points.map((point) => [point.date, point]));
  return annotations.flatMap((annotation, annotationIndex) => {
    const point = pointByDate.get(annotation.date);
    if (point === undefined) return [];
    const bullish = annotation.direction === "bullish";
    const risk = annotation.level === "risk" || annotation.level === "warning";
    const directionLabel = bullish ? "↑ 多头" : risk ? "↓ 风险" : "↓ 空头";
    return [{
      key: annotationKey(annotation, annotationIndex),
      marker: {
        name: annotation.title,
        coord: [point.label, annotation.price ?? point.close],
        value: directionLabel,
        symbol: "triangle",
        symbolRotate: bullish ? 0 : 180,
        symbolSize: [8, 12],
        symbolOffset: [0, bullish ? -6 : 6],
        itemStyle: {
          color: annotation.color,
          borderColor: "#f4fbff",
          borderWidth: 1.5,
          shadowBlur: 9,
          shadowColor: annotation.color
        },
        label: { show: false },
        tooltip: { formatter: `${directionLabel}<br/>${annotation.title}<br/>${annotation.reason}` }
      },
      guideLine: {
        xAxis: point.label,
        lineStyle: { color: annotation.color, width: risk ? 1.8 : 1.3, type: "dashed", opacity: risk ? 0.9 : 0.65 },
        label: { show: false }
      }
    }];
  });
}

export const MA_PERIODS = [5, 10, 20, 30, 45, 60] as const;
export const DEFAULT_KLINE_RANGE: KlineRange = "halfYear";
export const DEFAULT_MA_PERIODS = [5, 10, 20];
export const DEFAULT_SUBCHART: KlineSubchart = "macd";
export const KLINE_PREFERENCES_KEY = "ironman.kline-preferences.v1";

export interface KlinePreferences {
  range: KlineRange;
  maPeriods: number[];
  subchart: KlineSubchart;
}

function defaultPreferences(): KlinePreferences {
  return { range: DEFAULT_KLINE_RANGE, maPeriods: [...DEFAULT_MA_PERIODS], subchart: DEFAULT_SUBCHART };
}

export function parseKlinePreferences(raw: string | null): KlinePreferences {
  if (raw === null) return defaultPreferences();
  try {
    const value = JSON.parse(raw) as Partial<KlinePreferences>;
    const range = value.range !== undefined && value.range in KLINE_RANGES ? value.range : DEFAULT_KLINE_RANGE;
    const maPeriods = Array.isArray(value.maPeriods)
      ? [...new Set(value.maPeriods.filter((period): period is number => typeof period === "number" && MA_PERIODS.some((supported) => supported === period)))].sort((left, right) => left - right)
      : [...DEFAULT_MA_PERIODS];
    const subchart = value.subchart === "volume" || value.subchart === "macd" ? value.subchart : DEFAULT_SUBCHART;
    return { range, maPeriods, subchart };
  } catch {
    return defaultPreferences();
  }
}

export function movingAverage(values: number[], period: number): Array<number | null> {
  const result: Array<number | null> = Array.from({ length: values.length }, () => null);
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index] ?? 0;
    if (index >= period) sum -= values[index - period] ?? 0;
    if (index >= period - 1) result[index] = Number((sum / period).toFixed(6));
  }
  return result;
}

export function lineVisualStyle(color: string, width: number): { itemStyle: { color: string }; lineStyle: { color: string; width: number } } {
  return { itemStyle: { color }, lineStyle: { color, width } };
}
