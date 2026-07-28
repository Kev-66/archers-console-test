-- Draft a Dynasty governing-document ratification
-- Ratifies Compact Constitution v1.2 and Operations Manual v1.0 in live state.
-- Archives Constitution First Ratified Edition and Bible v1.1 as historical references.
-- Safe to run more than once. A second run does not create a duplicate event.

do $$
declare
  current_state jsonb;
begin
  select state
  into current_state
  from public.archers_franchise_state
  where id = 'stl-2026';

  if current_state is null then
    raise exception 'Archers franchise state has not been initialized';
  end if;

  if current_state #>> '{canon,constitution,version}' = '1.2'
     and current_state #>> '{canon,constitution,status}' = 'ACTIVE'
     and current_state #>> '{canon,operations_manual,version}' = '1.0'
     and current_state #>> '{canon,operations_manual,status}' = 'ACTIVE'
  then
    raise notice 'Compact Constitution v1.2 and Operations Manual v1.0 are already ratified.';
    return;
  end if;

  perform *
  from public.apply_archers_state_update(
    jsonb_build_object(
      'canon', jsonb_build_object(
        'constitution', jsonb_build_object(
          'title', 'Draft a Dynasty Compact Constitution',
          'version', '1.2',
          'status', 'ACTIVE',
          'effective_date', '2026-07-28',
          'supersedes', 'Draft a Dynasty Constitution, First Ratified Edition',
          'archived_predecessor', 'First Ratified Edition'
        ),
        'operations_manual', jsonb_build_object(
          'title', 'Draft a Dynasty Operations Manual',
          'version', '1.0',
          'status', 'ACTIVE',
          'effective_date', '2026-07-28',
          'replaces_for_current_operations', 'Draft a Dynasty Bible Version 1.1'
        ),
        'bible', jsonb_build_object(
          'version', '1.1',
          'status', 'ARCHIVED HISTORICAL OPERATIONS SOURCE'
        ),
        'governing_documents_status', 'RATIFIED',
        'sync_status', 'Synced'
      )
    ),
    'decision',
    'Ratified Compact Constitution v1.2 and Operations Manual v1.0; archived the First Ratified Edition and Bible v1.1 as historical references.',
    'Alright lets add all those things then ratify Compact Constitution v1.2 and Operations Manual v1.0.',
    'USER_EXPLICIT'
  );
end;
$$;