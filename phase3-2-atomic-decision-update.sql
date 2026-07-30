-- Draft a Dynasty • Backend 3.2.0
-- Atomic Decision Queue Update
--
-- Adds one dedicated protected RPC used by the unified Edge Function when
-- operation = update_decision. Existing archers_execute_operation behavior is
-- not replaced or modified by this migration.

begin;

create or replace function public.archers_update_decision(
  p_resource_type text,
  p_resource_id text,
  p_payload jsonb,
  p_expected_version integer,
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
  v_operation constant text := 'update_decision';
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_decision_id text;
  v_changes jsonb;
  v_history_entry jsonb;
  v_allowed_fields text[] := array[
    'status',
    'priority',
    'summary',
    'due_date',
    'due_week',
    'deadline_label',
    'review_after',
    'choices',
    'recommended_action',
    'decision_question',
    'resolution',
    'note',
    'evidence_boundaries',
    'related_resource_refs',
    'related_player_resource_ids',
    'approval_required',
    'approval_owner'
  ];
  v_supported_statuses text[] := array[
    'OPEN', 'READY_FOR_REVIEW', 'AWAITING_KEVIN', 'BLOCKED',
    'DEFERRED', 'RESOLVED', 'WITHDRAWN', 'EXPIRED'
  ];
  v_terminal_statuses text[] := array['RESOLVED', 'WITHDRAWN', 'EXPIRED'];
  v_invalid_fields text;
  v_updated_fields jsonb;
  v_state_row public.archers_franchise_state%rowtype;
  v_queue_row public.archers_resources%rowtype;
  v_existing_log public.archers_operation_log%rowtype;
  v_request_payload jsonb;
  v_array_key text;
  v_queue_array jsonb;
  v_new_queue_array jsonb;
  v_new_queue_data jsonb;
  v_summary_counts jsonb;
  v_open_decisions jsonb;
  v_current_decision jsonb;
  v_updated_decision jsonb;
  v_existing_history jsonb;
  v_total_count integer := 0;
  v_non_object_count integer := 0;
  v_missing_id_count integer := 0;
  v_distinct_id_count integer := 0;
  v_match_count integer := 0;
  v_current_status text;
  v_result_status text;
  v_new_state_version integer;
  v_new_queue_version integer;
  v_state_patch jsonb;
  v_merged_state jsonb;
  v_event_id bigint;
  v_operation_id bigint;
  v_result jsonb;
  v_now timestamptz := now();
  v_idempotency_key_already_used boolean := false;
begin
  if lower(coalesce(trim(p_resource_type), '')) <> 'decision_queue'
     or coalesce(trim(p_resource_id), '') <> 'decision-queue' then
    raise exception 'update_decision requires decision_queue/decision-queue';
  end if;

  if jsonb_typeof(v_payload) is distinct from 'object' then
    raise exception 'payload must be one JSON object';
  end if;

  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'expected_version is required for update_decision';
  end if;

  if p_expected_state_version is null or p_expected_state_version < 1 then
    raise exception 'expected_state_version is required for update_decision';
  end if;

  if coalesce(trim(p_idempotency_key), '') = '' then
    raise exception 'idempotency_key is required for update_decision';
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

  v_decision_id := nullif(trim(v_payload ->> 'decision_id'), '');
  if v_decision_id is null then
    raise exception 'payload.decision_id is required';
  end if;

  v_changes := v_payload -> 'changes';
  if jsonb_typeof(v_changes) is distinct from 'object' or v_changes = '{}'::jsonb then
    raise exception 'payload.changes must be a non-empty JSON object';
  end if;

  select string_agg(key, ', ' order by key)
  into v_invalid_fields
  from jsonb_object_keys(v_changes) as fields(key)
  where not (key = any(v_allowed_fields));

  if v_invalid_fields is not null then
    raise exception 'unsupported decision fields: %', v_invalid_fields;
  end if;

  select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
  into v_updated_fields
  from jsonb_object_keys(v_changes) as fields(key);

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
      and v_existing_log.resource_type = 'decision_queue'
      and v_existing_log.resource_id = 'decision-queue'
      and v_existing_log.expected_version = p_expected_version
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

  -- Match the established generic resource lock order: resource first, state second.
  select *
  into v_queue_row
  from public.archers_resources
  where franchise_id = 'stl-2026'
    and resource_type = 'decision_queue'
    and resource_id = 'decision-queue'
    and status = 'ACTIVE'
  for update;

  if not found then
    raise exception 'active Decision Queue resource was not found';
  end if;

  if v_queue_row.version <> p_expected_version then
    raise exception 'stale Decision Queue: expected %, current %',
      p_expected_version, v_queue_row.version;
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

  if jsonb_typeof(v_queue_row.data -> 'decisions') = 'array' then
    v_array_key := 'decisions';
  elsif jsonb_typeof(v_queue_row.data -> 'items') = 'array' then
    v_array_key := 'items';
  elsif jsonb_typeof(v_queue_row.data -> 'queue') = 'array' then
    v_array_key := 'queue';
  else
    raise exception 'Decision Queue does not contain a decisions, items, or queue array';
  end if;

  v_queue_array := v_queue_row.data -> v_array_key;

  select
    count(*),
    count(*) filter (where jsonb_typeof(value) <> 'object'),
    count(*) filter (
      where jsonb_typeof(value) <> 'object'
         or nullif(trim(value ->> 'decision_id'), '') is null
    ),
    count(distinct value ->> 'decision_id')
  into
    v_total_count,
    v_non_object_count,
    v_missing_id_count,
    v_distinct_id_count
  from jsonb_array_elements(v_queue_array) as entries(value);

  if v_non_object_count > 0 then
    raise exception 'Decision Queue contains a non-object decision entry';
  end if;

  if v_missing_id_count > 0 then
    raise exception 'Decision Queue contains an entry without decision_id';
  end if;

  if v_distinct_id_count <> v_total_count then
    raise exception 'Decision Queue contains duplicate decision_id values';
  end if;

  select count(*)
  into v_match_count
  from jsonb_array_elements(v_queue_array) as entries(value)
  where value ->> 'decision_id' = v_decision_id;

  select value
  into v_current_decision
  from jsonb_array_elements(v_queue_array) as entries(value)
  where value ->> 'decision_id' = v_decision_id
  limit 1;

  if v_match_count = 0 then
    raise exception 'decision_id not found: %', v_decision_id;
  end if;

  if v_match_count <> 1 then
    raise exception 'decision_id matched more than once: %', v_decision_id;
  end if;

  v_current_status := upper(replace(coalesce(v_current_decision ->> 'status', ''), ' ', '_'));

  if v_changes ? 'status' then
    if jsonb_typeof(v_changes -> 'status') <> 'string' then
      raise exception 'changes.status must be a string';
    end if;

    v_result_status := upper(replace(trim(v_changes ->> 'status'), ' ', '_'));
    if not (v_result_status = any(v_supported_statuses)) then
      raise exception 'unsupported decision status: %', v_result_status;
    end if;

    v_changes := jsonb_set(v_changes, '{status}', to_jsonb(v_result_status), true);
  else
    v_result_status := v_current_status;
  end if;

  if not (v_result_status = any(v_supported_statuses)) then
    raise exception 'existing decision has unsupported status: %', v_result_status;
  end if;

  if v_current_status = any(v_terminal_statuses)
     and not (v_result_status = any(v_terminal_statuses))
     and p_source_label <> 'CORRECTION' then
    raise exception 'reopening a terminal decision requires source_label CORRECTION';
  end if;

  v_updated_decision := v_current_decision || v_changes;

  if v_result_status = any(v_terminal_statuses)
     and jsonb_typeof(v_updated_decision -> 'resolution') is distinct from 'object' then
    raise exception 'terminal decision status requires a resolution object';
  end if;

  v_new_state_version := v_state_row.version + 1;

  if v_payload ? 'history_entry' and v_payload -> 'history_entry' <> 'null'::jsonb then
    v_history_entry := v_payload -> 'history_entry';

    if jsonb_typeof(v_history_entry) is distinct from 'object' then
      raise exception 'payload.history_entry must be a JSON object or null';
    end if;

    if nullif(trim(v_history_entry ->> 'status'), '') is null then
      raise exception 'history_entry.status is required';
    end if;

    if upper(replace(trim(v_history_entry ->> 'status'), ' ', '_')) <> v_result_status then
      raise exception 'history_entry.status must match the resulting decision status';
    end if;

    if v_history_entry ? 'state_version'
       and v_history_entry -> 'state_version' <> 'null'::jsonb
       and (v_history_entry ->> 'state_version')::integer <> v_new_state_version then
      raise exception 'history_entry.state_version conflicts with the resulting state version';
    end if;

    v_existing_history := coalesce(v_updated_decision -> 'history', '[]'::jsonb);
    if jsonb_typeof(v_existing_history) is distinct from 'array' then
      raise exception 'existing decision history must be an array';
    end if;

    v_history_entry := v_history_entry || jsonb_build_object(
      'status', v_result_status,
      'state_version', v_new_state_version
    );

    v_updated_decision := jsonb_set(
      v_updated_decision,
      '{history}',
      v_existing_history || jsonb_build_array(v_history_entry),
      true
    );
  end if;

  select jsonb_agg(
    case
      when value ->> 'decision_id' = v_decision_id then v_updated_decision
      else value
    end
    order by ordinality
  )
  into v_new_queue_array
  from jsonb_array_elements(v_queue_array) with ordinality as entries(value, ordinality);

  v_new_queue_data := jsonb_set(
    v_queue_row.data,
    array[v_array_key],
    v_new_queue_array,
    false
  );

  select jsonb_build_object(
    'total', count(*),
    'open', count(*) filter (
      where upper(replace(coalesce(value ->> 'status', ''), ' ', '_')) in (
        'OPEN', 'READY_FOR_REVIEW', 'AWAITING_KEVIN', 'BLOCKED', 'DEFERRED'
      )
    ),
    'actionable', count(*) filter (
      where upper(replace(coalesce(value ->> 'status', ''), ' ', '_')) in (
        'OPEN', 'READY_FOR_REVIEW', 'AWAITING_KEVIN', 'BLOCKED'
      )
    ),
    'deferred', count(*) filter (
      where upper(replace(coalesce(value ->> 'status', ''), ' ', '_')) = 'DEFERRED'
    ),
    'closed', count(*) filter (
      where upper(replace(coalesce(value ->> 'status', ''), ' ', '_')) in (
        'RESOLVED', 'WITHDRAWN', 'EXPIRED'
      )
    ),
    'resolved', count(*) filter (
      where upper(replace(coalesce(value ->> 'status', ''), ' ', '_')) = 'RESOLVED'
    ),
    'withdrawn', count(*) filter (
      where upper(replace(coalesce(value ->> 'status', ''), ' ', '_')) = 'WITHDRAWN'
    ),
    'expired', count(*) filter (
      where upper(replace(coalesce(value ->> 'status', ''), ' ', '_')) = 'EXPIRED'
    )
  )
  into v_summary_counts
  from jsonb_array_elements(v_new_queue_array) as entries(value);

  v_new_queue_data := jsonb_set(
    v_new_queue_data,
    '{summary_counts}',
    coalesce(v_queue_row.data -> 'summary_counts', '{}'::jsonb) || v_summary_counts,
    true
  );


  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'decision_id', value -> 'decision_id',
          'title', value -> 'title',
          'summary', value -> 'summary',
          'status', value -> 'status',
          'priority', value -> 'priority',
          'category', value -> 'category',
          'due_week', value -> 'due_week',
          'due_date', value -> 'due_date',
          'deadline_label', value -> 'deadline_label',
          'approval_required', value -> 'approval_required',
          'approval_owner', value -> 'approval_owner'
        )
      )
      order by ordinality
    ),
    '[]'::jsonb
  )
  into v_open_decisions
  from jsonb_array_elements(v_new_queue_array) with ordinality as entries(value, ordinality)
  where upper(replace(coalesce(value ->> 'status', ''), ' ', '_')) in (
    'OPEN', 'READY_FOR_REVIEW', 'AWAITING_KEVIN', 'BLOCKED', 'DEFERRED'
  );

  if p_dry_run then
    return jsonb_build_object(
      'backend_feature', 'ATOMIC_DECISION_UPDATE',
      'dry_run', true,
      'operation', v_operation,
      'resource_type', 'decision_queue',
      'resource_id', 'decision-queue',
      'decision_id', v_decision_id,
      'current_state_version', v_state_row.version,
      'current_resource_version', v_queue_row.version,
      'proposed_state_version', v_new_state_version,
      'proposed_resource_version', v_queue_row.version + 1,
      'current_decision', v_current_decision,
      'proposed_decision', v_updated_decision,
      'updated_fields', v_updated_fields,
      'unrelated_decisions_preserved', true,
      'legacy_open_decisions_synchronized', true,
      'proposed_open_decisions', v_open_decisions,
      'idempotency_key_already_used', v_idempotency_key_already_used,
      'note', 'No database write was performed.'
    );
  end if;

  update public.archers_resources
  set
    data = v_new_queue_data,
    provenance = p_source_label,
    version = version + 1
  where franchise_id = 'stl-2026'
    and resource_type = 'decision_queue'
    and resource_id = 'decision-queue'
    and status = 'ACTIVE'
  returning version into v_new_queue_version;

  v_state_patch := jsonb_build_object(
    'open_decisions', v_open_decisions,
    'canon', jsonb_build_object(
      'last_operation', jsonb_build_object(
        'operation', v_operation,
        'resource_type', 'decision_queue',
        'resource_id', 'decision-queue',
        'decision_id', v_decision_id,
        'idempotency_key', p_idempotency_key,
        'source_label', p_source_label,
        'completed_at', v_now
      )
    )
  );

  v_merged_state := public.archers_jsonb_deep_merge(v_state_row.state, v_state_patch);
  v_merged_state := jsonb_set(
    v_merged_state,
    '{franchise,team}',
    to_jsonb('St. Louis Archers'::text),
    true
  );
  v_merged_state := jsonb_set(
    v_merged_state,
    '{franchise,owner_and_general_manager}',
    to_jsonb('Kevin Dorey'::text),
    true
  );
  v_merged_state := jsonb_set(
    v_merged_state,
    '{canon,kevin_lock,enabled}',
    'true'::jsonb,
    true
  );

  update public.archers_franchise_state
  set
    version = version + 1,
    state = v_merged_state
  where id = 'stl-2026'
  returning version into v_new_state_version;

  v_result := jsonb_build_object(
    'operation', v_operation,
    'state_version', v_new_state_version,
    'resource_type', 'decision_queue',
    'resource_id', 'decision-queue',
    'resource_version', v_new_queue_version,
    'decision_id', v_decision_id,
    'decision', v_updated_decision,
    'updated_fields', v_updated_fields,
    'unrelated_decisions_preserved', true,
    'legacy_open_decisions_synchronized', true,
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
    'decision_queue',
    trim(p_summary),
    nullif(p_exact_kevin_text, ''),
    p_source_label,
    jsonb_build_object(
      'operation', v_operation,
      'resource_type', 'decision_queue',
      'resource_id', 'decision-queue',
      'decision_id', v_decision_id,
      'payload', v_payload,
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
    'decision_queue',
    'decision-queue',
    p_expected_version,
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

revoke all on function public.archers_update_decision(
  text, text, jsonb, integer, integer, text, text, text, text, boolean
) from public, anon, authenticated;

grant execute on function public.archers_update_decision(
  text, text, jsonb, integer, integer, text, text, text, text, boolean
) to service_role;

commit;
