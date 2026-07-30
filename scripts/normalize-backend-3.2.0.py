#!/usr/bin/env python3
"""Apply final idempotent 3.2.0 queue-consistency refinements."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "phase3-2-atomic-decision-update.sql"
DESIGN = ROOT / "BACKEND_3.2.0_ATOMIC_DECISION_UPDATE_DESIGN.md"


def insert_once(text: str, marker: str, addition: str, guard: str, label: str) -> str:
    if guard in text:
        return text
    count = text.count(marker)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one marker, found {count}")
    return text.replace(marker, marker + addition, 1)


def replace_once_if_needed(
    text: str,
    old: str,
    new: str,
    guard: str,
    label: str,
) -> str:
    if guard in text:
        return text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one source block, found {count}")
    return text.replace(old, new, 1)


def refine_sql() -> None:
    text = SQL.read_text(encoding="utf-8")

    required = [
        "'READY_FOR_REVIEW'",
        "'AWAITING_KEVIN'",
        "'WITHDRAWN'",
        "'EXPIRED'",
        "v_summary_counts jsonb;",
    ]
    for token in required:
        if token not in text:
            raise RuntimeError(f"normalized SQL is missing {token}")

    text = insert_once(
        text,
        "  v_summary_counts jsonb;\n",
        "  v_open_decisions jsonb;\n",
        "v_open_decisions jsonb;",
        "legacy projection declaration",
    )

    projection_block = """

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
"""

    text = insert_once(
        text,
        "  v_new_queue_data := jsonb_set(\n    v_new_queue_data,\n    '{summary_counts}',\n    coalesce(v_queue_row.data -> 'summary_counts', '{}'::jsonb) || v_summary_counts,\n    true\n  );\n",
        projection_block,
        "into v_open_decisions",
        "legacy projection query",
    )

    text = replace_once_if_needed(
        text,
        """  v_state_patch := jsonb_build_object(
    'canon', jsonb_build_object(
""",
        """  v_state_patch := jsonb_build_object(
    'open_decisions', v_open_decisions,
    'canon', jsonb_build_object(
""",
        "'open_decisions', v_open_decisions",
        "state projection patch",
    )

    text = replace_once_if_needed(
        text,
        """      'unrelated_decisions_preserved', true,
      'idempotency_key_already_used', v_idempotency_key_already_used,
""",
        """      'unrelated_decisions_preserved', true,
      'legacy_open_decisions_synchronized', true,
      'proposed_open_decisions', v_open_decisions,
      'idempotency_key_already_used', v_idempotency_key_already_used,
""",
        "'proposed_open_decisions', v_open_decisions",
        "dry-run projection response",
    )

    text = replace_once_if_needed(
        text,
        """    'updated_fields', v_updated_fields,
    'unrelated_decisions_preserved', true,
    'idempotent_replay', false
""",
        """    'updated_fields', v_updated_fields,
    'unrelated_decisions_preserved', true,
    'legacy_open_decisions_synchronized', true,
    'idempotent_replay', false
""",
        "'legacy_open_decisions_synchronized', true,\n    'idempotent_replay', false",
        "success projection response",
    )

    SQL.write_text(text, encoding="utf-8")


def refine_design() -> None:
    text = DESIGN.read_text(encoding="utf-8")
    sentence = (
        "14. Refresh the compact legacy `state.open_decisions` projection from the "
        "updated queue so `core_state` and snapshot fallback cannot drift."
    )
    if sentence not in text:
        marker = "13. Return the updated decision, queue version, resulting state version, operation ID, and event ID."
        if marker not in text:
            raise RuntimeError("design atomic-behavior marker is missing")
        text = text.replace(marker, marker + "\n" + sentence, 1)

    if "legacy_open_decisions_synchronized" not in text:
        marker = '  "unrelated_decisions_preserved": true,\n  "idempotent_replay": false'
        replacement = (
            '  "unrelated_decisions_preserved": true,\n'
            '  "legacy_open_decisions_synchronized": true,\n'
            '  "idempotent_replay": false'
        )
        if marker not in text:
            raise RuntimeError("design success-response marker is missing")
        text = text.replace(marker, replacement, 1)

    DESIGN.write_text(text, encoding="utf-8")


def main() -> None:
    refine_sql()
    refine_design()
    print("applied final backend 3.2.0 queue-consistency refinements")


if __name__ == "__main__":
    main()
