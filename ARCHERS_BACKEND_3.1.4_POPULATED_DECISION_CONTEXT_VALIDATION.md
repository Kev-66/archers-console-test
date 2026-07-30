# Archers Backend 3.1.4 Populated Decision Context Validation

Date: 2026-07-30

## Test

A read-only `decision_context` request was executed against the explicitly requested deferred decision `teo-poaching` with:

- `audit_limit: 5`
- `event_limit: 5`
- `transaction_limit: 12`

No other read scope was called, and no write or modification occurred.

## Result

**PASS**

The populated decision-context branch returned:

- Backend version: `3.1.4`
- Global state version: `33`
- Decision Queue version: `4`
- Requested decision: `teo-poaching`
- Decision status: `DEFERRED`
- Decision actionable: `false`
- Related resources returned: `2`
- Missing related resources: `0`
- Matching transaction entries: `2`
- Unrelated transaction entries omitted: `44`
- Relevant audit records: `1`
- Relevant canon events: `1`
- Response JSON byte estimate: `16160`

## Verified behavior

- An explicitly requested deferred decision can be inspected without being treated as actionable.
- The related player resource was returned at version `2`.
- The related transaction ledger was returned at version `1`.
- The transaction ledger was compacted server-side.
- Only two related transactions were included from a 46-entry ledger.
- Forty-four unrelated transactions were omitted.
- The full franchise snapshot was not used.
- The full transaction ledger was not returned.
- Write preconditions included global state version `33`, Decision Queue version `4`, and both related resource versions.
- No referenced resource was missing.

## Compactness observation

The response remained Action-safe at approximately 16.2 KB. The compact transaction resource still includes ledger-level `unresolved_items` metadata. This is not a blocker because transaction entries were correctly filtered, but that metadata is the clearest optional target for a future compactness-only optimization if response size becomes a concern.

## Infrastructure status

The major read-path tests are now complete:

1. Capabilities read
2. Empty automatic decision selection with deferred decisions excluded
3. Populated explicit decision context
4. Related-resource retrieval
5. Server-side transaction filtering
6. Compact operation verification
7. Deduplicated affected-resource verification
8. Operation-scoped unresolved-issue verification

No OpenAPI schema change was required for backend 3.1.4.
