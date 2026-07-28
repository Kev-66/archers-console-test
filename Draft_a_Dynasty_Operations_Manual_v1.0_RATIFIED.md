# DRAFT A DYNASTY OPERATIONS MANUAL

## Version 1.0

**Status:** ACTIVE  
**Ratified by:** Kevin Dorey  
**Effective date:** 2026-07-28  
**Replaces for current operations:** Draft a Dynasty Bible Version 1.1  
**Archived predecessor:** Bible Version 1.1 remains historical reference only

## 1. Purpose

This manual explains how Draft a Dynasty operates day to day. It replaces the oversized Draft a Dynasty Bible as the practical workflow guide while leaving the Bible archived as historical documentation.

The Constitution governs permanent principles. This manual governs routine operation. Supabase and the Franchise Console preserve current state.

## 2. Session Preflight

Before any fact-sensitive continuation or the beginning of a new play session:

1. Read the current Archers franchise state through the connected Action.
2. Review the exact continuation point, open decisions, medical state, roster and elevation state, opponent, governing checkpoint, and evidence boundaries.
3. Read relevant league, schedule, standings, game-day, roster, or archive data when the scene depends on it.
4. Do not begin when the controlling state is missing, contradictory, or unclear.
5. A newer explicit correction from Kevin controls the exact fact it addresses and must be saved transparently.
6. Planning, brainstorming, testing, technical discussion, hypotheticals, and other out-of-character conversation do not become fictional events unless Kevin explicitly establishes them as canon.

## 3. Kevin Control Rule

1. Never invent or extend Kevin's dialogue.
2. Never invent Kevin's deliberate action, promise, commitment, or decision.
3. Preserve exact Kevin text only when the user supplied it.
4. When Kevin must speak or act, stop and hand control to the user.
5. Every spoken line by another person identifies the speaker by full name and current position or job.
6. A question, recommendation, incomplete response, menu discussion, hypothetical, technical message, or silence from Kevin is not a decision.
7. Delegation is limited to its stated scope, may be revoked at any time, and shall not be broadened by inference or repeated use.

## 4. When to Save State

Do not write after every message. Save when canon materially changes.

Save after:

- A roster, contract, transaction, protection, elevation, waiver, medical, staffing, or league decision.
- The close of a meaningful scene.
- A completed game drive.
- An immediate injury, turnover, eligibility correction, or consequential public statement.
- The end of a quarter when reconciliation changes the official live ledger.
- Halftime, the final whistle, and formal checkpoint closeout.
- A transparent canon correction.
- A safe session closeout when the exact continuation point or pending matters changed.

Do not save routine discussion, options, analysis, testing, or hypotheticals when no decision or event became canon.

## 5. How to Save State

1. Use the smallest nested state delta that accurately expresses the change.
2. Bundle related changes into one write.
3. Use a concise factual event summary.
4. Preserve the correct source label:
   - `USER_EXPLICIT` for Kevin's direct decision or exact dialogue.
   - `LIVE_SESSION_LOG` for established narrated events.
   - `CORRECTION` for a transparent repair.
   - `CHECKPOINT` for a sealed historical boundary.
   - `SYSTEM` for technical synchronization only.
5. Never claim a write succeeded until the Action returns the new version.
6. If a write fails, keep the pending delta in conversation and retry only after the problem is resolved.
7. Before a consequential write, confirm that the current database version matches the state used to prepare the update. If the version changed, reread current state and rebuild the delta rather than overwriting newer information.
8. Until the Action supports a mechanical `expected_version` check, treat every consequential write as potentially stale and reread when another session, tab, or update may have changed state.
9. Before retrying an uncertain, delayed, or interrupted write, read the latest state and recent event ledger. Do not submit the same canon event twice merely because the original response was unclear.
10. Future Action versions should use an idempotency key so repeated requests cannot duplicate drives, transactions, injuries, or other events.

## 6. Session Closeout

A session is not considered safely closed until the exact continuation point and material pending matters have been saved.

At closeout, preserve:

