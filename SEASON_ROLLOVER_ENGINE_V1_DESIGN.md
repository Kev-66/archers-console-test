# Season Rollover Engine v1

## Status

Backend design for Draft a Dynasty Backend 3.3.0.

Season Rollover Engine v1 advances the authoritative franchise season by exactly one year and rolls forward every populated player and staff contract that has canonical structured terms. The operation is atomic, dry-run first, idempotent, version protected, and deliberately non-discretionary.

## Operation

```text
operation: rollover_season
resource_type: season_rollover
resource_id: season-rollover
```

The dedicated PostgreSQL function is:

```text
public.archers_rollover_season(...)
```

The generic `archers_execute_operation` function is not modified.

## Required request shape

```json
{
  "operation": "rollover_season",
  "resource_type": "season_rollover",
  "resource_id": "season-rollover",
  "expected_state_version": 35,
  "idempotency_key": "season-rollover-2026-to-2027-preview-v1",
  "summary": "Preview the 2026 to 2027 season rollover",
  "source_label": "SYSTEM",
  "dry_run": true,
  "payload": {
    "from_season": 2026,
    "to_season": 2027,
    "strict": true
  }
}
```

A real execution must resend the dry run's exact `expected_resources` array with a new idempotency key and the still-current state version.

## Contract coverage

The engine inspects active resources of these types:

- `player`
- `staff`
- `player_contract`
- `staff_contract`
- `contract`

For `player` and `staff`, canonical contract data lives under `data.contract`.

For dedicated contract resources, the resource `data` object is the contract object.

A populated person without contract information is ignored. A record that contains only legacy fields such as `contract_summary`, a season-specific cap field, or practice-squad weekly salary is reported as a normalization blocker. The engine never parses prose to invent future terms.

## Canonical contract facts

The rollover relies on absolute terms:

- `start_season`, when established
- `end_season`
- `salary_by_season`
- `cap_hit_by_season`
- `options`

Derived current fields are refreshed by the operation:

- `current_season`
- `years_remaining`
- `current_salary`
- `current_salary_season`
- `current_cap_hit`
- `current_cap_hit_season`
- `rollover_status`
- `options_due`
- `last_rollover`

Unknown compensation remains `null`. Missing future money is a warning, not permission to infer a number.

## Status derivation

For the new season:

- `ACTIVE`: `end_season` is later than the new season.
- `FINAL_YEAR`: `end_season` equals the new season.
- `EXPIRED`: `end_season` is earlier than the new season.

`years_remaining` is derived as `max(end_season - new_season + 1, 0)`.

An expired contract is flagged only. The engine does not release, re-sign, renew, tag, replace, promote, or otherwise move the person.

## Player and staff parity

Player and staff contracts use the same rollover guarantees:

- one-season advancement;
- scheduled compensation selection;
- remaining-year derivation;
- final-year and expiration flags;
- option-due reporting;
- no discretionary action.

Player contracts may additionally provide `cap_hit_by_season`. Staff contracts normally omit it.

## Dry-run protocol

The dry run:

1. Locks all candidate contract resources in stable `resource_type/resource_id` order.
2. Validates the current state version and authoritative current season.
3. Classifies canonical, legacy, malformed, final-year, and expiring contracts.
4. Calculates scheduled salary and cap changes.
5. Flags unresolved options without exercising them.
6. Returns blockers, warnings, detailed changes, and an exact resource-version fingerprint.
7. Writes nothing to state, resources, canon events, or operation logs.

`ready_to_execute` is true only when no blocker exists.

## Atomic execution

Execution requires:

- the same `from_season` and `to_season`;
- the current global state version;
- the exact `expected_resources` fingerprint returned by the dry run;
- a new idempotency key;
- `dry_run: false`.

Within one database transaction, the operation:

1. Re-locks the same contract population.
2. Rejects additions, removals, version changes, malformed contracts, and season conflicts.
3. Updates every processable contract and increments every affected resource version.
4. Advances `state.season`, `state.current_season`, and `state.timeline.season`.
5. Records rollover metadata in franchise state.
6. Increments global state exactly once.
7. Creates one `season_rollover` canon event.
8. Creates one successful operation-log record.

Any error rolls back the entire transaction.

## Explicitly excluded from v1

Season Rollover Engine v1 does not automatically:

- exercise or decline an option;
- renew or terminate a player or staff contract;
- release, waive, tag, tender, promote, demote, hire, or fire anyone;
- create free-agent destinations;
- restructure compensation;
- invent guarantees, buyouts, dead money, cap charges, or salaries;
- advance schedules, standings, draft classes, awards, or league transactions.

Those remain separate verified operations and decisions.

## Operation verification

Backend 3.3.0 operation verification reads `affected_resource_versions` from the successful operation log, reloads those resources, and requires their current versions to be at or beyond the logged rollover versions. Verification still requires the resulting state version and at least one canon event.

## Safe deployment sequence

1. Apply `phase3-3-season-rollover-v1.sql`.
2. Deploy the complete Backend 3.3.0 Edge source.
3. Confirm capabilities advertise `rollover_season` and `ATOMIC_SEASON_ROLLOVER`.
4. Run only a dry run against live state.
5. Normalize every reported legacy or malformed contract before any real rollover.
6. Execute only at the intended offseason boundary after Kevin approval.
7. Run `operation_verification` using the execution idempotency key.


## No automatic options

Options are reported as due or unresolved. The rollover engine never exercises or declines an option.


## Scale-safe verification

The execution fingerprint must contain each contract resource identity exactly once. Duplicate identities are rejected, preventing one valid resource from being repeated while another is omitted.

Operation verification reloads every logged affected resource in bounded database batches. It verifies the full set, while returning at most 250 resource summaries plus total, returned, and truncation metadata so Action responses remain bounded as the league grows.
