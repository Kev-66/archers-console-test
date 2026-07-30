\set ON_ERROR_STOP on

-- Establish an authoritative current season for the isolated fixture.
update public.archers_franchise_state
set state = public.archers_jsonb_deep_merge(
  state,
  jsonb_build_object(
    'season', 2026,
    'current_season', 2026,
    'timeline', jsonb_build_object('season', 2026, 'week', 18)
  )
)
where id = 'stl-2026';

insert into public.archers_resources (
  franchise_id, resource_type, resource_id, season, data,
  status, visibility, provenance, version
) values
(
  'stl-2026', 'player', 'player-alpha', 2026,
  jsonb_build_object(
    'player_id', 'player-alpha',
    'player_name', 'Alpha Player',
    'contract', jsonb_build_object(
      'contract_kind', 'PLAYER',
      'start_season', 2025,
      'end_season', 2028,
      'salary_by_season', jsonb_build_object('2026', 10.0, '2027', 12.0, '2028', 14.0),
      'cap_hit_by_season', jsonb_build_object('2026', 11.0, '2027', 13.0, '2028', 15.0),
      'options', jsonb_build_array(
        jsonb_build_object('season', 2027, 'type', 'TEAM', 'status', 'UNRESOLVED')
      ),
      'current_season', 2026,
      'years_remaining', 3,
      'current_salary', 10.0,
      'current_cap_hit', 11.0
    )
  ),
  'ACTIVE', 'CONSOLE', 'SYSTEM', 2
),
(
  'stl-2026', 'staff', 'staff-holt', 2026,
  jsonb_build_object(
    'staff_id', 'staff-holt',
    'staff_name', 'Avery Holt',
    'position', 'Head Coach',
    'contract', jsonb_build_object(
      'contract_kind', 'STAFF',
      'start_season', 2026,
      'end_season', 2027,
      'salary_by_season', jsonb_build_object('2026', 6.0, '2027', 6.5),
      'options', jsonb_build_array(),
      'current_season', 2026,
      'years_remaining', 2,
      'current_salary', 6.0
    )
  ),
  'ACTIVE', 'PRIVATE', 'SYSTEM', 4
),
(
  'stl-2026', 'player_contract', 'contract-expiring', 2026,
  jsonb_build_object(
    'contract_kind', 'PLAYER',
    'player_id', 'expiring-player',
    'player_name', 'Expiring Player',
    'start_season', 2026,
    'end_season', 2026,
    'salary_by_season', jsonb_build_object('2026', 1.0),
    'cap_hit_by_season', jsonb_build_object('2026', 1.0),
    'options', jsonb_build_array(),
    'current_season', 2026,
    'years_remaining', 1,
    'current_salary', 1.0,
    'current_cap_hit', 1.0
  ),
  'ACTIVE', 'PRIVATE', 'SYSTEM', 3
),
(
  'stl-2026', 'player', 'legacy-summary-only', 2026,
  jsonb_build_object(
    'player_id', 'legacy-summary-only',
    'player_name', 'Legacy Summary',
    'contract_summary', 'Two years remaining',
    'cap_hit_2026_millions', 2.5
  ),
  'ACTIVE', 'CONSOLE', 'SYSTEM', 1
);

-- A dry run must detect the legacy contract and perform no writes.
do $$
declare
  v_result jsonb;
  v_state_version integer;
  v_player_version integer;
