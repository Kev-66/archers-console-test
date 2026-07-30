# Decision Queue v1

## Canonical resource

- `resource_type`: `decision_queue`
- `resource_id`: `decision-queue`
- `status`: `ACTIVE`
- `visibility`: `CONSOLE`
- `profile_schema_version`: `1`

## Purpose

Decision Queue is the durable lifecycle record for franchise choices that require review, approval, deferral, or resolution. It replaces the snapshot-only `open_decisions` list as the authoritative source while preserving snapshot fallback for compatibility.

## Lifecycle

Supported statuses:

- `OPEN`
- `READY_FOR_REVIEW`
- `AWAITING_KEVIN`
- `BLOCKED`
- `DEFERRED`
- `RESOLVED`
- `WITHDRAWN`
- `EXPIRED`

Open views include the first five statuses. Resolved, withdrawn, and expired decisions remain in the resource as history.

## Required behavior

1. Every decision has a stable, unique `decision_id`.
2. Kevin Dorey remains the approval owner for decisions requiring user control.
3. The public console never executes a canon write.
4. Choices must not claim unsupported consequences.
5. Relevant player and resource links use verified IDs only.
6. A resolution records its audit operation, canon event, resulting state version, and related transaction IDs when available.
7. Decisions are not deleted after resolution.
8. Status corrections are appended to `history`; prior states are not silently erased.
9. Unknown deadlines, choices, consequences, or evidence remain null, omitted, or explicitly unresolved.

## Console behavior

Before the structured resource exists, Weekly Ops and Front Office continue to use the current snapshot's `open_decisions` list.

Once `decision_queue / decision-queue` exists, the live adapter:

- replaces Weekly Ops open-decision cards,
- selects the highest-priority next action,
- updates the Weekly Ops open-decision metric,
- updates the Front Office personnel decision list,
- exposes recorded choices and evidence boundaries in a read-only review dialog,
- prepares a copyable authenticated-GPT handoff,
- updates through Supabase Realtime.

## Resolution rule

A decision should be marked `RESOLVED` only after the authenticated operation succeeds and the affected resources are verified. The resolution should link the audit operation, canon event, resulting state version, and any transaction-ledger record created by the action.
