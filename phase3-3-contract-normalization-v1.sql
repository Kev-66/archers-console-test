-- Draft a Dynasty • Contract Normalization Migration v1
--
-- Adds one protected, idempotent database function for converting the sealed
-- 2026 legacy player contract summaries into canonical contract objects,
-- establishing the canonical non-owner staff resources, and setting the
-- explicit franchise season required by Season Rollover Engine v1.

begin;

create or replace function public.archers_normalize_contracts_v1(
  p_plan jsonb,
  p_expected_state_version integer,
  p_idempotency_key text,
  p_summary text,
  p_source_label text default 'USER_EXPLICIT',
  p_exact_kevin_text text default null,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation constant text := 'normalize_contracts';
  v_resource_type constant text := 'contract_normalization';
  v_resource_id constant text := 'contract-normalization-v1';
  v_plan jsonb := coalesce(p_plan, '{}'::jsonb);
  v_players jsonb;
  v_staff jsonb;
  v_state_patch jsonb;
  v_season integer;
  v_player_count integer := 0;
  v_staff_count integer := 0;
  v_unique_count integer := 0;
  v_legacy_player_count integer := 0;
  v_blockers jsonb := '[]'::jsonb;
  v_blocker_count integer := 0;
  v_player_entry jsonb;
  v_staff_entry jsonb;
  v_row public.archers_resources%rowtype;
  v_state_row public.archers_franchise_state%rowtype;
  v_existing_log public.archers_operation_log%rowtype;
  v_request_payload jsonb;
  v_plan_digest text;
  v_expected_version integer;
  v_updated_version integer;
  v_affected_before jsonb := '[]'::jsonb;
  v_affected_after jsonb := '[]'::jsonb;
  v_new_state jsonb;
  v_new_state_version integer;
  v_event_id bigint;
  v_operation_id bigint;
  v_result jsonb;
  v_now timestamptz := now();
begin
  if jsonb_typeof(v_plan) is distinct from 'object' then
    raise exception 'p_plan must be one JSON object';
  end if;

  if p_expected_state_version is null or p_expected_state_version < 1 then
    raise exception 'p_expected_state_version is required';
  end if;

  if coalesce(trim(p_idempotency_key), '') = '' then
    raise exception 'p_idempotency_key is required';
  end if;

  if coalesce(trim(p_summary), '') = '' then
    raise exception 'p_summary is required';
  end if;

  if coalesce(p_source_label, '') not in (
    'USER_EXPLICIT', 'LIVE_SESSION_LOG', 'CHECKPOINT', 'CORRECTION', 'SYSTEM'
  ) then
    raise exception 'unsupported source label: %', p_source_label;
  end if;

  begin
    v_season := (v_plan ->> 'season')::integer;
  exception when others then
    raise exception 'plan.season must be an integer';
  end;

  if v_season <> 2026 then
    raise exception 'Contract Normalization Migration v1 is limited to the sealed 2026 season';
  end if;

  v_players := coalesce(v_plan -> 'player_updates', '[]'::jsonb);
  v_staff := coalesce(v_plan -> 'staff_inserts', '[]'::jsonb);
  v_state_patch := coalesce(v_plan -> 'state_patch', '{}'::jsonb);

  if jsonb_typeof(v_players) is distinct from 'array' then
    raise exception 'plan.player_updates must be an array';
  end if;
  if jsonb_typeof(v_staff) is distinct from 'array' then
    raise exception 'plan.staff_inserts must be an array';
  end if;
  if jsonb_typeof(v_state_patch) is distinct from 'object' then
    raise exception 'plan.state_patch must be an object';
  end if;

  v_player_count := jsonb_array_length(v_players);
  v_staff_count := jsonb_array_length(v_staff);
  v_plan_digest := md5(v_plan::text);
  v_request_payload := jsonb_build_object(
    'plan_digest', v_plan_digest,
    'season', v_season,
    'player_count', v_player_count,
    'staff_count', v_staff_count,
    'expected_state_version', p_expected_state_version
  );

  select *
  into v_existing_log
  from public.archers_operation_log
  where idempotency_key = p_idempotency_key;

  if found then
    if not (
      v_existing_log.status = 'SUCCESS'
      and v_existing_log.operation = v_operation
      and v_existing_log.resource_type = v_resource_type
      and v_existing_log.resource_id = v_resource_id
      and v_existing_log.request_payload = v_request_payload
      and v_existing_log.summary = trim(p_summary)
      and v_existing_log.source_label = p_source_label
      and v_existing_log.exact_kevin_text is not distinct from nullif(p_exact_kevin_text, '')
    ) then
      raise exception 'idempotency_key was already used for a different request';
    end if;

    return v_existing_log.result_payload || jsonb_build_object('idempotent_replay', true);
  end if;

  select *
  into v_state_row
  from public.archers_franchise_state
  where id = 'stl-2026'
  for update;

  if not found then
    raise exception 'Archers franchise state has not been initialized';
  end if;

  if v_state_row.version <> p_expected_state_version then
    raise exception 'stale franchise state: expected %, current %',
      p_expected_state_version, v_state_row.version;
  end if;

  if nullif(v_state_row.state #>> '{franchise,season}', '') is distinct from v_season::text then
    v_blocker_count := v_blocker_count + 1;
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'SEALED_FRANCHISE_SEASON_CONFLICT',
      'expected', v_season,
      'actual', v_state_row.state #>> '{franchise,season}',
      'message', 'The sealed franchise section must establish the same season as the normalization plan.'
    ));
  end if;

  select count(*)
  into v_unique_count
  from (
    select distinct value ->> 'resource_id' as resource_id
    from jsonb_array_elements(v_players) as entries(value)
  ) as unique_players;

  if v_unique_count <> v_player_count then
    v_blocker_count := v_blocker_count + 1;
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'DUPLICATE_PLAYER_IDENTITIES',
      'message', 'player_updates contains duplicate resource identities.'
    ));
  end if;

  select count(*)
  into v_legacy_player_count
  from public.archers_resources
  where franchise_id = 'stl-2026'
    and resource_type = 'player'
    and status = 'ACTIVE'
    and jsonb_typeof(data -> 'contract') is distinct from 'object'
    and (
      data ? 'contract_summary'
      or data ? 'cap_hit_2026_millions'
      or data ? 'practice_squad_weekly_salary'
    );

  if v_player_count <> 69 or v_legacy_player_count <> v_player_count then
    v_blocker_count := v_blocker_count + 1;
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'PLAYER_SET_MISMATCH',
      'plan_count', v_player_count,
      'current_legacy_count', v_legacy_player_count,
      'message', 'The plan must cover the complete current 69-player legacy contract set.'
    ));
  end if;

  for v_player_entry in
    select value
    from jsonb_array_elements(v_players) as entries(value)
    order by value ->> 'resource_id'
  loop
    if jsonb_typeof(v_player_entry) is distinct from 'object'
       or coalesce(v_player_entry ->> 'resource_type', '') <> 'player'
       or coalesce(v_player_entry ->> 'resource_id', '') = ''
       or jsonb_typeof(v_player_entry -> 'contract') is distinct from 'object'
       or coalesce(v_player_entry #>> '{contract,contract_kind}', '') <> 'PLAYER' then
      v_blocker_count := v_blocker_count + 1;
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'PLAYER_PLAN_ENTRY_INVALID',
        'resource_id', v_player_entry ->> 'resource_id'
      ));
      continue;
    end if;

    begin
      v_expected_version := (v_player_entry ->> 'expected_version')::integer;
    exception when others then
      v_blocker_count := v_blocker_count + 1;
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'PLAYER_EXPECTED_VERSION_INVALID',
        'resource_id', v_player_entry ->> 'resource_id'
      ));
      continue;
    end;

    select *
    into v_row
    from public.archers_resources
    where franchise_id = 'stl-2026'
      and resource_type = 'player'
      and resource_id = v_player_entry ->> 'resource_id'
      and status = 'ACTIVE'
    for update;

    if not found then
      v_blocker_count := v_blocker_count + 1;
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'PLAYER_RESOURCE_MISSING',
        'resource_id', v_player_entry ->> 'resource_id'
      ));
      continue;
    end if;

    if v_row.version <> v_expected_version then
      v_blocker_count := v_blocker_count + 1;
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'PLAYER_RESOURCE_STALE',
        'resource_id', v_row.resource_id,
        'expected_version', v_expected_version,
        'current_version', v_row.version
      ));
      continue;
    end if;

    if jsonb_typeof(v_row.data -> 'contract') = 'object' then
      v_blocker_count := v_blocker_count + 1;
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'PLAYER_ALREADY_NORMALIZED',
        'resource_id', v_row.resource_id
      ));
      continue;
    end if;

    if (v_player_entry #>> '{contract,current_season}')::integer <> v_season
       or (v_player_entry #>> '{contract,end_season}')::integer < v_season then
      v_blocker_count := v_blocker_count + 1;
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'PLAYER_CONTRACT_SEASON_INVALID',
        'resource_id', v_row.resource_id
      ));
      continue;
    end if;

    v_affected_before := v_affected_before || jsonb_build_array(jsonb_build_object(
      'resource_type', 'player',
      'resource_id', v_row.resource_id,
      'version', v_row.version
    ));
  end loop;

  select count(*)
  into v_unique_count
  from (
    select distinct value ->> 'resource_id' as resource_id
    from jsonb_array_elements(v_staff) as entries(value)
  ) as unique_staff;

  if v_unique_count <> v_staff_count or v_staff_count <> 16 then
    v_blocker_count := v_blocker_count + 1;
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'STAFF_SET_MISMATCH',
      'plan_count', v_staff_count,
      'unique_count', v_unique_count,
      'message', 'The plan must establish exactly the 16 canonical non-owner staff members.'
    ));
  end if;

  for v_staff_entry in
    select value
    from jsonb_array_elements(v_staff) as entries(value)
    order by value ->> 'resource_id'
  loop
    if jsonb_typeof(v_staff_entry) is distinct from 'object'
       or coalesce(v_staff_entry ->> 'resource_type', '') <> 'staff'
       or coalesce(v_staff_entry ->> 'resource_id', '') = ''
       or jsonb_typeof(v_staff_entry -> 'data') is distinct from 'object'
       or jsonb_typeof(v_staff_entry #> '{data,contract}') is distinct from 'object'
       or coalesce(v_staff_entry #>> '{data,contract,contract_kind}', '') <> 'STAFF' then
      v_blocker_count := v_blocker_count + 1;
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'STAFF_PLAN_ENTRY_INVALID',
        'resource_id', v_staff_entry ->> 'resource_id'
      ));
      continue;
    end if;

    if exists (
      select 1
      from public.archers_resources
      where franchise_id = 'stl-2026'
        and resource_type = 'staff'
        and resource_id = v_staff_entry ->> 'resource_id'
    ) then
      v_blocker_count := v_blocker_count + 1;
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'STAFF_RESOURCE_ALREADY_EXISTS',
        'resource_id', v_staff_entry ->> 'resource_id'
      ));
      continue;
    end if;
  end loop;

  v_result := jsonb_build_object(
    'operation', v_operation,
    'resource_type', v_resource_type,
    'resource_id', v_resource_id,
    'dry_run', p_dry_run,
    'ready_to_execute', v_blocker_count = 0,
    'plan_digest', v_plan_digest,
    'season', v_season,
    'current_state_version', v_state_row.version,
    'proposed_state_version', v_state_row.version + 1,
    'player_updates', v_player_count,
    'staff_inserts', v_staff_count,
    'blocker_count', v_blocker_count,
    'blockers', v_blockers,
    'affected_before', v_affected_before,
    'personnel_moves', 0,
    'options_exercised', 0,
    'discretionary_contract_decisions_delegated', true
  );

  if p_dry_run then
    return v_result || jsonb_build_object(
      'note', 'No database write was performed. Execute only inside the same protected migration transaction after this preview is ready.'
    );
  end if;

  if v_blocker_count > 0 then
    raise exception 'contract normalization blocked by % issue(s): %', v_blocker_count, v_blockers;
  end if;

  for v_player_entry in
    select value
    from jsonb_array_elements(v_players) as entries(value)
    order by value ->> 'resource_id'
  loop
    v_expected_version := (v_player_entry ->> 'expected_version')::integer;

    update public.archers_resources
    set
      data = jsonb_set(data, '{contract}', v_player_entry -> 'contract', true),
      season = v_season,
      provenance = p_source_label,
      version = version + 1,
      updated_at = v_now
    where franchise_id = 'stl-2026'
      and resource_type = 'player'
      and resource_id = v_player_entry ->> 'resource_id'
      and status = 'ACTIVE'
      and version = v_expected_version
      and jsonb_typeof(data -> 'contract') is distinct from 'object'
    returning version into v_updated_version;

    if v_updated_version is null then
      raise exception 'player resource changed during normalization: %', v_player_entry ->> 'resource_id';
    end if;

    v_affected_after := v_affected_after || jsonb_build_array(jsonb_build_object(
      'resource_type', 'player',
      'resource_id', v_player_entry ->> 'resource_id',
      'previous_version', v_expected_version,
      'version', v_updated_version
    ));
  end loop;

  for v_staff_entry in
    select value
    from jsonb_array_elements(v_staff) as entries(value)
    order by value ->> 'resource_id'
  loop
    insert into public.archers_resources (
      franchise_id,
      resource_type,
      resource_id,
      season,
      data,
      status,
      visibility,
      provenance,
      version,
      created_at,
      updated_at
    ) values (
      'stl-2026',
      'staff',
      v_staff_entry ->> 'resource_id',
      v_season,
      v_staff_entry -> 'data',
      coalesce(nullif(v_staff_entry ->> 'status', ''), 'ACTIVE'),
      coalesce(nullif(v_staff_entry ->> 'visibility', ''), 'CONSOLE'),
      p_source_label,
      1,
      v_now,
      v_now
    );

    v_affected_after := v_affected_after || jsonb_build_array(jsonb_build_object(
      'resource_type', 'staff',
      'resource_id', v_staff_entry ->> 'resource_id',
      'previous_version', null,
      'version', 1
    ));
  end loop;

  v_state_patch := public.archers_jsonb_deep_merge(
    v_state_patch,
    jsonb_build_object(
      'contracts', jsonb_build_object(
        'last_normalization', jsonb_build_object(
          'version', 1,
          'season', v_season,
          'player_contracts', v_player_count,
          'staff_contracts', v_staff_count,
          'plan_digest', v_plan_digest,
          'idempotency_key', p_idempotency_key,
          'completed_at', v_now
        )
      ),
      'canon', jsonb_build_object(
        'last_operation', jsonb_build_object(
          'operation', v_operation,
          'resource_type', v_resource_type,
          'resource_id', v_resource_id,
          'idempotency_key', p_idempotency_key,
          'source_label', p_source_label,
          'completed_at', v_now
        )
      )
    )
  );

  v_new_state := public.archers_jsonb_deep_merge(v_state_row.state, v_state_patch);
  v_new_state := jsonb_set(v_new_state, '{franchise,team}', to_jsonb('St. Louis Archers'::text), true);
  v_new_state := jsonb_set(v_new_state, '{franchise,owner_and_general_manager}', to_jsonb('Kevin Dorey'::text), true);
  v_new_state := jsonb_set(v_new_state, '{canon,kevin_lock,enabled}', 'true'::jsonb, true);

  update public.archers_franchise_state
  set
    version = version + 1,
    state = v_new_state,
    updated_at = v_now
  where id = 'stl-2026'
    and version = p_expected_state_version
  returning version into v_new_state_version;

  if v_new_state_version is null then
    raise exception 'franchise state changed during contract normalization';
  end if;

  v_result := v_result || jsonb_build_object(
    'dry_run', false,
    'ready_to_execute', true,
    'state_version', v_new_state_version,
    'affected_resource_versions', v_affected_after,
    'idempotent_replay', false
  );

  insert into public.archers_canon_events (
    franchise_id,
    state_version,
    event_type,
    summary,
    exact_kevin_text,
    source_label,
    payload
  ) values (
    'stl-2026',
    v_new_state_version,
    'contract_normalization',
    trim(p_summary),
    nullif(p_exact_kevin_text, ''),
    p_source_label,
    jsonb_build_object(
      'operation', v_operation,
      'resource_type', v_resource_type,
      'resource_id', v_resource_id,
      'season', v_season,
      'plan_digest', v_plan_digest,
      'player_contracts', v_player_count,
      'staff_contracts', v_staff_count,
      'result', v_result
    )
  ) returning event_id into v_event_id;

  v_result := v_result || jsonb_build_object('event_id', v_event_id);

  insert into public.archers_operation_log (
    idempotency_key,
    operation,
    resource_type,
    resource_id,
    expected_version,
    request_payload,
    result_payload,
    summary,
    source_label,
    exact_kevin_text,
    state_version,
    status
  ) values (
    p_idempotency_key,
    v_operation,
    v_resource_type,
    v_resource_id,
    null,
    v_request_payload,
    v_result,
    trim(p_summary),
    p_source_label,
    nullif(p_exact_kevin_text, ''),
    v_new_state_version,
    'SUCCESS'
  ) returning operation_id into v_operation_id;

  v_result := v_result || jsonb_build_object('operation_id', v_operation_id);

  update public.archers_operation_log
  set result_payload = v_result
  where operation_id = v_operation_id;

  return v_result;
end;
$$;

revoke all on function public.archers_normalize_contracts_v1(
  jsonb, integer, text, text, text, text, boolean
) from public;

grant execute on function public.archers_normalize_contracts_v1(
  jsonb, integer, text, text, text, text, boolean
) to service_role;

commit;
