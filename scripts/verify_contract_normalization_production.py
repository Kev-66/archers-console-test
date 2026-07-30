import json
import os
import time
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


def call(method, query="", payload=None, attempts=8):
    url = BASE + ("?" + query if query else "")
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    last_error = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, data=body, method=method, headers=HEADERS)
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            last_error = exc
            if attempt + 1 == attempts:
                raise
            time.sleep(min(2 ** attempt, 15))
    raise last_error


def write(name, value):
    with (OUT / name).open("w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, sort_keys=True, ensure_ascii=False)
        handle.write("\n")


def resource_rows(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        return payload.get("resources") or []
    return []


capabilities = call("GET", "scope=capabilities")
core_before = call("GET", "scope=core_state")
players_payload = call("GET", "scope=resources&resource_type=player&status=ACTIVE&include_data=true&limit=100")
staff_payload = call("GET", "scope=resources&resource_type=staff&status=ACTIVE&include_data=true&limit=100")
verification = call(
    "GET",
    "scope=operation_verification&" + urllib.parse.urlencode({
        "idempotency_key": "contract-normalization-v1-20260730",
        "resource_type": "contract_normalization",
        "resource_id": "contract-normalization-v1",
        "event_limit": 3,
    }),
)

players = resource_rows(players_payload)
staff = resource_rows(staff_payload)
player_by_id = {row["resource_id"]: row for row in players}
staff_by_id = {row["resource_id"]: row for row in staff}

assert capabilities.get("backend_version") == "3.3.0", capabilities
assert int(core_before["version"]) == 37, core_before
assert isinstance(core_before.get("timeline"), dict), core_before
assert int(core_before["timeline"].get("season")) == 2026, core_before
assert len(players) == 69, len(players)
assert len(staff) == 16, len(staff)
assert all(isinstance(row.get("data", {}).get("contract"), dict) for row in players), players
assert all(isinstance(row.get("data", {}).get("contract"), dict) for row in staff), staff
assert verification.get("verified") is True, verification

ethan = player_by_id["ethan-cross"]["data"]["contract"]
assert float(ethan["cap_hit_by_season"]["2027"]) == 3.8, ethan
jalen = player_by_id["jalen-knox"]["data"]["contract"]
assert "No starting-role guarantee" in jalen.get("clauses", []), jalen
gavin = player_by_id["gavin-mercer"]["data"]["contract"]
assert gavin["options"][0]["season"] == 2030, gavin
assert gavin["options"][0]["status"] == "UNRESOLVED", gavin
beni = player_by_id["beni-akande"]["data"]["contract"]
assert beni["weekly_salary_by_season"]["2026"] == 14500, beni
assert beni["end_season"] == 2026, beni
marcus = player_by_id["marcus-vale"]["data"]["contract"]
assert round(sum(float(value) for value in marcus["salary_by_season"].values()), 4) == 124.0, marcus
avery = staff_by_id["avery-holt"]["data"]["contract"]
assert avery["end_season"] == 2030, avery
assert float(avery["salary_by_season"]["2026"]) == 7.5, avery

write("capabilities.json", capabilities)
write("core-state-normalized.json", core_before)
write("player-resources-normalized.json", players)
write("staff-resources-normalized.json", staff)
write("normalization-operation-verification.json", verification)

dry_run_key = f"contract-normalization-postcheck-rollover-{RUN_ID}"
rollover_request = {
    "operation": "rollover_season",
    "resource_type": "season_rollover",
    "resource_id": "season-rollover",
    "expected_state_version": 37,
    "idempotency_key": dry_run_key,
    "summary": "Verify normalized player and staff contracts without advancing the season",
    "source_label": "SYSTEM",
    "dry_run": True,
    "payload": {
        "from_season": 2026,
        "to_season": 2027,
        "strict": True,
        "detail_limit": 200,
    },
}
rollover_preview = call("POST", payload=rollover_request)
core_after = call("GET", "scope=core_state")

assert rollover_preview.get("dry_run") is True, rollover_preview
assert rollover_preview.get("ready_to_execute") is True, rollover_preview
assert int(rollover_preview.get("blocker_count")) == 0, rollover_preview
contract_set = rollover_preview.get("contract_set") or {}
assert int(contract_set.get("processable_contracts")) == 85, rollover_preview
assert int(contract_set.get("players")) == 69, rollover_preview
assert int(contract_set.get("staff")) == 16, rollover_preview
assert int(contract_set.get("legacy_records_requiring_normalization")) == 0, rollover_preview
assert len(rollover_preview.get("expected_resources") or []) == 85, rollover_preview
effects = rollover_preview.get("effects") or {}
assert int(effects.get("expired_contracts")) == 27, rollover_preview
assert int(effects.get("final_year_contracts")) == 27, rollover_preview
assert int(core_after["version"]) == 37, (core_before, core_after)

write("rollover-dry-run-request-redacted.json", rollover_request)
write("rollover-dry-run-after-normalization.json", rollover_preview)
write("core-state-after-rollover-dry-run.json", core_after)

summary = {
    "backend_version": capabilities["backend_version"],
    "state_version": int(core_after["version"]),
    "season": int(core_after["timeline"]["season"]),
    "normalized_player_contracts": len(players),
    "established_staff_contracts": len(staff),
    "rollover_ready_to_execute": rollover_preview["ready_to_execute"],
    "rollover_blocker_count": rollover_preview["blocker_count"],
    "rollover_warning_count": rollover_preview["warning_count"],
    "rollover_processable_contracts": contract_set["processable_contracts"],
    "contracts_expiring_entering_2027": effects["expired_contracts"],
    "contracts_in_final_year_during_2027": effects["final_year_contracts"],
    "real_rollover_executed": False,
    "normalization_operation_verified": True,
}
write("contract-normalization-production-summary.json", summary)
print(json.dumps(summary, indent=2, sort_keys=True))
