import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

type SqlParameters = Record<string, string | number | bigint | boolean | null | Uint8Array> | Array<string | number | bigint | boolean | null | Uint8Array>;

interface Migration {
  version: number;
  sql: string;
}

const migrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
        status TEXT NOT NULL CHECK (status IN ('active', 'disabled')) DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id, expires_at);

      CREATE TABLE IF NOT EXISTS user_settings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        setting_key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, setting_key)
      );
      CREATE INDEX IF NOT EXISTS user_settings_owner_idx ON user_settings(user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs(actor_id, created_at DESC);
    `
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS instruments (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        exchange TEXT NOT NULL CHECK (exchange IN ('sh', 'sz', 'bj', 'fund')),
        name TEXT NOT NULL,
        asset_type TEXT NOT NULL CHECK (asset_type IN ('stock', 'index', 'fund')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(code, exchange)
      );
      CREATE INDEX IF NOT EXISTS instruments_search_idx ON instruments(code, name);

      CREATE TABLE IF NOT EXISTS market_bars (
        id TEXT PRIMARY KEY,
        instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
        timeframe TEXT NOT NULL CHECK (timeframe IN ('day', 'week', 'month')),
        source TEXT NOT NULL,
        trade_date TEXT NOT NULL,
        open REAL NOT NULL,
        close REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        volume REAL NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(instrument_id, timeframe, source, trade_date)
      );
      CREATE INDEX IF NOT EXISTS market_bars_lookup_idx ON market_bars(instrument_id, timeframe, source, trade_date DESC);

      CREATE TABLE IF NOT EXISTS watchlist_entries (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE RESTRICT,
        note TEXT NOT NULL DEFAULT '',
        target_price REAL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, instrument_id)
      );
      CREATE INDEX IF NOT EXISTS watchlist_entries_owner_idx ON watchlist_entries(user_id, sort_order, created_at DESC);

      CREATE TABLE IF NOT EXISTS cash_accounts (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        available REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cash_ledger (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount REAL NOT NULL,
        category TEXT NOT NULL CHECK (category IN ('adjustment', 'buy', 'sell', 'dividend')),
        reference_id TEXT,
        note TEXT NOT NULL DEFAULT '',
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS cash_ledger_owner_idx ON cash_ledger(user_id, occurred_at DESC);

      CREATE TABLE IF NOT EXISTS holdings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE RESTRICT,
        status TEXT NOT NULL CHECK (status IN ('active', 'closed')) DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS holdings_active_unique_idx ON holdings(user_id, instrument_id) WHERE status = 'active';
      CREATE INDEX IF NOT EXISTS holdings_owner_idx ON holdings(user_id, status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS holding_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        holding_id TEXT NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
        action TEXT NOT NULL CHECK (action IN ('buy', 'sell', 'dividend')),
        quantity REAL NOT NULL DEFAULT 0,
        price REAL NOT NULL DEFAULT 0,
        fee REAL NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS holding_transactions_owner_idx ON holding_transactions(user_id, holding_id, occurred_at ASC);
    `
  },
  {
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS strategies (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        instrument_ids_json TEXT NOT NULL,
        indicators_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, name)
      );
      CREATE INDEX IF NOT EXISTS strategies_owner_idx ON strategies(user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS analysis_tasks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        strategy_id TEXT NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
        error_message TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS analysis_tasks_owner_idx ON analysis_tasks(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS analysis_reports (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES analysis_tasks(id) ON DELETE CASCADE,
        instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE RESTRICT,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(task_id, instrument_id)
      );
      CREATE INDEX IF NOT EXISTS analysis_reports_owner_idx ON analysis_reports(user_id, task_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('analysis', 'alert-scan')),
        strategy_id TEXT REFERENCES strategies(id) ON DELETE SET NULL,
        interval_minutes INTEGER NOT NULL CHECK (interval_minutes BETWEEN 1 AND 10080),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        last_run_at TEXT,
        next_run_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS scheduled_jobs_due_idx ON scheduled_jobs(enabled, next_run_at);
      CREATE INDEX IF NOT EXISTS scheduled_jobs_owner_idx ON scheduled_jobs(user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE RESTRICT,
        direction TEXT NOT NULL CHECK (direction IN ('above', 'below')),
        threshold REAL NOT NULL,
        cooldown_minutes INTEGER NOT NULL DEFAULT 60 CHECK (cooldown_minutes BETWEEN 1 AND 10080),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        last_triggered_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS alerts_owner_idx ON alerts(user_id, enabled, updated_at DESC);

      CREATE TABLE IF NOT EXISTS alert_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        alert_id TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
        price REAL NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS alert_events_owner_idx ON alert_events(user_id, created_at DESC);
    `
  },
  {
    version: 4,
    sql: `
      CREATE TABLE IF NOT EXISTS task_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES analysis_tasks(id) ON DELETE CASCADE,
        level TEXT NOT NULL CHECK (level IN ('info', 'error')),
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS task_logs_owner_idx ON task_logs(user_id, task_id, created_at ASC);
    `
  },
  {
    version: 5,
    sql: `
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        instrument_id TEXT REFERENCES instruments(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS notes_owner_idx ON notes(user_id, updated_at DESC);
    `
  },
  {
    version: 6,
    sql: `
      ALTER TABLE cash_ledger ADD COLUMN holding_transaction_id TEXT;
      CREATE INDEX IF NOT EXISTS cash_ledger_transaction_idx ON cash_ledger(user_id, holding_transaction_id);

      UPDATE cash_ledger
         SET holding_transaction_id = (
           SELECT holding_transactions.id
             FROM holding_transactions
            WHERE holding_transactions.user_id = cash_ledger.user_id
              AND holding_transactions.holding_id = cash_ledger.reference_id
              AND holding_transactions.action = cash_ledger.category
              AND holding_transactions.occurred_at = cash_ledger.occurred_at
              AND ABS(cash_ledger.amount - CASE holding_transactions.action
                WHEN 'buy' THEN -(holding_transactions.quantity * holding_transactions.price + holding_transactions.fee)
                WHEN 'sell' THEN holding_transactions.quantity * holding_transactions.price - holding_transactions.fee
                ELSE holding_transactions.price - holding_transactions.fee
              END) < 0.000001
            ORDER BY holding_transactions.id ASC
            LIMIT 1
         )
       WHERE holding_transaction_id IS NULL
         AND reference_id IS NOT NULL
         AND category IN ('buy', 'sell', 'dividend');
    `
  },
  {
    version: 7,
    sql: `
      CREATE TABLE IF NOT EXISTS trend_strategies (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        remarks TEXT NOT NULL DEFAULT '',
        target_scope TEXT NOT NULL CHECK (target_scope IN ('holdings', 'watchlist', 'custom', 'all', 'holdings_watchlist')),
        data_range_json TEXT NOT NULL,
        report_window TEXT NOT NULL CHECK (report_window IN ('1d', '3d', '7d', '30d', 'all')),
        backtest_config_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, name)
      );
      CREATE INDEX IF NOT EXISTS trend_strategies_owner_idx ON trend_strategies(user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS trend_strategy_targets (
        strategy_id TEXT NOT NULL REFERENCES trend_strategies(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        PRIMARY KEY(strategy_id, instrument_id)
      );
      CREATE INDEX IF NOT EXISTS trend_strategy_targets_owner_idx ON trend_strategy_targets(user_id, strategy_id);

      CREATE TABLE IF NOT EXISTS trend_strategy_indicators (
        id TEXT PRIMARY KEY,
        strategy_id TEXT NOT NULL REFERENCES trend_strategies(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        indicator_id TEXT NOT NULL,
        parameters_json TEXT NOT NULL,
        display_order INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(strategy_id, indicator_id)
      );
      CREATE INDEX IF NOT EXISTS trend_strategy_indicators_owner_idx ON trend_strategy_indicators(user_id, strategy_id, display_order);

      CREATE TABLE IF NOT EXISTS trend_runs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        strategy_id TEXT NOT NULL REFERENCES trend_strategies(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
        target_total INTEGER NOT NULL DEFAULT 0,
        target_completed INTEGER NOT NULL DEFAULT 0,
        target_snapshot_json TEXT NOT NULL,
        error_message TEXT,
        cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS trend_runs_owner_idx ON trend_runs(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS trend_run_reports (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES trend_runs(id) ON DELETE CASCADE,
        instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE RESTRICT,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(run_id, instrument_id)
      );
      CREATE INDEX IF NOT EXISTS trend_run_reports_owner_idx ON trend_run_reports(user_id, run_id, created_at ASC);

      CREATE TABLE IF NOT EXISTS trend_run_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES trend_runs(id) ON DELETE CASCADE,
        level TEXT NOT NULL CHECK (level IN ('info', 'error')),
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS trend_run_logs_owner_idx ON trend_run_logs(user_id, run_id, created_at ASC);
    `
  },
  {
    version: 8,
    sql: `
      CREATE TABLE IF NOT EXISTS assistant_conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS assistant_conversations_owner_idx ON assistant_conversations(user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS assistant_messages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        result_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS assistant_messages_conversation_idx ON assistant_messages(user_id, conversation_id, created_at ASC);
    `
  },
  {
    version: 9,
    sql: `
      ALTER TABLE alert_events RENAME TO legacy_alert_events;
      ALTER TABLE alerts RENAME TO legacy_alerts;

      CREATE TABLE IF NOT EXISTS alert_rules (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('price_threshold', 'target_price', 'trade_plan')),
        source TEXT NOT NULL CHECK (source IN ('manual', 'system')),
        severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'risk')),
        instrument_id TEXT REFERENCES instruments(id) ON DELETE SET NULL,
        scope_type TEXT NOT NULL CHECK (scope_type IN ('instrument', 'watchlist', 'holdings', 'custom')),
        condition_json TEXT NOT NULL,
        cooldown_minutes INTEGER NOT NULL DEFAULT 60 CHECK (cooldown_minutes BETWEEN 1 AND 10080),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        last_triggered_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS alert_rules_owner_idx ON alert_rules(user_id, enabled, updated_at DESC);
      CREATE INDEX IF NOT EXISTS alert_rules_instrument_idx ON alert_rules(user_id, instrument_id, kind);

      CREATE TABLE IF NOT EXISTS alert_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rule_id TEXT REFERENCES alert_rules(id) ON DELETE SET NULL,
        instrument_id TEXT REFERENCES instruments(id) ON DELETE SET NULL,
        severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'risk')),
        status TEXT NOT NULL CHECK (status IN ('unread', 'read', 'acknowledged', 'snoozed', 'resolved')),
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        price REAL,
        snapshot_json TEXT NOT NULL,
        dedupe_key TEXT NOT NULL,
        triggered_at TEXT NOT NULL,
        read_at TEXT,
        acknowledged_at TEXT,
        resolved_at TEXT,
        snoozed_until TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, dedupe_key)
      );
      CREATE INDEX IF NOT EXISTS alert_events_owner_idx ON alert_events(user_id, status, triggered_at DESC);
      CREATE INDEX IF NOT EXISTS alert_events_rule_idx ON alert_events(user_id, rule_id, triggered_at DESC);

      CREATE TABLE IF NOT EXISTS alert_suggestions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source TEXT NOT NULL CHECK (source IN ('trend', 'watchlist', 'holding', 'system')),
        instrument_id TEXT REFERENCES instruments(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'risk')),
        rule_kind TEXT NOT NULL CHECK (rule_kind IN ('price_threshold', 'target_price', 'trade_plan')),
        condition_json TEXT NOT NULL,
        cooldown_minutes INTEGER NOT NULL DEFAULT 60 CHECK (cooldown_minutes BETWEEN 1 AND 10080),
        status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'ignored')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        accepted_at TEXT,
        ignored_at TEXT
      );
      CREATE INDEX IF NOT EXISTS alert_suggestions_owner_idx ON alert_suggestions(user_id, status, updated_at DESC);

      INSERT OR IGNORE INTO alert_rules (
        id, user_id, name, kind, source, severity, instrument_id, scope_type, condition_json, cooldown_minutes, enabled, last_triggered_at, created_at, updated_at
      )
      SELECT
        legacy_alerts.id,
        legacy_alerts.user_id,
        instruments.name || ' 价格提醒',
        'price_threshold',
        'manual',
        'warning',
        legacy_alerts.instrument_id,
        'instrument',
        json_object('direction', legacy_alerts.direction, 'threshold', legacy_alerts.threshold),
        legacy_alerts.cooldown_minutes,
        legacy_alerts.enabled,
        legacy_alerts.last_triggered_at,
        legacy_alerts.created_at,
        legacy_alerts.updated_at
      FROM legacy_alerts
      JOIN instruments ON instruments.id = legacy_alerts.instrument_id;

      INSERT OR IGNORE INTO alert_events (
        id, user_id, rule_id, instrument_id, severity, status, title, message, price, snapshot_json, dedupe_key, triggered_at, created_at
      )
      SELECT
        legacy_alert_events.id,
        legacy_alert_events.user_id,
        legacy_alert_events.alert_id,
        legacy_alerts.instrument_id,
        'warning',
        'unread',
        instruments.name || ' 价格提醒',
        legacy_alert_events.message,
        legacy_alert_events.price,
        json_object('legacyAlertId', legacy_alert_events.alert_id),
        legacy_alert_events.alert_id || ':' || legacy_alert_events.created_at,
        legacy_alert_events.created_at,
        legacy_alert_events.created_at
      FROM legacy_alert_events
      JOIN legacy_alerts ON legacy_alerts.id = legacy_alert_events.alert_id
      JOIN instruments ON instruments.id = legacy_alerts.instrument_id;
    `
  },
  {
    version: 10,
    sql: `
      CREATE TABLE IF NOT EXISTS trend_run_report_interpretations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES trend_runs(id) ON DELETE CASCADE,
        report_id TEXT NOT NULL REFERENCES trend_run_reports(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider IN ('local', 'deepseek', 'ollama', 'openai_compatible')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(report_id)
      );
      CREATE INDEX IF NOT EXISTS trend_run_report_interpretations_owner_idx ON trend_run_report_interpretations(user_id, run_id, created_at DESC);
    `
  },
  {
    version: 11,
    sql: `
      CREATE TABLE IF NOT EXISTS fund_daily_metrics (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        trade_date TEXT NOT NULL,
        cash_available REAL NOT NULL,
        principal REAL NOT NULL,
        market_value REAL NOT NULL,
        total_assets REAL NOT NULL,
        external_cash_flow REAL NOT NULL,
        daily_profit REAL,
        daily_return REAL,
        performance_index REAL NOT NULL,
        cumulative_profit REAL NOT NULL,
        cumulative_profit_rate REAL,
        instrument_count INTEGER NOT NULL,
        priced_count INTEGER NOT NULL,
        carried_price_count INTEGER NOT NULL,
        missing_price_count INTEGER NOT NULL,
        data_status TEXT NOT NULL CHECK (data_status IN ('complete', 'partial')),
        calculation_version INTEGER NOT NULL,
        calculated_at TEXT NOT NULL,
        PRIMARY KEY(user_id, trade_date)
      );
      CREATE INDEX IF NOT EXISTS fund_daily_metrics_owner_idx ON fund_daily_metrics(user_id, trade_date DESC);

      CREATE TABLE IF NOT EXISTS fund_history_state (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        covered_from TEXT,
        covered_to TEXT,
        dirty_from TEXT,
        status TEXT NOT NULL CHECK (status IN ('idle', 'calculating', 'dirty', 'failed')) DEFAULT 'idle',
        last_error TEXT,
        calculation_version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
    `
  },
  {
    version: 12,
    sql: `
      CREATE TABLE IF NOT EXISTS market_intraday_snapshots (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
        captured_at TEXT NOT NULL,
        captured_minute TEXT NOT NULL,
        trade_date TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('mock', 'tencent', 'eastmoney', 'akshare')),
        capture_mode TEXT NOT NULL CHECK (capture_mode IN ('auto', 'manual')),
        open REAL NOT NULL,
        close REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        volume REAL NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, instrument_id, captured_minute)
      );
      CREATE INDEX IF NOT EXISTS market_intraday_snapshots_series_idx
        ON market_intraday_snapshots(user_id, instrument_id, captured_at ASC);
      CREATE INDEX IF NOT EXISTS market_intraday_snapshots_retention_idx
        ON market_intraday_snapshots(user_id, captured_at ASC);

      CREATE TABLE IF NOT EXISTS market_snapshot_states (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        last_attempt_at TEXT,
        last_success_at TEXT,
        last_capture_mode TEXT CHECK (last_capture_mode IN ('auto', 'manual')),
        last_target_count INTEGER NOT NULL DEFAULT 0,
        last_captured_count INTEGER NOT NULL DEFAULT 0,
        last_skipped_count INTEGER NOT NULL DEFAULT 0,
        last_failed_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        last_cleanup_trade_date TEXT,
        updated_at TEXT NOT NULL
      );
    `
  },
  {
    version: 13,
    sql: `
      CREATE TABLE IF NOT EXISTS holding_diagnosis_runs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'scheduled')),
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')),
        progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
        scheduled_trade_date TEXT,
        settings_snapshot_json TEXT NOT NULL,
        model_snapshot_json TEXT NOT NULL,
        error_message TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, trigger, scheduled_trade_date)
      );
      CREATE INDEX IF NOT EXISTS holding_diagnosis_runs_owner_idx
        ON holding_diagnosis_runs(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS holding_diagnosis_reports (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL UNIQUE REFERENCES holding_diagnosis_runs(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        summary_json TEXT NOT NULL,
        market_as_of TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS holding_diagnosis_reports_owner_idx
        ON holding_diagnosis_reports(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS holding_diagnosis_items (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        report_id TEXT NOT NULL REFERENCES holding_diagnosis_reports(id) ON DELETE CASCADE,
        instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
        data_snapshot_json TEXT NOT NULL,
        chart_snapshot_json TEXT NOT NULL,
        analysis_json TEXT NOT NULL,
        recommendation_direction TEXT NOT NULL CHECK (recommendation_direction IN ('add_evaluation', 'reduce_evaluation', 'hold', 'observe', 'research_further')),
        recommendation_price_json TEXT NOT NULL,
        valid_until TEXT,
        data_quality TEXT NOT NULL CHECK (data_quality IN ('complete', 'partial', 'stale', 'unavailable')),
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS holding_diagnosis_items_report_idx
        ON holding_diagnosis_items(user_id, report_id, instrument_id);

      CREATE TABLE IF NOT EXISTS holding_diagnosis_sources (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        report_id TEXT NOT NULL REFERENCES holding_diagnosis_reports(id) ON DELETE CASCADE,
        item_id TEXT REFERENCES holding_diagnosis_items(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL,
        source_name TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK (source_type IN ('market', 'disclosure', 'news', 'reference')),
        title TEXT NOT NULL,
        published_at TEXT,
        fetched_at TEXT NOT NULL,
        availability TEXT NOT NULL CHECK (availability IN ('available', 'stale', 'failed', 'link_only')),
        url TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS holding_diagnosis_sources_report_idx
        ON holding_diagnosis_sources(user_id, report_id, item_id);
    `
  },
  {
    version: 14,
    sql: `
      ALTER TABLE holding_diagnosis_sources ADD COLUMN external_id TEXT;
      ALTER TABLE holding_diagnosis_sources ADD COLUMN origin TEXT;
      ALTER TABLE holding_diagnosis_sources ADD COLUMN content_hash TEXT;
      ALTER TABLE holding_diagnosis_sources ADD COLUMN retrieved_at TEXT;
      ALTER TABLE holding_diagnosis_sources ADD COLUMN summary_kind TEXT;
      ALTER TABLE holding_diagnosis_sources ADD COLUMN source_insight_json TEXT;
    `
  },
  {
    version: 15,
    sql: `
      ALTER TABLE market_bars ADD COLUMN amount REAL;
      ALTER TABLE market_bars ADD COLUMN turnover_rate REAL;

      CREATE TABLE IF NOT EXISTS ai_candidate_runs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'scheduled')),
        trade_date TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')),
        progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
        requested_top_n INTEGER NOT NULL CHECK (requested_top_n IN (5, 10, 20)),
        strategies_json TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        market_regime_json TEXT NOT NULL,
        data_quality_json TEXT NOT NULL,
        model_snapshot_json TEXT NOT NULL,
        error_message TEXT,
        cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS ai_candidate_runs_owner_idx ON ai_candidate_runs(user_id, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS ai_candidate_active_run_idx
        ON ai_candidate_runs(user_id, trigger, trade_date)
        WHERE status IN ('queued', 'running');

      CREATE TABLE IF NOT EXISTS ai_candidate_items (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES ai_candidate_runs(id) ON DELETE CASCADE,
        instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE RESTRICT,
        strategy TEXT NOT NULL CHECK (strategy IN ('trend_event', 'quality_growth', 'value_repair')),
        rank INTEGER,
        score REAL NOT NULL,
        percentile REAL NOT NULL,
        selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1)),
        score_snapshot_json TEXT NOT NULL,
        evidence_snapshot_json TEXT NOT NULL,
        explanation_json TEXT,
        ai_status TEXT NOT NULL CHECK (ai_status IN ('pending', 'completed', 'local', 'unavailable')),
        data_quality TEXT NOT NULL CHECK (data_quality IN ('complete', 'partial', 'stale', 'unavailable')),
        rejection_reason TEXT,
        cycle_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ai_candidate_items_run_idx ON ai_candidate_items(user_id, run_id, strategy, selected, score DESC);
      CREATE INDEX IF NOT EXISTS ai_candidate_items_instrument_idx ON ai_candidate_items(user_id, instrument_id, strategy, created_at DESC);

      CREATE TABLE IF NOT EXISTS ai_candidate_cycles (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        strategy TEXT NOT NULL CHECK (strategy IN ('trend_event', 'quality_growth', 'value_repair')),
        instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE RESTRICT,
        first_item_id TEXT NOT NULL REFERENCES ai_candidate_items(id) ON DELETE CASCADE,
        latest_item_id TEXT NOT NULL REFERENCES ai_candidate_items(id) ON DELETE CASCADE,
        state TEXT NOT NULL CHECK (state IN ('waiting_entry', 'tracking', 'matured', 'invalidated', 'not_executable', 'indeterminate')),
        signal_date TEXT NOT NULL,
        entry_date TEXT,
        entry_price REAL,
        valid_until TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS ai_candidate_active_cycle_idx ON ai_candidate_cycles(user_id, strategy, instrument_id) WHERE state IN ('waiting_entry', 'tracking');

      CREATE TABLE IF NOT EXISTS ai_candidate_evaluations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL REFERENCES ai_candidate_items(id) ON DELETE CASCADE,
        cycle_id TEXT REFERENCES ai_candidate_cycles(id) ON DELETE SET NULL,
        horizon INTEGER NOT NULL CHECK (horizon IN (5, 10, 20)),
        state TEXT NOT NULL CHECK (state IN ('pending', 'matured', 'not_executable', 'indeterminate', 'invalidated', 'insufficient_data')),
        target_date TEXT,
        actual_date TEXT,
        entry_price REAL,
        exit_price REAL,
        benchmark_return REAL,
        industry_return REAL,
        gross_return REAL,
        net_return REAL,
        market_excess_return REAL,
        industry_excess_return REAL,
        mfe REAL,
        mae REAL,
        max_drawdown REAL,
        invalidation_result INTEGER,
        data_quality TEXT NOT NULL CHECK (data_quality IN ('complete', 'partial', 'stale', 'unavailable')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(item_id, horizon)
      );
      CREATE INDEX IF NOT EXISTS ai_candidate_evaluations_owner_idx ON ai_candidate_evaluations(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS ai_candidate_run_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES ai_candidate_runs(id) ON DELETE CASCADE,
        level TEXT NOT NULL CHECK (level IN ('info', 'error')),
        stage TEXT NOT NULL,
        message TEXT NOT NULL,
        context_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ai_candidate_run_logs_idx ON ai_candidate_run_logs(user_id, run_id, created_at ASC);
    `
  },
  {
    version: 16,
    sql: `
      CREATE TABLE IF NOT EXISTS ai_candidate_daily_runs (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        trade_date TEXT NOT NULL,
        current_run_id TEXT NOT NULL REFERENCES ai_candidate_runs(id) ON DELETE RESTRICT,
        pending_run_id TEXT REFERENCES ai_candidate_runs(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(user_id, trade_date),
        UNIQUE(current_run_id)
      );
      CREATE INDEX IF NOT EXISTS ai_candidate_daily_runs_date_idx
        ON ai_candidate_daily_runs(user_id, trade_date DESC);

      WITH ranked AS (
        SELECT id, user_id, trade_date, created_at,
          ROW_NUMBER() OVER (
            PARTITION BY user_id, trade_date
            ORDER BY
              CASE WHEN status IN ('queued', 'running', 'completed', 'partial') THEN 0 ELSE 1 END,
              created_at DESC,
              id DESC
          ) AS row_num
        FROM ai_candidate_runs
      )
      INSERT OR IGNORE INTO ai_candidate_daily_runs (user_id, trade_date, current_run_id, pending_run_id, created_at, updated_at)
      SELECT user_id, trade_date, id, NULL, created_at, created_at
      FROM ranked
      WHERE row_num = 1;
    `
  },
  {
    version: 17,
    sql: `
      CREATE INDEX IF NOT EXISTS market_intraday_snapshots_trade_date_idx
        ON market_intraday_snapshots(user_id, trade_date ASC);
    `
  },
  {
    version: 18,
    sql: `
      CREATE TABLE trend_run_report_interpretations_widened (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES trend_runs(id) ON DELETE CASCADE,
        report_id TEXT NOT NULL REFERENCES trend_run_reports(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider IN ('local', 'deepseek', 'ollama', 'openai_compatible', 'opencode_go')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(report_id)
      );
      INSERT INTO trend_run_report_interpretations_widened (id, user_id, run_id, report_id, provider, content, created_at)
        SELECT id, user_id, run_id, report_id, provider, content, created_at
        FROM trend_run_report_interpretations;
      DROP TABLE trend_run_report_interpretations;
      ALTER TABLE trend_run_report_interpretations_widened RENAME TO trend_run_report_interpretations;
      CREATE INDEX IF NOT EXISTS trend_run_report_interpretations_owner_idx ON trend_run_report_interpretations(user_id, run_id, created_at DESC);
    `
  }
];

export const LATEST_SCHEMA_VERSION = migrations.at(-1)?.version ?? 0;

export class IronManDatabase {
  private readonly connection: Database;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.connection = new Database(databasePath, { create: true, strict: true });
    this.connection.run("PRAGMA foreign_keys = ON");
    this.connection.run("PRAGMA journal_mode = WAL");
    this.connection.run("PRAGMA busy_timeout = 5000");
    try {
      this.migrate();
    } catch (error) {
      this.connection.close();
      throw error;
    }
  }

  all<T>(sql: string, parameters: SqlParameters = {}): T[] {
    return this.connection.query(sql).all(parameters as never) as T[];
  }

  get<T>(sql: string, parameters: SqlParameters = {}): T | undefined {
    return (this.connection.query(sql).get(parameters as never) as T | null) ?? undefined;
  }

  run(sql: string, parameters: SqlParameters = {}): void {
    this.connection.query(sql).run(parameters as never);
  }

  transaction<T>(work: () => T): T {
    return this.connection.transaction(work)();
  }

  getAppliedMigrationVersions(): number[] {
    return this.all<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version ASC").map((row) => row.version);
  }

  close(): void {
    this.connection.run("PRAGMA wal_checkpoint(TRUNCATE)");
    this.connection.close();
  }

  private migrate(): void {
    this.connection.run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);

    const appliedVersions = this.all<{ version: number }>("SELECT version FROM schema_migrations").map((row) => row.version);
    const newestAppliedVersion = Math.max(0, ...appliedVersions);
    if (newestAppliedVersion > LATEST_SCHEMA_VERSION) {
      throw new Error(
        `Database schema version ${newestAppliedVersion} is newer than this application supports (${LATEST_SCHEMA_VERSION}). Switch to a compatible branch or recover the database before starting the service.`,
      );
    }
    const applied = new Set(appliedVersions);
    for (const migration of migrations) {
      if (applied.has(migration.version)) {
        continue;
      }

      this.transaction(() => {
        this.connection.run(migration.sql);
        this.connection.query("INSERT INTO schema_migrations (version, applied_at) VALUES ($version, $appliedAt)").run({
          version: migration.version,
          appliedAt: new Date().toISOString()
        });
      });
    }
  }
}
