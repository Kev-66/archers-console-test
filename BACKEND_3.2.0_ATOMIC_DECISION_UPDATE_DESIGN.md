# Draft a Dynasty Backend 3.2.0

## Atomic Decision Queue Updates

Status: **Proposed design**

## Purpose

Add one protected write operation, `update_decision`, that changes exactly one record inside the authoritative `decision_queue/decision-queue` resource without requiring the caller to resend or replace the full queue.

This completes the three-call decision workflow:

1. `decision_context`
2. `executeArchersOperation` with `operation: update_decision`
3. `operation_verification`

## Why this is needed

The current backend can read one decision safely through `decision_context`, but a decision write still uses generic resource replacement. Replacing the full Decision Queue makes unrelated decisions part of the write surface and increases the chance of stale data, omitted records, or accidental edits.

`update_decision` narrows the mutation boundary to one stable `decision_id` while preserving every unrelated queue item byte-for-byte.

## Proposed operation

```json
{
  "operation": "update_decision",
  "resource_type": "decision_queue",
  "resource_id": "decision-queue",
  "expected_version": 5,
  "expected_state_version": 34,
  "idempotency_key": "decision-update-example-v1-20260730",
  "summary": "Resolve example decision",
  "source_label": "USER_EXPLICIT",
  "exact_kevin_text": null,
  "dry_run": false,
  "payload": {
    "decision_id": "example-decision",
    "changes": {
      "status": "RESOLVED",
      "resolution": {
        "summary": "Approved the verified option.",
        "resolved_week": 3
      }
    },
    "history_entry": {
      "status": "RESOLVED",
      "note": "Approved the verified option.",
      "state_version": null
    }
  }
}
```

## Required top-level fields

- `operation: update_decision`
- `resource_type: decision_queue`
- `resource_id: decision-queue`
- `expected_version`: current Decision Queue resource version
- `expected_state_version`: current global franchise state version
- unique `idempotency_key`
- non-empty `summary`
- valid `source_label`
- `dry_run`
- native JSON `payload`

## Required payload fields

- `decision_id`: non-empty stable decision identifier
- `changes`: non-empty object containing only allowed mutable decision fields

Optional:

- `history_entry`: one history object to append after successful validation

## Allowed mutable fields

Initial version:

- `status`
- `priority`
- `summary`
- `due_date`
- `due_week`
- `deadline_label`
- `review_after`
- `choices`
- `recommended_action`
- `decision_question`
- `resolution`
- `note`
- `evidence_boundaries`
- `related_resource_refs`
- `related_player_resource_ids`
- `approval_required`
- `approval_owner`

Fields such as `decision_id`, `created_at`, `created_week`, `created_state_version`, and source provenance IDs must not be changed by this operation.

## Status rules

Supported normalized statuses:

- `OPEN`
- `READY_FOR_REVIEW`
- `AWAITING_KEVIN`
- `BLOCKED`
- `DEFERRED`
- `RESOLVED`
- `WITHDRAWN`
- `EXPIRED`

Rules:

1. Status values are normalized to uppercase.
2. A transition to `RESOLVED`, `WITHDRAWN`, or `EXPIRED` requires a non-null `resolution` object or an existing resolution already on the record.
3. A transition from a terminal status back to a non-terminal status requires `source_label: CORRECTION`.
4. `history_entry.status`, when supplied, must match the resulting decision status.
5. The backend supplies the resulting state version to the appended history entry. A caller-provided null placeholder is accepted; a conflicting numeric value is rejected.

## Atomic behavior

Inside one database transaction, the dedicated `archers_update_decision` RPC must:

1. Lock the franchise state row and Decision Queue resource row.
2. Verify `expected_state_version`.
3. Verify Decision Queue `expected_version`.
4. Verify exactly one decision matches `decision_id`.
5. Reject duplicate decision IDs anywhere in the queue.
6. Validate the requested field set and status transition.
7. Replace only the selected decision object in the queue array.
8. Preserve the order and content of every unrelated decision.
9. Increment the Decision Queue resource version once.
10. Increment the global franchise state version once.
11. Fill the appended history entry with the resulting state version.
12. Write one audit operation and one canon event.
13. Return the updated decision, queue version, resulting state version, operation ID, and event ID.

Any failure rolls back the entire transaction.

## Expected success response

```json
{
  "operation": "update_decision",
  "operation_id": 35,
  "event_id": 35,
  "state_version": 35,
  "resource_type": "decision_queue",
  "resource_id": "decision-queue",
  "resource_version": 6,
  "decision_id": "example-decision",
  "decision": {},
  "updated_fields": ["status", "resolution"],
  "unrelated_decisions_preserved": true,
  "idempotent_replay": false
}
```

