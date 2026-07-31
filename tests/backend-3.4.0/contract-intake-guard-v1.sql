\set ON_ERROR_STOP on

-- Contract Intake Guard v1 runs after the existing Backend 3.3.0 regressions.
-- The fixture is therefore in season 2027 with four canonical rollover contracts.

-- Read-only validation accepts a complete drafted-player contract and writes nothing.
do $$
declare
  v_state_version integer := (
    select version from public.archers_franchise_state where id = 'stl-2026'
  );
  v_result jsonb;
begin
  v_result := public.archers_validate_contract_intake(
    'player',
    'validation-only-rookie',
    jsonb_build_object(
      'season', 2027,
      'status', 'ACTIVE',
      'data', jsonb_build_object(
        'player_name', 'Validation Rookie',
        'team_id', 'stl-2026',
        'roster_status', 'ACTIVE_ROSTER',
        'contract', jsonb_build_object(
          'contract_kind', 'PLAYER',
          'start_season', 2027,
          'end_season', 2030,
          'salary_by_season', jsonb_build_object(
            '2027', 1.0, '2028', 1.1, '2029', 1.2, '2030', 1.3
          ),
          'cap_hit_by_season', jsonb_build_object(
            '2027', 1.0, '2028', 1.1, '2029', 1.2, '2030', 1.3
          ),
          'options', jsonb_build_array()
        )
      )
    ),
    v_state_version
  );

  if (v_result ->> 'accepted')::boolean is distinct from true
     or (v_result ->> 'writes_performed')::boolean is distinct from false
     or (v_result ->> 'blocker_count')::integer <> 0 then
    raise exception 'valid intake preview failed: %', v_result;
  end if;
  if v_result #>> '{normalized_contract,player_id}' <> 'validation-only-rookie'
     or v_result #>> '{normalized_contract,current_season}' <> '2027'
     or v_result #>> '{normalized_contract,years_remaining}' <> '4'
     or v_result #>> '{normalized_contract,contract_intake_guard,version}' <> '1' then
    raise exception 'valid intake preview did not derive canonical fields: %', v_result;
  end if;
  if exists (
    select 1 from public.archers_resources
    where franchise_id = 'stl-2026'
      and resource_type = 'player'
      and resource_id = 'validation-only-rookie'
  ) then
    raise exception 'validation RPC wrote a resource';
  end if;
  if (select version from public.archers_franchise_state where id = 'stl-2026') <> v_state_version then
    raise exception 'validation RPC changed state version';
  end if;
end;
$$;

-- A drafted player is normalized automatically at insert.
insert into public.archers_resources (
  franchise_id, resource_type, resource_id, season, data,
  status, visibility, provenance, version
) values (
  'stl-2026', 'player', 'rookie-guard', null,
  jsonb_build_object(
    'player_name', 'Rookie Guard',
    'team_id', 'stl-2026',
    'roster_status', 'ACTIVE_ROSTER',
    'contract', jsonb_build_object(
      'start_season', 2027,
      'end_season', 2030,
      'contract_value_millions', 5.2,
      'salary_by_season', jsonb_build_object(
        '2027', 1.0, '2028', 1.2, '2029', 1.4, '2030', 1.6
      ),
      'cap_hit_by_season', jsonb_build_object(
        '2027', 1.0, '2028', 1.2, '2029', 1.4, '2030', 1.6
      ),
      'options', jsonb_build_array(
        jsonb_build_object(
          'season', 2031,
          'option_type', 'TEAM_FIFTH_YEAR',
          'status', 'UNRESOLVED'
        )
      )
    )
  ),
  'ACTIVE', 'CONSOLE', 'USER_EXPLICIT', 1
);

do $$
declare
  v_row public.archers_resources%rowtype;
  v_contract jsonb;
begin
  select * into v_row
  from public.archers_resources
  where franchise_id = 'stl-2026'
    and resource_type = 'player'
    and resource_id = 'rookie-guard';

  v_contract := v_row.data -> 'contract';
  if v_row.season <> 2027
     or v_contract ->> 'contract_schema_version' <> '1'
     or v_contract ->> 'contract_kind' <> 'PLAYER'
     or v_contract ->> 'player_id' <> 'rookie-guard'
     or v_contract ->> 'current_season' <> '2027'
     or v_contract ->> 'years_remaining' <> '4'
     or (v_contract ->> 'current_salary')::numeric <> 1.0
     or (v_contract ->> 'current_cap_hit')::numeric <> 1.0
     or v_row.data ->> 'contract_years_remaining' <> '4'
     or (v_row.data ->> 'current_cap_hit_millions')::numeric <> 1.0
     or (v_row.data ->> 'cap_hit_2027_millions')::numeric <> 1.0 then
    raise exception 'drafted-player contract was not normalized: %', v_row.data;
  end if;