begin
  select version into v_state_version
  from public.archers_franchise_state where id = 'stl-2026';
  select version into v_player_version
  from public.archers_resources
  where franchise_id = 'stl-2026' and resource_type = 'player' and resource_id = 'player-alpha';

  v_result := public.archers_rollover_season(
    'season_rollover',
    'season-rollover',
    jsonb_build_object('from_season', 2026, 'to_season', 2027, 'strict', true),
    v_state_version,
    'rollover-v1-blocked-preview',
    'Preview blocked rollover',
    'SYSTEM',
    null,
    true
  );

  if (v_result ->> 'dry_run')::boolean is distinct from true then
    raise exception 'blocked preview was not a dry run';
  end if;
  if (v_result ->> 'ready_to_execute')::boolean is distinct from false then
    raise exception 'legacy contract did not block readiness';
  end if;
  if (v_result ->> 'blocker_count')::integer <> 1 then
    raise exception 'expected one blocker, received %', v_result ->> 'blocker_count';
  end if;
  if v_result #>> '{contract_set,processable_contracts}' <> '3' then
    raise exception 'expected three processable contracts';
  end if;
  if v_result #>> '{contract_set,players}' <> '2' then
    raise exception 'expected two player contracts';
  end if;
  if v_result #>> '{contract_set,staff}' <> '1' then
    raise exception 'expected one staff contract';
  end if;
  if v_result #>> '{effects,options_due}' <> '1' then
    raise exception 'expected one option due';
  end if;
  if v_result #>> '{effects,options_exercised}' <> '0' then
    raise exception 'preview exercised an option';
  end if;

  if (select version from public.archers_franchise_state where id = 'stl-2026') <> v_state_version then
    raise exception 'dry run changed state version';
  end if;
  if (select version from public.archers_resources where franchise_id = 'stl-2026' and resource_type = 'player' and resource_id = 'player-alpha') <> v_player_version then
    raise exception 'dry run changed player version';
  end if;
  if exists (select 1 from public.archers_operation_log where idempotency_key = 'rollover-v1-blocked-preview') then
    raise exception 'dry run wrote an operation log';
  end if;
end;
$$;

-- Normalize the legacy record without inferring numbers from its summary.
update public.archers_resources
set data = data || jsonb_build_object(
  'contract', jsonb_build_object(
    'contract_kind', 'PLAYER',
    'start_season', 2026,
    'end_season', 2027,
    'salary_by_season', jsonb_build_object('2026', 2.0, '2027', 2.25),
    'cap_hit_by_season', jsonb_build_object('2026', 2.5, '2027', 2.75),
    'options', jsonb_build_array(),
    'current_season', 2026,
    'years_remaining', 2,
    'current_salary', 2.0,
    'current_cap_hit', 2.5
  )
)
where franchise_id = 'stl-2026'
  and resource_type = 'player'
  and resource_id = 'legacy-summary-only';

create temporary table rollover_preview as
select public.archers_rollover_season(
  'season_rollover',
  'season-rollover',
  jsonb_build_object('from_season', 2026, 'to_season', 2027, 'strict', true),
  (select version from public.archers_franchise_state where id = 'stl-2026'),
  'rollover-v1-ready-preview',
  'Preview ready rollover',
  'SYSTEM',
  null,
  true
) as result;

do $$
declare
  v_result jsonb := (select result from rollover_preview);
begin
  if (v_result ->> 'ready_to_execute')::boolean is distinct from true then
    raise exception 'normalized preview is not ready: %', v_result -> 'blockers';
  end if;
  if (v_result ->> 'blocker_count')::integer <> 0 then
    raise exception 'normalized preview still has blockers';
  end if;
  if v_result #>> '{contract_set,processable_contracts}' <> '4' then
    raise exception 'expected four processable contracts';
  end if;
  if v_result #>> '{effects,expired_contracts}' <> '1' then
    raise exception 'expected one expired contract';
  end if;
  if v_result #>> '{effects,final_year_contracts}' <> '2' then
    raise exception 'expected two final-year contracts';
  end if;
  if v_result #>> '{effects,salary_changes}' <> '3' then
    raise exception 'expected three salary changes';
  end if;
  if v_result #>> '{effects,cap_hit_changes}' <> '2' then
    raise exception 'expected two cap changes';
  end if;
end;
$$;

-- A fingerprint cannot duplicate one valid resource while omitting another.
do $$
declare
  v_expected jsonb := (select result -> 'expected_resources' from rollover_preview);
  v_duplicate jsonb;
  v_failed boolean := false;
  v_state_before integer := (select version from public.archers_franchise_state where id = 'stl-2026');
begin
  if jsonb_array_length(v_expected) < 2 then
    raise exception 'duplicate fingerprint regression requires at least two contracts';
  end if;

  v_duplicate :=
    (v_expected - (jsonb_array_length(v_expected) - 1)) ||
    jsonb_build_array(v_expected -> 0);

  begin
    perform public.archers_rollover_season(
      'season_rollover',
      'season-rollover',
      jsonb_build_object(
        'from_season', 2026,
        'to_season', 2027,
        'strict', true,
        'expected_resources', v_duplicate
      ),
      (select (result ->> 'current_state_version')::integer from rollover_preview),
      'rollover-v1-duplicate-fingerprint',
      'Reject duplicate rollover fingerprint',
      'SYSTEM',
      null,
      false
    );
  exception when others then
    if position('duplicate resource identities' in sqlerrm) = 0 then
      raise;
    end if;
    v_failed := true;
  end;

  if not v_failed then
    raise exception 'duplicate fingerprint unexpectedly succeeded';
  end if;
  if (select version from public.archers_franchise_state where id = 'stl-2026') <> v_state_before then
    raise exception 'duplicate fingerprint changed state';
  end if;
  if exists (
    select 1 from public.archers_operation_log
    where idempotency_key = 'rollover-v1-duplicate-fingerprint'
  ) then
    raise exception 'duplicate fingerprint wrote an operation log';
  end if;