## Required failures

Return a protected `409` or validation `400` without changing state for:

- stale global state version
- stale Decision Queue version
- missing Decision Queue resource
- missing `decision_id`
- no matching decision
- duplicate matching decision IDs
- empty `changes`
- unsupported mutable field
- attempted identity or creation-provenance edit
- invalid status
- invalid terminal transition
- mismatched history status
- idempotency key reused for a different request

## Dry-run behavior

`dry_run: true` must perform all deterministic validation that does not require committing a write. It should return:

- current state and queue versions
- selected current decision
- normalized proposed decision
- updated field names
- validation result
- note that no database write occurred

A stale expected version must still fail the dry run. Dry run must never reserve the idempotency key or write audit/canon records.

## Edge Function changes

Backend version: `3.2.0`

1. Add `update_decision` to `WRITE_OPERATIONS`.
2. Add capability feature `ATOMIC_DECISION_UPDATE`.
3. Add safeguard `DECISION_IDENTITY_PRESERVATION`.
4. Add operation-specific request checks before the RPC:
   - exact Decision Queue resource target
   - required `expected_version`
   - required `expected_state_version`
   - payload object with `decision_id` and non-empty `changes`
5. Preserve native JSON payload handling.
6. Preserve the existing RPC fallback policy only for operations supported by the legacy signature. `update_decision` must never silently fall back to a database function version that does not implement it.

## Database changes

Create a versioned SQL migration that adds a dedicated `archers_update_decision` RPC. The unified Edge endpoint routes only `update_decision` to it; existing `archers_execute_operation` behavior remains unchanged.

The SQL migration must be committed to GitHub. The Edge Function source alone is not sufficient evidence of the database behavior.

No table migration is expected if the Decision Queue remains stored as a versioned JSON resource.

## OpenAPI and GPT instruction impact

The current compact OpenAPI request accepts `operation` as a string, so no structural OpenAPI change is required for transport compatibility.

For clear documentation, publish a schema metadata revision only if desired. Do not reinstall the GPT schema solely for this operation unless the installed schema constrains the operation with an enum.

The Custom GPT instruction allowlist must add `update_decision`. This is a tiny text-only revision and must remain within the 8,000-character limit.

## Verification compatibility

After a successful write, call `operation_verification` with:

- `operation_id` or `idempotency_key`
- `decision_id`
- `resource_type: decision_queue`
- `resource_id: decision-queue`

Pass conditions:

- `verified: true`
- resulting state version reached
- one canon event
- one unique affected Decision Queue resource
- updated `decision_record` found
- no unrelated queue-wide unresolved issues
- Decision Queue resource version incremented exactly once

## Regression test matrix

### Local or isolated database tests

1. Update one non-terminal decision field.
2. Resolve one decision and append history.
3. Defer one decision.
4. Preserve all unrelated decisions exactly.
5. Reject missing decision ID.
6. Reject duplicate decision IDs.
7. Reject stale state version.
8. Reject stale queue version.
9. Reject forbidden field mutation.
10. Reject terminal reopening without `CORRECTION`.
11. Confirm identical idempotent replay does not duplicate audit/canon effects.
12. Confirm reused idempotency key with different payload fails.
13. Confirm dry run writes nothing.

### Live production verification

Use a reversible, purpose-created `system_test` Decision Queue item or another explicitly approved non-story test record. Do not alter an active franchise decision merely to test infrastructure.

1. Read capabilities and confirm backend `3.2.0` plus `ATOMIC_DECISION_UPDATE`.
2. Read the exact Decision Queue and record versions.
3. Dry-run one atomic update.
4. Execute the approved test update.
5. Verify through `operation_verification`.
6. Confirm unrelated decisions are unchanged.
7. Clean up the test record through another verified atomic update or approved queue maintenance operation.

## Deployment order

1. Commit design and implementation on a feature branch.
2. Add the SQL migration and updated Edge Function source.
3. Run parser and isolated regression tests.
4. Apply the SQL migration.
5. Deploy the Edge Function.
6. Verify capabilities.
7. Run the dry-run test.
8. Run one approved live atomic update.
9. Run `operation_verification`.
10. Update the GPT instruction allowlist.
11. Merge only after live verification evidence is recorded.

## Non-goals for 3.2.0

- No arbitrary JSON Patch support.
- No multi-decision bulk update.
- No automatic roster, contract, or medical side effects.
- No implicit decision creation.
- No hard deletion of decisions.
- No direct standings or unrelated resource changes.

Those changes require separate explicit operations or approval.