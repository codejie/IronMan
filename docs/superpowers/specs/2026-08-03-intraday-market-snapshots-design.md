# Intraday Market Snapshots Design

## Context

`master` shows a holdings-level intraday-data action, but its current API
converts daily history into synthetic snapshot points. It does not persist
intraday captures, expose capture configuration, or schedule automatic work.

`feat/ai-enhancement-batch2` contains an intraday snapshot implementation, but
also includes unrelated research code and migrations 13 and 14. It additionally
constructs the snapshot service without wiring it into asset refreshes or the
existing automation service, so neither manual nor automatic capture runs in
that branch.

## Goal

Add a complete, user-isolated intraday snapshot workflow to `master` without
adopting the feature branch's research subsystem or its incompatible data
model migrations.

## Scope

- Add only database migration 12 from the feature branch.
- Add settings, capture, status, retention, deletion, and series-query support.
- Make the holdings view read persisted intraday snapshots rather than daily
  history presented as intraday data.
- Add a configuration surface in System Configuration > Market and Calendar.
- Wire both automatic collection and manual-refresh collection into existing
  `master` services.

The work excludes migrations 13 and 14, research services, research scheduling,
and all research UI.

## Architecture

### Storage

Migration 12 creates two additive tables:

- `market_intraday_snapshots`: one point per user, instrument, and local
  capture minute. Each row stores timestamp, trading date, market source,
  collection mode, and OHLCV values.
- `market_snapshot_states`: one row per user recording the last attempt,
  success, counts, error, and retention-cleanup date.

The current local database at migration 11 upgrades in place. Existing data is
not rewritten.

### Service And Settings

`MarketSnapshotService` owns a user setting named
`market.intraday-snapshots`. Defaults are disabled, automatic mode, 09:30 to
15:00, 15-minute interval, holdings scope, and five-day retention.

The service validates supported modes, intervals, scopes, retention periods,
and ordered HH:MM windows. It captures only stock and index instruments on a
user's configured trading day during 09:30-11:30 and 13:00-15:00 Asia/Shanghai
time. It rejects stale daily bars so a previous trading day's quote is never
stored as an intraday point.

### Collection Paths

- Automatic mode: `AutomationService.runDueSchedules()` invokes
  `captureDueAutomatic()`. The existing 30-second scheduler remains the clock;
  the snapshot service enforces each user's configured interval and prevents
  concurrent runs.
- Manual mode: an explicit holdings or watchlist refresh reuses the bar already
  loaded for the workspace and calls `captureFromManualRefresh()` without a
  second market-provider request.

`MarketSnapshotService` is constructed before `AssetsService` and
`AutomationService`, then passed to both. This deliberately fixes the missing
feature-branch wiring.

### API And UI

Authenticated POST APIs provide settings get/update, status, deletion, and
series lookup. All operations are scoped to the current user. The existing
`/api/market/snapshots/series` endpoint delegates to the service rather than
deriving points from daily bars.

The Market and Calendar section gains a concise `盘中行情快照` row with current
state, stored-point count, and actions to configure or clear current-user
records. Its dialog controls the master switch, automatic/manual mode, scope,
window, interval, and retention. Deletion uses the project's confirmation
dialog and feedback uses its existing notification surface.

## Error Handling

- Invalid settings return a validation error without updating saved settings.
- A provider failure records the user's failed automatic attempt and continues
  processing other users and scheduled work.
- A disabled setting, a non-trading period, an out-of-scope instrument, or a
  stale bar does not write a snapshot.
- Deleting snapshots affects only the current user's records and leaves daily
  cache, holdings, and funds data untouched.

## Acceptance Criteria

- A migration-11 database upgrades to version 12 with the two snapshot tables.
- Settings are validated and isolated between users.
- Manual refresh creates one current-minute point only when enabled manual
  settings, scope, trade day, and session allow it.
- Automatic capture honours per-user interval and scope, skips unsupported fund
  instruments, cleans expired points, and records status.
- The existing scheduler calls automatic capture and asset refresh calls manual
  capture; each has a regression test for this wiring.
- Snapshot series queries return only the requesting user's persisted rows.
- System Configuration can save settings, display state, and confirm deletion.
- Holdings data uses stored intraday points instead of synthetic daily bars.

## Tests

- Backend service tests cover manual capture, automatic capture, stale or
  out-of-session rejection, retention cleanup, and user isolation.
- Route tests cover settings validation, settings isolation, snapshot status,
  deletion, and series reads.
- Scheduler and asset-service tests verify both collection paths are wired.
- Frontend tests verify configuration controls submit the selected values and
  deletion uses the shared confirmation component.