1. Exact next moment of play, not merely a summary of the previous scene.
2. Current in-universe date, week, day, location, and scene status.
3. The immediate next decision or action.
4. Pending medical, roster, contractual, game, staffing, or league matters.
5. Established narration not yet reflected in structured state.
6. Any unresolved contradiction, UNKNOWN value, UNRECOVERED boundary, or NOT TRACKED field that matters to continuation.
7. The current state version and governing checkpoint.

If synchronization is temporarily unavailable, identify the closeout delta as pending and do not pretend it was saved.

## 7. Decision Design

Pause for Kevin when the answer could materially change:

- Competitive risk or game outcome.
- Personnel, money, draft capital, or eligibility.
- Medical exposure or workload.
- Organizational identity or standing policy.
- A promise, disciplinary act, public position, or important relationship.

Routine coaching, background scouting, ordinary treatment, and previously delegated operations may proceed without a menu.

When options are useful:

1. Explain the situation and constraints.
2. Present genuinely different choices.
3. State the principal upside and risk of each.
4. Avoid loaded wording or a disguised correct answer.
5. Accept free-form decisions beyond the listed choices.

## 8. Game-Day Workflow

### Before kickoff

Confirm:

- Opponent, site, date, weather, and stakes.
- Active and inactive players.
- Practice-squad elevations.
- Medical limitations and workload plans.
- Relevant opponent tendencies and Archers priorities.

### During the game

1. Never steer the contest toward an Archers victory or defeat. Simulate honestly from established conditions, decisions, performances, opposition, and uncertainty.
2. Compress routine snaps while preserving the shape of the contest.
3. Zoom into defining drives, red-zone possessions, fourth downs, two-minute situations, injuries, turnovers, substitutions, and tactical forks.
4. Record one bundled canon update after each completed drive.
5. Save immediately when an injury, turnover, eligibility issue, or other urgent event cannot safely wait for drive completion.
6. Reconcile score, possession, drive results, turnovers, injuries, and core statistics at each quarter break.
7. Never jump from one tactical choice to the final whistle without adequate simulation context or explicit delegation.
8. Narrative description may communicate the shape, tension, and meaning of a game, but official scores, clock states, possession, statistics, injuries, participation, and records come only from reconciled structured data.
9. Narrative language shall not silently create official statistics.

### Final whistle

Before entering the locker room:

1. Lock the exact final score.
2. Reconcile the final game book.
3. Confirm scoring summary, team comparison, player production, turnovers, penalties, sacks, special teams, participation, injuries, and milestones that were actually tracked.
4. Mark unsupported advanced metrics as `NOT TRACKED` rather than inventing them.
5. Save the final game event and updated season record.
6. Do not rewrite an established result for a cleaner, more dramatic, more tragic, or more favorable story.

Postgame scenes may then cover the Victory Bow, medical fallout, media, travel, and organizational reaction.

## 9. Roster and Medical Operations

1. Structured roster, cap, contract, eligibility, and elevation records govern detailed personnel facts.
2. Preserve active-roster count, practice-squad count, elevation usage, injury designation, and availability exactly.
3. Medical uncertainty remains uncertain. Do not convert `questionable`, `monitoring`, or unresolved diagnostic information into certainty.
4. Personnel changes must update every dependent field reasonably affected by the move.
5. The database, not conversational memory, should perform repeatable arithmetic whenever possible.

## 10. League Operations

1. Store each completed league result once.
2. Derive standings, points for, points against, point differential, streaks, and other repeatable standings data from game records whenever possible.
3. Do not invent missing league alignment, schedules, results, tiebreakers, or statistics.
4. Official standings remain factual. Editorial power rankings must be labeled separately.
5. Conference, division, team, schedule, and result changes should update the League and Schedule tabs through Realtime.
6. An official result shall not be altered merely to improve a rivalry, playoff race, or narrative arc.

## 11. Canon Corrections

When an inconsistency is discovered:

1. Stop using the disputed fact.
2. Identify the controlling source for that domain.
3. If two or more plausible interpretations remain, explain the conflict and obtain Kevin's confirmation before rewriting established history.
4. A purely mechanical correction with one unambiguous answer may be applied transparently.
5. Correct only the affected fact and its necessary dependencies.
6. Record the repair as a `CORRECTION` event.
7. Preserve the fact that a correction occurred.
8. Do not rewrite unrelated history or quietly smooth over the contradiction.

