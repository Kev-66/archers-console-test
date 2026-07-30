\set ON_ERROR_STOP on

-- Dry run validates and previews without writing rows or advancing versions.
do $$
declare
  v_result jsonb;
  v_state_version integer;
  v_queue_version integer;
  v_event_count integer;
  v_operation_count integer;
begin
  v_result := public.archers_update_decision(
    'decision_queue',
    'decision-queue',
    jsonb_build_object(
      'decision_id', 'alpha',
      'changes', jsonb_build_object('priority', 'HIGH'),
      'history_entry', jsonb_build_object(
        'status', 'OPEN',
        'note', 'Dry-run priority preview.',
        'state_version', null
      )
    ),
    5,
    34,
    'atomic-decision-dry-run-v1',
    'Preview Alpha priority update',
    'SYSTEM',
    null,
    true
  );

  if coalesce((v_result ->> 'dry_run')::boolean, false) is not true then
    raise exception 'dry run did not report dry_run true: %', v_result;
  end if;

  if v_result ->> 'decision_id' <> 'alpha' then
    raise exception 'dry run returned the wrong decision';
  end if;

  if v_result #>> '{proposed_decision,priority}' <> 'HIGH' then
    raise exception 'dry run did not normalize the proposed decision';
  end if;

  select version into v_state_version
  from public.archers_franchise_state where id = 'stl-2026';

  select version into v_queue_version
  from public.archers_resources
  where franchise_id = 'stl-2026'
    and resource_type = 'decision_queue'
    and resource_id = 'decision-queue';

  select count(*) into v_event_count from public.archers_canon_events;
  select count(*) into v_operation_count from public.archers_operation_log;

  if v_state_version <> 34 or v_queue_version <> 5 then
    raise exception 'dry run changed versions: state %, queue %', v_state_version, v_queue_version;
  end if;

  if v_event_count <> 0 or v_operation_count <> 0 then
    raise exception 'dry run wrote audit or canon rows';
  end if;
end
$$;

-- Resolve one decision and prove unrelated records are byte-for-byte preserved.
do $$
declare
  v_result jsonb;
  v_beta_before jsonb;
  v_beta_after jsonb;
  v_gamma_before jsonb;
  v_gamma_after jsonb;
  v_alpha_after jsonb;
  v_state public.archers_franchise_state%rowtype;
  v_queue public.archers_resources%rowtype;
  v_event_count integer;
  v_operation_count integer;
begin
  select value into v_beta_before
  from public.archers_resources r,
       jsonb_array_elements(r.data -> 'decisions') entries(value)
  where r.franchise_id = 'stl-2026'
    and r.resource_type = 'decision_queue'
    and r.resource_id = 'decision-queue'
    and value ->> 'decision_id' = 'beta';

  select value into v_gamma_before
  from public.archers_resources r,
       jsonb_array_elements(r.data -> 'decisions') entries(value)
  where r.franchise_id = 'stl-2026'
    and r.resource_type = 'decision_queue'
    and r.resource_id = 'decision-queue'
    and value ->> 'decision_id' = 'gamma';

  v_result := public.archers_update_decision(
    'decision_queue',
    'decision-queue',
    jsonb_build_object(
      'decision_id', 'alpha',
      'changes', jsonb_build_object(
        'status', 'RESOLVED',
        'resolution', jsonb_build_object(
          'summary', 'Alpha was resolved by the atomic test.',
          'resolved_week', 3
        )
      ),
      'history_entry', jsonb_build_object(
        'status', 'RESOLVED',
        'note', 'Resolved by the atomic test.',
        'state_version', null
      )
    ),
    5,
    34,
    'atomic-decision-resolve-alpha-v1',
    'Resolve Alpha decision atomically',
    'SYSTEM',
    null,
    false
  );

  if coalesce((v_result ->> 'idempotent_replay')::boolean, true) is not false then
    raise exception 'first execution was incorrectly marked as replay';
  end if;

  if v_result ->> 'state_version' <> '35'
     or v_result ->> 'resource_version' <> '6' then
    raise exception 'unexpected resulting versions: %', v_result;
  end if;

  if coalesce((v_result ->> 'unrelated_decisions_preserved')::boolean, false) is not true
     or coalesce((v_result ->> 'legacy_open_decisions_synchronized')::boolean, false) is not true then
    raise exception 'success response did not confirm preservation and synchronization';
  end if;

  select * into v_state
  from public.archers_franchise_state where id = 'stl-2026';

  select * into v_queue
  from public.archers_resources
  where franchise_id = 'stl-2026'
    and resource_type = 'decision_queue'
    and resource_id = 'decision-queue';

  if v_state.version <> 35 or v_queue.version <> 6 then
    raise exception 'database versions did not increment exactly once';
  end if;

  select value into v_alpha_after
  from jsonb_array_elements(v_queue.data -> 'decisions') entries(value)
  where value ->> 'decision_id' = 'alpha';

  select value into v_beta_after
  from jsonb_array_elements(v_queue.data -> 'decisions') entries(value)
  where value ->> 'decision_id' = 'beta';

  select value into v_gamma_after
  from jsonb_array_elements(v_queue.data -> 'decisions') entries(value)
  where value ->> 'decision_id' = 'gamma';

  if v_alpha_after ->> 'status' <> 'RESOLVED'
     or jsonb_typeof(v_alpha_after -> 'resolution') <> 'object' then
    raise exception 'target decision was not resolved correctly';
  end if;

  if v_alpha_after #>> '{history,-1,state_version}' <> '35' then
    raise exception 'history did not receive the resulting state version';
  end if;

  if v_beta_before is distinct from v_beta_after
     or v_gamma_before is distinct from v_gamma_after then
    raise exception 'an unrelated decision changed';
  end if;

  if v_queue.data #>> '{summary_counts,total}' <> '3'
     or v_queue.data #>> '{summary_counts,open}' <> '1'
     or v_queue.data #>> '{summary_counts,actionable}' <> '0'
     or v_queue.data #>> '{summary_counts,deferred}' <> '1'
     or v_queue.data #>> '{summary_counts,closed}' <> '2'
     or v_queue.data #>> '{summary_counts,resolved}' <> '2' then
    raise exception 'summary counts were not refreshed: %', v_queue.data -> 'summary_counts';
  end if;

  if jsonb_array_length(v_state.state -> 'open_decisions') <> 1
     or v_state.state #>> '{open_decisions,0,decision_id}' <> 'beta'
     or v_state.state #>> '{open_decisions,0,status}' <> 'DEFERRED' then
    raise exception 'legacy open_decisions projection drifted: %', v_state.state -> 'open_decisions';
  end if;

  select count(*) into v_event_count from public.archers_canon_events;
  select count(*) into v_operation_count from public.archers_operation_log;

  if v_event_count <> 1 or v_operation_count <> 1 then
    raise exception 'expected exactly one canon and one audit row';
  end if;

  if nullif(v_result ->> 'event_id', '') is null
     or nullif(v_result ->> 'operation_id', '') is null then
    raise exception 'success response is missing event or operation ID';
  end if;