end;
$$;

create temporary table rollover_execution as
select public.archers_rollover_season(
  'season_rollover',
  'season-rollover',
  jsonb_build_object(
    'from_season', 2026,
    'to_season', 2027,
    'strict', true,
    'expected_resources', (select result -> 'expected_resources' from rollover_preview)
  ),
  (select version from public.archers_franchise_state where id = 'stl-2026'),
  'rollover-v1-execute',
  'Advance player and staff contracts into 2027',
  'SYSTEM',
  null,
  false
) as result;

do $$
declare
  v_result jsonb := (select result from rollover_execution);
  v_state jsonb;
  v_contract jsonb;
begin
  if (v_result ->> 'dry_run')::boolean is distinct from false then
    raise exception 'execution returned dry_run true';
  end if;
  if (v_result ->> 'state_version')::integer <>
     (select (result ->> 'current_state_version')::integer + 1 from rollover_preview) then
    raise exception 'expected one state-version increment, received %', v_result ->> 'state_version';
  end if;
  if jsonb_array_length(v_result -> 'affected_resource_versions') <> 4 then
    raise exception 'expected four affected resource versions';
  end if;
  if (v_result ->> 'discretionary_actions_taken')::boolean is distinct from false then
    raise exception 'rollover reported discretionary action';
  end if;

  select state into v_state from public.archers_franchise_state where id = 'stl-2026';
  if v_state #>> '{timeline,season}' <> '2027'
     or v_state ->> 'current_season' <> '2027'
     or v_state ->> 'season' <> '2027' then
    raise exception 'state season was not advanced consistently';
  end if;
  if v_state #>> '{franchise,owner_and_general_manager}' <> 'Kevin Dorey' then
    raise exception 'Kevin identity guardrail changed';
  end if;
  if v_state #>> '{canon,kevin_lock,enabled}' <> 'true' then
    raise exception 'Kevin lock was not preserved';
  end if;

  select data -> 'contract' into v_contract
  from public.archers_resources
  where franchise_id = 'stl-2026' and resource_type = 'player' and resource_id = 'player-alpha';
  if v_contract ->> 'current_season' <> '2027'
     or v_contract ->> 'years_remaining' <> '2'
     or v_contract ->> 'rollover_status' <> 'ACTIVE'
     or (v_contract ->> 'current_salary')::numeric <> 12.0
     or (v_contract ->> 'current_cap_hit')::numeric <> 13.0 then
    raise exception 'player contract did not roll correctly: %', v_contract;
  end if;
  if jsonb_array_length(v_contract -> 'options_due') <> 1 then
    raise exception 'player option was not flagged';
  end if;
  if v_contract #>> '{options,0,status}' <> 'UNRESOLVED' then
    raise exception 'player option was exercised or altered';
  end if;

  select data -> 'contract' into v_contract
  from public.archers_resources
  where franchise_id = 'stl-2026' and resource_type = 'staff' and resource_id = 'staff-holt';
  if v_contract ->> 'years_remaining' <> '1'
     or v_contract ->> 'rollover_status' <> 'FINAL_YEAR'
     or (v_contract ->> 'current_salary')::numeric <> 6.5 then
    raise exception 'staff contract did not roll correctly: %', v_contract;
  end if;

  select data into v_contract
  from public.archers_resources
  where franchise_id = 'stl-2026' and resource_type = 'player_contract' and resource_id = 'contract-expiring';
  if v_contract ->> 'years_remaining' <> '0'
     or v_contract ->> 'rollover_status' <> 'EXPIRED'
     or v_contract -> 'current_salary' <> 'null'::jsonb then
    raise exception 'expired contract did not roll correctly: %', v_contract;
  end if;

  if not exists (
    select 1 from public.archers_canon_events
    where state_version = (v_result ->> 'state_version')::integer
      and event_type = 'season_rollover'
  ) then
    raise exception 'season rollover canon event missing';
  end if;
  if not exists (
    select 1 from public.archers_operation_log
    where idempotency_key = 'rollover-v1-execute'
      and operation = 'rollover_season'
      and state_version = (v_result ->> 'state_version')::integer
      and status = 'SUCCESS'
  ) then
    raise exception 'season rollover operation log missing';
  end if;
