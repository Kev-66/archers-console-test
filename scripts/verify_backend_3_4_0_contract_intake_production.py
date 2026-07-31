import concurrent.futures
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

PROJECT_REF = os.environ["PROJECT_REF"]
ACTION_KEY = os.environ["ARCHERS_ACTION_KEY"]
RUN_ID = os.environ["GITHUB_RUN_ID_VALUE"]
BASE = f"https://{PROJECT_REF}.supabase.co/functions/v1/archers-franchise"
HEADERS = {"x-archers-key": ACTION_KEY, "Content-Type": "application/json"}
OUT = Path("evidence")
OUT.mkdir(exist_ok=True)


def call(method: str, query: str = "", payload=None, attempts: int = 8):
    url = BASE + ("?" + query if query else "")
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    last_error = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, data=body, method=method, headers=HEADERS)
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            response_body = exc.read().decode("utf-8", errors="replace")
            last_error = RuntimeError(f"HTTP {exc.code}: {response_body}")
        except Exception as exc:
            last_error = exc
        if attempt + 1 == attempts:
            raise last_error
        time.sleep(min(2**attempt, 15))
    raise last_error


def write(name: str, value):
    with (OUT / name).open("w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, sort_keys=True, ensure_ascii=False)
        handle.write("\n")


def resource_rows(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        return payload.get("resources") or []
    return []


def blocker_codes(result):
    return {
        str(item.get("code"))
        for item in (result.get("blockers") or [])
        if isinstance(item, dict)
    }


capabilities = call("GET", "scope=capabilities")
core_before = call("GET", "scope=core_state")
events_before = call("GET", "scope=events&limit=1")
audit_before = call("GET", "scope=audit&limit=1")
players_payload = call(
    "GET",
    "scope=resources&resource_type=player&status=ACTIVE&include_data=true&limit=100",
)
staff_payload = call(
    "GET",
    "scope=resources&resource_type=staff&status=ACTIVE&include_data=true&limit=100",
)

write("capabilities.json", capabilities)
write("core-state-before.json", core_before)
write("events-before.json", events_before)
write("audit-before.json", audit_before)
write("player-resources-before.json", players_payload)
write("staff-resources-before.json", staff_payload)

assert capabilities.get("backend_version") == "3.4.0", capabilities
assert "validate_contract_intake" in capabilities.get("write_operations", []), capabilities
for token in (
    "CONTRACT_INTAKE_VALIDATION",
    "DATABASE_CONTRACT_INTAKE_GUARD",
    "CANONICAL_CONTRACT_DERIVATION",
):
    assert token in capabilities.get("write_features", []), (token, capabilities)
for token in (
    "CONTRACT_INTAKE_AT_DATABASE_BOUNDARY",
    "DEFERRED_ROLLOVER_REVALIDATION",
    "NO_LEGACY_CONTRACT_GUESSING",
):
    assert token in capabilities.get("safeguards", []), (token, capabilities)

state_version = int(core_before["version"])
timeline = core_before.get("timeline") if isinstance(core_before.get("timeline"), dict) else {}
season = timeline.get("season") or core_before.get("current_season") or core_before.get("season")
season = int(season)
assert state_version == 37, core_before
assert season == 2026, core_before

players = resource_rows(players_payload)
staff = resource_rows(staff_payload)
assert len(players) == 69, len(players)
assert len(staff) == 16, len(staff)
existing = [("player", row) for row in players] + [("staff", row) for row in staff]


def validate_existing(item):
    resource_type, row = item
    resource_id = row["resource_id"]
    request = {
        "operation": "validate_contract_intake",
        "resource_type": resource_type,
        "resource_id": resource_id,
        "expected_state_version": state_version,
        "idempotency_key": f"contract-intake-production-existing-{RUN_ID}-{resource_type}-{resource_id}",
        "summary": "Validate an existing canonical contract without changing canon",
        "source_label": "SYSTEM",
        "dry_run": True,
        "payload": {
            "season": row.get("season") or season,
            "status": row.get("status") or "ACTIVE",
            "data": row.get("data") or {},
        },
    }
    result = call("POST", payload=request)
    return {
        "resource_type": resource_type,
        "resource_id": resource_id,
        "accepted": result.get("accepted"),
        "blocker_count": result.get("blocker_count"),
        "warning_count": result.get("warning_count"),
        "contract_fingerprint": result.get("contract_fingerprint"),
        "result": result,
    }


with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
    validations = list(executor.map(validate_existing, existing))

write("existing-contract-validation-results.json", validations)
assert len(validations) == 85, len(validations)
for validation in validations:
    assert validation["accepted"] is True, validation
    assert int(validation["blocker_count"]) == 0, validation
    assert validation["contract_fingerprint"], validation

valid_id = f"__contract-intake-valid-{RUN_ID}__"
invalid_id = f"__contract-intake-invalid-{RUN_ID}__"
valid_data = {
    "player_name": "Contract Intake Validation Player",
    "team_id": "stl-2026",
    "roster_status": "ACTIVE_ROSTER",
    "contract": {
        "contract_kind": "PLAYER",
        "start_season": season,
        "end_season": season + 2,
        "contract_value_millions": 6.6,
        "salary_by_season": {
            str(season): 2.0,
            str(season + 1): 2.2,
            str(season + 2): 2.4,
        },
        "cap_hit_by_season": {
            str(season): 2.0,
            str(season + 1): 2.2,
            str(season + 2): 2.4,
        },
        "options": [],
    },
}
valid_request = {
    "operation": "validate_contract_intake",
    "resource_type": "player",
    "resource_id": valid_id,
    "expected_state_version": state_version,
    "idempotency_key": f"contract-intake-production-valid-{RUN_ID}",
    "summary": "Validate a hypothetical complete player contract without signing anyone",
    "source_label": "SYSTEM",
    "dry_run": True,
    "payload": {"season": season, "status": "ACTIVE", "data": valid_data},
}
valid_result = call("POST", payload=valid_request)
write("valid-intake-request-redacted.json", valid_request)
write("valid-intake-response.json", valid_result)
assert valid_result.get("accepted") is True, valid_result
assert int(valid_result.get("blocker_count")) == 0, valid_result
assert valid_result.get("writes_performed") is False, valid_result
assert valid_result.get("normalized_contract", {}).get("player_id") == valid_id, valid_result
assert int(valid_result.get("normalized_contract", {}).get("years_remaining")) == 3, valid_result

invalid_request = {
    "operation": "validate_contract_intake",
    "resource_type": "player",
    "resource_id": invalid_id,
    "expected_state_version": state_version,
    "idempotency_key": f"contract-intake-production-invalid-{RUN_ID}",
    "summary": "Confirm a legacy summary-only contract is rejected without writing",
    "source_label": "SYSTEM",
    "dry_run": True,
    "payload": {
        "season": season,
        "status": "ACTIVE",
        "data": {
            "player_name": "Rejected Legacy Contract",
            "team_id": "stl-2026",
            "roster_status": "ACTIVE_ROSTER",
            "contract_summary": "3 yrs/$30M",
        },
    },
}
invalid_result = call("POST", payload=invalid_request)
write("invalid-intake-request-redacted.json", invalid_request)
write("invalid-intake-response.json", invalid_result)
assert invalid_result.get("accepted") is False, invalid_result
assert int(invalid_result.get("blocker_count")) > 0, invalid_result
assert "CANONICAL_CONTRACT_REQUIRED" in blocker_codes(invalid_result), invalid_result
assert invalid_result.get("writes_performed") is False, invalid_result

upsert_preview_request = {
    "operation": "upsert_resource",
    "resource_type": "player",
    "resource_id": valid_id,
    "expected_state_version": state_version,
    "idempotency_key": f"contract-intake-production-upsert-preview-{RUN_ID}",
    "summary": "Preview a guarded player upsert without signing anyone",
    "source_label": "SYSTEM",
    "dry_run": True,
    "payload": {"season": season, "status": "ACTIVE", "data": valid_data},
}
upsert_preview = call("POST", payload=upsert_preview_request)
write("guarded-upsert-preview-request-redacted.json", upsert_preview_request)
write("guarded-upsert-preview-response.json", upsert_preview)
assert upsert_preview.get("accepted") is True, upsert_preview
assert upsert_preview.get("requested_operation") == "upsert_resource", upsert_preview
assert upsert_preview.get("writes_performed") is False, upsert_preview

rollover_key = f"contract-intake-production-rollover-dry-run-{RUN_ID}"
rollover_request = {
    "operation": "rollover_season",
    "resource_type": "season_rollover",
    "resource_id": "season-rollover",
    "expected_state_version": state_version,
    "idempotency_key": rollover_key,
    "summary": "Verify Contract Intake Guard compatibility without advancing the season",
    "source_label": "SYSTEM",
    "dry_run": True,
    "payload": {
        "from_season": season,
        "to_season": season + 1,
        "strict": True,
        "detail_limit": 200,
    },
}
rollover_preview = call("POST", payload=rollover_request)
write("rollover-dry-run-request-redacted.json", rollover_request)
write("rollover-dry-run-response.json", rollover_preview)
assert rollover_preview.get("dry_run") is True, rollover_preview
assert rollover_preview.get("ready_to_execute") is True, rollover_preview
assert int(rollover_preview.get("blocker_count")) == 0, rollover_preview
contract_set = rollover_preview.get("contract_set") or {}
assert int(contract_set.get("processable_contracts")) == 85, rollover_preview
assert int(contract_set.get("players")) == 69, rollover_preview
assert int(contract_set.get("staff")) == 16, rollover_preview
assert int(contract_set.get("legacy_records_requiring_normalization")) == 0, rollover_preview

core_after = call("GET", "scope=core_state")
events_after = call("GET", "scope=events&limit=1")
audit_after = call("GET", "scope=audit&limit=1")
valid_lookup = call(
    "GET",
    "scope=resources&" + urllib.parse.urlencode({
        "resource_type": "player",
        "resource_id": valid_id,
        "include_archived": "true",
        "include_data": "true",
        "limit": 5,
    }),
)
invalid_lookup = call(
    "GET",
    "scope=resources&" + urllib.parse.urlencode({
        "resource_type": "player",
        "resource_id": invalid_id,
        "include_archived": "true",
        "include_data": "true",
        "limit": 5,
    }),
)
rollover_verification = call(
    "GET",
    "scope=operation_verification&" + urllib.parse.urlencode({
        "idempotency_key": rollover_key,
        "resource_type": "season_rollover",
        "resource_id": "season-rollover",
        "event_limit": 3,
    }),
)

write("core-state-after.json", core_after)
write("events-after.json", events_after)
write("audit-after.json", audit_after)
write("valid-test-resource-lookup.json", valid_lookup)
write("invalid-test-resource-lookup.json", invalid_lookup)
write("rollover-dry-run-operation-verification.json", rollover_verification)

assert int(core_after["version"]) == state_version, (core_before, core_after)
assert events_after == events_before, (events_before, events_after)
assert audit_after == audit_before, (audit_before, audit_after)
assert not resource_rows(valid_lookup), valid_lookup
assert not resource_rows(invalid_lookup), invalid_lookup
assert rollover_verification.get("verified") is False, rollover_verification

summary = {
    "backend_version": capabilities["backend_version"],
    "state_version_before": state_version,
    "state_version_after": int(core_after["version"]),
    "season": season,
    "existing_player_contracts_validated": len(players),
    "existing_staff_contracts_validated": len(staff),
    "existing_contract_blockers": sum(int(item["blocker_count"]) for item in validations),
    "existing_contract_warnings": sum(int(item["warning_count"]) for item in validations),
    "valid_hypothetical_contract_accepted": True,
    "legacy_summary_contract_rejected": True,
    "guarded_upsert_preview_accepted": True,
    "rollover_ready_to_execute": rollover_preview["ready_to_execute"],
    "rollover_blocker_count": rollover_preview["blocker_count"],
    "rollover_processable_contracts": contract_set["processable_contracts"],
    "test_resources_created": False,
    "audit_row_created": False,
    "canon_event_created": False,
    "real_personnel_transaction_executed": False,
    "real_season_rollover_executed": False,
}
write("deployment-summary.json", summary)
print(json.dumps(summary, indent=2, sort_keys=True))
