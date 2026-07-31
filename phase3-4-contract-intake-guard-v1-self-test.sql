-- Contract Intake Guard v1 installation self-test.
-- Exercises the read-only validator and both direct-write outcomes inside the
-- migration transaction. No test resource, state change, audit row, or canon
-- event survives this migration.

begin;

do $guard_self_test$
declare
  v_state_version integer;
  v_season integer;
  v_result jsonb;
  v_rejected boolean := false;
  v_valid_id constant text := 'contract-intake-guard-valid-self-test';
  v_invalid_id constant text := 'contract-intake-guard-invalid-self-test';
begin
  select
    version,
    coalesce(
      nullif(state #>> '{timeline,season}', '')::integer,
      nullif(state ->> 'current_season', '')::integer,
      nullif(state ->> 'season', '')::integer,
      nullif(state #>> '{franchise,season}', '')::integer
    )
  into v_state_version, v_season
  from public.archers_franchise_state
  where id = 'stl-2026';

  if v_state_version is null or v_season is null then
    raise exception 'Contract Intake Guard self-test requires current state version and season';
  end if;

  v_result := public.archers_validate_contract_intake(
    'player',
    v_valid_id,
    jsonb_build_object(
      'season', v_season,
      'status', 'ACTIVE',
      'data', jsonb_build_object(
        'team_id', 'stl-2026',
        'roster_status', 'ACTIVE_ROSTER',
        'contract', jsonb_build_object(
          'contract_kind', 'PLAYER',
          'start_season', v_season,
          'end_season', v_season + 1,
          'contract_value_millions', 2.1,
          'salary_by_season', jsonb_build_object(
            v_season::text, 1.0,
            (v_season + 1)::text, 1.1
          ),
          'cap_hit_by_season', jsonb_build_object(
            v_season::text, 1.0,
            (v_season + 1)::text, 1.1
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
    raise exception 'Contract Intake Guard validator self-test failed: %', v_result;
  end if;

  begin
    insert into public.archers_resources (
      franchise_id, resource_type, resource_id, season, data,
      status, visibility, provenance, version
    ) values (
      'stl-2026', 'player', v_invalid_id, v_season,
      jsonb_build_object(
        'team_id', 'stl-2026',
        'roster_status', 'ACTIVE_ROSTER'
      ),
      'ACTIVE', 'PRIVATE', 'SYSTEM', 1
    );
  exception when others then
    if position('CONTRACT_INTAKE_REJECTED' in sqlerrm) = 0 then
      raise;
    end if;
    v_rejected := true;
  end;

  if not v_rejected then
    raise exception 'Contract Intake Guard invalid-write self-test unexpectedly succeeded';
  end if;

  insert into public.archers_resources (
    franchise_id, resource_type, resource_id, season, data,
    status, visibility, provenance, version
  ) values (
    'stl-2026', 'player', v_valid_id, v_season,
    jsonb_build_object(
      'team_id', 'stl-2026',
      'roster_status', 'ACTIVE_ROSTER',
      'contract', jsonb_build_object(
        'contract_kind', 'PLAYER',
        'start_season', v_season,
        'end_season', v_season + 1,
        'contract_value_millions', 2.1,
        'salary_by_season', jsonb_build_object(
          v_season::text, 1.0,
          (v_season + 1)::text, 1.1
        ),
        'cap_hit_by_season', jsonb_build_object(
          v_season::text, 1.0,
          (v_season + 1)::text, 1.1
        ),
        'options', jsonb_build_array()
      )
    ),
    'ACTIVE', 'PRIVATE', 'SYSTEM', 1
  );

  if not exists (
    select 1
    from public.archers_resources
    where franchise_id = 'stl-2026'
      and resource_type = 'player'
      and resource_id = v_valid_id
      and data #>> '{contract,contract_intake_guard,version}' = '1'
      and data #>> '{contract,current_season}' = v_season::text
  ) then
    raise exception 'Contract Intake Guard valid-write self-test was not normalized';
  end if;

  delete from public.archers_resources
  where franchise_id = 'stl-2026'
    and resource_type = 'player'
    and resource_id = v_valid_id;

  if exists (
    select 1
    from public.archers_resources
    where franchise_id = 'stl-2026'
      and resource_id in (v_valid_id, v_invalid_id)
  ) then
    raise exception 'Contract Intake Guard self-test left a resource behind';
  end if;
end;
$guard_self_test$;

commit;
