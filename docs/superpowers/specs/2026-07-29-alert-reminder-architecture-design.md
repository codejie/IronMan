# Alert And Reminder Architecture Design

## Scope

Build the internal architecture for alerts and reminders with scheme B: a generic alert rule engine plus an in-app reminder center. External delivery channels such as email, webhook, SMS, desktop push, or broker integration are out of scope for this phase.

## Product Boundary

- Alert rules define what should be evaluated: target scope, condition, severity, cooldown, source, and enabled state.
- Reminder events are user-facing notifications produced by rule evaluation or system suggestions. Events can be unread, read, acknowledged, snoozed, or resolved.
- System suggestions are rule drafts produced by the application from watchlist, holdings, and trend-analysis context. The first phase stores and accepts suggestions; later phases can add more generators.
- Scheduled jobs continue to drive alert scanning, and scan runs should be observable through job status and event records.

## Backend Design

Add a new normalized model while keeping the legacy price alert endpoints compatible:

- `alert_rules`: generic rules owned by a user.
- `alert_events`: trigger records and in-app reminder state.
- `alert_suggestions`: system-created rule drafts that the user can accept or ignore.

Initial rule kinds:

- `price_threshold`: price above or below a threshold.
- `target_price`: compare latest price with a target price from the rule condition.
- `trade_plan`: a dated reminder for a planned buy, sell, review, or note.
- Additional kinds can be added behind the same evaluator interface.

The existing `/api/automation/alerts/create`, `/list`, `/evaluate`, and `/events/list` endpoints remain available. They map to the new rule/event model so current UI flows and tests keep working.

New APIs:

- `/api/automation/alerts/rules/create`
- `/api/automation/alerts/rules/list`
- `/api/automation/alerts/events/list`
- `/api/automation/alerts/events/update-status`
- `/api/automation/alerts/suggestions/create`
- `/api/automation/alerts/suggestions/list`
- `/api/automation/alerts/suggestions/accept`
- `/api/automation/alerts/settings/get`
- `/api/automation/alerts/settings/update`

## Frontend Design

Replace the reminder placeholder page with a real in-app center:

- Overview counters: unread reminders, active rules, pending system suggestions, latest trigger.
- Tabs: reminders, rules, suggestions.
- A compact rule creation form for price threshold, target price, and trade-plan reminders.
- Event actions: mark as read, acknowledge, resolve.
- Suggestion action: accept into a live rule.

The sidebar reminder entry stays as the global entry. It can later show unread badges after the unread-count API is added.

## Data And Reliability

- Every table carries `user_id`; all reads and mutations filter by current user.
- Rule conditions are stored as JSON but validated at service and API boundaries.
- Rule evaluation is idempotent through cooldown plus deterministic dedupe keys.
- Data-source failures should not create false events; failures are returned in scan summaries and can later be recorded as task logs.
- Backup/export must include the new user-owned alert tables.

## Testing

Backend tests cover:

- Legacy price alert compatibility.
- Generic rule creation and evaluation.
- Event state transitions.
- User isolation for events and suggestions.
- System suggestion acceptance creates an enabled rule.

Frontend tests cover:

- Reminder center loads rules, events, suggestions, and settings.
- Creating a manual rule uses the new API.
- Event actions call status updates.
- Accepting a system suggestion refreshes rules and suggestions.
