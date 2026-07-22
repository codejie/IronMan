# Trend Analysis Design

## Objective

Rebuild Batman's Trend Analysis workflow in IronMan while preserving IronMan's user isolation, typed TypeScript services, persistent task state, and stable deployment on Bun. The page replaces the current `/analysis/trend` placeholder.

## Scope

The first release covers all 26 indicator and pattern entries registered by Batman:

- Overlap: `MA`, `SAR`
- Momentum: `ADX`, `MACD`, `MACDEXT`, `RSI`, `MOM`, `KDJ`
- Volatility: `BOLL`, `ATR`, `NATR`
- Volume: `OBV`, `AD`, `VWAP`
- Price transform: `AVGPRICE`, `MEDPRICE`
- Pattern recognition: `CDLHAMMER`, `CDLENGULFING`, `CDLMORNINGSTAR`, `CDLDOJI`, `CDLEVENINGSTAR`, `CDL3WHITESOLDIERS`, `CDL3BLACKCROWS`, `CDLDARKCLOUDCOVER`
- Cycle: `HT_DCPERIOD`, `HT_DCPHASE`

The UI supports the five Batman target scopes: holdings, watchlist, custom instruments, all instruments, and holdings plus watchlist. Data windows provide 3-month, 6-month, 1-year, and 2-year presets plus a custom date range. Report windows provide 1, 3, 7, and 30 days plus the full data window.

The page displays a disabled `回测（即将推出）` entry. Trend strategies and reports reserve an optional backtest configuration field, but the first release does not execute or persist backtest transactions.

## Domain Model

Keep the existing generic `strategies` and `analysis_tasks` contracts unchanged. Add a focused trend-analysis domain:

- `trend_strategies`: id, user_id, name, remarks, target_scope, data_range, report_window, optional backtest_config_json, created_at, updated_at.
- `trend_strategy_targets`: custom target instruments for a strategy.
- `trend_strategy_indicators`: one row per enabled registry indicator, with indicator id, typed parameter JSON, display order, and enabled status.
- `trend_runs`: id, user_id, strategy_id, status, progress, target_total, target_completed, error_message, created_at, started_at, completed_at.
- `trend_run_reports`: id, user_id, run_id, instrument_id, result_json, created_at. One latest report per instrument within a run.
- `trend_run_logs`: id, user_id, run_id, level, message, created_at.

Every query filters by `user_id`. A strategy, run, report, and log cannot be read, updated, cancelled, or deleted by another user.

## Indicator Engine

Create a TypeScript indicator registry with schema-defined parameters, output lines, signal extractor, and chart placement for each indicator. The registry is the only source of valid indicator ids and parameter defaults.

The engine uses pure TypeScript compatible implementations. It does not require Python, native TA-Lib, or a Docker compiler toolchain. Regression fixtures capture price bars, parameter inputs, output lines, and expected signals. The compatibility target is Batman's calculation and reporting semantics, with explicit fixtures where Batman's output is underspecified.

Each run report normalizes results to:

```ts
interface TrendSignal {
  date: string
  direction: "bullish" | "bearish" | "neutral"
  strength: number
  reason: string
}
```

Reports retain raw indicator lines for chart overlays and include a source/error field for failures that affect one instrument without failing the entire run.

## Execution

`TrendRunService` resolves a strategy's target scope, validates the estimated target count, and runs a bounded-concurrency batch. The all-instruments scope requires a confirmation token from the client after the server has returned the estimated count.

The service emits progress, report, log, completed, failed, and cancelled events through SSE. It writes each result and log before emitting it, so a page refresh can restore a completed or in-progress run from persistent state. Cancellation stops scheduling new instruments and marks the run as cancelled after active work completes safely.

Market-provider failures are recorded per instrument and do not discard reports for other instruments. Invalid strategy parameters fail before a run is created.

## API Contract

All non-streaming endpoints use `POST` and the existing `{ code, message, result }` response envelope.

- `/api/analysis/trend/strategies/create|update|delete|get|list`
- `/api/analysis/trend/strategies/targets/update`
- `/api/analysis/trend/indicators/catalog`
- `/api/analysis/trend/runs/estimate`
- `/api/analysis/trend/runs/start|cancel|get|list`
- `/api/analysis/trend/reports/list`
- `/api/analysis/trend/logs/list`
- `GET /api/analysis/trend/runs/:id/events` for SSE only

The start endpoint accepts a confirmation token for all-instruments runs. The event stream requires the same authenticated user as the run owner.

## Frontend

`TrendAnalysisView` has a strategy list and a main work area:

- The strategy list creates, selects, edits, and deletes user-owned strategies.
- The editor selects a target scope, custom targets when needed, preset or custom date range, report window, and registry-backed indicators with validated parameter controls.
- The work area starts or cancels a run, shows status, target progress, and logs.
- The report panel filters all, bullish, bearish, neutral, and failed items. Selecting a row opens the shared K-line dialog with the run's indicator overlays.
- The disabled backtest entry explains that the capability is planned without pretending to run a calculation.

The layout follows IronMan's dense operational tables and existing dark theme. It does not copy Batman's Element Plus implementation or its direct default-user assumptions.

## Verification

Tests cover:

- All 26 registry entries and their parameter validation.
- Golden indicator fixtures for calculation lines and normalized signals.
- Strategy CRUD, custom targets, and user isolation.
- Target estimation and explicit confirmation for all instruments.
- Run progress, cancellation, completion, persistence, and report restoration.
- Single-instrument market failures without batch failure.
- SSE event ownership and ordering.
- Frontend editor validation, disabled backtest entry, filters, and restored report display.

Build validation includes `bun test`, backend TypeScript lint/build, frontend tests, and frontend production build.
