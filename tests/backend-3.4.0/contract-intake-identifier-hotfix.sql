\set ON_ERROR_STOP on

-- Invalid preview identities must fail before a write reaches table constraints.
do $$
declare
  v_state_version integer := (
    select version from public.archers_franchise_state where id = 'stl-2026'
  );
  v_failed boolean := false;
begin
  begin
    perform public.archers_validate_contract_intake(
      'player',
      '__invalid-preview-id__',
      jsonb_build_object(
        'season', 2028,
        'status', 'ACTIVE',
        'data', jsonb_build_object(
          'team_id', 'stl-2026',
          'roster_status', 'ACTIVE_ROSTER',
          'contract', jsonb_build_object(
            'contract_kind', 'PLAYER',
            'start_season', 2028,
            'end_season', 2028,
            'salary_by_season', jsonb_build_object('2028', 1.0),
            'cap_hit_by_season', jsonb_build_object('2028', 1.0),
            'options', jsonb_build_array()
          )
        )
      ),
      v_state_version
    );
  exception when others then
    if position('resource_id has an unsupported format' in sqlerrm) = 0 then
      raise;
    end if;
    v_failed := true;
  end;

  if not v_failed then
    raise exception 'invalid preview resource ID unexpectedly succeeded';
  end if;
end;
$$;

-- A valid identity remains accepted after the patch.
do $$
declare
  v_state_version integer := (
    select version from public.archers_franchise_state where id = 'stl-2026'
  );
  v_result jsonb;
begin
  v_result := public.archers_validate_contract_intake(
    'player',
    'valid-preview-id',
    jsonb_build_object(
      'season', 2028,
      'status', 'ACTIVE',
      'data', jsonb_build_object(
        'team_id', 'stl-2026',
        'roster_status', 'ACTIVE_ROSTER',
        'contract', jsonb_build_object(
          'contract_kind', 'PLAYER',
          'start_season', 2028,
          'end_season', 2028,
          'salary_by_season', jsonb_build_object('2028', 1.0),
          'cap_hit_by_season', jsonb_build_object('2028', 1.0),
          'options', jsonb_build_array()
        )
      )
    ),
    v_state_version
  );

  if (v_result ->> 'accepted')::boolean is distinct from true
     or (v_result ->> 'blocker_count')::integer <> 0 then
    raise exception 'valid preview resource ID was rejected: %', v_result;
  end if;
end;
$$;

select 'contract intake identifier hotfix regressions passed' as result;
