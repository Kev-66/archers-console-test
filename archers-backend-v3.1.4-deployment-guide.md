# St. Louis Archers Backend 3.1.4 Deployment

## Purpose

Backend 3.1.4 is a narrow output-quality patch for `operation_verification`.
It preserves the 3.1.3 OpenAPI contract and all protected-write behavior.

## Files

- `archers-franchise-index-v3.1.4.ts`
- Existing Custom GPT OpenAPI schema remains `archers-action-openapi-v3.1.3.yaml`

## What 3.1.4 fixes

### Unique affected-resource versions

`operation_verification` now deduplicates `affected_resource_versions` by:

```text
resource_type/resource_id
```

When the target resource is the Decision Queue, the same queue row is no longer
returned once as the target and again as the queue context.

### Operation-scoped unresolved issues

For a `decision_queue/decision-queue` verification:

- with `decision_id`, only unresolved items attached to that decision are evaluated;
- without `decision_id`, decision-specific unresolved items are not evaluated;
- queue-wide unresolved items are intentionally omitted.

The response includes `unresolved_issues_evaluation` so the scope is explicit.

## Compatibility

- No OpenAPI schema change is required.
- No database migration is required.
- No write-operation behavior changes.
- Payloads must remain native JSON objects.
- Never stringify `payload`.
- Never use `payload_json` in new calls.

## Deployment

1. Open Supabase.
2. Open Edge Functions.
3. Open `archers-franchise`.
4. Replace the complete `index.ts` contents with `archers-franchise-index-v3.1.4.ts`.
5. Deploy the function.
6. Do not change the Custom GPT OpenAPI schema.

## Verification step 1: capabilities

Use the existing Draft a Dynasty GPT Action:

```text
TECHNICAL BACKEND 3.1.4 CAPABILITIES CHECK

Do not write or modify anything.

Call capabilities exactly once.

Confirm:
- backend_version is 3.1.4
- UNIQUE_AFFECTED_RESOURCE_VERSIONS is listed
- OPERATION_SCOPED_UNRESOLVED_ISSUES is listed

Return the complete capabilities response and stop.
```

## Verification step 2: regression test operation 27

```text
TECHNICAL OPERATION VERIFICATION 3.1.4 REGRESSION TEST

Do not write or modify anything.

Call operation_verification exactly once using:

- idempotency_key: decision-queue-resolve-knox-protection-write-v1-20260730
- resource_type: decision_queue
- resource_id: decision-queue
- event_limit: 5

Do not provide decision_id.
Do not call any other scope.
Return the complete Action response exactly as received and stop.
```

Expected evidence:

- `backend_version` is `3.1.4`
- `verified` is `true`
- `affected_resource_versions_deduplicated` is `true`
- `affected_resource_versions` contains one unique `decision_queue/decision-queue` entry
- `verification_totals.affected_resources` is `1`
- `unresolved_issues` is empty
- `unresolved_issues_evaluation.mode` is `NOT_EVALUATED_WITHOUT_DECISION_ID`
- `unresolved_issues_evaluation.queue_wide_issues_included` is `false`

## Rollback

If the function fails the capabilities or regression test, redeploy the last
verified `archers-franchise-index-v3.1.3.ts` file. The Custom GPT schema does not
need to change during either upgrade or rollback.