end;
$$;

-- A traded player may retain an original start season before the current season.
insert into public.archers_resources (
  franchise_id, resource_type, resource_id, season, data,
  status, visibility, provenance, version
) values (
  'stl-2026', 'player', 'trade-acquisition', 2027,
  jsonb_build_object(
    'player_name', 'Trade Acquisition',
    'team_id', 'stl-2026',
    'roster_status', 'ACTIVE_ROSTER',
    'contract', jsonb_build_object(
      'contract_kind', 'PLAYER',
      'player_id', 'trade-acquisition',
      'start_season', 2025,
      'end_season', 2029,
      'contract_value_millions', 24.0,
      'salary_by_season', jsonb_build_object(
        '2027', 7.0, '2028', 8.0, '2029', 9.0
      ),
      'cap_hit_by_season', jsonb_build_object(
        '2027', 6.5, '2028', 8.2, '2029', 9.3
      ),
      'options', jsonb_build_array()
    )
  ),
  'ACTIVE', 'CONSOLE', 'USER_EXPLICIT', 1
);

-- Practice-squad agreements and staff contracts use the same guard.
insert into public.archers_resources (
  franchise_id, resource_type, resource_id, season, data,
  status, visibility, provenance, version
) values
(
  'stl-2026', 'player', 'practice-squad-intake', 2027,
  jsonb_build_object(
    'player_name', 'Practice Squad Intake',
    'team_id', 'stl-2026',
    'roster_status', 'PRACTICE_SQUAD',
    'contract', jsonb_build_object(
      'contract_kind', 'PLAYER',
      'employment_class', 'PRACTICE_SQUAD',
      'start_season', 2027,
      'end_season', 2027,
      'weekly_salary_by_season', jsonb_build_object('2027', 16000),
      'scheduled_weeks_by_season', jsonb_build_object('2027', 18),
      'salary_by_season', jsonb_build_object('2027', 0.288),
      'cap_hit_by_season', jsonb_build_object('2027', 0.288),
      'options', jsonb_build_array()
    )
  ),
  'ACTIVE', 'CONSOLE', 'USER_EXPLICIT', 1
),
(
  'stl-2026', 'staff', 'staff-intake', 2027,
  jsonb_build_object(
    'staff_name', 'Staff Intake',
    'team_id', 'stl-2026',
    'position', 'Quality Control Coach',
    'contract', jsonb_build_object(
      'contract_kind', 'STAFF',
      'start_season', 2027,
      'end_season', 2029,
      'salary_by_season', jsonb_build_object(
        '2027', 0.45, '2028', 0.50, '2029', 0.55
      ),
      'options', jsonb_build_array()
    )
  ),
  'ACTIVE', 'PRIVATE', 'USER_EXPLICIT', 1
);

-- Contractless non-Archers scouting profiles remain legal.
insert into public.archers_resources (
  franchise_id, resource_type, resource_id, season, data,
  status, visibility, provenance, version
) values (
  'stl-2026', 'player', 'opponent-scout-only', 2027,
  jsonb_build_object(
    'player_name', 'Opponent Scout Only',
    'team_id', 'opponent-team',
    'roster_status', 'ACTIVE_ROSTER',
    'scouting_scope', 'GAME_PREPARATION'
  ),
  'ACTIVE', 'PRIVATE', 'SYSTEM', 1
);

-- Active Archers players cannot enter without a canonical contract.
do $$
declare
  v_failed boolean := false;
begin
  begin
    insert into public.archers_resources (
      franchise_id, resource_type, resource_id, season, data,
      status, visibility, provenance, version
    ) values (
      'stl-2026', 'player', 'missing-contract', 2027,
      jsonb_build_object(
        'player_name', 'Missing Contract',
        'team_id', 'stl-2026',
        'roster_status', 'ACTIVE_ROSTER'
      ),
      'ACTIVE', 'CONSOLE', 'SYSTEM', 1
    );
  exception when others then
    if position('CONTRACT_INTAKE_REJECTED' in sqlerrm) = 0 then
      raise;
    end if;
    v_failed := true;
  end;

  if not v_failed then
    raise exception 'active Archers player without contract unexpectedly succeeded';
  end if;
end;
$$;

-- Legacy summary-only data is rejected rather than guessed.
do $$
declare
  v_failed boolean := false;
