# Squad Planner v1

## Purpose

Squad Planner is the read-only bridge between the live Archers roster and future roster construction. It appears directly after Roster in the hosted console and uses the existing authoritative player, contract, roster-status, and medical data.

## v1 experience

- Thirteen position-room cards cover offense, defense, specialists, and unmapped flex players.
- The baseline order is derived from recorded roster status, role, overall rating, and player name. It is a planning baseline, not an authoritative depth-chart claim.
- Players can be reordered only inside their recorded position room by drag-and-drop or accessible arrow controls.
- The 2026 and 2027 views distinguish controlled, final-year, uncontrolled, and unknown contract records.
- Warnings cover roster-count integrity, thin future control, final-year pressure, unknown contracts, and recorded medical flags.
- Existing read-only player profile drawers remain available from every planner card.

## Safety boundary

Squad Planner v1 never writes to Supabase and never changes a player position, roster status, contract, depth chart, or canon state. Its scenario document is stored only in the current browser under:

`archers-console-squad-planner-v1-scenario`

Reset to Live Roster deletes that browser-local scenario and reconstructs the baseline from the latest read-only roster response. Realtime events only trigger a fresh read and reconciliation.

## Scenario shape

```json
{
  "schemaVersion": 1,
  "name": "Week 3 Squad Plan",
  "baselineStateVersion": 38,
  "updatedAt": "ISO-8601 timestamp or null",
  "rooms": {
    "qb": ["player resource IDs in local planning order"]
  }
}
```

Unknown contract information stays unknown. A local ordering is not a Kevin Dorey decision and must not be treated as a personnel commitment.

## Deferred

Cross-position changes, active/practice-squad transactions, releases, signings, cap simulation, trade packages, contract offers, server-shared scenarios, and canon promotion belong in separately protected future workflows. Scenario Lab should own full decision simulation.
