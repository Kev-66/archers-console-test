import json
from pathlib import Path

EVIDENCE = Path("evidence")
plan_path = EVIDENCE / "contract-normalization-plan-v1.json"
plan = json.loads(plan_path.read_text(encoding="utf-8"))
plan_json = json.dumps(plan, sort_keys=True, ensure_ascii=False, separators=(",", ":"))

sql = f"""-- One-time atomic execution of Contract Normalization Migration v1.
-- The preview, execution, and rollover readiness assertions run in one database
-- transaction. Any failed assertion rolls back every canon and resource change.

do $normalize$
declare
  v_plan jsonb := $plan${plan_json}$plan$::jsonb;
  v_preview jsonb;
  v_execution jsonb;
  v_rollover_preview jsonb;
  v_state_version integer;
  v_player_contracts integer;
  v_staff_contracts integer;
begin
  v_preview := public.archers_normalize_contracts_v1(
    p_plan => v_plan,
    p_expected_state_version => (v_plan ->> 'expected_state_version')::integer,
    p_idempotency_key => v_plan ->> 'idempotency_key',
    p_summary => v_plan ->> 'summary',
    p_source_label => v_plan ->> 'source_label',
    p_exact_kevin_text => v_plan ->> 'exact_kevin_text',
    p_dry_run => true
  );

  if coalesce((v_preview ->> 'ready_to_execute')::boolean, false) is not true
     or coalesce((v_preview ->> 'blocker_count')::integer, -1) <> 0
     or coalesce((v_preview ->> 'player_updates')::integer, -1) <> 69
     or coalesce((v_preview ->> 'staff_inserts')::integer, -1) <> 16 then
    raise exception 'Contract normalization dry run failed: %', v_preview;
  end if;

  v_execution := public.archers_normalize_contracts_v1(
    p_plan => v_plan,
    p_expected_state_version => (v_plan ->> 'expected_state_version')::integer,
    p_idempotency_key => v_plan ->> 'idempotency_key',
    p_summary => v_plan ->> 'summary',
    p_source_label => v_plan ->> 'source_label',
    p_exact_kevin_text => v_plan ->> 'exact_kevin_text',
    p_dry_run => false
  );

  v_state_version := (v_execution ->> 'state_version')::integer;
  if v_state_version <> (v_plan ->> 'expected_state_version')::integer + 1 then
    raise exception 'Normalization returned an unexpected state version: %', v_execution;
  end if;

  select count(*)
  into v_player_contracts
  from public.archers_resources
  where franchise_id = 'stl-2026'
    and resource_type = 'player'
    and status = 'ACTIVE'
    and jsonb_typeof(data -> 'contract') = 'object';

  select count(*)
  into v_staff_contracts
  from public.archers_resources
  where franchise_id = 'stl-2026'
    and resource_type = 'staff'
    and status = 'ACTIVE'
    and jsonb_typeof(data -> 'contract') = 'object';

  if v_player_contracts <> 69 or v_staff_contracts <> 16 then
    raise exception 'Post-normalization contract count mismatch: players %, staff %',
      v_player_contracts, v_staff_contracts;
  end if;

  if not exists (
    select 1
    from public.archers_franchise_state
    where id = 'stl-2026'
      and version = v_state_version
      and state #>> '{{timeline,season}}' = '2026'
      and state ->> 'current_season' = '2026'
      and state ->> 'season' = '2026'
      and state #>> '{{franchise,season}}' = '2026'
  ) then
    raise exception 'Canonical season fields were not established consistently.';
  end if;

  v_rollover_preview := public.archers_rollover_season(
    p_resource_type => 'season_rollover',
    p_resource_id => 'season-rollover',
    p_payload => jsonb_build_object(
      'from_season', 2026,
      'to_season', 2027,
      'strict', true,
      'detail_limit', 200
    ),
    p_expected_state_version => v_state_version,
    p_idempotency_key => 'contract-normalization-v1-transactional-rollover-readiness',
    p_summary => 'Verify rollover readiness inside the contract normalization transaction',
    p_source_label => 'SYSTEM',
    p_exact_kevin_text => null,
    p_dry_run => true
  );

  if coalesce((v_rollover_preview ->> 'ready_to_execute')::boolean, false) is not true
     or coalesce((v_rollover_preview ->> 'blocker_count')::integer, -1) <> 0
     or coalesce((v_rollover_preview #>> '{{contract_set,processable_contracts}}')::integer, -1) <> 85
     or coalesce((v_rollover_preview #>> '{{contract_set,players}}')::integer, -1) <> 69
     or coalesce((v_rollover_preview #>> '{{contract_set,staff}}')::integer, -1) <> 16
     or coalesce((v_rollover_preview #>> '{{contract_set,legacy_records_requiring_normalization}}')::integer, -1) <> 0
     or coalesce((v_rollover_preview #>> '{{effects,expired_contracts}}')::integer, -1) <> 27
     or coalesce((v_rollover_preview #>> '{{effects,final_year_contracts}}')::integer, -1) <> 27 then
    raise exception 'Transactional rollover readiness check failed: %', v_rollover_preview;
  end if;

  raise notice 'CONTRACT_NORMALIZATION_PREVIEW=%', v_preview;
  raise notice 'CONTRACT_NORMALIZATION_EXECUTION=%', v_execution;
  raise notice 'ROLLOVER_READINESS_PREVIEW=%', v_rollover_preview;
end;
$normalize$;
"""

(EVIDENCE / "contract-normalization-execution-v1.sql").write_text(sql, encoding="utf-8")
print("Built atomic execution SQL for 69 player contracts and 16 staff contracts.")
