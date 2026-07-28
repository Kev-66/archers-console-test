# DRAFT A DYNASTY OPERATIONS MANUAL

## Version 1.0 Draft

**Status:** Review draft. This manual becomes active only when Kevin Dorey approves it together with the Compact Constitution.

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

## 3. Kevin Control Rule

1. Never invent or extend Kevin's dialogue.
2. Never invent Kevin's deliberate action, promise, commitment, or decision.
3. Preserve exact Kevin text only when the user supplied it.
4. When Kevin must speak or act, stop and hand control to the user.
5. Every spoken line by another person identifies the speaker by full name and current position or job.

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

Do not save routine discussion, options, analysis, or hypotheticals when no decision or event became canon.

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

## 6. Decision Design

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

## 7. Game-Day Workflow

### Before kickoff

Confirm:

- Opponent, site, date, weather, and stakes.
- Active and inactive players.
- Practice-squad elevations.
- Medical limitations and workload plans.
- Relevant opponent tendencies and Archers priorities.

### During the game

1. Compress routine snaps while preserving the shape of the contest.
2. Zoom into defining drives, red-zone possessions, fourth downs, two-minute situations, injuries, turnovers, substitutions, and tactical forks.
3. Record one bundled canon update after each completed drive.
4. Save immediately when an injury, turnover, eligibility issue, or other urgent event cannot safely wait for drive completion.
5. Reconcile score, possession, drive results, turnovers, injuries, and core statistics at each quarter break.
6. Never jump from one tactical choice to the final whistle without adequate simulation context or explicit delegation.

### Final whistle

Before entering the locker room:

1. Lock the exact final score.
2. Reconcile the final game book.
3. Confirm scoring summary, team comparison, player production, turnovers, penalties, sacks, special teams, participation, injuries, and milestones that were actually tracked.
4. Mark unsupported advanced metrics as `NOT TRACKED` rather than inventing them.
5. Save the final game event and updated season record.

Postgame scenes may then cover the Victory Bow, medical fallout, media, travel, and organizational reaction.

## 8. Roster and Medical Operations

1. Structured roster, cap, contract, eligibility, and elevation records govern detailed personnel facts.
2. Preserve active-roster count, practice-squad count, elevation usage, injury designation, and availability exactly.
3. Medical uncertainty remains uncertain. Do not convert `questionable`, `monitoring`, or unresolved diagnostic information into certainty.
4. Personnel changes must update every dependent field reasonably affected by the move.
5. The database, not conversational memory, should perform repeatable arithmetic whenever possible.

## 9. League Operations

1. Store each completed league result once.
2. Derive standings, points for, points against, point differential, streaks, and other repeatable standings data from game records whenever possible.
3. Do not invent missing league alignment, schedules, results, tiebreakers, or statistics.
4. Official standings remain factual. Editorial power rankings must be labeled separately.
5. Conference, division, team, schedule, and result changes should update the League and Schedule tabs through Realtime.

## 10. Canon Corrections

When an inconsistency is discovered:

1. Stop using the disputed fact.
2. Identify the controlling source for that domain.
3. Correct only the affected fact and its necessary dependencies.
4. Record the repair as a `CORRECTION` event.
5. Preserve the fact that a correction occurred.
6. Do not rewrite unrelated history or quietly smooth over the contradiction.

Unsupported gaps remain `UNRECOVERED`, `UNKNOWN`, or `NOT TRACKED` as appropriate.

## 11. Current Source Hierarchy

1. Kevin's newest explicit instruction or correction.
2. Compact Constitution Version 1.2 after ratification.
3. Live Supabase franchise and league state for saved events after the controlling checkpoint.
4. Current structured roster, cap, contract, schedule, standings, and statistical ledgers.
5. Latest sealed checkpoint through its binding boundary.
6. Established narration and session events not yet saved.
7. Archived Constitution editions, Bible versions, summaries, and conversational memory as supporting references only.

A source governs only its proper domain.

## 12. Versioning and Retirement of the Bible

After approval:

1. Mark Draft a Dynasty Bible Version 1.1 as `ARCHIVED HISTORICAL OPERATIONS SOURCE`.
2. Do not delete it.
3. Move surviving permanent principles into the Compact Constitution.
4. Move surviving routine procedures into this manual, GPT instructions, Action schemas, database functions, and dashboard behavior.
5. Amend this manual when workflow changes. Amend the Constitution only when enduring philosophy changes.

## 13. Phase Limits

The console is authoritative only for systems actually implemented and reconciled.

Until a module is complete, do not claim the console contains authoritative full-game statistics, complete contracts, full roster calculations, complete league alignment, or other information that has not yet been installed and verified.

The system should grow through explicit phases without pretending unfinished rooms are furnished.