begin
  begin
    insert into public.archers_resources (
      franchise_id, resource_type, resource_id, season, data,
      status, visibility, provenance, version
    ) values (
      'stl-2026', 'player', 'legacy-intake', 2027,
      jsonb_build_object(
        'player_name', 'Legacy Intake',
        'team_id', 'opponent-team',
        'contract_summary', 'Three years remaining'
      ),
      'ACTIVE', 'PRIVATE', 'SYSTEM', 1
    );
  exception when others then
    v_failed := position('CONTRACT_INTAKE_REJECTED' in sqlerrm) > 0;
  end;

  if not v_failed then
    raise exception 'legacy summary-only contract unexpectedly succeeded';
  end if;
end;
$$;

-- Missing schedule years, value mismatches, invalid options, and excessive guarantees are blockers.
do $$
declare
  v_result jsonb;
  v_version integer := (
    select version from public.archers_franchise_state where id = 'stl-2026'
  );
begin
  v_result := public.archers_validate_contract_intake(
    'player',
    'invalid-schedule',
    jsonb_build_object(
      'season', 2027,
      'status', 'ACTIVE',
      'data', jsonb_build_object(
        'team_id', 'stl-2026',
        'roster_status', 'ACTIVE_ROSTER',
        'contract', jsonb_build_object(
          'contract_kind', 'PLAYER',
          'start_season', 2027,
          'end_season', 2029,
          'contract_value_millions', 30.0,
          'salary_by_season', jsonb_build_object('2027', 8.0, '2029', 9.0),
          'cap_hit_by_season', jsonb_build_object('2027', 8.0, '2028', 9.0),
          'guaranteed_by_season', jsonb_build_object('2027', 9.0),
          'options', jsonb_build_array(
            jsonb_build_object('season', 'bad', 'status', 'MAYBE')
          )
        )
      )
    ),
    v_version
  );

  if (v_result ->> 'accepted')::boolean is distinct from false
     or (v_result ->> 'blocker_count')::integer < 5 then
    raise exception 'invalid contract did not return expected blockers: %', v_result;
  end if;
  if not (v_result -> 'blockers' @> jsonb_build_array(jsonb_build_object('code', 'MISSING_SALARY_SCHEDULE')))
     or not (v_result -> 'blockers' @> jsonb_build_array(jsonb_build_object('code', 'MISSING_CAP_SCHEDULE')))
     or not (v_result -> 'blockers' @> jsonb_build_array(jsonb_build_object('code', 'CONTRACT_VALUE_MISMATCH')))
     or not (v_result -> 'blockers' @> jsonb_build_array(jsonb_build_object('code', 'INVALID_OPTION_SEASON')))
     or not (v_result -> 'blockers' @> jsonb_build_array(jsonb_build_object('code', 'GUARANTEE_EXCEEDS_SALARY'))) then
    raise exception 'expected blocker codes are missing: %', v_result -> 'blockers';
  end if;
end;
$$;

-- A multi-row write rolls back atomically when one contract fails.
do $$
declare
  v_failed boolean := false;
begin
  begin
    insert into public.archers_resources (
      franchise_id, resource_type, resource_id, season, data,
      status, visibility, provenance, version
    ) values
    (
      'stl-2026', 'player', 'bulk-valid', 2027,
      jsonb_build_object(
        'team_id', 'stl-2026',
        'roster_status', 'ACTIVE_ROSTER',
        'contract', jsonb_build_object(
          'contract_kind', 'PLAYER',
          'start_season', 2027,
          'end_season', 2027,
          'salary_by_season', jsonb_build_object('2027', 1.0),
          'cap_hit_by_season', jsonb_build_object('2027', 1.0),
          'options', jsonb_build_array()
        )
      ),
      'ACTIVE', 'CONSOLE', 'SYSTEM', 1
    ),
    (
      'stl-2026', 'player', 'bulk-invalid', 2027,
      jsonb_build_object(
        'team_id', 'stl-2026',
        'roster_status', 'ACTIVE_ROSTER',
        'contract', jsonb_build_object(
          'contract_kind', 'PLAYER',
          'start_season', 2027,
          'end_season', 2028,
          'salary_by_season', jsonb_build_object('2027', 1.0),
          'cap_hit_by_season', jsonb_build_object('2027', 1.0),
          'options', jsonb_build_array()
        )
      ),
      'ACTIVE', 'CONSOLE', 'SYSTEM', 1
    );
  exception when others then
    v_failed := position('CONTRACT_INTAKE_REJECTED' in sqlerrm) > 0;
  end;

  if not v_failed then
    raise exception 'invalid bulk intake unexpectedly succeeded';
  end if;
  if exists (
    select 1 from public.archers_resources
    where franchise_id = 'stl-2026'
      and resource_id in ('bulk-valid', 'bulk-invalid')
  ) then
    raise exception 'failed bulk intake left a partial resource';
  end if;
