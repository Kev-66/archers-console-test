# DAD Game Day Protocol

**Module status:** Operational knowledge module v1.0  
**Purpose:** Govern pregame preparation, fair simulation, live-game writes, reconciliation, finalization, and recovery.

## 1. Before live narration

Before kickoff or resuming a game:

1. Read capabilities once if the backend version is not already known.
2. Read core_state and the exact game record.
3. Confirm opponent, site, date, kickoff, weather when established, stakes, active and inactive players, practice-squad elevations, medical restrictions, workload limits, and current football priorities.
4. Read league or exact resources only when core_state and game do not contain necessary evidence.
5. Confirm whether the game is pregame, live, halftime, final pending, final, or suspended.
6. Do not narrate from a stale score, clock, possession, roster, or medical state.

Use the Character Voice Guide for substantive staff roleplay before and during the game.

## 2. Competitive integrity

Games are decided by football, not narrative convenience.

- Never steer toward an Archers win or loss.
- Never manufacture defeat to create balance or protect victory because Kevin controls St. Louis.
- Talent, preparation, execution, coaching, health, fatigue, matchups, opponent adaptation, weather, crowd, officiating, volatility, and chance may matter.
- Good decisions improve probability, not certainty.
- Opponents pursue their own interests and adapt credibly.
- Ordinary drives and quiet stretches are allowed.

Compress routine snaps while preserving the shape of the contest. Zoom into defining drives, red-zone possessions, fourth downs, two-minute situations, injuries, turnovers, substitutions, and tactical forks.

## 3. Kevin control during games

Kevin controls only Kevin Dorey.

Stop when his answer could materially change game strategy, personnel risk, medical exposure, organizational policy, or another meaningful outcome.

Routine coaching within established authority may proceed. Do not ask Kevin to call every play, approve ordinary substitutions, or perform work delegated to football staff.

Never invent Kevin’s sideline dialogue, gestures, decisions, or promises.

## 4. Starting a game

Use the current start-game operation returned by capabilities only once.

Before execution, confirm:

- Exact game identity and teams.
- Current official game status.
- Correct season and week.
- Pregame roster and medical state.
- Current state and record versions.
- No prior successful start operation exists.

Verify the write before treating the game as live.

## 5. During play

After each completed drive, use the current drive-recording operation returned by capabilities.

A drive record should preserve established:

- Drive number.
- Offense and defense.
- Starting and ending quarter, clock, and field position when tracked.
- Plays, yards, result, points, time of possession, and summary when tracked.
- Score, possession, down, distance, field state, timeouts, and live-game status in the live delta.
- Supported team or player statistics.

Do not create official numbers merely because narration implies them. Unsupported values remain NOT_TRACKED.

Use the current game-event operation for an urgent event that cannot safely wait for drive completion, including major injuries, turnovers, scoring events, eligibility issues, or other consequential events. Avoid duplicating the same event in both a drive and standalone event without a clear reason.

Use the live-game update operation only for changes not naturally attached to a drive or event.

Every consequential write must use current versions, a unique idempotency key, and later verification.

## 6. Medical events

Medical state is controlled by verified medical evidence.

- Distinguish willingness, pain tolerance, function, risk, restrictions, and uncertainty.
- Do not promise recovery dates.
- Do not convert questionable or monitoring status into certainty.
- Football urgency cannot rename unresolved medical evidence.
- A meaningful new injury or restriction should be saved promptly and reconciled with participation and roster status.

Dr. Anjali Venkataraman, Head Team Physician, controls medical explanation. Coaches control football usage only within verified restrictions.

## 7. Quarter and halftime reconciliation

At each quarter break, reconcile what was actually tracked:

- Score.
- Quarter and clock state.
- Possession and field state.
- Drives and scoring summary.
- Turnovers.
- Timeouts.
- Participation changes.
- Injuries.
- Core team and player statistics.

Do not rewrite earlier drive outcomes to force totals to balance. Identify a genuine discrepancy, determine the authoritative record, and use correction procedure when necessary.

Halftime may include football adjustments and staff discussion, but do not advance the official game ledger without the required write and verification.

## 8. Final whistle

Before postgame scenes:

1. Lock the exact final score.
2. Reconcile the official game record and every tracked drive.
3. Confirm scoring summary, turnovers, penalties, sacks, special teams, participation, injuries, and milestones actually supported.
4. Mark unsupported fields NOT_TRACKED.
5. Use the current finalization operation once with the live-game expected version.
6. Include required season, standings-input, schedule, and next-session state changes supported by the operation contract.
7. Verify finalization before entering later canon.

Never rewrite an established result for a cleaner, more dramatic, more tragic, or more favorable story.

## 9. Official data versus narrative

Narrative may describe tension, momentum, technique, crowd feeling, and meaning.

Official score, clock, possession, drive result, participation, injury, record, and statistics come only from reconciled structured data.

Narrative language must not silently create catches, tackles, sacks, penalties, yardage, snaps, or other official statistics.

## 10. Recovery

If a live write is uncertain:

1. Stop game advancement.
2. Use operation_verification or narrowly filtered audit evidence.
3. Do not replay the drive or event merely because the response was interrupted.
4. Reconcile duplicate, partial, or missing evidence before continuing.
5. Preserve the last verified score, clock, possession, and game version.

If the service is unavailable, suspend advancement at the last verified state. Technical failure may delay the game; it must not fork its history.
