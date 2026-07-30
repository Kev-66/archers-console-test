# Backend 3.3.0 Deployment Guide

## Scope

Backend 3.3.0 adds Season Rollover Engine v1 while preserving Backend 3.2.0 atomic Decision Queue behavior.

## Files

- `phase3-3-season-rollover-v1.sql`
- `archers-franchise-index-v3.3.0.ts`
- `edge-function-archers-franchise.ts`
- `tests/backend-3.3.0/season-rollover-v1.sql`
- `SEASON_ROLLOVER_ENGINE_V1_DESIGN.md`
- `SEASON_ROLLOVER_ENGINE_V1_CONTRACT_SCHEMA.md`

## Deploy

1. Back up current database functions and Edge source.
2. Apply the SQL migration with a role authorized to create the protected function.
3. Deploy `archers-franchise-index-v3.3.0.ts` as the complete Edge Function source.
4. Call `capabilities` and verify:
   - `backend_version: 3.3.0`
   - `rollover_season` appears in `write_operations`
   - `ATOMIC_SEASON_ROLLOVER` appears in `write_features`
   - `CONTRACT_RESOURCE_FINGERPRINT` appears in safeguards.
5. Run a live dry run only. Do not execute the rollover during deployment validation.

## Live dry-run validation

Use the current state version and the current season:

```json
{
  "operation": "rollover_season",
  "resource_type": "season_rollover",
  "resource_id": "season-rollover",
  "expected_state_version": 35,
  "idempotency_key": "backend-3.3.0-rollover-dry-run-v1",
  "summary": "Validate Season Rollover Engine v1 without changing canon",
  "source_label": "SYSTEM",
  "dry_run": true,
  "payload": {
    "from_season": 2026,
    "to_season": 2027,
    "strict": true
  }
}
```

Expected deployment result:

- no resource or state version changes;
- no operation-log row;
- no canon event;
- a complete blocker and warning report;
- `expected_resources` returned for a future authorized execution;
- legacy contract summaries reported rather than inferred.

## Real execution boundary

A real rollover is an offseason canon operation. It requires Kevin approval after reviewing a current dry run. Use a new idempotency key and resend the exact dry-run `expected_resources`. After success, call `operation_verification` with the execution idempotency key.

## Rollback

If the migration is deployed but unused, restore the prior Edge source and drop `public.archers_rollover_season` with its exact signature.

After a successful canon rollover, do not reverse it with ad hoc SQL. Use a documented correction migration and preserve the original event and operation log.
