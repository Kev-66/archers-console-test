# Contract Intake Guard v1

## Purpose

Contract Intake Guard v1 prevents a drafted player, signing, extension, trade acquisition, practice-squad agreement, or staff contract from entering authoritative franchise resources in a format that the Season Rollover Engine cannot process.

The guard is enforced inside PostgreSQL. Edge Function validation improves the workflow, but database triggers remain the final authority for direct writes, generic `upsert_resource`, `bulk_upsert_resources`, and future composite transaction operations.

## Guarded resources

The guard recognizes:

- `player` with a nested `data.contract`
- `staff` with a nested `data.contract`
- `player_contract`
- `staff_contract`
- generic `contract`

An active Archers player in a signed or rostered status requires a canonical contract. Every active Archers staff resource requires a canonical contract. Any resource carrying contract signals is guarded even when it belongs to another team.

A contractless non-Archers player profile may remain valid when it is plainly a scouting or game-preparation record and contains no contract summary, cap field, salary field, or contract object.

Archived records remain historical evidence and are not forced to contain current schedules.

## Canonical requirements

The guard requires or deterministically establishes:

- contract schema version 1
- `contract_kind` of `PLAYER` or `STAFF`
- stable player or staff identity
- four-digit `end_season`
- optional four-digit `start_season`
- complete `salary_by_season` coverage through the contract end
- complete player `cap_hit_by_season` coverage through the contract end
- USD currency and amounts expressed in millions
- valid guarantees and options
- scheduled salary total matching `contract_value_millions` when that value is supplied

Missing original start seasons remain warnings rather than blockers because a remaining-term contract can still roll forward from its established current and future schedules.

Legacy strings such as `3 yrs/$30M` are never converted automatically. A legacy summary without a canonical schedule is rejected.

## Derived fields

Before an accepted write reaches `archers_resources`, the immediate trigger derives:

- `current_season`
- `years_remaining`
- `current_salary`
- `current_salary_season`
- player `current_cap_hit`
- player `current_cap_hit_season`
- `rollover_status`
- `options_due`
- a deterministic contract fingerprint
- compatibility fields used by the console, including the current season cap field

The guard does not exercise an option, sign or release a player, hire or fire staff, restructure compensation, create a role guarantee, or make another discretionary personnel decision.

## Validation operation

Backend 3.4.0 exposes:

```text
operation: validate_contract_intake
```

It is read-only and requires:

- `dry_run: true`
- guarded `resource_type`
- stable `resource_id`
- current `expected_state_version`
- one native JSON payload containing the proposed resource data

A guarded `upsert_resource` dry run uses the same validator automatically. Bulk writes remain protected atomically by the database trigger; callers should preview each contract-bearing item before executing a consequential bulk transaction.

The validation response includes blockers, warnings, normalized data, normalized contract, effective season, and a fingerprint. It creates no operation log, canon event, resource, or state change.

## Rollover compatibility

The Season Rollover Engine updates contract resources before advancing franchise state inside one transaction. The immediate guard temporarily recognizes a correctly marked pending rollover update. A deferred constraint trigger then validates every changed contract against the final franchise season at transaction commit.

A fabricated future-season contract can therefore pass neither an ordinary write nor the deferred transaction boundary. Any disagreement rolls back the full transaction.

## Failure behavior

Invalid contract-bearing writes raise `CONTRACT_INTAKE_REJECTED` with structured blocker details. A multi-row statement containing one invalid contract rolls back every row from that statement. Deferred final-state mismatches raise `CONTRACT_INTAKE_DEFERRED_REJECTION` or `CONTRACT_INTAKE_DERIVATION_DRIFT` and roll back the transaction.
