# Season Rollover Engine v1 Contract Schema

## Canonical placement

Current person resources use a nested contract:

```json
{
  "player_id": "jalen-knox",
  "player_name": "Jalen Knox",
  "contract": {
    "schema_version": 1,
    "contract_kind": "PLAYER",
    "start_season": 2026,
    "end_season": 2029,
    "salary_by_season": {
      "2026": 8.5,
      "2027": 11.0,
      "2028": 14.0,
      "2029": 17.5
    },
    "cap_hit_by_season": {
      "2026": 9.2,
      "2027": 12.1,
      "2028": 15.0,
      "2029": 18.4
    },
    "options": [],
    "current_season": 2026,
    "years_remaining": 4,
    "current_salary": 8.5,
    "current_cap_hit": 9.2,
    "rollover_status": "ACTIVE"
  }
}
```

Staff uses the same nested shape with `contract_kind: STAFF`. `cap_hit_by_season` is normally omitted.

Dedicated `player_contract`, `staff_contract`, or `contract` resources may place these fields at the root of `data`.

## Required for automatic rollover

- `end_season`: positive integer.
- `salary_by_season`: object when supplied.
- `cap_hit_by_season`: object when supplied.
- `options`: array when supplied.

`start_season` is recommended. Its absence produces a warning, while an invalid value blocks rollover.

## Compensation values

Money values are numeric ledger units chosen by the resource's documented convention. Existing Archers console resources generally use millions for cap fields. The engine preserves the values and does not convert units.

A schedule may omit an unknown season. The resulting current value becomes `null` and the dry run reports `NEXT_SEASON_COMPENSATION_UNKNOWN`.

## Options

```json
{
  "season": 2028,
  "type": "TEAM",
  "status": "UNRESOLVED",
  "amount": 12.0
}
```

Options in the destination season are copied into `options_due` unless their status is already `EXERCISED`, `DECLINED`, `VOIDED`, or `RESOLVED`. The original option entry is never changed by rollover.

## Legacy records

These fields remain display-compatible but are not enough for automatic rollover:

- `contract_summary`
- `cap_hit_2026_millions`
- `practice_squad_weekly_salary`

When one of those exists without a canonical contract object, the dry run returns `LEGACY_CONTRACT_REQUIRES_NORMALIZATION`. Prose and isolated current-year values are not converted automatically.

## Derived fields after rollover

```json
{
  "current_season": 2027,
  "years_remaining": 3,
  "current_salary": 11.0,
  "current_salary_season": 2027,
  "current_cap_hit": 12.1,
  "current_cap_hit_season": 2027,
  "rollover_status": "ACTIVE",
  "options_due": [],
  "last_rollover": {
    "from_season": 2026,
    "to_season": 2027,
    "processed_at": "database timestamp",
    "operation": "rollover_season"
  }
}
```

These values are derived views of the absolute contract schedule. They are not substitutes for `end_season` or the year-by-year schedules.
