# Intraday Snapshot Trading-Day Retention Design

## Goal

Make the configured five-, ten-, or fifteen-day intraday snapshot retention
period mean that many user-configured trading days. A holding must be able to
show every snapshot the active retention setting preserves.

## Current Issue

Snapshot cleanup currently compares UTC `captured_at` timestamps against a
calendar-day duration, and only automatic collection invokes it. Consequently,
weekends, configured market closures, and a manual-only collection setup can
leave the retained period inconsistent with the configured number of trading
days. The holdings dialog then requests only five calendar days, so data
preserved by a ten- or fifteen-day setting is not available to its `全部` view.

## Design

### Retention Boundary

`MarketSnapshotService` will use the current user's `TradingCalendarService`
to find the configured trading days ending on the active capture date. The
oldest of the most recent N days, including the current date, is the retention
boundary. Cleanup deletes only rows for that user whose `trade_date` is older
than the boundary.

The computation reads the current and preceding calendar year, which provides
more than enough trading dates for the supported maximum of fifteen days and
also respects per-user calendar overrides. It deliberately uses the stored
local Shanghai `trade_date`, not the UTC capture timestamp.

### Collection Paths

Automatic collection keeps its existing pre-capture cleanup. Manual refreshes
will run the same cleanup after their setting, scope, trading-session, and
target eligibility checks and before writing the current point. Both paths
record the cleanup trade date in the existing per-user snapshot state, so
cleanup is performed at most once per user and trade date.

The cleanup query changes from `captured_at` to `trade_date`; a new additive
database migration adds an index on `(user_id, trade_date)` for that query.
No stored snapshot schema, settings contract, or HTTP API changes are needed.

### Holdings Dialog

The holdings dialog will request a conservative 45-calendar-day lookback. The
service already applies the user's five-, ten-, or fifteen-trading-day storage
limit, so this only ensures that all retained data reaches the existing
`全部` range. The one-, two-, and five-day display filters remain unchanged.

## Error Handling And Isolation

Invalid snapshot settings, ineligible sessions, stale bars, unsupported
instruments, and provider failures retain their existing behavior. Cleanup
continues to include `user_id` in every query, so one user's settings or
collection never delete another user's snapshots.

## Acceptance Tests

- With a five-day setting, cleanup on a Wednesday retains Friday through
  Wednesday and deletes the preceding Thursday, proving that weekends do not
  consume retention days.
- A manual in-scope refresh performs the same cleanup and records the cleanup
  date; a second refresh on that date does not repeat it.
- Automatic collection retains the configured trading-day window, and user
  isolation remains intact.
- A holdings dialog request begins far enough in the past to receive data from
  all fifteen retained trading days; selecting `全部` renders that response.
- Database migration upgrades existing installations by adding only the new
  index.

## Scope

This work does not add a new configuration control, change the supported
retention options, alter existing snapshot APIs, or attempt to restore data
that a prior shorter retention setting has already deleted.
