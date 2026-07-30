-- Draft a Dynasty • Backend 3.3.0
-- Season Rollover Engine v1
--
-- Adds one dedicated protected RPC used by the unified Edge Function when
-- operation = rollover_season. The operation advances one season and rolls
-- forward every active, canonically structured player and staff contract in
-- one transaction. It never exercises options or makes personnel decisions.

begin;

create or replace function public.archers_rollover_season(
  p_resource_type text,
  p_resource_id text,
  p_payload jsonb,
  p_expected_state_version integer,
  p_idempotency_key text,
  p_summary text,
  p_source_label text default 'LIVE_SESSION_LOG',
  p_exact_kevin_text text default null,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation constant text := 'rollover_season';
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_from_season integer;
  v_to_season integer;
  v_strict boolean := true;
  v_expected_resources jsonb;
  v_expected_count integer := 0;
  v_state_row public.archers_franchise_state%rowtype;
  v_existing_log public.archers_operation_log%rowtype;
  v_request_payload jsonb;
  v_current_state_season integer;
  v_state_season_text text;
  v_now timestamptz := now();
  v_row public.archers_resources%rowtype;
  v_contract jsonb;
  v_new_contract jsonb;
  v_new_data jsonb;
  v_contract_path text;
  v_start_season integer;
  v_end_season integer;
  v_start_text text;
  v_end_text text;
  v_salary_schedule jsonb;
  v_cap_schedule jsonb;
  v_from_salary numeric;
  v_to_salary numeric;
  v_from_cap numeric;
  v_to_cap numeric;
  v_salary_text text;
  v_cap_text text;
  v_years_remaining integer;
  v_rollover_status text;
  v_entity_kind text;
  v_entity_id text;
  v_entity_name text;
  v_options jsonb;
  v_options_due jsonb;
  v_option_count integer;
  v_blockers jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_expected_actual jsonb := '[]'::jsonb;
  v_affected_before jsonb := '[]'::jsonb;
  v_affected_after jsonb := '[]'::jsonb;
  v_blocker_count integer := 0;
  v_warning_count integer := 0;
  v_total_candidates integer := 0;
  v_processable_count integer := 0;
  v_player_count integer := 0;
  v_staff_count integer := 0;
  v_expired_count integer := 0;
  v_final_year_count integer := 0;
  v_salary_change_count integer := 0;
  v_cap_change_count integer := 0;
  v_options_due_count integer := 0;
  v_legacy_count integer := 0;
  v_new_state jsonb;
  v_state_patch jsonb;
  v_new_state_version integer;
  v_event_id bigint;
  v_operation_id bigint;
  v_result jsonb;
  v_detail_limit integer := 200;
  v_idempotency_key_already_used boolean := false;
  v_expected_entry jsonb;
  v_expected_version integer;
  v_matching_expected integer;
  v_actual_contract_count integer;
  v_logged_version integer;
  v_updated_version integer;
  v_readiness boolean;
begin
  if lower(coalesce(trim(p_resource_type), '')) <> 'season_rollover'
     or coalesce(trim(p_resource_id), '') <> 'season-rollover' then
    raise exception 'rollover_season requires season_rollover/season-rollover';
  end if;

  if jsonb_typeof(v_payload) is distinct from 'object' then
    raise exception 'payload must be one JSON object';
  end if;

  if p_expected_state_version is null or p_expected_state_version < 1 then
    raise exception 'expected_state_version is required for rollover_season';
  end if;

  if coalesce(trim(p_idempotency_key), '') = '' then
    raise exception 'idempotency_key is required for rollover_season';
  end if;

  if length(p_idempotency_key) > 180 then
    raise exception 'idempotency_key is too long';
  end if;

  if coalesce(trim(p_summary), '') = '' then
    raise exception 'summary is required';
  end if;

  if coalesce(p_source_label, '') not in (
    'USER_EXPLICIT', 'LIVE_SESSION_LOG', 'CHECKPOINT', 'CORRECTION', 'SYSTEM'
  ) then
    raise exception 'unsupported source_label: %', p_source_label;
  end if;

  begin
    v_from_season := (v_payload ->> 'from_season')::integer;
    v_to_season := (v_payload ->> 'to_season')::integer;
  exception when others then
    raise exception 'payload.from_season and payload.to_season must be integers';
  end;

  if v_from_season < 1 or v_to_season < 1 then
    raise exception 'season values must be positive integers';
  end if;

  if v_to_season <> v_from_season + 1 then
    raise exception 'Season Rollover Engine v1 advances exactly one season';
  end if;

  if v_payload ? 'strict' then
    if jsonb_typeof(v_payload -> 'strict') <> 'boolean' then
      raise exception 'payload.strict must be boolean';
    end if;
    v_strict := (v_payload ->> 'strict')::boolean;
  end if;

  if v_payload ? 'detail_limit' then
    begin
      v_detail_limit := greatest(1, least(500, (v_payload ->> 'detail_limit')::integer));
    exception when others then
      raise exception 'payload.detail_limit must be an integer from 1 to 500';
    end;
  end if;

  v_expected_resources := coalesce(v_payload -> 'expected_resources', '[]'::jsonb);
  if jsonb_typeof(v_expected_resources) is distinct from 'array' then
    raise exception 'payload.expected_resources must be an array';
  end if;
  v_expected_count := jsonb_array_length(v_expected_resources);

  v_request_payload := jsonb_build_object(
    'payload', v_payload,
    'expected_state_version', p_expected_state_version
  );

  select *
  into v_existing_log
  from public.archers_operation_log
  where idempotency_key = p_idempotency_key;

  if found then
    v_idempotency_key_already_used := true;

    if not (
      v_existing_log.status = 'SUCCESS'
      and v_existing_log.operation = v_operation
      and v_existing_log.resource_type = 'season_rollover'
      and v_existing_log.resource_id = 'season-rollover'
      and v_existing_log.request_payload = v_request_payload
      and v_existing_log.summary = trim(p_summary)
      and v_existing_log.source_label = p_source_label
      and v_existing_log.exact_kevin_text is not distinct from nullif(p_exact_kevin_text, '')
    ) then
      raise exception 'idempotency_key was already used for a different request';
    end if;

    if not p_dry_run then
      return v_existing_log.result_payload || jsonb_build_object('idempotent_replay', true);
    end if;
  end if;

  -- Lock every possibly contract-bearing active resource in stable order.
  -- This includes legacy summary-only records so that a dry run can flag them
  -- rather than silently leaving them behind.
  for v_row in
    select *
    from public.archers_resources
    where franchise_id = 'stl-2026'
      and status = 'ACTIVE'
      and resource_type in ('player', 'staff', 'player_contract', 'staff_contract', 'contract')
      and (
        jsonb_typeof(data -> 'contract') = 'object'
        or resource_type in ('player_contract', 'staff_contract', 'contract')
        or data ? 'contract_summary'
        or data ? format('cap_hit_%s_millions', v_from_season)
        or data ? 'practice_squad_weekly_salary'
      )
    order by resource_type, resource_id
    for update
  loop
    v_total_candidates := v_total_candidates + 1;
    v_entity_kind := case
      when v_row.resource_type in ('staff', 'staff_contract')
        or upper(coalesce(v_row.data ->> 'contract_kind', '')) = 'STAFF'
        or upper(coalesce(v_row.data #>> '{contract,contract_kind}', '')) = 'STAFF'
        then 'STAFF'
      else 'PLAYER'
    end;
    v_entity_id := coalesce(
      nullif(v_row.data ->> 'staff_id', ''),
      nullif(v_row.data ->> 'player_id', ''),
      nullif(v_row.data #>> '{contract,staff_id}', ''),
      nullif(v_row.data #>> '{contract,player_id}', ''),
      v_row.resource_id
    );
    v_entity_name := coalesce(
      nullif(v_row.data ->> 'staff_name', ''),
      nullif(v_row.data ->> 'player_name', ''),
      nullif(v_row.data ->> 'name', ''),
      nullif(v_row.data #>> '{contract,staff_name}', ''),
      nullif(v_row.data #>> '{contract,player_name}', ''),
      v_row.resource_id
    );

    if jsonb_typeof(v_row.data -> 'contract') = 'object' then
      v_contract := v_row.data -> 'contract';
      v_contract_path := 'NESTED';
    elsif v_row.resource_type in ('player_contract', 'staff_contract', 'contract')
          and jsonb_typeof(v_row.data) = 'object' then
      v_contract := v_row.data;
      v_contract_path := 'ROOT';
    else
      v_contract := null;
      v_contract_path := 'LEGACY_ONLY';
    end if;

    if v_contract is null then
      v_legacy_count := v_legacy_count + 1;
      v_blocker_count := v_blocker_count + 1;
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'LEGACY_CONTRACT_REQUIRES_NORMALIZATION',
        'resource_type', v_row.resource_type,
        'resource_id', v_row.resource_id,
        'entity_kind', v_entity_kind,
        'entity_name', v_entity_name,
        'message', 'Contract summary exists without a canonical contract object; future terms will not be inferred.'
      ));
      continue;
    end if;

    v_start_text := nullif(trim(v_contract ->> 'start_season'), '');
    v_end_text := nullif(trim(v_contract ->> 'end_season'), '');

    if v_end_text is null or v_end_text !~ '^[0-9]+$' then
      v_blocker_count := v_blocker_count + 1;
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'CONTRACT_END_SEASON_MISSING_OR_INVALID',
        'resource_type', v_row.resource_type,
        'resource_id', v_row.resource_id,
        'entity_kind', v_entity_kind,
        'entity_name', v_entity_name,
        'message', 'A canonical contract requires an integer end_season.'
      ));
      continue;
    end if;

    v_end_season := v_end_text::integer;
    v_start_season := null;
    if v_start_text is not null then
      if v_start_text !~ '^[0-9]+$' then
        v_blocker_count := v_blocker_count + 1;
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'CONTRACT_START_SEASON_INVALID',
          'resource_type', v_row.resource_type,
          'resource_id', v_row.resource_id,
          'entity_kind', v_entity_kind,
          'entity_name', v_entity_name,
          'message', 'start_season must be an integer when supplied.'
        ));
        continue;
      end if;
      v_start_season := v_start_text::integer;
      if v_start_season > v_end_season then
        v_blocker_count := v_blocker_count + 1;
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'CONTRACT_SEASON_RANGE_INVALID',
          'resource_type', v_row.resource_type,
          'resource_id', v_row.resource_id,
          'entity_kind', v_entity_kind,
          'entity_name', v_entity_name,
          'message', 'start_season cannot be later than end_season.'
        ));
        continue;
      end if;
    else
      v_warning_count := v_warning_count + 1;
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
        'code', 'CONTRACT_START_SEASON_UNKNOWN',
        'resource_type', v_row.resource_type,
        'resource_id', v_row.resource_id,
        'entity_kind', v_entity_kind,
        'entity_name', v_entity_name,
        'message', 'start_season is unknown; rollover can still derive remaining years from end_season.'
      ));
    end if;

    v_salary_schedule := coalesce(v_contract -> 'salary_by_season', '{}'::jsonb);
    v_cap_schedule := coalesce(v_contract -> 'cap_hit_by_season', '{}'::jsonb);

    if jsonb_typeof(v_salary_schedule) is distinct from 'object' then
      v_blocker_count := v_blocker_count + 1;
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'SALARY_SCHEDULE_INVALID',
        'resource_type', v_row.resource_type,
        'resource_id', v_row.resource_id,
        'entity_kind', v_entity_kind,
        'entity_name', v_entity_name,
        'message', 'salary_by_season must be an object when supplied.'
      ));
      continue;
    end if;

    if jsonb_typeof(v_cap_schedule) is distinct from 'object' then
      v_blocker_count := v_blocker_count + 1;
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'CAP_SCHEDULE_INVALID',
        'resource_type', v_row.resource_type,
        'resource_id', v_row.resource_id,
        'entity_kind', v_entity_kind,
        'entity_name', v_entity_name,
        'message', 'cap_hit_by_season must be an object when supplied.'
      ));
      continue;
    end if;

    v_from_salary := null;
    v_to_salary := null;
    v_from_cap := null;
    v_to_cap := null;

    v_salary_text := nullif(trim(v_salary_schedule ->> v_from_season::text), '');
    if v_salary_text is not null then
      begin v_from_salary := v_salary_text::numeric;
      exception when others then
        v_blocker_count := v_blocker_count + 1;
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'SALARY_VALUE_INVALID', 'resource_type', v_row.resource_type,
          'resource_id', v_row.resource_id, 'season', v_from_season,
          'message', 'salary_by_season contains a non-numeric value.'
        ));
        continue;
      end;
    end if;

    v_salary_text := nullif(trim(v_salary_schedule ->> v_to_season::text), '');
    if v_salary_text is not null then
      begin v_to_salary := v_salary_text::numeric;
      exception when others then
        v_blocker_count := v_blocker_count + 1;
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'SALARY_VALUE_INVALID', 'resource_type', v_row.resource_type,
          'resource_id', v_row.resource_id, 'season', v_to_season,
          'message', 'salary_by_season contains a non-numeric value.'
        ));
        continue;
      end;
    end if;

    v_cap_text := nullif(trim(v_cap_schedule ->> v_from_season::text), '');
    if v_cap_text is not null then
      begin v_from_cap := v_cap_text::numeric;
      exception when others then
        v_blocker_count := v_blocker_count + 1;
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'CAP_VALUE_INVALID', 'resource_type', v_row.resource_type,
          'resource_id', v_row.resource_id, 'season', v_from_season,
          'message', 'cap_hit_by_season contains a non-numeric value.'
        ));
        continue;
      end;
    end if;

    v_cap_text := nullif(trim(v_cap_schedule ->> v_to_season::text), '');
    if v_cap_text is not null then
      begin v_to_cap := v_cap_text::numeric;
      exception when others then
        v_blocker_count := v_blocker_count + 1;
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'CAP_VALUE_INVALID', 'resource_type', v_row.resource_type,
          'resource_id', v_row.resource_id, 'season', v_to_season,
          'message', 'cap_hit_by_season contains a non-numeric value.'
        ));
        continue;
      end;
    end if;

    if v_end_season >= v_to_season
       and v_to_salary is null
       and v_to_cap is null then
      v_warning_count := v_warning_count + 1;
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
        'code', 'NEXT_SEASON_COMPENSATION_UNKNOWN',
        'resource_type', v_row.resource_type,
        'resource_id', v_row.resource_id,
        'entity_kind', v_entity_kind,
        'entity_name', v_entity_name,
        'message', 'No next-season salary or cap figure is established; current values remain null rather than inferred.'
      ));
    end if;

    v_years_remaining := greatest(v_end_season - v_to_season + 1, 0);
    v_rollover_status := case
      when v_end_season < v_to_season then 'EXPIRED'
      when v_end_season = v_to_season then 'FINAL_YEAR'
      else 'ACTIVE'
    end;

    if v_rollover_status = 'EXPIRED' then
      v_expired_count := v_expired_count + 1;
    elsif v_rollover_status = 'FINAL_YEAR' then
      v_final_year_count := v_final_year_count + 1;
    end if;

    if v_from_salary is not null and v_to_salary is not null and v_from_salary <> v_to_salary then
      v_salary_change_count := v_salary_change_count + 1;
    end if;
    if v_from_cap is not null and v_to_cap is not null and v_from_cap <> v_to_cap then
      v_cap_change_count := v_cap_change_count + 1;
    end if;

    v_options := coalesce(v_contract -> 'options', '[]'::jsonb);
    if jsonb_typeof(v_options) is distinct from 'array' then
      v_blocker_count := v_blocker_count + 1;
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'CONTRACT_OPTIONS_INVALID',
        'resource_type', v_row.resource_type,
        'resource_id', v_row.resource_id,
        'message', 'contract.options must be an array when supplied.'
      ));
      continue;
    end if;

    select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb), count(*)
    into v_options_due, v_option_count
    from jsonb_array_elements(v_options) with ordinality as entries(value, ordinality)
    where jsonb_typeof(value) = 'object'
      and nullif(value ->> 'season', '') ~ '^[0-9]+$'
      and (value ->> 'season')::integer = v_to_season
      and upper(coalesce(value ->> 'status', 'UNRESOLVED')) not in ('EXERCISED', 'DECLINED', 'VOIDED', 'RESOLVED');

    v_options_due_count := v_options_due_count + coalesce(v_option_count, 0);
    v_processable_count := v_processable_count + 1;
    if v_entity_kind = 'STAFF' then
      v_staff_count := v_staff_count + 1;
    else
      v_player_count := v_player_count + 1;
    end if;

    v_new_contract := v_contract || jsonb_build_object(
      'current_season', v_to_season,
      'years_remaining', v_years_remaining,
      'current_salary', v_to_salary,
      'current_salary_season', case when v_to_salary is null then null else v_to_season end,
      'current_cap_hit', v_to_cap,
      'current_cap_hit_season', case when v_to_cap is null then null else v_to_season end,
      'rollover_status', v_rollover_status,
      'options_due', v_options_due,
      'last_rollover', jsonb_build_object(
        'from_season', v_from_season,
        'to_season', v_to_season,
        'processed_at', v_now,
        'operation', v_operation
      )
    );

    if v_contract_path = 'NESTED' then
      v_new_data := jsonb_set(v_row.data, '{contract}', v_new_contract, true);
    else
      v_new_data := v_new_contract;
    end if;

    v_expected_actual := v_expected_actual || jsonb_build_array(jsonb_build_object(
      'resource_type', v_row.resource_type,
      'resource_id', v_row.resource_id,
      'version', v_row.version
    ));
    v_affected_before := v_affected_before || jsonb_build_array(jsonb_build_object(
      'resource_type', v_row.resource_type,
      'resource_id', v_row.resource_id,
      'version', v_row.version,
      'status', v_row.status,
      'visibility', v_row.visibility
    ));

    if jsonb_array_length(v_changes) < v_detail_limit then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'resource_type', v_row.resource_type,
        'resource_id', v_row.resource_id,
        'entity_kind', v_entity_kind,
        'entity_id', v_entity_id,
        'entity_name', v_entity_name,
        'from_season', v_from_season,
        'to_season', v_to_season,
        'start_season', v_start_season,
        'end_season', v_end_season,
        'years_remaining', v_years_remaining,
        'rollover_status', v_rollover_status,
        'salary', jsonb_build_object(
          'from', v_from_salary,
          'to', v_to_salary,
          'change', case when v_from_salary is null or v_to_salary is null then null else v_to_salary - v_from_salary end
        ),
        'cap_hit', jsonb_build_object(
          'from', v_from_cap,
          'to', v_to_cap,
          'change', case when v_from_cap is null or v_to_cap is null then null else v_to_cap - v_from_cap end
        ),
        'options_due', v_options_due,
        'discretionary_action_taken', false
      ));
    end if;
  end loop;

  -- Match the established resource-first, state-second lock order.
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

  v_state_season_text := coalesce(
    nullif(v_state_row.state #>> '{timeline,season}', ''),
    nullif(v_state_row.state ->> 'current_season', ''),
    nullif(v_state_row.state ->> 'season', '')
  );

  if v_state_season_text is null or v_state_season_text !~ '^[0-9]+$' then
    v_blocker_count := v_blocker_count + 1;
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'CURRENT_SEASON_MISSING_OR_INVALID',
      'message', 'Franchise state must establish timeline.season, current_season, or season before rollover.'
    ));
  else
    v_current_state_season := v_state_season_text::integer;
    if v_current_state_season <> v_from_season then
      v_blocker_count := v_blocker_count + 1;
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'CURRENT_SEASON_CONFLICT',
        'expected_from_season', v_from_season,
        'current_state_season', v_current_state_season,
        'message', 'payload.from_season does not match authoritative franchise state.'
      ));
    end if;
  end if;

  -- Execute calls must reproduce the exact contract version set returned by
  -- the dry run. This detects additions, removals, and concurrent edits.
  if not p_dry_run then
    if v_expected_count = 0 and v_processable_count > 0 then
      raise exception 'payload.expected_resources from a current dry run is required';
    end if;

    if v_expected_count <> v_processable_count then
      raise exception 'contract set changed since dry run: expected % resources, current %',
        v_expected_count, v_processable_count;
    end if;

    for v_expected_entry in select value from jsonb_array_elements(v_expected_resources)
    loop
      if jsonb_typeof(v_expected_entry) is distinct from 'object' then
        raise exception 'every expected_resources entry must be an object';
      end if;
      begin
        v_expected_version := (v_expected_entry ->> 'version')::integer;
      exception when others then
        raise exception 'expected_resources.version must be an integer';
      end;

      select count(*)
      into v_matching_expected
      from jsonb_array_elements(v_expected_actual) as actual(value)
      where value ->> 'resource_type' = v_expected_entry ->> 'resource_type'
        and value ->> 'resource_id' = v_expected_entry ->> 'resource_id'
        and (value ->> 'version')::integer = v_expected_version;

      if v_matching_expected <> 1 then
        raise exception 'stale or unknown contract resource in expected_resources: %/% version %',
          v_expected_entry ->> 'resource_type',
          v_expected_entry ->> 'resource_id',
          v_expected_version;
      end if;
    end loop;
  end if;

  v_readiness := v_blocker_count = 0;

  v_result := jsonb_build_object(
    'backend_feature', 'ATOMIC_SEASON_ROLLOVER',
    'operation', v_operation,
    'dry_run', p_dry_run,
    'resource_type', 'season_rollover',
    'resource_id', 'season-rollover',
    'from_season', v_from_season,
    'to_season', v_to_season,
    'current_state_version', v_state_row.version,
    'proposed_state_version', v_state_row.version + 1,
    'strict', v_strict,
    'ready_to_execute', v_readiness,
    'contract_set', jsonb_build_object(
      'candidate_resources', v_total_candidates,
      'processable_contracts', v_processable_count,
      'players', v_player_count,
      'staff', v_staff_count,
      'legacy_records_requiring_normalization', v_legacy_count
    ),
    'effects', jsonb_build_object(
      'expired_contracts', v_expired_count,
      'final_year_contracts', v_final_year_count,
      'salary_changes', v_salary_change_count,
      'cap_hit_changes', v_cap_change_count,
      'options_due', v_options_due_count,
      'options_exercised', 0,
      'personnel_moves', 0
    ),
    'blocker_count', v_blocker_count,
    'warning_count', v_warning_count,
    'blockers', v_blockers,
    'warnings', v_warnings,
    'changes', v_changes,
    'change_detail_limit', v_detail_limit,
    'omitted_change_count', greatest(v_processable_count - jsonb_array_length(v_changes), 0),
    'expected_resources', v_expected_actual,
    'idempotency_key_already_used', v_idempotency_key_already_used,
    'discretionary_actions_taken', false
  );

  if p_dry_run then
    return v_result || jsonb_build_object(
      'note', 'No database write was performed. Execute only with this preview''s exact expected_resources and current state version.'
    );
  end if;

  if v_strict and v_blocker_count > 0 then
    raise exception 'rollover blocked by % contract or season issue(s); run dry_run for details', v_blocker_count;
  elsif v_blocker_count > 0 then
    raise exception 'rollover cannot skip unresolved contract blockers; run dry_run for details';
  end if;

  -- Recompute and write each processable contract under the locks already held.
  for v_row in
    select *
    from public.archers_resources
    where franchise_id = 'stl-2026'
      and status = 'ACTIVE'
      and resource_type in ('player', 'staff', 'player_contract', 'staff_contract', 'contract')
      and (
        jsonb_typeof(data -> 'contract') = 'object'
        or resource_type in ('player_contract', 'staff_contract', 'contract')
      )
    order by resource_type, resource_id
  loop
    if jsonb_typeof(v_row.data -> 'contract') = 'object' then
      v_contract := v_row.data -> 'contract';
      v_contract_path := 'NESTED';
    else
      v_contract := v_row.data;
      v_contract_path := 'ROOT';
    end if;

    v_end_season := (v_contract ->> 'end_season')::integer;
    v_salary_schedule := coalesce(v_contract -> 'salary_by_season', '{}'::jsonb);
    v_cap_schedule := coalesce(v_contract -> 'cap_hit_by_season', '{}'::jsonb);
    v_to_salary := null;
    v_to_cap := null;

    v_salary_text := nullif(trim(v_salary_schedule ->> v_to_season::text), '');
    if v_salary_text is not null then v_to_salary := v_salary_text::numeric; end if;
    v_cap_text := nullif(trim(v_cap_schedule ->> v_to_season::text), '');
    if v_cap_text is not null then v_to_cap := v_cap_text::numeric; end if;

    v_years_remaining := greatest(v_end_season - v_to_season + 1, 0);
    v_rollover_status := case
      when v_end_season < v_to_season then 'EXPIRED'
      when v_end_season = v_to_season then 'FINAL_YEAR'
      else 'ACTIVE'
    end;
    v_options := coalesce(v_contract -> 'options', '[]'::jsonb);
    select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb)
    into v_options_due
    from jsonb_array_elements(v_options) with ordinality as entries(value, ordinality)
    where jsonb_typeof(value) = 'object'
      and nullif(value ->> 'season', '') ~ '^[0-9]+$'
      and (value ->> 'season')::integer = v_to_season
      and upper(coalesce(value ->> 'status', 'UNRESOLVED')) not in ('EXERCISED', 'DECLINED', 'VOIDED', 'RESOLVED');

    v_new_contract := v_contract || jsonb_build_object(
      'current_season', v_to_season,
      'years_remaining', v_years_remaining,
      'current_salary', v_to_salary,
      'current_salary_season', case when v_to_salary is null then null else v_to_season end,
      'current_cap_hit', v_to_cap,
      'current_cap_hit_season', case when v_to_cap is null then null else v_to_season end,
      'rollover_status', v_rollover_status,
      'options_due', v_options_due,
      'last_rollover', jsonb_build_object(
        'from_season', v_from_season,
        'to_season', v_to_season,
        'processed_at', v_now,
        'operation', v_operation
      )
    );

    if v_contract_path = 'NESTED' then
      v_new_data := jsonb_set(v_row.data, '{contract}', v_new_contract, true);
    else
      v_new_data := v_new_contract;
    end if;

    update public.archers_resources
    set
      season = v_to_season,
      data = v_new_data,
      provenance = p_source_label,
      version = version + 1,
      updated_at = v_now
    where franchise_id = 'stl-2026'
      and resource_type = v_row.resource_type
      and resource_id = v_row.resource_id
      and version = v_row.version
    returning version into v_updated_version;

    if v_updated_version is null then
      raise exception 'contract resource changed during rollover: %/%', v_row.resource_type, v_row.resource_id;
    end if;

    v_affected_after := v_affected_after || jsonb_build_array(jsonb_build_object(
      'resource_type', v_row.resource_type,
      'resource_id', v_row.resource_id,
      'previous_version', v_row.version,
      'version', v_updated_version,
      'status', v_row.status,
      'visibility', v_row.visibility
    ));
  end loop;

  v_state_patch := jsonb_build_object(
    'season', v_to_season,
    'current_season', v_to_season,
    'timeline', jsonb_build_object('season', v_to_season),
    'contracts', jsonb_build_object(
      'current_season', v_to_season,
      'last_rollover', jsonb_build_object(
        'from_season', v_from_season,
        'to_season', v_to_season,
        'processed_contracts', v_processable_count,
        'players', v_player_count,
        'staff', v_staff_count,
        'completed_at', v_now,
        'idempotency_key', p_idempotency_key
      )
    ),
    'canon', jsonb_build_object(
      'last_operation', jsonb_build_object(
        'operation', v_operation,
        'resource_type', 'season_rollover',
        'resource_id', 'season-rollover',
        'idempotency_key', p_idempotency_key,
        'source_label', p_source_label,
        'completed_at', v_now
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
    raise exception 'franchise state changed during rollover';
  end if;

  v_result := v_result || jsonb_build_object(
    'dry_run', false,
    'state_version', v_new_state_version,
    'affected_resource_versions', v_affected_after,
    'idempotent_replay', false,
    'ready_to_execute', true
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
    'season_rollover',
    trim(p_summary),
    nullif(p_exact_kevin_text, ''),
    p_source_label,
    jsonb_build_object(
      'operation', v_operation,
      'resource_type', 'season_rollover',
      'resource_id', 'season-rollover',
      'from_season', v_from_season,
      'to_season', v_to_season,
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
    'season_rollover',
    'season-rollover',
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

revoke all on function public.archers_rollover_season(
  text, text, jsonb, integer, text, text, text, text, boolean
) from public, anon, authenticated;

grant execute on function public.archers_rollover_season(
  text, text, jsonb, integer, text, text, text, text, boolean
) to service_role;

commit;
