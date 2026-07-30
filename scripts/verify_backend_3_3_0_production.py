#!/usr/bin/env python3
"""Verify Backend 3.3.0 in production and run a no-write rollover dry run."""

from __future__ import annotations

import json
import os
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

PROJECT_REF = os.environ["PROJECT_REF"]
ACTION_KEY = os.environ["ARCHERS_ACTION_KEY"]
RUN_ID = os.environ["GITHUB_RUN_ID_VALUE"]
BASE_URL = f"https://{PROJECT_REF}.supabase.co/functions/v1/archers-franchise"
EVIDENCE_DIR = Path("evidence")
HEADERS = {
    "x-archers-key": ACTION_KEY,
    "Content-Type": "application/json",
}


def call(method: str, query: str = "", payload: dict[str, Any] | None = None, attempts: int = 8) -> dict[str, Any]:
    url = BASE_URL + ("?" + query if query else "")
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    last_error: Exception | None = None

    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, data=body, method=method, headers=HEADERS)
            with urllib.request.urlopen(request, timeout=45) as response:
                result = json.loads(response.read().decode("utf-8"))
                if not isinstance(result, dict):
                    raise TypeError(f"Expected JSON object from {url}")
                return result
        except Exception as exc:  # Network and HTTP errors are retried for incident resilience.
            last_error = exc
            if attempt + 1 == attempts:
                raise
            time.sleep(min(2**attempt, 15))

    raise RuntimeError("Request failed without an exception") from last_error


def write(name: str, value: Any) -> None:
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    with (EVIDENCE_DIR / name).open("w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, sort_keys=True)
        handle.write("\n")


def positive_int(value: Any) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def resolve_dry_run_season(core_state: dict[str, Any], state_fields: dict[str, Any]) -> tuple[int, str, bool]:
    fields = state_fields.get("fields") if isinstance(state_fields.get("fields"), dict) else {}
    timeline = core_state.get("timeline") if isinstance(core_state.get("timeline"), dict) else {}

    explicit_candidates = (
        (fields.get("timeline.season"), "state_fields.timeline.season"),
        (fields.get("current_season"), "state_fields.current_season"),
        (fields.get("season"), "state_fields.season"),
        (timeline.get("season"), "core_state.timeline.season"),
        (core_state.get("current_season"), "core_state.current_season"),
        (core_state.get("season"), "core_state.season"),
    )

    for value, source in explicit_candidates:
        season = positive_int(value)
        if season is not None:
            return season, source, True

    in_universe_date = fields.get("timeline.in_universe_date") or timeline.get("in_universe_date")
    match = re.match(r"^(\d{4})-\d{2}-\d{2}$", str(in_universe_date or ""))
    if not match:
        raise RuntimeError(
            "No explicit franchise season exists and timeline.in_universe_date cannot provide a dry-run discovery year"
        )

    # This fallback is permitted only because the request below is dry_run=true.
    # The SQL engine will still block execution until canon explicitly establishes a season.
    return int(match.group(1)), "timeline.in_universe_date_year_dry_run_fallback", False


def main() -> None:
    capabilities = call("GET", "scope=capabilities")
    write("capabilities.json", capabilities)
    assert capabilities.get("backend_version") == "3.3.0", capabilities
    assert "rollover_season" in capabilities.get("write_operations", []), capabilities
    assert "ATOMIC_SEASON_ROLLOVER" in capabilities.get("write_features", []), capabilities
    assert "CONTRACT_RESOURCE_FINGERPRINT" in capabilities.get("safeguards", []), capabilities

    core_before = call("GET", "scope=core_state")
    state_fields = call(
        "GET",
        "scope=state_fields&"
        + urllib.parse.urlencode(
            {
                "fields": "timeline.season,current_season,season,timeline.in_universe_date",
            }
        ),
    )
    events_before = call("GET", "scope=events&limit=1")
    write("core-state-before.json", core_before)
    write("season-state-fields.json", state_fields)
    write("events-before.json", events_before)

    state_version = int(core_before["version"])
    season, season_source, season_is_explicit = resolve_dry_run_season(core_before, state_fields)
    idempotency_key = f"backend-3.3.0-rollover-dry-run-v2-{RUN_ID}"

    dry_run_request = {
        "operation": "rollover_season",
        "resource_type": "season_rollover",
        "resource_id": "season-rollover",
        "expected_state_version": state_version,
        "idempotency_key": idempotency_key,
        "summary": "Validate Season Rollover Engine v1 without changing canon",
        "source_label": "SYSTEM",
        "dry_run": True,
        "payload": {
            "from_season": season,
            "to_season": season + 1,
            "strict": True,
        },
    }
    write("dry-run-request-redacted.json", dry_run_request)

    dry_run = call("POST", payload=dry_run_request)
    write("dry-run-response.json", dry_run)
    assert dry_run.get("dry_run") is True, dry_run
    assert dry_run.get("operation") == "rollover_season", dry_run
    assert int(dry_run.get("current_state_version")) == state_version, dry_run
    assert int(dry_run.get("proposed_state_version")) == state_version + 1, dry_run
    assert isinstance(dry_run.get("expected_resources"), list), dry_run

    core_after = call("GET", "scope=core_state")
    events_after = call("GET", "scope=events&limit=1")
    audit_check = call(
        "GET",
        "scope=operation_verification&"
        + urllib.parse.urlencode(
            {
                "idempotency_key": idempotency_key,
                "resource_type": "season_rollover",
                "resource_id": "season-rollover",
                "event_limit": 3,
            }
        ),
    )
    write("core-state-after.json", core_after)
    write("events-after.json", events_after)
    write("dry-run-operation-verification.json", audit_check)

    assert int(core_after["version"]) == state_version, (core_before, core_after)
    assert events_after == events_before, (events_before, events_after)
    assert audit_check.get("verified") is False, audit_check
    assert "No matching audit operation" in str(audit_check.get("error", "")), audit_check

    blockers = dry_run.get("blockers") if isinstance(dry_run.get("blockers"), list) else []
    blocker_codes = [
        item.get("code")
        for item in blockers
        if isinstance(item, dict) and isinstance(item.get("code"), str)
    ]

    summary = {
        "backend_version": capabilities["backend_version"],
        "state_version_before": state_version,
        "state_version_after": int(core_after["version"]),
        "from_season": season,
        "to_season": season + 1,
        "season_source": season_source,
        "season_is_explicit_in_canon": season_is_explicit,
        "ready_to_execute": dry_run.get("ready_to_execute"),
        "blocker_count": dry_run.get("blocker_count"),
        "blocker_codes": blocker_codes,
        "warning_count": dry_run.get("warning_count"),
        "processable_contracts": (dry_run.get("contract_set") or {}).get("processable_contracts"),
        "legacy_records_requiring_normalization": (dry_run.get("contract_set") or {}).get(
            "legacy_records_requiring_normalization"
        ),
        "expected_resource_count": len(dry_run.get("expected_resources", [])),
        "audit_row_created": False,
        "canon_event_created": False,
        "real_rollover_executed": False,
    }
    write("deployment-summary.json", summary)
    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
