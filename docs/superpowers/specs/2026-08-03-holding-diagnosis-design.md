# AI Holding Diagnosis Reports Design

## Goal

Add a report-centered **Holding Diagnosis** workspace under the existing
`Trend Analysis` navigation. It helps a user manage A-share, index, and listed
ETF holdings by combining their position facts, local market data, locally
rendered charts, trend calculations, and selected external financial sources.

The feature produces specific, conditional decision support such as an action
direction, timing, reference price range, validity period, invalidation price,
and supporting evidence. It never places orders, changes holdings, or writes
trading records.

The feature is not an AI chat entry. AI is a report-generation dependency that
may use its own reasoning and may call local analytical functions on demand.

## Scope And Constraints

- Supported instruments: A shares, indices, and listed ETFs only.
- AI model: use the current user's enabled default model from the existing AI
  configuration. No new AI credentials or browser-side keys are introduced.
- Report body: at most 600 Chinese characters. Source lists, charts, method
  metadata, and structured recommendation fields do not count toward this cap.
- External material: use it transiently during generation. Persist only source
  metadata and the source URL, never HTML, article text, PDF contents, or other
  full external material.
- Every report, run, source, and setting is isolated by `user_id`.
- A report must remain viewable after its source expires or a market provider
  changes. It renders from its local report snapshot and identifies stale or
  failed sources.
- No automatic trading, external notifications, broker integration, arbitrary
  server-side code execution, or arbitrary webpage crawling is in scope.

## User Experience

### Navigation And Report List

`Trend Analysis` gains a `Holding Diagnosis` subpage. It is the sole entry for
manual diagnosis and the archive for daily automatic diagnoses.

The list page includes:

- a `Generate diagnosis` command for the current active holdings;
- reports grouped by date and labelled `manual` or `scheduled`;
- queued, running, completed, partial, failed, and cancelled states;
- coverage count, data time, main risk count, model name, and source freshness;
- filtering by date range, trigger, state, and instrument;
- single-report deletion and filtered batch deletion through the existing
  confirmation dialog.

If a user has no qualifying holdings, the page shows an empty state and does
not create an AI request.

### Report Detail

The detail page starts with a compact portfolio summary, followed by one item
for each active holding. It deliberately has no chat composer.

Each holding item shows:

1. Position facts: code, name, quantity, average cost, current price, holding
   profit/loss, source, and valuation time.
2. Local market diagnosis: daily movement, recent range, volatility, trend
   signals, and any stored intraday snapshot context.
3. A locally rendered chart: daily K line plus selected local indicators and
   labelled turning points. It renders from the report snapshot, rather than
   loading later market data.
4. A structured recommendation card with direction, timing, reference price
   range, invalidation or stop-review level, validity period, evidence, and
   uncertainty. Directions are `add evaluation`, `reduce evaluation`, `hold`,
   `observe`, and `research further`.
5. Method disclosure: AI-generated reasoning, local function calls, or both;
   selected algorithm names, parameter values, data windows, and conflicts.
6. A `Data and sources` section with usable external links, a concise source
   summary, expandable key facts, and all relevant local data sources.

The natural-language diagnosis body across the whole report is limited to 600
characters by server validation. Structured recommendation cards and source
metadata stay outside that body so the report remains both compact and
auditable.

### Sources And Links

Reports display, and preserve for later viewing:

- market provider actually used (`akshare`, `tencent`, `eastmoney`, or local
  cache), valuation timestamp, and freshness state;
- local calculation function/algorithm name, version, parameters, and data
  range;
- external material source name, title, type, publication time, fetch time,
  availability state, original URL, concise summary, and up to eight key facts.

An external-link icon opens the original URL in a separate browser tab. A
source is never embedded in an iframe and its full content is not stored. A
link-only source must say that its page was not read; its summary can only
describe the source scope and verification status, never assert third-party
facts.

## Generation Pipeline

### Input Collection

For each active eligible holding, `HoldingDiagnosisService` builds a reusable
local input package:

- holding and transaction facts from `AssetsService`;
- latest daily OHLCV history from `MarketService`, including actual source and
  cache time;
- the most recent intraday snapshots if enabled and available;
- concise range, volatility, volume, and data freshness facts;
- current trend reports where applicable;
- external source metadata, compact summaries, and URL references supplied by
  configured source adapters. The initial adapters are deliberately link-only;
  their expandable summaries identify the relevant source scope and do not
  claim to have read a third-party page or persist its body.

The package is cached for the run, so repeated AI tool calls never re-fetch the
same market or source data. Each provider call has a timeout, a source-specific
rate limit, and a cache policy.

### AI-Led Analysis

The configured model receives the concise input package, report preference,
and a controlled list of local analytical functions. It may:

- reason directly over the input package using its own analytical method;
- call one or more local functions to validate a hypothesis or improve a
  calculation;
