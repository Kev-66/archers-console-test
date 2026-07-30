# Draft a Dynasty Backend 3.2.0 Deployment Guide

## Status

Backend 3.2.0 is implemented on draft PR #5 and has passed isolated PostgreSQL 16 regressions plus TypeScript parser validation.

It is **not live** until both deployment stages below are completed and verified.

## Files

- SQL migration: `phase3-2-atomic-decision-update.sql`
- Versioned Edge source: `archers-franchise-index-v3.2.0.ts`
- Canonical Edge source: `edge-function-archers-franchise.ts`
- Design: `BACKEND_3.2.0_ATOMIC_DECISION_UPDATE_DESIGN.md`

The two Edge source files must remain identical.

## Stage 1: Apply the SQL migration

In the Supabase SQL Editor for the Archers project:

1. Open `phase3-2-atomic-decision-update.sql` from PR #5.
2. Copy the complete file exactly.
3. Run it once.
4. Confirm the transaction completes without an error.

The migration creates or replaces only:

```text
public.archers_update_decision(
  text,
  text,
  jsonb,
  integer,
  integer,
  text,
  text,
  text,
  text,
  boolean
)
```

It does not replace `archers_execute_operation`, change a table, or modify live franchise records.

Do not deploy the Edge Function if the SQL migration fails.

## Stage 2: Deploy the Edge Function

After the SQL migration succeeds:

1. Open the deployed `archers-franchise` Edge Function.
2. Replace its source with the complete contents of `archers-franchise-index-v3.2.0.ts` from PR #5.
3. Deploy the function.
4. Do not change environment variables or Action authentication.
5. Do not reinstall or modify the Custom GPT OpenAPI schema.

## Stage 3: Capabilities verification

Send this in the Draft a Dynasty GPT:

```text
TECHNICAL BACKEND 3.2.0 CAPABILITIES CHECK

Do not write or modify anything.

Call capabilities exactly once.

Report the complete capabilities response, including:
- backend_version
- read_scopes
- composite_read_features
- write_features
- write_operations
- safeguards

Stop after this single read-only Action call.
```

Pass conditions:

- `backend_version` is `3.2.0`
- `write_features` includes `ATOMIC_DECISION_UPDATE`
- `write_operations` includes `update_decision`
- `safeguards` includes `DECISION_IDENTITY_PRESERVATION`

## Stage 4: Read a safe dry-run target

Use an existing deferred decision only as a read and dry-run target. The recommended target is `teo-poaching`.

```text
TECHNICAL BACKEND 3.2.0 ATOMIC DECISION DRY-RUN CONTEXT

Do not write or modify anything.

Call decision_context exactly once using:

- decision_id: teo-poaching
- audit_limit: 3
- event_limit: 3
- transaction_limit: 4

Do not call any other scope.

Report only:
- backend_version
- state_version
- decision_queue_version
- decision_id
- decision_status
- decision_actionable
- write_preconditions

Stop afterward.
```

Record the returned global state version and Decision Queue version. Do not reuse versions displayed elsewhere.

## Stage 5: Atomic dry run

Replace the two placeholders with the exact versions returned in Stage 4.

```text
TECHNICAL BACKEND 3.2.0 ATOMIC DECISION DRY RUN

Perform a dry run only. Do not execute a real write.

Call executeArchersOperation exactly once using:

- operation: update_decision
- resource_type: decision_queue
- resource_id: decision-queue
- expected_version: <CURRENT_DECISION_QUEUE_VERSION>
- expected_state_version: <CURRENT_STATE_VERSION>
- idempotency_key: atomic-decision-teo-priority-dry-run-v1-20260730
- summary: Preview atomic Teo decision priority update
- source_label: SYSTEM
- dry_run: true
- payload:
  {
    "decision_id": "teo-poaching",
    "changes": {
      "priority": "HIGH"
    }
  }

Use a native JSON payload object. Do not use payload_json.
Do not call any read scope or any other operation.
Return the complete Action response exactly as received.
Stop afterward.
```

Pass conditions:

- `dry_run` is `true`
- `operation` is `update_decision`
- `decision_id` is `teo-poaching`
- current versions match Stage 4
- proposed versions are each current plus one
- proposed decision priority is `HIGH`
- `unrelated_decisions_preserved` is `true`
- `legacy_open_decisions_synchronized` is `true`
- the response states that no database write occurred

After the dry run, reread only if needed to prove that versions did not change.

## First live write

Do not change `teo-poaching` merely to test infrastructure.

Use the first real franchise decision that requires a Decision Queue mutation, or create a purpose-built non-story test decision through a separately approved maintenance workflow.

For the first real atomic write:

1. Call `decision_context` for the exact decision.
2. Use its returned write preconditions.
3. Call `executeArchersOperation` with `operation: update_decision`.
4. Call `operation_verification` with the operation ID or idempotency key, exact `decision_id`, and Decision Queue resource identifiers.
5. Confirm unrelated decisions and queue counts remain correct.

Keep PR #5 in draft until this live write and verification pass.

## GPT instruction update

After live verification succeeds, add `update_decision` to the `ALLOWED OPERATIONS` line in Compact Instructions v3.3 and save the result as v3.4.

No other instruction change is required.

## Rollback

If the SQL migration succeeds but the Edge deployment fails, leave the SQL helper installed and continue using backend 3.1.4. It is inert until the Edge Function routes `update_decision` to it.

If backend 3.2.0 is deployed but fails verification:

1. Redeploy the verified 3.1.4 Edge source.
2. Do not perform an `update_decision` write.
3. Preserve the failed response and logs for diagnosis.
4. The SQL helper may remain installed or be removed later with an explicit maintenance migration.

Do not merge PR #5 based only on deployment. Merge only after live verification evidence is recorded.