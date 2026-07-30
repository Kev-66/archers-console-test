# Backend 3.2.0 Live Validation Report

## Status

Backend 3.2.0 atomic Decision Queue updates passed production validation on July 30, 2026.

## Deployment verification

The deployed `archers-franchise` Edge Function reported:

- `backend_version`: `3.2.0`
- `update_decision` present in `write_operations`
- `ATOMIC_DECISION_UPDATE` present in `write_features`
- `DECISION_IDENTITY_PRESERVATION` present in `safeguards`

## Dry-run validation

A dry run targeted the deferred `teo-poaching` decision without modifying canon.

- backend feature: `ATOMIC_DECISION_UPDATE`
- current state version: `34`
- current Decision Queue version: `4`
- proposed state version: `35`
- proposed Decision Queue version: `5`
- updated fields: `note`
- unrelated decisions preserved: `true`
- idempotency key already used: `false`
- database write performed: no

## Controlled live write

A controlled no-op lifecycle write set `teo-poaching` to its existing `DEFERRED` status.

- operation: `update_decision`
- decision ID: `teo-poaching`
- resulting state version: `35`
- resulting Decision Queue version: `5`
- updated fields: `status`
- unrelated decisions preserved: `true`
- idempotent replay: `false`

The write did not change the substantive meaning, recommendation, evidence, deadline, or resolution of the decision.

## Operation verification

`operation_verification` confirmed:

- verified: `true`
- operation ID: `29`
- decision status: `DEFERRED`
- current state version: `35`
- current Decision Queue version: `5`
- response JSON bytes estimate: `5786`

Affected resource versions:

- `decision_queue/decision-queue`: version `5`
- `player/teo-brankovic`: version `2`
- `transaction_ledger/transaction-ledger`: version `1`

The unresolved-issues output remained decision-scoped and preserved the known evidence boundaries for Teo Branković.

## Conclusion

Backend 3.2.0 passed the complete production workflow:

1. `decision_context`
2. `executeArchersOperation` with `update_decision`
3. `operation_verification`

The atomic single-decision operation is ready for normal use after compact GPT instructions v3.4 are installed.