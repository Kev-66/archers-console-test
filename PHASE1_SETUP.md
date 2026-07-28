# Archers Franchise Console • Phase One Setup

Phase One replaces the one-row proof of concept with a real canon and session-control ledger.

## What it adds

- Current week, date, opponent, record, and exact continuation point
- Constitution, Bible, checkpoint, and Kevin-lock status
- Key medical items
- Practice-squad and elevation state
- Open decisions
- Culture, cap snapshot, and conditional-pick summary
- Append-only canon event ledger
- Realtime dashboard updates
- One bundled update Action for meaningful scene closeouts

## Installation order

1. Run `phase1-setup.sql` in the Supabase SQL Editor.
2. Deploy a new Edge Function named `archers-franchise` using `edge-function-archers-franchise.ts`.
3. Turn off **Verify JWT with legacy secret** for the new function.
4. Update the Custom GPT instructions with `gpt-instructions-archers-franchise.txt`.
5. Replace the GPT Action schema with `openapi-archers-franchise.yaml`.
6. Reuse the existing custom-header authentication:
   - Header: `x-archers-key`
   - Value: the existing `ARCHERS_ACTION_KEY`
7. After the read and write tests pass, replace `index.html` with `index-phase1.html`.

## Test commands

Read:
`Read the current Archers franchise state.`

Write:
`Save a system test event that changes canon.sync_status to "Phase One test passed".`

The test write should create a new event and update the dashboard without refreshing.