end;
$$;

-- Exact replay must return the original result without a second write.
do $$
declare
  v_before_state integer := (select version from public.archers_franchise_state where id = 'stl-2026');
  v_result jsonb;
begin
  v_result := public.archers_rollover_season(
    'season_rollover',
    'season-rollover',
    jsonb_build_object(
      'from_season', 2026,
      'to_season', 2027,
      'strict', true,
      'expected_resources', (select result -> 'expected_resources' from rollover_preview)
    ),
    (select (result ->> 'current_state_version')::integer from rollover_preview),
    'rollover-v1-execute',
    'Advance player and staff contracts into 2027',
    'SYSTEM',
    null,
    false
  );

  if (v_result ->> 'idempotent_replay')::boolean is distinct from true then
    raise exception 'exact replay was not identified';
  end if;
  if (select version from public.archers_franchise_state where id = 'stl-2026') <> v_before_state then
    raise exception 'idempotent replay changed state';
  end if;
  if (select count(*) from public.archers_operation_log where idempotency_key = 'rollover-v1-execute') <> 1 then
    raise exception 'idempotent replay duplicated operation log';
  end if;
end;
$$;

-- A second-year preview produces a version fingerprint. Mutating one contract
-- afterward must make execution fail atomically.
create temporary table rollover_2028_preview as
select public.archers_rollover_season(
  'season_rollover',
  'season-rollover',
  jsonb_build_object('from_season', 2027, 'to_season', 2028, 'strict', true),
  (select version from public.archers_franchise_state where id = 'stl-2026'),
  'rollover-v1-2028-preview',
  'Preview 2028 rollover',
  'SYSTEM',
  null,
  true
) as result;

update public.archers_resources
set version = version + 1
where franchise_id = 'stl-2026'
  and resource_type = 'player'
  and resource_id = 'player-alpha';

do $$
declare
  v_failed boolean := false;
  v_state_before integer := (select version from public.archers_franchise_state where id = 'stl-2026');
begin
  begin
    perform public.archers_rollover_season(
      'season_rollover',
      'season-rollover',
      jsonb_build_object(
        'from_season', 2027,
        'to_season', 2028,
        'strict', true,
        'expected_resources', (select result -> 'expected_resources' from rollover_2028_preview)
      ),
      (select (result ->> 'current_state_version')::integer from rollover_2028_preview),
      'rollover-v1-stale-execute',
      'Attempt stale 2028 rollover',
      'SYSTEM',
      null,
      false
    );
  exception when others then
    v_failed := true;
  end;

  if not v_failed then
    raise exception 'stale resource execution unexpectedly succeeded';
  end if;
  if (select version from public.archers_franchise_state where id = 'stl-2026') <> v_state_before then
    raise exception 'failed stale execution changed state';
  end if;
  if exists (select 1 from public.archers_operation_log where idempotency_key = 'rollover-v1-stale-execute') then
    raise exception 'failed stale execution wrote operation log';
  end if;
end;
$$;

-- Wrong-season previews must be visibly blocked rather than silently corrected.
do $$
declare
  v_result jsonb;
begin
  v_result := public.archers_rollover_season(
    'season_rollover',
    'season-rollover',
    jsonb_build_object('from_season', 2026, 'to_season', 2027, 'strict', true),
    (select version from public.archers_franchise_state where id = 'stl-2026'),
    'rollover-v1-wrong-season-preview',
    'Preview wrong-season rollover',
    'SYSTEM',
    null,
    true
  );

  if (v_result ->> 'ready_to_execute')::boolean is distinct from false then
    raise exception 'wrong-season preview was marked ready';
  end if;
  if not (v_result -> 'blockers' @> jsonb_build_array(jsonb_build_object('code', 'CURRENT_SEASON_CONFLICT'))) then
    raise exception 'wrong-season blocker was not reported: %', v_result -> 'blockers';
  end if;
end;
$$;

select 'season rollover v1 regressions passed' as result;
