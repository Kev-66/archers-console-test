# Opponent Package v1 Resource Contract

## Shared rules

Every opponent package resource:

- uses a stable lowercase `resource_type`;
- uses a stable identity-preserving `resource_id`;
- records absolute season and week values;
- is `ACTIVE` and `CONSOLE` only when safe for the website;
- preserves unknown information rather than filling it invisibly;
- contains no opponent contract fields unless separately established and validated;
- uses `LIVE_SESSION_LOG` provenance for simulated canon established during play.

## `team_identity`

One season-level team identity record.

Required concepts:

- team and season identity;
- record and competitive posture as of the stated week;
- general manager and head coach;
- organizational summary and culture traits;
- offensive, defensive and special-teams systems;
- current known availability items;
- provenance note.

## `team_staff`

One season-level staff directory.

Each staff entry should preserve:

- stable staff ID;
- full name and current job;
- department and responsibilities;
- profile, voice and decision lens;
- years with the team when established.

Voice notes exist to keep opponent characters distinct during roleplay. Every spoken line must still identify the speaker by full name and current job.

## `team_roster`

One season-level roster record.

The Baltimore v1 record contains:

- 53 active players;
- 16 practice-squad players;
- stable player IDs;
- full names, positions, ages and jersey numbers;
- overall ratings and development traits used by the fictional league model;
- roster roles, unit, availability and football notes;
- captains;
- explicit statement that opponent contract data is not tracked.

A rating is one input, not destiny or guaranteed performance.

## `team_depth_chart`

A week-specific projected depth chart.

It contains:

- offense;
- defense;
- special teams;
- stable player references;
- projected replacements;
- unresolved questions.

Projected depth must not be presented as a confirmed inactive list.

## `opponent_scouting`

A franchise-versus-opponent, week-specific scouting dossier.

It contains:

- executive summary and confidence;
- key threats and control points;
- offensive and defensive tendencies;
- matchup board;
- ordered practice priorities;
- evidence boundaries;
- resource references.

Scouting analysis may guide roleplay and coaching recommendations. It does not execute a game-plan decision or guarantee what Baltimore will call.

## Updates

Team identity, staff and roster should update only when the fictional league establishes a change. Week-specific depth and scouting records may be replaced or archived after the week concludes.

Read the existing resource and version before any update. Archive obsolete week-specific records rather than erasing history.
