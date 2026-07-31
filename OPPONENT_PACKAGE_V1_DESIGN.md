# Opponent Package v1

## Purpose

Opponent Package v1 gives Draft a Dynasty a reusable, authoritative structure for fully developed weekly opponents without creating 53 unrelated one-off records or asserting unsupported contracts.

The first package covers the 2026 Week Three opponent, the Baltimore Admirals.

## Current authoritative anchors

- Team ID: `bal`
- Team: Baltimore Admirals
- Conference: Continental
- Division: Atlantic
- Week Three record: 2-0
- Site: St. Louis
- Kickoff: Sunday, September 27, 2026 at 12:00 PM Central
- Known availability issue: starting right guard Damon Kirkland has an unresolved knee status; St. Louis prepares as though he will play.

Those anchors are preserved from current league and franchise state. The remaining staff, roster, depth, identity and scouting details are new simulated canon established under Kevin Dorey's authorization to flesh out the current opponent.

## Resource set

| Resource type | Resource ID | Purpose |
|---|---|---|
| `team_identity` | `bal-2026` | Organizational, offensive, defensive and special-teams identity |
| `team_staff` | `bal-2026` | General manager, coaches, responsibilities and portrayal notes |
| `team_roster` | `bal-2026` | Full 53-player active roster and 16-player practice squad |
| `team_depth_chart` | `bal-2026-w03` | Projected Week Three offense, defense and specialists |
| `opponent_scouting` | `stl-bal-2026-w03` | Threats, tendencies, matchup board, practice priorities and evidence boundaries |

All five resources are console-visible, active, contractless scouting records under franchise ledger `stl-2026`.

## Data boundary

Opponent Package v1 establishes football identity and personnel facts for the fictional league. It does not establish:

- opponent contract compensation;
- guarantees, options, cap charges or dead money;
- Baltimore's final Week Three inactive list;
- Damon Kirkland's final game designation;
- Baltimore's private final game plan;
- future outcomes.

Scouting tendencies are staff analysis, not foreknowledge. Unknown information remains unresolved.

## Website integration

Weekly Ops receives an Opponent Command Room with five views:

1. Overview
2. Coaches
3. Depth Chart
4. Roster
5. Scouting

The existing compact opponent snapshot remains in place and gains a direct link to the full dossier.

The website is read-only. It reads the five exact resources and never creates or modifies opponent canon.

## Reuse for later opponents

Future opponent packages should use the same resource types and replace only stable team, season and week identifiers. Team identity, staff and roster can persist across weeks. Depth charts and scouting dossiers should be week-specific when availability or matchup context changes.

## Production write

The first package uses one guarded `bulk_upsert_resources` operation because all five exact resources were confirmed absent. The operation also updates only `state.opponent.preparation_status` and resource references.

Before execution, the workflow must:

1. Read capabilities, compact state and the five exact resource identities.
2. Confirm Baltimore, Week Three and the current state version.
3. Confirm all five target resources are still absent or already exactly identical.
4. Run a dry-run preview.
5. Execute once with a stable idempotency key.
6. Verify one audit operation, one canon event, the five resources and the resulting state version.
7. Confirm Archers player and staff resource counts remain unchanged.

## Implementation checkpoint

The branch contains the complete package, read-only Weekly Ops integration, schema validation, browser evidence tests and guarded production seeding workflow. Production remains untouched until the pull request is approved and merged with the explicit production trigger commit.