- issue one batch request covering several indicators/parameter sets; and
- preserve uncertainty or a disagreement instead of forcing one conclusion.

The service does not force every conclusion through a local indicator. An AI
result is retained as `ai analysis` with model and method disclosure. A local
function result is retained as `local function` with its name, version,
parameters, input window, and result. A combined conclusion is retained as
`hybrid analysis` and records both sources of reasoning.

The AI cannot execute arbitrary server code. It can use its own model-side
logic and can invoke only the explicit local functions exposed by the service.

### Local Analytical Functions

The first version exposes existing, deterministic local capabilities as
batchable functions:

- trend indicator and turning-point calculation from `TrendIndicatorService`;
- MA, MACD, RSI, SAR, ATR/NATR, KDJ, BOLL, VWAP, volume, price-pattern, and
  cycle indicators already supported by the trend catalog;
- local chart data generation and turning-point marker projection;
- current and historic market summaries, including intraday snapshot summaries
  where present.

The AI can select a subset, set valid parameters, and combine several calls in
one request. Invalid parameters, unsupported algorithms, excessive function
calls, and unavailable data return structured errors for the AI to handle.

No artificial "algorithm consensus" score is required. If methods conflict,
the report explicitly describes the conflict and reduces the confidence of the
suggestion.

### Turning Points

A turning point can be produced by an AI method, a local function, or both.
Every recorded point includes direction, timestamp, reference price, strength,
and a method array. Each method item has:

- `kind`: `ai_analysis` or `local_function`;
- method/algorithm name and optional version;
- parameters and data window;
- signal result and rationale;
- limitations or data-quality caveats.

This lets the report show, for example, an AI-derived turning point that was
checked with local `MACD(12,26,9)` and `ATR(14)`, without falsely claiming that
the local algorithms alone produced the final conclusion.

### Output Validation And Partial Completion

The service requests structured JSON from AI, validates its schema, verifies
the 600-character body limit, and normalizes price ranges and timestamps.
Malformed model output, unavailable model configuration, provider failures,
or missing source data do not discard collected local facts. The run completes
as `partial` when it has at least one usable holding diagnosis, otherwise it is
`failed` with a user-visible error.

## Information Source Catalog

The source catalog has separate roles so reports do not treat all sources as
equally authoritative.

| Source | Role | Acquisition and retention |
| --- | --- | --- |
| Existing market providers: AkShare, Tencent Finance, Eastmoney | Daily and current market data for A shares, indices, and listed ETFs | Reuse `MarketService` primary/fallback configuration and cache. Store provider name and market timestamp in the report. |
| Local AkShare service | Market, public-data adapter, and fallback source | Extend the local Python provider with explicit, typed endpoints where an upstream interface is available. Cache responses and obey rate limits. |
| CNInfo and Shanghai Stock Exchange disclosure pages | Primary company-disclosure reference sources for A-share holdings | The initial adapter records title, type, canonical URL, source-scope summary, and verification-status facts. A later typed official interface may add transient metadata after separate source validation. Persist only compact metadata and URL. |
| Eastmoney and Xueqiu | Optional financial-information and event-clue sources | The initial adapter records a vetted public URL plus source-scope summary and verification-status facts. Do not depend on hidden, undocumented, login-gated, or bypassed interfaces. A link-only source cannot be described as verified report fact. |

`All sources` in settings means all currently vetted adapters in this catalog. It
does not permit arbitrary URLs or unbounded web search. Official disclosure is
treated as evidence before news or discussion material. A link-only source may
appear as a reference but cannot be represented as verified report fact without
usable transient metadata.

## Scheduling And Settings

`System Configuration` gains a `Holding Diagnosis` setting group. It stores a
user-scoped `holding.diagnosis` setting with:

- `enabled`: automatic daily generation on or off; default off;
- `scheduledTime`: local Asia/Shanghai `HH:mm`; default `15:30` on trading days;
- `sourceIds`: selected source identifiers, with `all` resolving to vetted
  catalog entries at generation time;
- `reportPreference`: editable report-tendency prompt, capped at 4,000
  characters;
- `lookbackTradingDays`: chart/data window, initially 20, 60, or 120;
- `maxFunctionBatches`: maximum AI local-function batches per report;
- `maxExternalSourcesPerHolding`: upper bound for external fetches.

The page displays source descriptions and health state, the next eligible run,
the latest result, and the active default AI model. It uses the existing
confirmation UI for any destructive report deletion.

The existing 30-second `AutomationScheduler` invokes
`HoldingDiagnosisService.runDueAutomatic(now)` alongside its other due work.
The service checks user configuration, trading days, the configured time,
per-user last successful attempt, and a run lock before enqueueing a daily
report. It does not create duplicate daily reports.

Manual generation uses the same service but bypasses only the scheduled-time
check. It still obeys provider budgets and user/source selection.

