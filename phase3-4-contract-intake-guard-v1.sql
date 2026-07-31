-- Draft a Dynasty • Backend 3.4.0
-- Contract Intake Guard v1
--
-- Validates and normalizes canonical player and staff contracts at the
-- archers_resources database boundary. The same guard protects direct writes,
-- generic upserts, bulk upserts, and future transaction operations.
--
-- The immediate trigger derives current contract fields. A deferred constraint
-- trigger revalidates against the final franchise season so atomic season
-- rollover can update resources before the franchise state advances.

begin;

create or replace function public.archers_contract_intake_evaluate_v1(
  p_resource_type text,
  p_resource_id text,
  p_resource_season integer,
  p_status text,
  p_data jsonb,
  p_state_season integer,
  p_allow_pending_rollover boolean default false
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_resource_type text := lower(coalesce(trim(p_resource_type), ''));
  v_resource_id text := coalesce(trim(p_resource_id), '');
  v_status text := upper(coalesce(trim(p_status), 'ACTIVE'));
  v_data jsonb := coalesce(p_data, '{}'::jsonb);
  v_contract jsonb;
  v_normalized_contract jsonb;
  v_normalized_data jsonb;
  v_contract_path text;
  v_contract_kind text;
  v_expected_kind text;
  v_subject_id text;
  v_subject_name text;
  v_team_id text;
  v_team_name text;
  v_roster_status text;
  v_employment_class text;
  v_state_season integer := p_state_season;
  v_effective_season integer;
  v_start_season integer;
  v_end_season integer;
  v_years_remaining integer;
  v_rollover_status text;
  v_salary_schedule jsonb;
  v_cap_schedule jsonb;
  v_guaranteed_schedule jsonb;
  v_options jsonb;
  v_options_due jsonb := '[]'::jsonb;
  v_current_salary numeric;
  v_current_cap_hit numeric;
  v_contract_value numeric;
  v_salary_sum numeric;
  v_schema_version integer;
  v_key text;
  v_value jsonb;
  v_option jsonb;
  v_option_season integer;
  v_option_status text;
  v_option_type text;
  v_year integer;
  v_has_contract_signal boolean := false;
  v_archers_owned boolean := false;
  v_requires_contract boolean := false;
  v_guarded boolean := false;
  v_blockers jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_blocker_count integer;
  v_warning_count integer;
  v_fingerprint text;
begin
  if jsonb_typeof(v_data) is distinct from 'object' then
    v_data := '{}'::jsonb;
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'RESOURCE_DATA_NOT_OBJECT',
      'message', 'resource data must be one JSON object'
    ));
  end if;

  if v_state_season is null or v_state_season < 1900 or v_state_season > 2999 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'CURRENT_SEASON_UNAVAILABLE',
      'message', 'an authoritative four-digit franchise season is required'
    ));
    v_state_season := coalesce(p_resource_season, 0);
  end if;

  v_effective_season := v_state_season;

  if v_resource_type in ('player_contract', 'staff_contract', 'contract') then
    v_contract_path := 'ROOT';
    v_contract := v_data;
  elsif v_resource_type in ('player', 'staff') then
    v_contract_path := 'NESTED';
    v_contract := v_data -> 'contract';
  else
    return jsonb_build_object(
      'guard_version', 1,
      'guarded', false,
      'accepted', true,
      'ready_to_write', true,
      'resource_type', v_resource_type,
      'resource_id', v_resource_id,
      'state_season', v_state_season,
      'effective_season', v_state_season,
      'blocker_count', 0,
      'warning_count', 0,
      'blockers', '[]'::jsonb,
      'warnings', '[]'::jsonb,
      'normalized_data', v_data
    );
  end if;

  select exists (
    select 1
    from jsonb_object_keys(v_data) as key_name
    where key_name ~ '^cap_hit_[0-9]{4}_millions$'
       or key_name ~ '^salary_[0-9]{4}_millions$'
  )
  into v_has_contract_signal;

  v_has_contract_signal :=
    v_has_contract_signal
    or v_data ? 'contract'
    or v_data ? 'contract_summary'
    or v_data ? 'contract_years_remaining'
    or v_data ? 'years_remaining'
    or v_data ? 'current_salary_millions'
    or v_data ? 'current_cap_hit_millions'
    or v_data ? 'practice_squad_salary_per_week';

  v_team_id := lower(coalesce(
    nullif(trim(v_data ->> 'team_id'), ''),
    nullif(trim(v_data ->> 'current_team_id'), ''),
    nullif(trim(v_data ->> 'franchise_id'), ''),
    ''
  ));
  v_team_name := lower(coalesce(
    nullif(trim(v_data ->> 'team_name'), ''),
    nullif(trim(v_data ->> 'current_team'), ''),
    ''
  ));
  v_roster_status := upper(coalesce(
    nullif(trim(v_data ->> 'roster_status'), ''),
    nullif(trim(v_data ->> 'status'), ''),
    ''
  ));

  v_archers_owned :=
    lower(coalesce(v_data ->> 'is_archers', 'false')) in ('true', 't', '1', 'yes')
    or v_team_id in ('', 'stl-2026', 'st-louis-archers', 'st_louis_archers')
    or v_team_name in ('st. louis archers', 'st louis archers');

  if v_status = 'ACTIVE' then
    if v_resource_type in ('player_contract', 'staff_contract', 'contract') then
      v_requires_contract := true;
    elsif v_resource_type = 'staff' and v_archers_owned then
      v_requires_contract := true;
    elsif v_resource_type = 'player'
      and v_archers_owned
      and v_roster_status in (
        'ACTIVE', 'ACTIVE_ROSTER', 'PRACTICE_SQUAD', 'INJURED_RESERVE',
        'IR', 'PUP', 'NFI', 'RESERVE', 'SUSPENDED', 'ROSTER_EXEMPT',
        'SIGNED', 'UNDER_CONTRACT'
      ) then
      v_requires_contract := true;
    end if;
  end if;

  v_guarded := v_requires_contract or v_has_contract_signal;

  if not v_guarded or v_status <> 'ACTIVE' then
    return jsonb_build_object(
      'guard_version', 1,
      'guarded', v_guarded,
      'accepted', true,
      'ready_to_write', true,
      'resource_type', v_resource_type,
      'resource_id', v_resource_id,
      'state_season', v_state_season,
      'effective_season', v_state_season,
      'blocker_count', 0,
      'warning_count', 0,
      'blockers', '[]'::jsonb,
      'warnings', '[]'::jsonb,
      'normalized_data', v_data
    );
  end if;

  if v_contract is null or jsonb_typeof(v_contract) is distinct from 'object' then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', case when v_contract is null then 'CANONICAL_CONTRACT_REQUIRED' else 'CONTRACT_NOT_OBJECT' end,
      'message', case
        when v_contract is null then 'an active signed player or staff resource requires a canonical contract object'
        else 'contract must be one JSON object'
      end
    ));
    v_contract := '{}'::jsonb;
  end if;

  if p_allow_pending_rollover
     and p_resource_season = v_state_season + 1
     and (v_contract ->> 'current_season') ~ '^[0-9]{4}$'
     and (v_contract ->> 'current_season')::integer = p_resource_season
     and lower(coalesce(v_contract #>> '{last_rollover,operation}', '')) = 'rollover_season'
     and (v_contract #>> '{last_rollover,to_season}') ~ '^[0-9]{4}$'
     and (v_contract #>> '{last_rollover,to_season}')::integer = p_resource_season then
    v_effective_season := p_resource_season;
  end if;

  if coalesce(v_contract ->> 'contract_schema_version', v_contract ->> 'schema_version', '1') !~ '^[0-9]+$' then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'INVALID_CONTRACT_SCHEMA_VERSION',
      'message', 'contract_schema_version must be integer 1'
    ));
    v_schema_version := 1;
  else
    v_schema_version := coalesce(
      nullif(v_contract ->> 'contract_schema_version', '')::integer,
      nullif(v_contract ->> 'schema_version', '')::integer,
      1
    );
    if v_schema_version <> 1 then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'UNSUPPORTED_CONTRACT_SCHEMA_VERSION',
        'message', 'only contract schema version 1 is supported',
        'value', v_schema_version
      ));
    end if;
  end if;

  if upper(coalesce(nullif(trim(v_contract ->> 'currency'), ''), 'USD')) <> 'USD' then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'UNSUPPORTED_CONTRACT_CURRENCY',
      'message', 'contract currency must be USD'
    ));
  end if;

  if upper(coalesce(nullif(trim(v_contract ->> 'amount_unit'), ''), 'MILLIONS')) <> 'MILLIONS' then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'UNSUPPORTED_AMOUNT_UNIT',
      'message', 'contract amount_unit must be MILLIONS'
    ));
  end if;

  v_expected_kind := case
    when v_resource_type in ('player', 'player_contract') then 'PLAYER'
    when v_resource_type in ('staff', 'staff_contract') then 'STAFF'
    else null
  end;
  v_contract_kind := upper(coalesce(nullif(trim(v_contract ->> 'contract_kind'), ''), v_expected_kind, ''));

  if v_contract_kind not in ('PLAYER', 'STAFF') then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'INVALID_CONTRACT_KIND',
      'message', 'contract_kind must be PLAYER or STAFF'
    ));
  elsif v_expected_kind is not null and v_contract_kind <> v_expected_kind then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'CONTRACT_KIND_MISMATCH',
      'message', 'contract_kind does not match the resource type',
      'expected', v_expected_kind,
      'actual', v_contract_kind
    ));
  end if;

  v_subject_id := coalesce(
    nullif(trim(v_contract ->> case when v_contract_kind = 'STAFF' then 'staff_id' else 'player_id' end), ''),
    case
      when v_resource_type in ('player', 'staff') then
        coalesce(
          nullif(trim(v_data ->> case when v_contract_kind = 'STAFF' then 'staff_id' else 'player_id' end), ''),
          v_resource_id
        )
      else null
    end
  );

  if coalesce(v_subject_id, '') = '' then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'CONTRACT_SUBJECT_ID_REQUIRED',
      'message', 'a standalone contract must identify its player_id or staff_id'
    ));
  elsif v_resource_type in ('player', 'staff') and v_subject_id <> v_resource_id then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'CONTRACT_SUBJECT_ID_MISMATCH',
      'message', 'the contract subject ID must match the resource ID',
      'expected', v_resource_id,
      'actual', v_subject_id
    ));
  end if;

  v_subject_name := coalesce(
    nullif(trim(v_contract ->> case when v_contract_kind = 'STAFF' then 'staff_name' else 'player_name' end), ''),
    nullif(trim(v_data ->> 'name'), ''),
    nullif(trim(v_data ->> 'full_name'), '')
  );

  if coalesce(v_contract ->> 'end_season', '') !~ '^[0-9]{4}$' then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'END_SEASON_REQUIRED',
      'message', 'end_season must be a four-digit integer'
    ));
    v_end_season := v_effective_season;
  else
    v_end_season := (v_contract ->> 'end_season')::integer;
  end if;

  if coalesce(v_contract ->> 'start_season', '') = '' then
    v_start_season := null;
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'START_SEASON_UNKNOWN',
      'message', 'original start season remains unknown; current and future schedules are still authoritative'
    ));
  elsif (v_contract ->> 'start_season') !~ '^[0-9]{4}$' then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'INVALID_START_SEASON',
      'message', 'start_season must be a four-digit integer when supplied'
    ));
  else
    v_start_season := (v_contract ->> 'start_season')::integer;
  end if;

  if v_start_season is not null and v_start_season > v_end_season then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'INVALID_CONTRACT_TERM',
      'message', 'start_season cannot be after end_season'
    ));
  end if;

  v_salary_schedule := v_contract -> 'salary_by_season';
  if jsonb_typeof(v_salary_schedule) is distinct from 'object' then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'SALARY_SCHEDULE_REQUIRED',
      'message', 'salary_by_season must be one JSON object'
    ));
    v_salary_schedule := '{}'::jsonb;
  end if;

  for v_key, v_value in
    select key, value from jsonb_each(v_salary_schedule)
  loop
    if v_key !~ '^[0-9]{4}$' then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'INVALID_SALARY_SEASON_KEY',
        'message', 'salary_by_season keys must be four-digit seasons',
        'key', v_key
      ));
    elsif jsonb_typeof(v_value) is distinct from 'number' then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'INVALID_SALARY_VALUE',
        'message', 'salary schedule values must be nonnegative numbers',
        'season', v_key
      ));
    elsif (v_value #>> '{}')::numeric < 0 then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'INVALID_SALARY_VALUE',
        'message', 'salary schedule values must be nonnegative numbers',
        'season', v_key
      ));
    end if;
  end loop;

  if v_end_season >= v_effective_season then
    for v_year in v_effective_season..v_end_season loop
      if not (v_salary_schedule ? v_year::text)
         or jsonb_typeof(v_salary_schedule -> v_year::text) is distinct from 'number' then
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'MISSING_SALARY_SCHEDULE',
          'message', 'salary_by_season must cover every active contract season',
          'season', v_year
        ));
      end if;
    end loop;
  end if;

  v_cap_schedule := v_contract -> 'cap_hit_by_season';
  if v_contract_kind = 'PLAYER' and jsonb_typeof(v_cap_schedule) is distinct from 'object' then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'PLAYER_CAP_SCHEDULE_REQUIRED',
      'message', 'player contracts require cap_hit_by_season'
    ));
    v_cap_schedule := '{}'::jsonb;
  elsif v_cap_schedule is null then
    v_cap_schedule := '{}'::jsonb;
  elsif jsonb_typeof(v_cap_schedule) is distinct from 'object' then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'INVALID_CAP_SCHEDULE',
      'message', 'cap_hit_by_season must be one JSON object when supplied'
    ));
    v_cap_schedule := '{}'::jsonb;
  end if;

  for v_key, v_value in
    select key, value from jsonb_each(v_cap_schedule)
  loop
    if v_key !~ '^[0-9]{4}$' then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'INVALID_CAP_SEASON_KEY',
        'message', 'cap_hit_by_season keys must be four-digit seasons',
        'key', v_key
      ));
    elsif jsonb_typeof(v_value) is distinct from 'number' then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'INVALID_CAP_VALUE',
        'message', 'cap schedule values must be nonnegative numbers',
        'season', v_key
      ));
    elsif (v_value #>> '{}')::numeric < 0 then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'INVALID_CAP_VALUE',
        'message', 'cap schedule values must be nonnegative numbers',
        'season', v_key
      ));
    end if;
  end loop;

  if v_contract_kind = 'PLAYER' and v_end_season >= v_effective_season then
    for v_year in v_effective_season..v_end_season loop
      if not (v_cap_schedule ? v_year::text)
         or jsonb_typeof(v_cap_schedule -> v_year::text) is distinct from 'number' then
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'MISSING_CAP_SCHEDULE',
          'message', 'cap_hit_by_season must cover every active player contract season',
          'season', v_year
        ));
      end if;
    end loop;
  end if;

  v_guaranteed_schedule := v_contract -> 'guaranteed_by_season';
  if v_guaranteed_schedule is not null then
    if jsonb_typeof(v_guaranteed_schedule) is distinct from 'object' then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'INVALID_GUARANTEE_SCHEDULE',
        'message', 'guaranteed_by_season must be one JSON object when supplied'
      ));
    else
      for v_key, v_value in
        select key, value from jsonb_each(v_guaranteed_schedule)
      loop
        if v_key !~ '^[0-9]{4}$' then
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'INVALID_GUARANTEE_VALUE',
            'message', 'guaranteed_by_season requires nonnegative numeric season values',
            'season', v_key
          ));
        elsif jsonb_typeof(v_value) is distinct from 'number' then
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'INVALID_GUARANTEE_VALUE',
            'message', 'guaranteed_by_season requires nonnegative numeric season values',
            'season', v_key
          ));
        elsif (v_value #>> '{}')::numeric < 0 then
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'INVALID_GUARANTEE_VALUE',
            'message', 'guaranteed_by_season requires nonnegative numeric season values',
            'season', v_key
          ));
        elsif v_salary_schedule ? v_key
          and jsonb_typeof(v_salary_schedule -> v_key) = 'number'
          and (v_value #>> '{}')::numeric > (v_salary_schedule ->> v_key)::numeric then
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'GUARANTEE_EXCEEDS_SALARY',
            'message', 'guaranteed compensation cannot exceed scheduled salary',
            'season', v_key
          ));
        end if;
      end loop;
    end if;
  end if;

  v_options := coalesce(v_contract -> 'options', '[]'::jsonb);
  if jsonb_typeof(v_options) is distinct from 'array' then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'INVALID_OPTIONS',
      'message', 'options must be one JSON array'
    ));
    v_options := '[]'::jsonb;
  end if;

  for v_option in
    select value from jsonb_array_elements(v_options)
  loop
    if jsonb_typeof(v_option) is distinct from 'object' then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'INVALID_OPTION_ENTRY',
        'message', 'every option must be one JSON object'
      ));
      continue;
    end if;

    if coalesce(v_option ->> 'season', '') !~ '^[0-9]{4}$' then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'INVALID_OPTION_SEASON',
        'message', 'every option requires a four-digit season'
      ));
    else
      v_option_season := (v_option ->> 'season')::integer;
    end if;

    v_option_type := upper(coalesce(
      nullif(trim(v_option ->> 'option_type'), ''),
      nullif(trim(v_option ->> 'type'), ''),
      ''
    ));
    if v_option_type = '' then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'OPTION_TYPE_REQUIRED',
        'message', 'every option requires option_type or type'
      ));
    end if;

    v_option_status := upper(coalesce(nullif(trim(v_option ->> 'status'), ''), 'UNRESOLVED'));
    if v_option_status not in (
      'UNRESOLVED', 'PENDING', 'EXERCISED', 'DECLINED', 'VOIDED', 'RESOLVED'
    ) then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'INVALID_OPTION_STATUS',
        'message', 'option status is not supported',
        'status', v_option_status
      ));
    end if;
  end loop;

  select coalesce(jsonb_agg(option_row order by ordinal_position), '[]'::jsonb)
  into v_options_due
  from (
    select value as option_row, ordinality as ordinal_position
    from jsonb_array_elements(v_options) with ordinality
    where jsonb_typeof(value) = 'object'
      and case
        when coalesce(value ->> 'season', '') ~ '^[0-9]{4}$'
          then (value ->> 'season')::integer
        else null
      end = v_effective_season
      and upper(coalesce(nullif(trim(value ->> 'status'), ''), 'UNRESOLVED'))
        in ('UNRESOLVED', 'PENDING')
  ) due;

  if coalesce(v_contract ->> 'contract_value_millions', '') <> '' then
    if (v_contract ->> 'contract_value_millions') !~ '^[0-9]+([.][0-9]+)?$' then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'INVALID_CONTRACT_VALUE',
        'message', 'contract_value_millions must be a nonnegative number'
      ));
    else
      v_contract_value := (v_contract ->> 'contract_value_millions')::numeric;
      select coalesce(sum((value #>> '{}')::numeric), 0)
      into v_salary_sum
      from jsonb_each(v_salary_schedule)
      where jsonb_typeof(value) = 'number';

      if abs(v_contract_value - v_salary_sum) > 0.0001 then
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'CONTRACT_VALUE_MISMATCH',
          'message', 'contract_value_millions must equal the scheduled salary total represented by salary_by_season',
          'contract_value_millions', v_contract_value,
          'scheduled_salary_total_millions', v_salary_sum
        ));
      end if;
    end if;
  end if;

  if v_end_season < v_effective_season then
    v_years_remaining := 0;
    v_rollover_status := 'EXPIRED';
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'EXPIRED_CONTRACT_ON_ACTIVE_RESOURCE',
      'message', 'the contract is expired but the resource remains active; personnel disposition is a separate decision'
    ));
  elsif v_end_season = v_effective_season then
    v_years_remaining := 1;
    v_rollover_status := 'FINAL_YEAR';
  else
    v_years_remaining := v_end_season - v_effective_season + 1;
    v_rollover_status := 'ACTIVE';
  end if;

  if v_salary_schedule ? v_effective_season::text
     and jsonb_typeof(v_salary_schedule -> v_effective_season::text) = 'number' then
    v_current_salary := (v_salary_schedule ->> v_effective_season::text)::numeric;
  end if;

  if v_cap_schedule ? v_effective_season::text
     and jsonb_typeof(v_cap_schedule -> v_effective_season::text) = 'number' then
    v_current_cap_hit := (v_cap_schedule ->> v_effective_season::text)::numeric;
  end if;

  v_normalized_contract :=
    v_contract
    || jsonb_build_object(
      'contract_schema_version', 1,
      'contract_kind', v_contract_kind,
      'currency', upper(coalesce(nullif(trim(v_contract ->> 'currency'), ''), 'USD')),
      'amount_unit', upper(coalesce(nullif(trim(v_contract ->> 'amount_unit'), ''), 'MILLIONS')),
      'end_season', v_end_season,
      'salary_by_season', v_salary_schedule,
      'options', v_options,
      'current_season', v_effective_season,
      'years_remaining', v_years_remaining,
      'current_salary', to_jsonb(v_current_salary),
      'current_salary_season', case when v_current_salary is null then null else v_effective_season end,
      'rollover_status', v_rollover_status,
      'options_due', v_options_due,
      'contract_intake_guard', jsonb_build_object(
        'version', 1,
        'validated_season', v_effective_season,
        'contract_kind', v_contract_kind
      )
    );

  if v_start_season is not null then
    v_normalized_contract := jsonb_set(
      v_normalized_contract,
      '{start_season}',
      to_jsonb(v_start_season),
      true
    );
  end if;

  if v_contract_kind = 'PLAYER' then
    v_normalized_contract :=
      v_normalized_contract
      || jsonb_build_object(
        'player_id', v_subject_id,
        'cap_hit_by_season', v_cap_schedule,
        'current_cap_hit', to_jsonb(v_current_cap_hit),
        'current_cap_hit_season', case when v_current_cap_hit is null then null else v_effective_season end
      );
    if v_subject_name is not null then
      v_normalized_contract := jsonb_set(v_normalized_contract, '{player_name}', to_jsonb(v_subject_name), true);
    end if;
  elsif v_contract_kind = 'STAFF' then
    v_normalized_contract := v_normalized_contract || jsonb_build_object('staff_id', v_subject_id);
    if v_subject_name is not null then
      v_normalized_contract := jsonb_set(v_normalized_contract, '{staff_name}', to_jsonb(v_subject_name), true);
    end if;
    if jsonb_typeof(v_contract -> 'cap_hit_by_season') = 'object' then
      v_normalized_contract := jsonb_set(v_normalized_contract, '{cap_hit_by_season}', v_cap_schedule, true);
    end if;
  end if;

  if v_contract_path = 'NESTED' then
    v_normalized_data :=
      jsonb_set(v_data, '{contract}', v_normalized_contract, true)
      || jsonb_build_object(
        'contract_years_remaining', v_years_remaining,
        'years_remaining', v_years_remaining,
        'current_salary_millions', to_jsonb(v_current_salary)
      );

    if v_contract_kind = 'PLAYER' then
      v_normalized_data :=
        v_normalized_data
        || jsonb_build_object(
          'current_cap_hit_millions', to_jsonb(v_current_cap_hit),
          'cap_hit_' || v_effective_season::text || '_millions', to_jsonb(v_current_cap_hit)
        );
    end if;
  else
    v_normalized_data := v_normalized_contract;
  end if;

  v_blocker_count := jsonb_array_length(v_blockers);
  v_warning_count := jsonb_array_length(v_warnings);
  v_fingerprint := md5(v_normalized_contract::text);

  return jsonb_build_object(
    'guard_version', 1,
    'guarded', true,
    'accepted', v_blocker_count = 0,
    'ready_to_write', v_blocker_count = 0,
    'resource_type', v_resource_type,
    'resource_id', v_resource_id,
    'contract_path', v_contract_path,
    'contract_kind', v_contract_kind,
    'subject_id', v_subject_id,
    'state_season', v_state_season,
    'effective_season', v_effective_season,
    'blocker_count', v_blocker_count,
    'warning_count', v_warning_count,
    'blockers', v_blockers,
    'warnings', v_warnings,
    'normalized_contract', v_normalized_contract,
    'normalized_data', v_normalized_data,
    'contract_fingerprint', v_fingerprint
  );