end;
$$;

-- Archived records are historical evidence and do not need current schedules.
insert into public.archers_resources (
  franchise_id, resource_type, resource_id, season, data,
  status, visibility, provenance, version
) values (
  'stl-2026', 'player', 'archived-legacy-intake', 2025,
  jsonb_build_object('contract_summary', 'Historical legacy evidence'),
  'ARCHIVED', 'PRIVATE', 'SYSTEM', 1
);

-- Updating an existing player with an extension recomputes derived fields.
update public.archers_resources
set
  data = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          data,
          '{contract,end_season}',
          '2031'::jsonb,
          true
        ),
        '{contract,salary_by_season}',
        (data #> '{contract,salary_by_season}') || jsonb_build_object('2031', 1.8),
        true
      ),
      '{contract,cap_hit_by_season}',
      (data #> '{contract,cap_hit_by_season}') || jsonb_build_object('2031', 1.8),
      true
    ),
    '{contract,contract_value_millions}',
    '7.0'::jsonb,
    true
  ),
  version = version + 1
where franchise_id = 'stl-2026'
  and resource_type = 'player'
  and resource_id = 'rookie-guard';

do $$
declare
  v_contract jsonb := (
    select data -> 'contract'
    from public.archers_resources
    where franchise_id = 'stl-2026'
      and resource_type = 'player'
      and resource_id = 'rookie-guard'
  );
begin
  if v_contract ->> 'end_season' <> '2031'
     or v_contract ->> 'years_remaining' <> '5'
     or v_contract ->> 'rollover_status' <> 'ACTIVE' then
    raise exception 'extension did not recompute derived fields: %', v_contract;
  end if;
end;
$$;

-- Season rollover remains compatible with the immediate and deferred guards.
create temporary table guarded_rollover_preview as
select public.archers_rollover_season(
  'season_rollover',
  'season-rollover',
  jsonb_build_object(
    'from_season', 2027,
    'to_season', 2028,
    'strict', true,
    'detail_limit', 100
  ),
  (select version from public.archers_franchise_state where id = 'stl-2026'),
  'contract-intake-guard-rollover-preview',
  'Preview rollover with Contract Intake Guard v1',
  'SYSTEM',
  null,
  true
) as result;

do $$
declare
  v_result jsonb := (select result from guarded_rollover_preview);
begin
  if (v_result ->> 'ready_to_execute')::boolean is distinct from true
     or (v_result ->> 'blocker_count')::integer <> 0 then
    raise exception 'guarded rollover preview is not ready: %', v_result;
  end if;
end;
$$;

create temporary table guarded_rollover_execution as
select public.archers_rollover_season(
  'season_rollover',
  'season-rollover',
  jsonb_build_object(
    'from_season', 2027,
    'to_season', 2028,
    'strict', true,
    'detail_limit', 100,
    'expected_resources', (
      select result -> 'expected_resources' from guarded_rollover_preview
    )
  ),
  (select version from public.archers_franchise_state where id = 'stl-2026'),
  'contract-intake-guard-rollover-execute',
  'Execute rollover compatibility regression for Contract Intake Guard v1',
  'SYSTEM',
  null,
  false
) as result;

do $$
declare
  v_contract jsonb;
  v_data jsonb;
begin
  if (select state #>> '{timeline,season}'
      from public.archers_franchise_state where id = 'stl-2026') <> '2028' then
    raise exception 'guarded rollover did not advance the state season';
  end if;

  select data, data -> 'contract'
  into v_data, v_contract
  from public.archers_resources
  where franchise_id = 'stl-2026'
    and resource_type = 'player'
    and resource_id = 'rookie-guard';

  if v_contract ->> 'current_season' <> '2028'
     or v_contract ->> 'years_remaining' <> '4'
     or (v_contract ->> 'current_salary')::numeric <> 1.2
     or (v_contract ->> 'current_cap_hit')::numeric <> 1.2
     or v_contract #>> '{contract_intake_guard,validated_season}' <> '2028'
     or (v_data ->> 'cap_hit_2028_millions')::numeric <> 1.2 then
    raise exception 'guard and rollover did not reconcile derived fields: %', v_data;
  end if;

  if not exists (
    select 1 from public.archers_operation_log
    where idempotency_key = 'contract-intake-guard-rollover-execute'
      and status = 'SUCCESS'
  ) then
    raise exception 'guarded rollover operation log missing';
  end if;
end;
$$;

select 'contract intake guard v1 regressions passed' as result;
