import type { TrendIndicatorDefinition, TrendIndicatorSelection, TrendRunReport } from "@/api/client";
import type { KlineAnnotation, KlineOverlay } from "@/components/kline-analysis";

export type TrendChartMode = "combined" | "indicator" | "kline";

export interface TrendChartPresentation {
  mainOverlays: KlineOverlay[];
  subOverlays: KlineOverlay[];
  annotations: KlineAnnotation[];
}

const seriesColors = ["#6581da", "#92c978", "#ffbd4b", "#c985d7", "#56c4c9", "#ed7777", "#61bbe0", "#e881b2"];

export function buildTrendIndicatorParameterSummary(
  definitions: TrendIndicatorDefinition[],
  selections: TrendIndicatorSelection[],
  indicatorId: string | null
): string | null {
  if (indicatorId === null) return null;
  const definition = definitions.find((item) => item.id === indicatorId);
  if (definition === undefined) return null;
  const selection = selections.find((item) => item.indicatorId === indicatorId);
  if (definition.parameters.length === 0) return `${definition.id} · 默认计算参数`;
  const values = definition.parameters.map((parameter) => `${parameter.label}: ${selection?.parameters?.[parameter.key] ?? parameter.defaultValue}`);
  return `${definition.id} · ${values.join(" · ")}`;
}

export function buildTrendChartPresentation(
  report: TrendRunReport,
  definitions: TrendIndicatorDefinition[],
  mode: TrendChartMode,
  indicatorIds: string[]
): TrendChartPresentation {
  const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
  const overlays = report.result.indicators.flatMap((indicator, indicatorIndex) => {
    const definition = definitionById.get(indicator.indicatorId);
    if (definition === undefined || definition.chart === "hidden") return [];
    if (mode === "kline") return [];
    if (mode === "indicator" && !indicatorIds.includes(indicator.indicatorId)) return [];
    const placement = definition.chart === "main" ? "main" : "sub";
    return Object.entries(indicator.lines).map(([line, values], lineIndex): KlineOverlay => ({
      id: `${indicator.indicatorId}:${line}`,
      name: `${indicator.indicatorId} ${line.toUpperCase()}`,
      placement,
      kind: line === "hist" ? "bar" : "line",
      values,
      color: seriesColors[(indicatorIndex * 3 + lineIndex) % seriesColors.length]!
    }));
  });
  const turningPoints = mode === "indicator"
    ? report.result.turningPoints.filter((point) => indicatorIds.includes(point.indicatorId))
    : report.result.turningPoints;
  return {
    mainOverlays: overlays.filter((overlay) => overlay.placement === "main"),
    subOverlays: overlays.filter((overlay) => overlay.placement === "sub"),
    annotations: turningPoints.map((point): KlineAnnotation => ({
      indicatorId: point.indicatorId,
      date: point.date,
      price: point.price,
      direction: point.direction,
      level: point.level,
      title: point.title,
      reason: point.reason,
      color: point.direction === "bullish" ? "#fa7575" : "#68d991"
    }))
  };
}