end
$$;

-- An identical retry returns the stored result without any duplicate effects.
do $$
declare
  v_result jsonb;
  v_state_version integer;
  v_queue_version integer;
  v_event_count integer;
  v_operation_count integer;
begin
  v_result := public.archers_update_decision(
    'decision_queue',
    'decision-queue',
    jsonb_build_object(
      'decision_id', 'alpha',
      'changes', jsonb_build_object(
        'status', 'RESOLVED',
        'resolution', jsonb_build_object(
          'summary', 'Alpha was resolved by the atomic test.',
          'resolved_week', 3
        )
      ),
      'history_entry', jsonb_build_object(
        'status', 'RESOLVED',
        'note', 'Resolved by the atomic test.',
        'state_version', null
      )
    ),
    5,
    34,
    'atomic-decision-resolve-alpha-v1',
    'Resolve Alpha decision atomically',
    'SYSTEM',
    null,
    false
  );

  if coalesce((v_result ->> 'idempotent_replay')::boolean, false) is not true then
    raise exception 'identical retry was not marked as replay';
  end if;

  select version into v_state_version
  from public.archers_franchise_state where id = 'stl-2026';

  select version into v_queue_version
  from public.archers_resources
  where franchise_id = 'stl-2026'
    and resource_type = 'decision_queue'
    and resource_id = 'decision-queue';

  select count(*) into v_event_count from public.archers_canon_events;
  select count(*) into v_operation_count from public.archers_operation_log;

  if v_state_version <> 35 or v_queue_version <> 6
     or v_event_count <> 1 or v_operation_count <> 1 then
    raise exception 'idempotent replay created duplicate effects';
  end if;
end
$$;

-- Reusing an idempotency key for a different request must fail.
do $$
begin
  perform public.archers_update_decision(
    'decision_queue',
    'decision-queue',
    jsonb_build_object(
      'decision_id', 'alpha',
      'changes', jsonb_build_object('priority', 'LOW')
    ),
    5,
    34,
    'atomic-decision-resolve-alpha-v1',
    'Resolve Alpha decision atomically',
    'SYSTEM',
    null,
    false
  );
  raise exception 'different request reused an idempotency key without failing';
exception
  when others then
    if position('idempotency_key was already used for a different request' in sqlerrm) = 0 then
      raise;
    end if;
end
$$;

-- Stale queue and state versions must fail without advancing anything.
do $$
begin
  perform public.archers_update_decision(
    'decision_queue',
    'decision-queue',
    jsonb_build_object(
      'decision_id', 'beta',
      'changes', jsonb_build_object('priority', 'HIGH')
    ),
    5,
    35,
    'atomic-decision-stale-queue-v1',
    'Reject stale queue version',
    'SYSTEM',
    null,
    false
  );
  raise exception 'stale queue version did not fail';
exception
  when others then
    if position('stale Decision Queue' in sqlerrm) = 0 then
      raise;
    end if;
end
$$;

