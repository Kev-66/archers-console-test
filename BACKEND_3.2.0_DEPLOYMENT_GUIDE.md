# Draft a Dynasty Backend 3.2.0 Deployment Guide

## Status

Production deployment and live validation completed on July 30, 2026.

- SQL migration deployed to the Archers Supabase project.
- `archers-franchise` Edge Function deployed at backend version `3.2.0`.
- Capabilities verification passed.
- Atomic dry-run validation passed.
- Controlled live atomic write passed.
- `operation_verification` confirmed operation `29` at state version `35` and Decision Queue version `5`.

## Deployed files

- SQL migration: `phase3-2-atomic-decision-update.sql`
- Versioned Edge source: `archers-franchise-index-v3.2.0.ts`
- Canonical Edge source: `edge-function-archers-franchise.ts`
- Design: `BACKEND_3.2.0_ATOMIC_DECISION_UPDATE_DESIGN.md`
- Live evidence: `BACKEND_3.2.0_LIVE_VALIDATION_REPORT.md`

The two Edge source files must remain identical.

## Verified capabilities

The production Action reported:

- `backend_version`: `3.2.0`
- `update_decision` in `write_operations`
- `ATOMIC_DECISION_UPDATE` in `write_features`
- `DECISION_IDENTITY_PRESERVATION` in `safeguards`

## Verified dry run

The deferred `teo-poaching` decision was used as a non-writing target.

- current state version: `34`
- current Decision Queue version: `4`
- proposed state version: `35`
- proposed Decision Queue version: `5`
- updated fields: `note`
- unrelated decisions preserved: `true`
- idempotency key already used: `false`
- database write performed: no

## Verified controlled live write

A controlled no-op lifecycle write set `teo-poaching` to its already-current `DEFERRED` status without changing its substantive meaning, recommendation, evidence, deadline, or resolution.

The complete three-call path succeeded:

1. `decision_context`
2. `executeArchersOperation` with `operation: update_decision`
3. `operation_verification`

Verified results:

- global state: `34 → 35`
- Decision Queue: `4 → 5`
- operation ID: `29`
- verification: `true`
- unrelated decisions preserved: `true`
- idempotent replay: `false`

## Remaining activation step

Install `DRAFT_A_DYNASTY_COMPACT_INSTRUCTIONS_v3.4.md` in the Draft a Dynasty Custom GPT. It adds `update_decision` to the allowed operation list and directs single-decision lifecycle mutations through the atomic Decision Queue operation.

The v3.4 file is 7,968 characters and remains within the Custom GPT instruction limit.

## Normal decision workflow

For one Decision Queue lifecycle mutation:

1. Call `decision_context` with the exact `decision_id`.
2. Use the returned global state and Decision Queue versions.
3. Call `executeArchersOperation` with:
   - `operation: update_decision`
   - `resource_type: decision_queue`
   - `resource_id: decision-queue`
   - a native JSON payload containing `decision_id` and `changes`
4. Call `operation_verification` with the operation ID or idempotency key, exact `decision_id`, and queue resource identifiers.
5. Do not claim success until verification passes.

## OpenAPI

No structural OpenAPI update is required. The installed compact Action schema accepts `operation` as a string and already transports the required native JSON payload and version fields.

## Rollback

The existing `archers_execute_operation` RPC was not modified. To disable the new path without altering stored canon:

1. Redeploy the verified backend 3.1.4 Edge Function source.
2. Remove `update_decision` from the Custom GPT instructions.
3. Optionally revoke execute access to `public.archers_update_decision` from `service_role`.

Do not delete or rewrite verified operation `29`. It is a valid SYSTEM validation event and audit record.

## Merge gate

PR #5 may be merged after:

- the latest CI run passes,
- Compact Instructions v3.4 are installed in the Draft a Dynasty GPT,
- the PR remains mergeable with no unresolved review blockers.
