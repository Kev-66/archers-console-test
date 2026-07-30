# DAD Session Closeout Protocol

**Module status:** Operational knowledge module v1.0  
**Purpose:** Preserve an exact, verified continuation point and every material pending matter before a session ends or transfers.

## 1. When closeout is required

Perform closeout when:

- A meaningful scene ends and the next moment changed.
- The user pauses or ends a live session.
- A game reaches halftime, finalization, or another formal boundary.
- Technical interruption may separate established narration from saved state.
- Control transfers to another conversation or a fresh Custom GPT session.
- A checkpoint is explicitly requested.

Do not create a fictional closeout for technical discussion that never entered canon.

## 2. Read before closing

Use the smallest authoritative read necessary to confirm:

- Current global state version.
- Exact continuation point.
- In-universe date, week, day, and location.
- Immediate opponent, game state, or organizational task.
- Highest-priority actionable decision.
- Deferred decisions with verified future triggers when material.
- Roster, protection, elevation, contract, cap, medical, staffing, draft, and league matters that remain pending.
- Unsaved narration.
- UNKNOWN, UNRECOVERED, NOT_TRACKED, or contradictory boundaries relevant to continuation.
- Governing checkpoint.

Do not reuse displayed versions from an earlier scene when a fresh version is required for the closeout write.

## 3. Exact continuation point

Record the next playable moment, not merely a summary of what just happened.

A good continuation point identifies:

- Who is present or expected.
- Where and when the next scene begins.
- What has just been established.
- What work begins next.
- Whether a Kevin decision is already waiting.
- What must not be assumed.

Do not invent Kevin dialogue, actions, commitments, or a decision to make the handoff feel complete.

## 4. Closeout content

Preserve, when changed:

1. In-universe date, week, day, and location.
2. Current scene status.
3. Exact continuation point.
4. Immediate next decision or action.
5. Pending medical, roster, contract, cap, game, staff, draft, transaction, communications, and league matters.
6. Established narration not yet represented in structured state.
7. New evidence boundaries or unresolved conflicts.
8. Relevant source checkpoint and provenance.
9. The verified resulting state version.

Use compact factual wording. Do not turn the closeout record into prose recap, analysis, or a prediction.

## 5. Decision handoff

The Decision Queue, not a free-form paragraph, is authoritative for structured decision lifecycle.

At closeout:

- Ensure material open or deferred decisions are represented correctly.
- Do not create duplicate decisions for the same underlying choice.
- Do not mark a decision resolved because a scene ended.
- Use update_decision for one queue record.
- Record verified future triggers for deferred decisions.
- Preserve the exact approval owner and requirement.

If a decision’s required external operation is still pending, keep the decision non-terminal and state what remains unverified.

## 6. Game closeout

A game session cannot safely close beyond the last verified game state.

At halftime or suspension, preserve the official score, quarter, clock, possession, field state, timeouts, drive sequence, tracked statistics, participation changes, injuries, and exact resumption point.

After the final whistle, finalize and verify the game before saving postgame continuation. Do not carry an unofficial score or unreconciled game book into later canon.

## 7. Write and verify

Use the operation appropriate to the changed records and current capabilities.

Every closeout write requires:

- Current expected versions.
- One native JSON payload.
- Unique idempotency key.
- Factual summary.
- Correct source label.
- dry_run according to the operation and consequence level.

After execution, call operation_verification. Closeout is incomplete until verification confirms the returned state version and affected records.

If verification fails, say that closeout remains pending. Do not claim the session was safely saved.

## 8. Unsaved narration

Established narration may temporarily outrank older saved state until synchronization.

Capture only events that actually occurred in the session. Do not add connective events, implied conversations, or unseen decisions.

When service returns:

1. Reread current state.
2. Reconcile whether another session changed the same area.
3. Rebuild the smallest pending delta.
4. Write once.
5. Verify before continuing.

## 9. Handoff summary

After verified closeout, report compactly:

- Resulting state version.
- Exact saved continuation point.
- Immediate next action or decision.
- Material unresolved boundary, if any.

Do not dump the full database or repeat every settled fact.

## 10. Failure boundary

If authoritative data is missing or contradictory, stop at the last verified point.

A technical failure may postpone closeout. It must never cause fabricated continuity, duplicate canon, or silent loss of established events.