do $$
begin
  perform public.archers_update_decision(
    'decision_queue',
    'decision-queue',
    jsonb_build_object(
      'decision_id', 'beta',
      'changes', jsonb_build_object('priority', 'HIGH')
    ),
    6,
    34,
    'atomic-decision-stale-state-v1',
    'Reject stale state version',
    'SYSTEM',
    null,
    false
  );
  raise exception 'stale state version did not fail';
exception
  when others then
    if position('stale franchise state' in sqlerrm) = 0 then
      raise;
    end if;
end
$$;

-- Decision identity and unsupported fields are immutable.
do $$
begin
  perform public.archers_update_decision(
    'decision_queue',
    'decision-queue',
    jsonb_build_object(
      'decision_id', 'beta',
      'changes', jsonb_build_object('decision_id', 'renamed-beta')
    ),
    6,
    35,
    'atomic-decision-identity-guard-v1',
    'Reject decision identity mutation',
    'SYSTEM',
    null,
    false
  );
  raise exception 'decision identity mutation did not fail';
exception
  when others then
    if position('unsupported decision fields: decision_id' in sqlerrm) = 0 then
      raise;
    end if;
end
$$;

-- Terminal decisions cannot be reopened without an explicit correction source.
do $$
begin
  perform public.archers_update_decision(
    'decision_queue',
    'decision-queue',
    jsonb_build_object(
      'decision_id', 'gamma',
      'changes', jsonb_build_object('status', 'OPEN'),
      'history_entry', jsonb_build_object(
        'status', 'OPEN',
        'note', 'Attempted reopen.',
        'state_version', null
      )
    ),
    6,
    35,
    'atomic-decision-reopen-guard-v1',
    'Reject unauthorized terminal reopen',
    'SYSTEM',
    null,
    false
  );
  raise exception 'terminal decision reopened without CORRECTION';
exception
  when others then
    if position('reopening a terminal decision requires source_label CORRECTION' in sqlerrm) = 0 then
      raise;
    end if;
end
$$;

-- Moving to a terminal status requires a resolution object.
do $$
begin
  perform public.archers_update_decision(
    'decision_queue',
    'decision-queue',
    jsonb_build_object(
      'decision_id', 'beta',
      'changes', jsonb_build_object('status', 'EXPIRED')
    ),
    6,
    35,
    'atomic-decision-resolution-guard-v1',
    'Reject terminal status without resolution',
    'SYSTEM',
    null,
    false
  );
  raise exception 'terminal status without resolution did not fail';
exception
  when others then
    if position('terminal decision status requires a resolution object' in sqlerrm) = 0 then
      raise;
    end if;
end
$$;

-- Missing target and duplicate queue identities are rejected.
do $$
begin
  perform public.archers_update_decision(
    'decision_queue',
    'decision-queue',
    jsonb_build_object(
      'decision_id', 'missing-decision',
      'changes', jsonb_build_object('priority', 'HIGH')
    ),
    6,
    35,
    'atomic-decision-missing-v1',
    'Reject missing decision',
    'SYSTEM',
    null,
    false
  );
  raise exception 'missing decision did not fail';
exception
  when others then
    if position('decision_id not found: missing-decision' in sqlerrm) = 0 then
      raise;
    end if;
end
$$;

begin;
update public.archers_resources
set data = jsonb_set(
  data,
  '{decisions}',
  (data -> 'decisions') || jsonb_build_array(data #> '{decisions,1}'),
  false
)
where franchise_id = 'stl-2026'
  and resource_type = 'decision_queue'
  and resource_id = 'decision-queue';

do $$
begin
  perform public.archers_update_decision(
    'decision_queue',
    'decision-queue',
    jsonb_build_object(
      'decision_id', 'beta',
      'changes', jsonb_build_object('priority', 'HIGH')
    ),
    6,
    35,
    'atomic-decision-duplicate-v1',
    'Reject duplicate decision identifiers',
    'SYSTEM',
    null,
    false
  );
  raise exception 'duplicate decision IDs did not fail';
exception
  when others then
    if position('Decision Queue contains duplicate decision_id values' in sqlerrm) = 0 then
      raise;
    end if;
end
$$;
rollback;

-- Final state remains exactly where the one successful operation left it.
do $$
declare
  v_state_version integer;
  v_queue_version integer;
  v_event_count integer;
  v_operation_count integer;
begin
  select version into v_state_version
  from public.archers_franchise_state where id = 'stl-2026';

  select version into v_queue_version
  from public.archers_resources
  where franchise_id = 'stl-2026'
    and resource_type = 'decision_queue'
    and resource_id = 'decision-queue';

  select count(*) into v_event_count from public.archers_canon_events;
  select count(*) into v_operation_count from public.archers_operation_log;

  if v_state_version <> 35 or v_queue_version <> 6
     or v_event_count <> 1 or v_operation_count <> 1 then
    raise exception 'rejected operations changed canonical state';
  end if;
end
$$;

select 'backend 3.2.0 atomic decision SQL regressions passed' as result;
