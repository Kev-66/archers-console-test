-- Contract Intake Guard v1 identifier validation patch.
-- Aligns the read-only preview RPC with archers_resources table constraints so
-- a preview cannot report ready when the resource identity would be rejected.

begin;

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
  v_resource_type text := lower(coalesce(trim(p_resource_type), ''));
  v_resource_id text := coalesce(trim(p_resource_id), '');
begin
  if v_resource_type = '' or v_resource_id = '' then
    raise exception 'resource_type and resource_id are required for contract intake validation';
  end if;

  if v_resource_type !~ '^[a-z][a-z0-9_]{1,63}$' then
    raise exception 'resource_type has an unsupported format';
  end if;

  if v_resource_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
    raise exception 'resource_id has an unsupported format';
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
    p_resource_type => v_resource_type,
    p_resource_id => v_resource_id,
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

revoke all on function public.archers_validate_contract_intake(
  text, text, jsonb, integer
) from public, anon, authenticated;

grant execute on function public.archers_validate_contract_intake(
  text, text, jsonb, integer
) to service_role;

commit;