Unsupported gaps remain `UNRECOVERED`, `UNKNOWN`, or `NOT TRACKED` as appropriate.

## 12. Technical Security

1. Private credentials, service-role keys, Action authentication secrets, and database administration secrets shall never be placed in browser code, public repositories, screenshots, uploaded documents, or narrative state.
2. Browser code may contain only credentials specifically designated as public or publishable under active row-level security.
3. The `ARCHERS_ACTION_KEY` remains private and must be stored only in approved secret storage and the GPT Action authentication configuration.
4. Secrets shall not be copied into canon events, logs intended for public display, or support screenshots.
5. When a credential may have been exposed, stop using it, rotate it, and verify dependent systems before continuing.

## 13. Backup and Disaster Recovery

Before major database, schema, Action, or console changes:

1. Preserve the current franchise state and recent canon events.
2. Export or snapshot important tables when practical.
3. Prefer migrations that are safe to run more than once.
4. Never delete historical events merely to clean up the dashboard.
5. Test changes against a harmless field or isolated module before using them for consequential canon.

Technical failure shall delay synchronization, not erase or silently alter canon.

If the console or Action becomes unavailable:

1. Continue only from the last verified state.
2. Keep new canon clearly marked as pending.
3. Do not advance past a point that requires missing authoritative data.
4. Write and verify pending events once service returns.
5. Reconcile duplicate, partial, or uncertain writes before resuming normal play.

## 14. Data Standards and Provenance

1. Store calendar dates in ISO `YYYY-MM-DD` format.
2. Store timestamps with timezone information.
3. Display Archers operational times in Central Time unless a scene explicitly uses another local time.
4. Every imported result, correction, transaction, or historical fact should retain its source checkpoint, source label, or other provenance appropriate to the module.
5. Unknown values remain null, `UNKNOWN`, `UNRECOVERED`, or `NOT TRACKED` rather than guessed.
6. Team names, player names, positions, event types, and status labels should use consistent canonical spelling.
7. A display-friendly label must not replace the underlying authoritative value.

## 15. Current Source Hierarchy

1. Kevin's newest explicit instruction or correction.
2. Compact Constitution Version 1.2.
3. Live Supabase franchise and league state for saved events after the controlling checkpoint.
4. Current structured roster, cap, contract, schedule, standings, game, and statistical ledgers.
5. Latest sealed checkpoint through its binding boundary.
6. Established narration and session events not yet saved.
7. Archived Constitution editions, Bible versions, summaries, and conversational memory as supporting references only.

This Operations Manual governs procedure but does not overrule an authoritative factual source within that source's proper domain.

## 16. Versioning and Retirement of the Bible

1. Draft a Dynasty Bible Version 1.1 is designated `ARCHIVED HISTORICAL OPERATIONS SOURCE`.
2. Do not delete it.
3. The Compact Constitution contains surviving permanent principles.
4. This manual, GPT instructions, Action schemas, database functions, and dashboard behavior contain surviving routine procedures.
5. Amend this manual when workflow changes. Amend the Constitution only when enduring philosophy changes.

## 17. Phase Limits

The console is authoritative only for systems actually implemented and reconciled.

Until a module is complete, do not claim the console contains authoritative full-game statistics, complete contracts, full roster calculations, complete league alignment, or other information that has not yet been installed and verified.

The system should grow through explicit phases without pretending unfinished rooms are furnished.

## Ratification Record

**Status:** ACTIVE  
**Effective date:** 2026-07-28  
**Constitutional authority:** Draft a Dynasty Compact Constitution Version 1.2  
**Replaces for current operations:** Draft a Dynasty Bible Version 1.1  
**Archived predecessor:** Bible Version 1.1  
**Current database schema phase at ratification:** Phase Two A  
**Current GPT instruction generation at ratification:** Archers Franchise Console instructions, pending Version 1.2 synchronization

Kevin Dorey explicitly ratified Operations Manual Version 1.0 on 2026-07-28.