end;
$$;

create or replace function public.archers_validate_contract_intake(
  p_resource_type text,
  p_resource_id text,
  p_payload jsonb,
  p_expected_state_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state_row public.archers_franchise_state%rowtype;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_state_season integer;
  v_result jsonb;
begin
  if coalesce(trim(p_resource_type), '') = '' or coalesce(trim(p_resource_id), '') = '' then
    raise exception 'resource_type and resource_id are required for contract intake validation';
  end if;

  if jsonb_typeof(v_payload) is distinct from 'object' then
    raise exception 'payload must be one JSON object';
  end if;

  if p_expected_state_version is null or p_expected_state_version < 1 then
    raise exception 'expected_state_version is required for contract intake validation';
  end if;

  select *
  into v_state_row
  from public.archers_franchise_state
  where id = 'stl-2026';

  if not found then
    raise exception 'franchise state not found';
  end if;

  if v_state_row.version <> p_expected_state_version then
    raise exception 'state version conflict: expected %, current %',
      p_expected_state_version, v_state_row.version;
  end if;

  v_state_season := coalesce(
    nullif(v_state_row.state #>> '{timeline,season}', '')::integer,
    nullif(v_state_row.state ->> 'current_season', '')::integer,
    nullif(v_state_row.state ->> 'season', '')::integer,
    nullif(v_state_row.state #>> '{franchise,season}', '')::integer
  );

  v_result := public.archers_contract_intake_evaluate_v1(
    p_resource_type => p_resource_type,
    p_resource_id => p_resource_id,
    p_resource_season => case
      when coalesce(v_payload ->> 'season', '') ~ '^[0-9]{4}$'
        then (v_payload ->> 'season')::integer
      else v_state_season
    end,
    p_status => coalesce(v_payload ->> 'status', 'ACTIVE'),
    p_data => coalesce(v_payload -> 'data', v_payload),
    p_state_season => v_state_season,
    p_allow_pending_rollover => false
  );

  return v_result || jsonb_build_object(
    'operation', 'validate_contract_intake',
    'dry_run', true,
    'state_version', v_state_row.version,
    'writes_performed', false
  );
end;
$$;

create or replace function public.archers_contract_intake_before_write_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state_season integer;
  v_result jsonb;
begin
  if new.franchise_id <> 'stl-2026' then
    return new;
  end if;

  select coalesce(
    nullif(state #>> '{timeline,season}', '')::integer,
    nullif(state ->> 'current_season', '')::integer,
    nullif(state ->> 'season', '')::integer,
    nullif(state #>> '{franchise,season}', '')::integer
  )
  into v_state_season
  from public.archers_franchise_state
  where id = new.franchise_id;

  v_result := public.archers_contract_intake_evaluate_v1(
    p_resource_type => new.resource_type,
    p_resource_id => new.resource_id,
    p_resource_season => new.season,
    p_status => new.status,
    p_data => new.data,
    p_state_season => v_state_season,
    p_allow_pending_rollover => true
  );

  if coalesce((v_result ->> 'blocker_count')::integer, 0) > 0 then
    raise exception 'CONTRACT_INTAKE_REJECTED for %/%',
      new.resource_type, new.resource_id
      using errcode = '22023', detail = v_result::text;
  end if;

  if coalesce((v_result ->> 'guarded')::boolean, false) then
    new.data := v_result -> 'normalized_data';
    new.season := (v_result ->> 'effective_season')::integer;
  end if;

  return new;
end;
$$;

create or replace function public.archers_contract_intake_deferred_check_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.archers_resources%rowtype;
  v_state_season integer;
  v_result jsonb;
begin
  select *
  into v_current
  from public.archers_resources
  where franchise_id = new.franchise_id
    and resource_type = new.resource_type
    and resource_id = new.resource_id;

  if not found then
    return null;
  end if;

  select coalesce(
    nullif(state #>> '{timeline,season}', '')::integer,
    nullif(state ->> 'current_season', '')::integer,
    nullif(state ->> 'season', '')::integer,
    nullif(state #>> '{franchise,season}', '')::integer
  )
  into v_state_season
  from public.archers_franchise_state
  where id = v_current.franchise_id;

  v_result := public.archers_contract_intake_evaluate_v1(
    p_resource_type => v_current.resource_type,
    p_resource_id => v_current.resource_id,
    p_resource_season => v_current.season,
    p_status => v_current.status,
    p_data => v_current.data,
    p_state_season => v_state_season,
    p_allow_pending_rollover => false
  );

  if coalesce((v_result ->> 'blocker_count')::integer, 0) > 0 then
    raise exception 'CONTRACT_INTAKE_DEFERRED_REJECTION for %/%',
      v_current.resource_type, v_current.resource_id
      using errcode = '22023', detail = v_result::text;
  end if;

  if coalesce((v_result ->> 'guarded')::boolean, false)
     and (v_result -> 'normalized_data') is distinct from v_current.data then
    raise exception 'CONTRACT_INTAKE_DERIVATION_DRIFT for %/%',
      v_current.resource_type, v_current.resource_id
      using errcode = '22023', detail = v_result::text;
  end if;

  return null;
end;
$$;

drop trigger if exists archers_contract_intake_before_write_v1
  on public.archers_resources;

create trigger archers_contract_intake_before_write_v1
before insert or update
on public.archers_resources
for each row
execute function public.archers_contract_intake_before_write_v1();

drop trigger if exists archers_contract_intake_deferred_check_v1
  on public.archers_resources;

create constraint trigger archers_contract_intake_deferred_check_v1
after insert or update
on public.archers_resources
deferrable initially deferred
for each row
execute function public.archers_contract_intake_deferred_check_v1();

revoke all on function public.archers_contract_intake_evaluate_v1(
  text, text, integer, text, jsonb, integer, boolean
) from public, anon, authenticated;

revoke all on function public.archers_validate_contract_intake(
  text, text, jsonb, integer
) from public, anon, authenticated;

grant execute on function public.archers_validate_contract_intake(
  text, text, jsonb, integer
) to service_role;

commit;
