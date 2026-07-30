# Draft a Dynasty Transaction Ledger Schema v1

Status: Final technical schema for the first live St. Louis Archers transaction ledger.

Authoritative resource target:

- `resource_type`: `transaction_ledger`
- `resource_id`: `transaction-ledger`
- `status`: `ACTIVE`
- `visibility`: `CONSOLE`
- `profile_schema_version`: `1`

Machine-readable validation lives in `transaction-ledger-schema-v1.json`.

## Purpose

The transaction ledger is the permanent structured history of Archers personnel, contract, roster and draft-asset movement. Current-state resources show what the franchise owns today. The ledger records how that state changed.

## Core rules

1. Every transaction has one stable `transaction_id`.
2. History is append-only. Do not silently delete or rewrite completed transactions.
3. Corrections use `AMENDED`, `REVERSED` or `VOIDED` records linked through `amends_transaction_id` or `reverses_transaction_id`.
4. `assets_in` means St. Louis receives the asset. `assets_out` means St. Louis sends or relinquishes the asset.
5. Current Archers players should use their authoritative player `resource_id`.
6. Incoming players from other teams may be stored as external snapshots before an Archers player resource exists.
7. Outgoing Archers player resources should be archived or updated, not erased.
8. Unknown terms remain null or omitted. Never invent contract, cap, draft-condition or player details.
9. The ledger entry links to the authenticated write through audit, canon-event and resulting state-version fields whenever those identifiers exist.
10. A ledger entry does not replace the required updates to roster, player, cap, draft-capital or franchise-state resources.

## Transaction types

- `TRADE`
- `SIGNING`
- `RELEASE`
- `WAIVER`
- `PRACTICE_SQUAD`
- `ELEVATION`
- `CONTRACT`
- `DRAFT_PICK`
- `RESERVE_LIST`
- `OTHER`

## Status values

- `CONFIRMED`
- `PROVISIONAL`
- `PENDING`
- `AMENDED`
- `REVERSED`
- `VOIDED`

## Player records

A player object may include:

- `resource_id`: authoritative Archers player resource when one exists
- `league_player_id`: future league-wide identifier
- `player_name`
- `position`
- `direction`: `IN`, `OUT`, `INTERNAL` or `NONE`
- `movement`: precise movement label
- `team_before`
- `team_after`
- `external_player`: true when the player was not yet represented by an Archers resource
- `resource_action`: `CREATE`, `UPDATE`, `ARCHIVE` or `NONE`

## Asset records

Assets use `asset_type`:

- `PLAYER`
- `DRAFT_PICK`
- `CASH`
- `RIGHTS`
- `OTHER`

Draft-pick assets may include year, round, original team, status, condition and note. Conditional or provisional selections remain labeled as such until earned.

## Contract and roster effects

`contract_effects` may record known contract summaries, cap effects, dead cap and notes.

`roster_effects` may record active-roster, practice-squad or reserve-list count changes.

These values are historical effects, not substitutes for the current authoritative cap and roster resources.

## Example trade

```json
{
  "transaction_id": "2026-wk05-trade-lv-stl-01",
  "transaction_type": "TRADE",
  "status": "CONFIRMED",
  "effective_week": 5,
  "summary": "St. Louis completed a trade with Las Vegas.",
  "counterparty_team": {
    "team_id": "las-vegas",
    "team_name": "Las Vegas"
  },
  "players": [
    {
      "player_name": "Cole Daniels",
      "position": "CB",
      "direction": "IN",
      "team_before": "Las Vegas",
      "team_after": "St. Louis",
      "external_player": true,
      "resource_action": "CREATE"
    },
    {
      "resource_id": "archers-player-id",
      "player_name": "Archers Player",
      "direction": "OUT",
      "team_before": "St. Louis",
      "team_after": "Las Vegas",
      "resource_action": "ARCHIVE"
    }
  ],
  "assets_in": [
    {
      "asset_type": "PLAYER",
      "player_name": "Cole Daniels",
      "position": "CB",
      "label": "CB Cole Daniels"
    },
    {
      "asset_type": "DRAFT_PICK",
      "year": 2028,
      "round": 2,
      "original_team": "Las Vegas",
      "status": "CONFIRMED"
    }
  ],
  "assets_out": [
    {
      "asset_type": "PLAYER",
      "resource_id": "archers-player-id",
      "player_name": "Archers Player"
    }
  ],
  "source_canon_event_id": 25,
  "source_audit_operation_id": 18,
  "resulting_state_version": 25
}
```

## Creation and future updates

The initial historical import should be dry-run first. It must use only current authoritative snapshots, active and archived resources, canon events and audit records. Ambiguous history stays omitted or explicitly unresolved.

Future authenticated operations should append or amend ledger entries whenever they complete a transaction and update every affected current-state resource in the same verified workflow.