## Persistence

Migration 13 adds the following tables. SQLite is preferred over local files:
it uses the existing backup/export path, transactions, foreign-key cleanup, and
tenant-isolation tests.

### `holding_diagnosis_runs`

- `id`, `user_id`, `trigger` (`manual` or `scheduled`), `status`, `progress`;
- immutable `settings_snapshot_json`, `model_snapshot_json`, and start/end
  timestamps;
- failure and partial-completion messages;
- per-user schedule key and creation timestamps.

### `holding_diagnosis_reports`

- `id`, `user_id`, `run_id`, `body`, `summary_json`, `market_as_of`, and
  `created_at`;
- exactly one report per run and a check enforced by service validation that the
  body is at most 600 characters.

### `holding_diagnosis_items`

- `id`, `user_id`, `report_id`, `instrument_id`;
- position/market `data_snapshot_json`, `chart_snapshot_json`, and
  `analysis_json`;
- recommendation direction, price-range JSON, validity date, and data-quality
  state.

### `holding_diagnosis_sources`

- `id`, `user_id`, `report_id`, optional `item_id`;
- source id/type, title, publication time, fetch time, availability state,
  original `url`, and metadata JSON;
- no full material payload or source-body column.

All report child tables cascade on report/run deletion. Backup, user export,
and recovery table lists include these tables in dependency-safe order.

## API Contract

All routes are authenticated `POST` APIs and derive `user_id` exclusively from
the session:

- `/api/analysis/holding-diagnosis/settings/get`
- `/api/analysis/holding-diagnosis/settings/update`
- `/api/analysis/holding-diagnosis/sources/catalog`
- `/api/analysis/holding-diagnosis/start`
- `/api/analysis/holding-diagnosis/runs/list`
- `/api/analysis/holding-diagnosis/runs/get`
- `/api/analysis/holding-diagnosis/reports/get`
- `/api/analysis/holding-diagnosis/reports/delete`
- `/api/analysis/holding-diagnosis/reports/delete-batch`

`start` responds with a queued run. The browser polls its run/report endpoint
until it reaches a terminal state. A later iteration may reuse the trend-run
SSE pattern, but polling is sufficient and reduces initial protocol surface.

## Error Handling And Safety

- Provider errors are isolated per holding and per external source. They become
  visible source-status records, not fabricated evidence.
- The AI receives no user data beyond the active user's holding data required
  for the report. User data is never used in external query text except the
  instrument code/name needed for a configured source lookup.
- External adapters enforce allowlists, timeout, concurrency, response-size,
  cache, and rate-limit policies. They do not bypass authentication, CAPTCHA,
  paywalls, or robots/access controls.
- Suggestions must include an uncertainty and invalidation condition. A report
  never claims a guaranteed return or sends an execution command.
- Delete routes are idempotent for the current user and must never disclose
  another user's report existence.

## Test Plan

Backend tests cover:

1. successful manual and scheduled report generation for only the current user;
2. A-share/index/listed-ETF eligibility and open-fund exclusion;
3. 600-character AI-body validation and malformed model-output handling;
4. local-function batch invocation, AI-only result retention, and hybrid method
   disclosure with names/parameters;
5. chart snapshot persistence and report reread without provider access;
6. external-source success, timeout, policy failure, stale metadata, and
   partial-report behavior without persisting source full text;
7. user isolation, single deletion, filtered batch deletion, cascade cleanup,
   backup/export/import, and migration compatibility;
8. scheduled-time deduplication, disabled settings, trading-day checks, and
   application wiring into `AutomationService`.

Frontend tests cover:

1. holding-diagnosis navigation, empty, loading, queued, partial, failed, and
   completed states;
2. source selection, report preference, schedule configuration, and model
   display in System Configuration;
3. 600-character report body, method disclosure, source URL links, and local
   chart rendering; report items switch through accessible Tabs; source facts
   expand without exposing stored source body;
4. single and batch deletion through the shared confirmation component;
5. responsive detail rendering without text or chart-control overlap.

## Acceptance Criteria

- A user can manually create a diagnosis of active eligible holdings from
  `Trend Analysis > Holding Diagnosis` and review it later.
- A configured automatic run produces at most one report per user/trading day
  and appears in the same list.
- Each completed/partial report records market source, chart data, method
  metadata, visible external URLs, and a body of at most 600 characters.
- AI can use its own method, local functions, or both, and the report clearly
  identifies which method produced each material conclusion or turning point.
- AI completion, timeout, and local-fallback states identify the selected model
  and never label a local fallback as AI analysis.
- Source-body content is not stored in SQLite, while source links remain
  viewable and openable.
- Users can delete one report or a filtered set without affecting holdings,
  market caches, other reports, or another user's data.
- All new paths pass success, isolation, invalid input, data-provider failure,
  model failure, transaction, and UI state tests.
