-- Archers Franchise Console • Phase One hotfix
-- Fixes apply_archers_state_update so an incoming canon.sync_status patch is not
-- overwritten with the literal value "Synced" after every write.
-- Safe to run more than once. No tables, rows, secrets, or existing events are deleted.

create or replace function public.apply_archers_state_update(
  p_patch jsonb,
  p_event_type text,
  p_summary text,
  p_exact_kevin_text text default null,
  p_source_label text default 'LIVE_SESSION_LOG'
)
returns table (
  version integer,
  state jsonb,
  updated_at timestamptz,
  event_id bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.archers_franchise_state%rowtype;
  merged_state jsonb;
  new_event_id bigint;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'patch must be a JSON object';
  end if;

  if coalesce(trim(p_event_type), '') = '' then
    raise exception 'event_type is required';
  end if;

  if coalesce(trim(p_summary), '') = '' then
    raise exception 'summary is required';
  end if;

  select *
  into current_row
  from public.archers_franchise_state
  where id = 'stl-2026'
  for update;

  if not found then
    raise exception 'Archers franchise state has not been initialized';
  end if;

  merged_state := public.archers_jsonb_deep_merge(current_row.state, p_patch);

  -- Mechanical identity and control guardrails.
  -- sync_status is intentionally NOT forced here because it is an operational field
  -- that legitimate system writes must be able to change.
  merged_state := jsonb_set(merged_state, '{franchise,team}', to_jsonb('St. Louis Archers'::text), true);
  merged_state := jsonb_set(merged_state, '{franchise,owner_and_general_manager}', to_jsonb('Kevin Dorey'::text), true);
  merged_state := jsonb_set(merged_state, '{canon,kevin_lock,enabled}', 'true'::jsonb, true);

  update public.archers_franchise_state
  set
    version = current_row.version + 1,
    state = merged_state
  where id = current_row.id
  returning public.archers_franchise_state.version,
            public.archers_franchise_state.state,
            public.archers_franchise_state.updated_at
  into version, state, updated_at;

  insert into public.archers_canon_events (
    franchise_id,
    state_version,
    event_type,
    summary,
    exact_kevin_text,
    source_label,
    payload
  )
  values (
    current_row.id,
    version,
    trim(p_event_type),
    trim(p_summary),
    nullif(p_exact_kevin_text, ''),
    coalesce(nullif(trim(p_source_label), ''), 'LIVE_SESSION_LOG'),
    p_patch
  )
  returning public.archers_canon_events.event_id into new_event_id;

  event_id := new_event_id;
  return next;
end;
$$;

grant execute on function public.apply_archers_state_update(jsonb, text, text, text, text)
to service_role;
