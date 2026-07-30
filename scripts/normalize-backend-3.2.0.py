#!/usr/bin/env python3
"""Normalize the backend 3.2.0 design and SQL against Decision Queue v1."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "phase3-2-atomic-decision-update.sql"
DESIGN = ROOT / "BACKEND_3.2.0_ATOMIC_DECISION_UPDATE_DESIGN.md"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def normalize_sql() -> None:
    text = SQL.read_text(encoding="utf-8")

    text = replace_once(
        text,
        "    'status',\n    'priority',",
        "    'status',\n    'priority',\n    'summary',",
        "allow mutable summary",
    )
    text = replace_once(
        text,
        "    'OPEN', 'PENDING', 'DEFERRED', 'RESOLVED', 'CLOSED', 'CANCELLED'",
        "    'OPEN', 'READY_FOR_REVIEW', 'AWAITING_KEVIN', 'BLOCKED',\n    'DEFERRED', 'RESOLVED', 'WITHDRAWN', 'EXPIRED'",
        "Decision Queue status allowlist",
    )
    text = replace_once(
        text,
        "  v_terminal_statuses text[] := array['RESOLVED', 'CLOSED', 'CANCELLED'];",
        "  v_terminal_statuses text[] := array['RESOLVED', 'WITHDRAWN', 'EXPIRED'];",
        "terminal statuses",
    )
    text = replace_once(
        text,
        "  v_new_queue_data jsonb;\n  v_current_decision jsonb;",
        "  v_new_queue_data jsonb;\n  v_summary_counts jsonb;\n  v_current_decision jsonb;",
        "summary count declaration",
    )
    text = replace_once(
        text,
        "  if jsonb_typeof(v_payload) <> 'object' then",
        "  if jsonb_typeof(v_payload) is distinct from 'object' then",
        "payload object validation",
    )
    text = replace_once(
        text,
        "  if p_source_label not in (\n    'USER_EXPLICIT', 'LIVE_SESSION_LOG', 'CHECKPOINT', 'CORRECTION', 'SYSTEM'\n  ) then",
        "  if coalesce(p_source_label, '') not in (\n    'USER_EXPLICIT', 'LIVE_SESSION_LOG', 'CHECKPOINT', 'CORRECTION', 'SYSTEM'\n  ) then",
        "source label validation",
    )
    text = replace_once(
        text,
        "  if jsonb_typeof(v_changes) <> 'object' or v_changes = '{}'::jsonb then",
        "  if jsonb_typeof(v_changes) is distinct from 'object' or v_changes = '{}'::jsonb then",
        "changes object validation",
    )

    old_idempotency = """  if found then
    v_idempotency_key_already_used := true;

    if not p_dry_run then
      if v_existing_log.status = 'SUCCESS'
         and v_existing_log.operation = v_operation
         and v_existing_log.resource_type = 'decision_queue'
         and v_existing_log.resource_id = 'decision-queue'
         and v_existing_log.expected_version = p_expected_version
         and v_existing_log.request_payload = v_request_payload
         and v_existing_log.summary = trim(p_summary)
         and v_existing_log.source_label = p_source_label
         and v_existing_log.exact_kevin_text is not distinct from nullif(p_exact_kevin_text, '') then
        return v_existing_log.result_payload || jsonb_build_object('idempotent_replay', true);
      end if;

      raise exception 'idempotency_key was already used for a different request';
    end if;
  end if;
"""
    new_idempotency = """  if found then
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
"""
    text = replace_once(text, old_idempotency, new_idempotency, "idempotency validation")

    old_lock_order = """  select *
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
"""
    new_lock_order = """  -- Match the established generic resource lock order: resource first, state second.
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
"""
    text = replace_once(text, old_lock_order, new_lock_order, "lock ordering")

    text = replace_once(
        text,
        """  select count(*), max(value)
  into v_match_count, v_current_decision
  from jsonb_array_elements(v_queue_array) as entries(value)
  where value ->> 'decision_id' = v_decision_id;
""",
        """  select count(*)
  into v_match_count
  from jsonb_array_elements(v_queue_array) as entries(value)
  where value ->> 'decision_id' = v_decision_id;

  select value
  into v_current_decision
  from jsonb_array_elements(v_queue_array) as entries(value)
  where value ->> 'decision_id' = v_decision_id
  limit 1;
""",
        "decision match lookup",
    )
    text = replace_once(
        text,
        "     and jsonb_typeof(v_updated_decision -> 'resolution') <> 'object' then",
        "     and jsonb_typeof(v_updated_decision -> 'resolution') is distinct from 'object' then",
        "terminal resolution validation",
    )
    text = replace_once(
        text,
        "    if jsonb_typeof(v_history_entry) <> 'object' then",
        "    if jsonb_typeof(v_history_entry) is distinct from 'object' then",
        "history object validation",
    )
    text = replace_once(
        text,
        "    if jsonb_typeof(v_existing_history) <> 'array' then",
        "    if jsonb_typeof(v_existing_history) is distinct from 'array' then",
        "history array validation",
    )

    old_queue_data = """  v_new_queue_data := jsonb_set(
    v_queue_row.data,
    array[v_array_key],
    v_new_queue_array,
    false
  );
"""
    new_queue_data = """  v_new_queue_data := jsonb_set(
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
"""
    text = replace_once(text, old_queue_data, new_queue_data, "queue summary counts")

    SQL.write_text(text, encoding="utf-8")


def normalize_design() -> None:
    text = DESIGN.read_text(encoding="utf-8")
    text = text.replace(
        "- `PENDING`\n- `DEFERRED`\n- `RESOLVED`\n- `CLOSED`\n- `CANCELLED`",
        "- `READY_FOR_REVIEW`\n- `AWAITING_KEVIN`\n- `BLOCKED`\n- `DEFERRED`\n- `RESOLVED`\n- `WITHDRAWN`\n- `EXPIRED`",
    )
    text = text.replace(
        "A transition to `RESOLVED`, `CLOSED`, or `CANCELLED`",
        "A transition to `RESOLVED`, `WITHDRAWN`, or `EXPIRED`",
    )
    text = text.replace(
        "- `priority`\n- `due_date`",
        "- `priority`\n- `summary`\n- `due_date`",
    )
    text = text.replace(
        "Inside one database transaction, the RPC must:",
        "Inside one database transaction, the dedicated `archers_update_decision` RPC must:",
    )
    text = text.replace(
        "Create a versioned SQL migration that updates `archers_execute_operation` to implement `update_decision` atomically.",
        "Create a versioned SQL migration that adds a dedicated `archers_update_decision` RPC. The unified Edge endpoint routes only `update_decision` to it; existing `archers_execute_operation` behavior remains unchanged.",
    )
    text = text.replace(
        '"summary": "Approved the verified option.",\n      "state_version": null',
        '"note": "Approved the verified option.",\n      "state_version": null',
    )
    DESIGN.write_text(text, encoding="utf-8")


def main() -> None:
    normalize_sql()
    normalize_design()
    print("normalized backend 3.2.0 SQL and design")


if __name__ == "__main__":
    main()
