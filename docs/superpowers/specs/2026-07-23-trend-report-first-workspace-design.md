# Trend Report-First Workspace Design

## Goal

Make Trend Analysis a report-first workspace. Its primary job is to calculate and explain price trends, surface turning points, and state risk clearly. Strategy editing supports that workflow but does not compete with report results for screen space.

## Layout

The `/analysis/trend` page uses three persistent regions on desktop:

1. A narrow left rail lists completed and active trend runs. It also shows a compact read-only summary of the selected strategy.
2. The center region is the primary workspace. It contains aggregate run metrics, the ordered report list, and the chart detail for the selected report.
3. The right rail shows risk conclusions and recommended actions for the selected run. It is hidden below the desktop breakpoint and becomes a section below the center region.

The page header contains the selected strategy, a compact strategy summary trigger, `Edit strategy`, `Manage strategies`, `Start calculation`, and the existing disabled backtest entry. It does not contain a full strategy form.

`Edit strategy` and `Create strategy` open a right-side drawer. The drawer contains the existing strategy fields, target scope, data range, report window, selected indicators, and indicator parameters. `Manage strategies` opens a compact list dialog with create, duplicate, rename, delete, and select actions. The current strategy remains unchanged until a drawer save succeeds.

## Report and Risk Model

Each completed run produces both per-instrument reports and a run summary. The summary includes:

- overall direction: bullish, bearish, or neutral;
- counts by direction;
- high, medium, and low risk counts;
- count of detected turning points in the report window;
- ordered risk items with instrument, level, evidence, and suggested action.

Each instrument report contains the existing bars and indicator results plus normalized chart annotations:

```ts
interface TrendTurningPoint {
  date: string;
  direction: "bullish" | "bearish";
  level: "info" | "warning" | "risk";
  title: string;
  reason: string;
  price: number | null;
  indicatorId: string;
}

interface TrendRiskItem {
  level: "high" | "medium" | "low";
  title: string;
  evidence: string[];
  suggestedAction: string;
}
```

Risk is calculated locally from selected indicator signals and price behavior. It does not require an AI model. The report page shows the evidence that produced each conclusion, so a user can verify the result directly from the chart and indicators.

The right rail exposes `Create risk reminder` for each high or medium risk item. The first implementation creates a prefilled alert draft from the report evidence rather than automatically enabling a notification. This avoids unexpected alerts from every calculation run and preserves a clear user approval step.

If an AI provider is configured, the rail also exposes `AI deep interpretation`. It submits the selected report's local facts, annotations, and risk evidence to the existing assistant integration and renders the response as supplementary analysis. AI output never replaces the local direction, risk level, or raw indicator data.

## Charts

The selected report has three display modes:

1. `Combined` is the default. It renders price candles, volume, selected price overlays, selected oscillator panels, and turning-point markers in one synchronized view.
2. `Indicator` renders one chosen selected indicator at a time. It keeps the price chart as context and gives the indicator its own readable panel.
3. `Price` renders candles, volume, selected moving-average or volatility overlays, and turning points without oscillator panels.

The chart supports a selected-indicator picker and a combined picker for all selected indicators. The chart never truncates the stored report range with a data-zoom slider; it presents the full range and uses horizontal scrolling only when a narrow viewport cannot display all dates.

Turning points are rendered as explicit bullish or bearish markers at the relevant bar. Hover text shows the date, indicator, evidence, and risk level. Line series, legend dots, axis-pointer labels, and tooltip swatches use one shared color registry so indicator values cannot appear under a mismatched color.

The chart capabilities are implemented by extending the shared `KLineChart` and `InstrumentKLineDialog` interfaces rather than creating a Trend-only chart engine. The shared components gain optional overlay, sub-chart, and annotation inputs; existing holding, watchlist, and dialog consumers keep their current behavior when those inputs are omitted.

## Data Flow

1. A user selects a saved strategy and starts a run.
2. The backend resolves the user-isolated target scope, retrieves bars through the existing market abstraction, and evaluates selected indicators.
3. The indicator service normalizes current signals, historical turning points, risk items, and chart-ready line metadata.
4. The run service persists the run summary and individual report payloads and emits progress through the existing SSE stream.
5. The frontend updates aggregate metrics and report rows while a run is active. When a report is selected, it renders the persisted bars, annotations, and indicator metadata without recalculating indicators in the browser.
6. The user can create a reminder draft or request optional AI interpretation from the selected report.

All strategy, run, report, reminder draft, and AI request data remains scoped to the authenticated user.

## Error Handling

- A failed instrument report remains visible with its provider error and does not prevent other reports from completing.
- Missing or insufficient bar history results in an explicit neutral/insufficient-data report rather than a false trend conclusion.
- A disabled or unavailable AI configuration disables only the AI interpretation action and leaves local reports fully available.
- A failed reminder creation keeps the report visible and shows an actionable error without changing its risk conclusion.
- Cancelling a run retains completed reports and labels the run as cancelled.

## Acceptance Tests

Backend tests cover:

- run-summary direction, risk, and turning-point aggregation;
- report annotation persistence and user isolation;
- insufficient data and market-provider failure behavior;
- reminder drafts containing selected report evidence;
- disabled AI configuration not blocking trend execution.

Frontend tests cover:

- report-first default layout and compact strategy controls;
- selected report updates chart mode and indicator picker;
- combined and individual indicator display contracts;
- turning-point marker and tooltip color consistency;
- risk-filtered reports and reminder actions;
- responsive right rail collapse.

Manual verification covers a multi-indicator strategy with at least one bullish turning point and one risk item, then confirms the report chart, risk evidence, reminder draft, and optional AI entry are all visible without leaving the report workspace.
