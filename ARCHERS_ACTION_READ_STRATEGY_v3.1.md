# Archers Action Read Strategy v3.1

Use the smallest authoritative read that can answer the current question.

## Required order

1. Call `capabilities` when beginning a technical workflow or after an Action update.
2. Use `core_state` for the current global state version, timeline, exact continuation fields, open decisions, opponent, medical flags, roster-operation summary, cap summary and evidence boundaries.
3. Use `state_fields` when exact state paths are required. Request no more than 20 comma-separated paths.
4. Use `resource_index` before broad resource discovery. Set `include_items=false` when only counts and latest versions are needed.
5. Use `resources` with the narrowest possible filters:
   - `resource_type`
   - `resource_id` when known
   - `status`
   - `visibility`
   - `season`
   - `include_archived`
6. Set `include_data=false` for discovery or version checks. Set it to true only when the resource payload is needed.
7. Paginate with `limit` and `offset`. Follow `pagination.next_offset` until `has_more` is false.
8. Use filtered `audit` and `events` reads for verification instead of loading them through the full snapshot.
9. Use `snapshot` only when a complete legacy response is genuinely necessary and known to fit.

## Decision Queue workflow

Read in this order:

1. `core_state`
2. `state_fields` with:
   - `timeline`
   - `open_decisions`
   - `opponent`
   - `medical`
   - `roster.week_three_protections_status`
   - `roster.protections`
   - `roster.elevations`
   - `canon.evidence_boundaries`
3. `resources` for `decision_queue / decision-queue`
4. `resource_index` with `include_items=false`
5. Exact related resources only
6. Filtered audit and canon events

Do not infer a missing state field from an older checkpoint when the live scoped state read is available.

## Resource discovery examples

Metadata-only player page:

```text
scope=resources
resource_type=player
status=ACTIVE
include_data=false
limit=25
offset=0
```

Exact live Draft Capital resource:

```text
scope=resources
resource_type=draft_capital
resource_id=draft-capital
status=ACTIVE
include_data=true
limit=1
```

Counts-only resource inventory:

```text
scope=resource_index
include_archived=false
include_items=false
```

Relevant Decision Queue audit operations:

```text
scope=audit
resource_type=decision_queue
resource_id=decision-queue
limit=20
```

## Write rule

Every `executeArchersOperation` call must send `payload` as a native JSON object. Do not stringify it and do not use `payload_json` in new calls.
