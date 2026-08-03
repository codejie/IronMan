# Master Database Recovery Design

## Context

The active local database was upgraded through migrations 13 and 14 on
`feat/ai-enhancement-batch2`. The checked-out `master` branch defines migrations
1 through 11 and expects the legacy `cash_ledger` columns, including `category`.
SQLite does not downgrade schema when a branch is changed, so the holdings
workspace fails when it queries the forward-migrated ledger table.

## Goal

Rebuild `data/ironman.sqlite` for the current `master` schema while preserving
all data that `master` can represent. Keep the original database as a restorable
backup before making the recovered database active.

## Scope

- Create a timestamped, SQLite-consistent backup of the current database before
  modifying the active database path.
- Create a fresh staging database using `master` migrations 1 through 11.
- Migrate all compatible user-owned and shared application data, preserving IDs
  and timestamps.
- Translate the forward ledger representation back to the legacy representation.
- Validate the staging database before atomically making it active.
- Reject startup when the database contains a migration version newer than the
  current code knows how to handle.

The migration does not attempt to represent branch-exclusive data such as cash
purpose allocations, import batches, asset snapshots, or research records in
`master`. Those records remain available in the backup database.

## Migration Flow

1. Stop the backend so no writes occur during the transition.
2. Use SQLite backup semantics to create
   `data/ironman.sqlite.before-master-recovery-<timestamp>.sqlite`.
3. Create `data/ironman.master-recovery-<timestamp>.sqlite` through
   `IronManDatabase`, which applies the `master` schema migrations.
4. Copy each schema-compatible table with its explicit supported columns.
5. Rebuild `cash_ledger` with this mapping:

   | Source field | Target field | Rule |
   | --- | --- | --- |
   | `type` | `category` | Preserve `adjustment`, `buy`, `sell`, and `dividend`; reject any other type. |
   | `related_transaction_id` | `holding_transaction_id` | Preserve the transaction ID when present. |
   | transaction's `holding_id` | `reference_id` | Look up from `holding_transactions` for buy, sell, and dividend entries. |
   | `reason` | `note` | Use an empty string when absent. |

6. Check table counts, ledger type coverage, cash balances, foreign-key
   integrity, and the holdings workspace endpoint against the staging database.
7. Move the original active database files to the backup set and move the
   verified staging database into the active `data/ironman.sqlite` path.
8. Start the backend and frontend, then verify health and the authenticated
   holdings workspace request.

## Error Handling And Rollback

- Unknown ledger types, missing referenced transactions, count mismatches,
  foreign-key violations, or failed endpoint verification abort the cutover.
- The original database remains untouched until staging validation succeeds.
- If an error occurs after switching paths, restore the timestamped backup and
  restart the backend.
- Startup detects migration versions greater than the largest migration in the
  checked-out code and fails with a direct compatibility error.

## Acceptance Criteria

- A timestamped backup exists and can be opened by SQLite.
- The replacement database reports only `master` migration versions 1 through 11.
- Users, instruments, cash accounts, ledger rows, holdings, holding
  transactions, watchlist entries, and other compatible records retain their
  row counts and relationships.
- Every ledger row uses a valid legacy category and has a valid linked holding
  reference where its type requires one.
- `PRAGMA foreign_key_check` returns no rows.
- The holdings workspace returns HTTP 200 for an authenticated user.
- Starting an older branch against a newer database returns a schema-version
  compatibility error rather than serving requests with an incompatible schema.

## Tests

- A migration test builds a forward-style source database containing each
  supported ledger type, runs recovery, and asserts the legacy ledger mapping.
- The test asserts source data is unchanged, target migration versions are 1
  through 11, and foreign-key checks pass.
- An API test verifies the recovered database serves the Batman holdings
  workspace and preserves user isolation.
- A database initialization test verifies the forward-version guard rejects a
  database whose migration ledger is newer than the current source.
