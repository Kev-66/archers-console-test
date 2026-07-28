# Draft a Dynasty Phase Three Installation

## What Phase Three Changes

Phase Three installs one protected operations backend for routine franchise, league, resource, and Game Day work. After this one-time deployment, ordinary data changes should happen through the Custom GPT Action rather than copied SQL.

The backend can:

- Read complete franchise, league, schedule, resource, live-game, and audit state.
- Add and update teams, official games, and the Archers schedule.
- Create new generic resource types without another migration.
- Track players, contracts, injuries, staff, draft picks, transactions, promises, depth charts, inactive lists, and future concepts as versioned resources.
- Start and update a live game.
- Record drives, urgent game events, team statistics, and player statistics.
- Finalize an Archers game atomically.
- Reject stale writes.
- Prevent duplicate writes with idempotency keys.
- Soft-archive resources instead of deleting canon.
- Keep a private audit log and state snapshots.

The Action cannot execute arbitrary SQL, alter the schema, expose secrets, or hard-delete recorded history.

## One-Time Deployment Order

### 1. Install the database backend

Open `phase3-unified-operations.sql` in GitHub.

In Supabase:

1. Open **SQL Editor**.
2. Choose **New query**.
3. Paste the entire file.
4. Click **Run**.

Expected result:

```text
Success. No rows returned
```

The state version should advance once with a `SYSTEM` event stating that the Phase Three backend was installed.

### 2. Deploy the upgraded Edge Function

Open `edge-function-archers-franchise.ts` in GitHub.

In Supabase:

1. Open **Edge Functions**.
2. Open `archers-franchise`.
3. Replace the function code with the GitHub file.
4. Deploy the function.
5. Keep legacy JWT verification disabled, as before.
6. Do not change or reveal `ARCHERS_ACTION_KEY`.

### 3. Replace the Custom GPT Action schema

Open `openapi-archers-franchise.yaml` in GitHub.

In the Draft a Dynasty GPT editor:

1. Open **Configure → Actions**.
2. Replace the existing OpenAPI schema with the GitHub file.
3. Keep authentication configured as API Key, custom header `x-archers-key`.
4. Save the Action.

### 4. Replace the GPT instructions

Open `gpt-instructions-archers-franchise.txt` in GitHub.

Replace the GPT's current governing instructions with that file and save the GPT.

## Verification Tests

Run these through the Custom GPT in order.

### Test A: capabilities

```text
Read the current operations capabilities. Do not write anything.
```

Expected:

- Backend version `3.0`
- Read scopes including snapshot, league, game, resources, audit, and capabilities
- Write operations including start_game, record_drive, finalize_game, and generic resources

### Test B: full snapshot

```text
Read the complete current Draft a Dynasty operations snapshot. Do not write anything.
```

Expected:

- Current franchise state and state version
- Recent canon events
- Teams and standings
- League metadata
- Archers schedule
- Current live game, normally null before kickoff

### Test C: harmless dry run

```text
Dry-run a generic resource named system_test with resource ID phase3-test. Its data should say that Phase Three validation passed. Do not execute the write.
```

Expected:

- `dry_run: true`
- The normalized operation and payload
- Current state version
- A statement that no database write occurred

### Test D: harmless real resource write

```text
Create the private generic resource system_test with resource ID phase3-test. Store status Phase Three test passed. Use a unique idempotency key and save it as a SYSTEM operation.
```

Expected:

- A returned resource at version 1
- A new global state version
- A canon event and private operation-log entry

Then verify it:

```text
Read resource type system_test with resource ID phase3-test.
```

### Test E: duplicate protection

Ask the GPT to retry Test D using the exact same idempotency key and exact same payload.

Expected:

```text
idempotent_replay: true
```

No second resource version or canon event should be created.

## Game Day Activation Test

Do not run this until the Week Three active/inactive list, elevations, medical limits, and kickoff state have been established.

The first real game workflow will be:

1. Read snapshot.
2. Read game scope for the Week Three game ID.
3. Start the live game.
4. Record each completed drive with the returned live-game version.
5. Record urgent events immediately.
6. Reconcile cumulative statistics at quarter breaks.
7. Finalize the game once at the final whistle.

## Rollback Boundary

Git history preserves the previous Edge Function, Action schema, and instructions. Database history is not hard-deleted by Phase Three.

If installation fails:

1. Do not continue live play.
2. Copy the complete Supabase error message.
3. Do not rerun fragments of the migration independently.
4. Repair the migration as one reviewed unit.
5. Confirm the last verified state version before resuming.
