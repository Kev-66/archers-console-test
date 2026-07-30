# DAD Decision Queue Protocol

**Module status:** Operational knowledge module v1.0  
**Canonical resource:** `decision_queue / decision-queue`  
**Schema lineage:** Decision Queue v1  
**Purpose:** Read, create, update, defer, reopen, and resolve individual franchise decisions without rewriting unrelated queue items.

## 1. Authority and identity

The structured Decision Queue is the durable lifecycle record for choices requiring review, approval, deferral, monitoring, or resolution.

Every decision must have one stable, unique `decision_id`. Never rename a decision by editing its identity. Never delete a decision after resolution. Preserve prior history.

The queue may use `decisions`, `items`, or `queue` as its array key, but the GPT should interact through decision_context and protected operations rather than reconstructing the resource shape.

## 2. Supported lifecycle statuses

- `OPEN`
- `READY_FOR_REVIEW`
- `AWAITING_KEVIN`
- `BLOCKED`
- `DEFERRED`
- `RESOLVED`
- `WITHDRAWN`
- `EXPIRED`

Actionable automatic selection includes `OPEN`, `READY_FOR_REVIEW`, `AWAITING_KEVIN`, and `BLOCKED`.

`DEFERRED` remains live history but is excluded from automatic next-decision selection. Inspect a deferred item only through an explicit `decision_id` or a verified trigger that reopens it.

Terminal statuses are `RESOLVED`, `WITHDRAWN`, and `EXPIRED`.

## 3. Decision read

For any material decision:

1. Call decision_context.
2. Supply decision_id when Kevin or the scene identifies an exact item.
3. Otherwise allow the backend to select the highest-priority actionable non-deferred item.
4. Use the returned decision, related resources, transactions, audit, events, evidence boundaries, and write preconditions.
5. Do not add separate reads unless decision_context reports missing evidence, conflict, or insufficient context.

A decision_context response may contain unresolved evidence boundaries. Do not turn those boundaries into facts or choices.

## 4. Meaningful Kevin decisions

Stop for Kevin when the answer could materially change:

- Competitive risk or game outcome.
- Personnel, money, draft capital, eligibility, or roster displacement.
- Medical exposure or workload.
- Organizational identity or standing policy.
- A promise, disciplinary act, public position, or important relationship.

A question, recommendation, technical test, partial reply, or hypothetical is not approval.

When options help, present genuinely different choices with their principal upside, cost, and uncertainty. Free-form instructions remain valid.

## 5. Atomic update_decision operation

Use `update_decision` when changing exactly one existing Decision Queue record.

Required targeting:

- `resource_type: decision_queue`
- `resource_id: decision-queue`
- Current Decision Queue `expected_version`
- Current global `expected_state_version`
- Stable `decision_id`
- Non-empty `changes` object
- Unique idempotency key
- Native JSON payload

Never resend the complete Decision Queue. Never include or alter another decision.

Only use fields supported by the live operation contract. Current supported fields may include status, priority, summary, deadlines, review timing, choices, recommendation, decision question, resolution, note, evidence boundaries, related resources, related players, and approval fields. Capabilities and the live backend contract control if this list changes.

Use `history_entry` when a lifecycle event should be appended. Do not rewrite earlier history entries.

## 6. Deferral and reopening

A deferred decision should record why no immediate choice is supported and what verified trigger should bring it back.

Do not repeatedly surface deferred items merely because they remain unresolved.

Reopening a terminal decision requires a transparent correction workflow and source_label `CORRECTION`. Reopening is not a convenience mechanism for changing one’s mind after canon was established.

## 7. Resolution

A terminal decision requires a structured resolution object supported by verified evidence.

A resolution should record, when available:

- Selected choice or explicit instruction.
- Concise factual summary.
- Resolved week and time.
- Resulting state version.
- Canon event ID.
- Audit operation ID.
- Related transaction IDs.

Never invent operation IDs, event IDs, timestamps, transaction IDs, or resulting versions before the backend returns them.

A decision is not resolved merely because Kevin spoke. Required operational consequences must first succeed and be verified.

## 8. Decisions with external operational effects

Some decisions change only the queue. Others also require roster, contract, medical, game, league, or resource operations.

When another record must change:

1. Read decision_context.
2. Execute the required domain operation using the relevant module.
3. Verify that operation.
4. Only then use update_decision to record the final status or resolution, citing verified evidence returned by the completed operation.
5. Verify the update_decision operation.

Do not mark a decision resolved before its required external effects are verified.

When the backend later offers a composite operation that atomically performs both domain effects and queue resolution, follow the live capability contract rather than this two-stage fallback.

## 9. Three-call queue-only workflow

For a queue-only change:

1. `decision_context`
2. `executeArchersOperation` with `update_decision`
3. `operation_verification`

Verification should include the exact decision_id and `decision_queue / decision-queue`.

Confirm:

- The intended decision changed.
- Queue and state versions advanced as expected.
- Unrelated decisions were preserved.
- Audit and canon evidence exist.
- Idempotency produced one operation.
- Legacy `state.open_decisions` synchronization remains consistent when reported.

## 10. Idempotency and dry runs

Use dry_run=true before an unfamiliar or consequential decision mutation. A dry run must not advance state or queue versions and must not reserve a new idempotency key.

An exact retry may return `idempotent_replay: true`. Reusing the key for a different request is a conflict and must stop the workflow.

## 11. Corrections and evidence boundaries

Do not delete unsupported or inconvenient history. Correct narrowly.

Keep unknown deadlines, choices, consequences, creation metadata, or outside claims null, omitted, UNKNOWN, or explicitly unresolved.

Verification unresolved_issues may restate evidence boundaries. They do not automatically mean the write failed. The `verified` field and concrete conflict evidence control that determination.
