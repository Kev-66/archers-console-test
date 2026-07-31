# Weekly Gameplan Lab Lite v1

## Feature purpose

Weekly Gameplan Lab Lite is a read-only preparation surface inside Weekly Ops, positioned directly after the Baltimore Opponent Command Room. It organizes current-week readiness, matchup evidence, position-group comparisons, browser-local practice emphasis and unresolved pre-game items without creating an authoritative coaching plan.

The feature is intentionally a lab, not an approval workflow. It may surface recorded facts and scouting analysis, but it does not claim that Archers staff or Kevin Dorey selected a response.

## Data sources

The lab reads the smallest existing authoritative set needed for the current game:

| Source | Use |
| --- | --- |
| `archers_franchise_state / stl-2026` | Current week, opponent, preparation or game status when recorded, medical entries and global state version |
| Active console-visible `player` resources | Archers active-roster count and position-group membership |
| `decision_queue / decision-queue` | Open game-affecting decisions, recorded approval ownership and recorded deadlines |
| `team_identity / bal-2026` | Baltimore offensive and defensive identity |
| `team_staff / bal-2026` | Package completeness only in Lite v1 |
| `team_roster / bal-2026` | Baltimore player identity for projected groups and threats |
| `team_depth_chart / bal-2026-w03` | Projected starters, position groups, special teams and unresolved depth questions |
| `opponent_scouting / stl-bal-2026-w03` | Tendencies, threats, matchup-board observations and evidence-backed prompts |

Missing resources remain missing. The lab renders degraded or empty states and does not synthesize substitute facts.

## Evidence presentation

Every planning surface distinguishes four states:

1. **Authoritative fact**: loaded from franchise state or active console-visible resources.
2. **Scouting observation**: loaded from the Baltimore scouting dossier or recorded team identity.
3. **Unknown / unresolved**: an absent, projected, pending or expressly unresolved fact.
4. **Browser-local note**: text or checklist state stored only in the current browser.

Projected Baltimore depth is presented as a position-group pairing. The lab does not claim a precise one-to-one assignment unless authoritative alignment data exists.

Damon Kirkland’s knee status remains **unknown or unresolved** unless an explicit authoritative medical entry records a final availability result. Absence of an entry is never treated as clearance or availability.

## Local-only behavior

The Practice Emphasis Planner and matchup-note fields use one stable browser-storage document:

`archers-console-weekly-gameplan-lab-lite-v1`

Schema:

```json
{
  "schemaVersion": 1,
  "practice": {
    "pass-protection": false,
    "ball-security": false,
    "third-down": false,
    "red-zone": false,
    "two-minute-offense": false,
    "run-fits": false,
    "pressure-recognition": false,
    "special-teams-assignments": false
  },
  "notes": {
    "matchup-card-id": "Browser-local note"
  },
  "updatedAt": "ISO-8601 timestamp or null"
}
```

Local state is not synchronized, is not canon and is not an official coaching decision. The module issues only Supabase `select` reads and optional realtime subscriptions that trigger fresh reads.

## Safety boundaries

Weekly Gameplan Lab Lite v1 does not create or expose:

- Supabase inserts, updates, upserts, deletes or RPC writes;
- roster, contract, staff or medical changes;
- lineup approvals or game-plan approvals;
- personnel transactions;
- protected write workflows;
- AI strategy generation;
- season rollover logic;
- Kevin Dorey dialogue, decisions, promises, commitments or deliberate actions.

Scouting observations are not guaranteed outcomes. A local checkmark is not staff action. A recorded recommendation is not Kevin Dorey approval.

## Known limitations

- Lite v1 does not create, edit or approve a coaching plan.
- Exact one-to-one assignments remain unknown when projected depth or alignment is not explicit.
- The lab does not infer injury availability from silence, role, depth position or practice emphasis.
- Browser-local planning data does not sync between devices or browsers.
- `team_staff` is checked for package completeness but staff-specific recommendation records are shown only when they exist in the Decision Queue.
- Live content reflects the latest successful read and may change when authoritative state or resources change.

## How to test

### Static and DOM validation

```bash
node --check phase4-weekly-gameplan-lab-lite.js
node --check tests/weekly-gameplan-lab-lite/gameplan-lab-dom-smoke.js
node --check tests/weekly-gameplan-lab-lite/gameplan-lab-live-browser.mjs
python tests/weekly-gameplan-lab-lite/gameplan-lab-v1-static.py
npm install --no-save jsdom@24.1.3
node tests/weekly-gameplan-lab-lite/gameplan-lab-dom-smoke.js
```

The DOM smoke suite verifies Week Three and Baltimore presentation, the 53-player active-roster derivation, Damon Kirkland’s unresolved fallback, all four evidence states, local checklist and note persistence, local reset, pre-game gate items, the safe empty state and missing Baltimore-resource degradation.

### Existing regression suites

```bash
python tests/portal/portal-v1-static.py
python tests/opponent-package/static-validation.py
python tests/squad-planner/squad-planner-v1-static.py
python tests/recruitment-market-desk/market-desk-v1-static.py
```

### Live browser validation

```bash
npm install --no-save playwright@1.54.1
npx playwright install --with-deps chromium
python -m http.server 4173 --bind 127.0.0.1
GAMEPLAN_BASE_URL=http://127.0.0.1:4173 \
GAMEPLAN_EVIDENCE_DIR=gameplan-lab-browser-evidence \
node tests/weekly-gameplan-lab-lite/gameplan-lab-live-browser.mjs
```

The browser run verifies desktop and narrower viewports, persistence across reload, reset, navigation integration, the existing Portal, Opponent Command Room, Squad Planner and Recruitment & Market Desk roots, console errors, overflow and absence of Supabase write requests.

## Reset browser-local data

Use **Reset local planning data** in the Practice Emphasis Planner. It removes `archers-console-weekly-gameplan-lab-lite-v1`, clears all checkmarks and matchup notes, and does not modify authoritative data.

For manual developer cleanup in the browser console:

```js
localStorage.removeItem("archers-console-weekly-gameplan-lab-lite-v1");
location.reload();
```

## Rollback

Before deployment, close the draft pull request or revert its feature commit. After an approved deployment, revert the merge commit and redeploy the prior known-good `main` head through the repository’s existing GitHub Pages workflow. No Supabase rollback is required because the feature performs no backend writes.

## Deployment verification

Deployment requires separate explicit approval. For a later approved deployment:

1. Confirm the approved pull request and exact commit hash.
2. Confirm the production `main` head before merging or deploying.
3. Deploy through the repository’s established GitHub Pages workflow.
4. Load `index-phase3.html` and confirm console version `4.3.0-weekly-gameplan-lab-lite-v1`.
5. Verify Portal and Weekly Ops navigation.
6. Verify the Baltimore Opponent Command Room.
7. Verify Weekly Gameplan Lab Lite readiness, matchup board, matchup cards, checklist and decision gate.
8. Verify Squad Planner.
9. Verify Recruitment & Market Desk.
10. Inspect browser network traffic and confirm no write request occurred.
11. Confirm the Supabase global state version did not change because of console verification.
12. Record the deployed commit hash, state version before and after, screenshots and verification result.
