import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

PROJECT_REF = os.environ["PROJECT_REF"]
ACTION_KEY = os.environ["ARCHERS_ACTION_KEY"]
RUN_ID = os.environ.get("GITHUB_RUN_ID_VALUE", "local")
BASE = f"https://{PROJECT_REF}.supabase.co/functions/v1/archers-franchise"
HEADERS = {"x-archers-key": ACTION_KEY, "Content-Type": "application/json"}
ROOT = Path(__file__).resolve().parents[1]
PACKAGE_PATH = ROOT / "data/opponents/bal-2026-w03.json"
OUT = Path("opponent-package-production-evidence")
OUT.mkdir(exist_ok=True)

RESOURCE_SPECS = [
    ("team_identity", "bal-2026", "team_identity"),
    ("team_staff", "bal-2026", "team_staff"),
    ("team_roster", "bal-2026", "team_roster"),
    ("team_depth_chart", "bal-2026-w03", "team_depth_chart"),
    ("opponent_scouting", "stl-bal-2026-w03", "opponent_scouting"),
]
REAL_KEY = "baltimore-opponent-package-v1-20260731"


def call(method: str, query: str = "", payload=None, attempts: int = 8):
    url = BASE + ("?" + query if query else "")
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    last_error = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, data=body, method=method, headers=HEADERS)
            with urllib.request.urlopen(request, timeout=90) as response:
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


def rows(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        return payload.get("resources") or []
    return []


def exact_resource(resource_type: str, resource_id: str):
    payload = call(
        "GET",
        "scope=resources&" + urllib.parse.urlencode({
            "resource_type": resource_type,
            "resource_id": resource_id,
            "include_archived": "true",
            "include_data": "true",
            "limit": 5,
        }),
    )
    found = rows(payload)
    assert len(found) <= 1, (resource_type, resource_id, found)
    return found[0] if found else None


package = json.loads(PACKAGE_PATH.read_text(encoding="utf-8"))
capabilities = call("GET", "scope=capabilities")
core_before = call("GET", "scope=core_state")
events_before = call("GET", "scope=events&limit=3")
audit_before = call("GET", "scope=audit&limit=3")
players_before = call("GET", "scope=resources&resource_type=player&status=ACTIVE&include_data=false&limit=100")
staff_before = call("GET", "scope=resources&resource_type=staff&status=ACTIVE&include_data=false&limit=100")

write("capabilities.json", capabilities)
write("core-state-before.json", core_before)
write("events-before.json", events_before)
write("audit-before.json", audit_before)

assert capabilities.get("backend_version") == "3.4.0", capabilities
assert "bulk_upsert_resources" in capabilities.get("write_operations", []), capabilities
assert core_before.get("opponent", {}).get("name") == "Baltimore Admirals", core_before
assert int(core_before.get("continuation", {}).get("week")) == 3, core_before
assert core_before.get("opponent", {}).get("known_note") == "Starting right guard Damon Kirkland's knee status remains unresolved. St. Louis will prepare as though he will play.", core_before

state_version = int(core_before["version"])
assert len(rows(players_before)) == 69, len(rows(players_before))
assert len(rows(staff_before)) == 16, len(rows(staff_before))

existing = {}
for resource_type, resource_id, package_key in RESOURCE_SPECS:
    existing[f"{resource_type}/{resource_id}"] = exact_resource(resource_type, resource_id)
write("target-resources-before.json", existing)

conflicts = []
already_present = []
for resource_type, resource_id, package_key in RESOURCE_SPECS:
    row = existing[f"{resource_type}/{resource_id}"]
    if row is None:
        continue
    if row.get("status") == "ACTIVE" and row.get("visibility") == "CONSOLE" and row.get("data") == package[package_key]:
        already_present.append(f"{resource_type}/{resource_id}")
    else:
        conflicts.append({
            "resource_type": resource_type,
            "resource_id": resource_id,
            "version": row.get("version"),
            "status": row.get("status"),
            "reason": "Existing resource differs from the approved package",
        })

if conflicts:
    write("conflicts.json", conflicts)
    raise RuntimeError(f"Opponent package conflicts with existing canon: {conflicts}")

all_present = len(already_present) == len(RESOURCE_SPECS)
none_present = not already_present
assert all_present or none_present, f"Partial prior package detected: {already_present}"

resources = [
    {
        "resource_type": resource_type,
        "resource_id": resource_id,
        "season": 2026,
        "data": package[package_key],
        "status": "ACTIVE",
        "visibility": "CONSOLE",
        "provenance": "LIVE_SESSION_LOG",
    }
    for resource_type, resource_id, package_key in RESOURCE_SPECS
]

current_opponent = dict(core_before.get("opponent") or {})
current_opponent.update({
    "preparation_status": "Full Week Three opponent package established; formal film review ready.",
    "package_id": "bal-2026-w03",
    "resource_refs": {
        "team_identity": "team_identity/bal-2026",
        "team_staff": "team_staff/bal-2026",
        "team_roster": "team_roster/bal-2026",
        "team_depth_chart": "team_depth_chart/bal-2026-w03",
        "opponent_scouting": "opponent_scouting/stl-bal-2026-w03",
    },
})

operation_payload = {
    "expected_state_version": state_version,
    "event_type": "opponent_scouting",
    "resources": resources,
    "state_patch": {"opponent": current_opponent},
}

if all_present:
    assert current_opponent["package_id"] == core_before.get("opponent", {}).get("package_id"), core_before
    execution = {
        "already_applied": True,
        "idempotency_key": REAL_KEY,
        "state_version": state_version,
        "resources_written": 0,
    }
    write("execution-response.json", execution)
else:
    preview_request = {
        "operation": "bulk_upsert_resources",
        "resource_type": "opponent_scouting",
        "resource_id": "stl-bal-2026-w03",
        "expected_state_version": state_version,
        "idempotency_key": f"baltimore-opponent-package-v1-preview-{RUN_ID}",
        "summary": "Preview the full Baltimore Week Three opponent package without changing canon",
        "source_label": "LIVE_SESSION_LOG",
        "dry_run": True,
        "payload": operation_payload,
    }
    preview = call("POST", payload=preview_request)
    write("preview-request.json", preview_request)
    write("preview-response.json", preview)
    assert preview.get("dry_run") is True, preview
    assert int(preview.get("current_state_version")) == state_version, preview

    execute_request = {
        "operation": "bulk_upsert_resources",
        "resource_type": "opponent_scouting",
        "resource_id": "stl-bal-2026-w03",
        "expected_state_version": state_version,
        "idempotency_key": REAL_KEY,
        "summary": "Establish the full Baltimore Week Three opponent package for formal film review",
        "source_label": "LIVE_SESSION_LOG",
        "dry_run": False,
        "payload": operation_payload,
    }
    execution = call("POST", payload=execute_request)
    write("execute-request.json", execute_request)
    write("execution-response.json", execution)
    assert int(execution.get("resources_written", 0)) == 5, execution

core_after = call("GET", "scope=core_state")
events_after = call("GET", "scope=events&limit=3")
audit_after = call("GET", "scope=audit&limit=3")
players_after = call("GET", "scope=resources&resource_type=player&status=ACTIVE&include_data=false&limit=100")
staff_after = call("GET", "scope=resources&resource_type=staff&status=ACTIVE&include_data=false&limit=100")
verification = call(
    "GET",
    "scope=operation_verification&" + urllib.parse.urlencode({
        "idempotency_key": REAL_KEY,
        "resource_type": "opponent_scouting",
        "resource_id": "stl-bal-2026-w03",
        "event_limit": 5,
    }),
)

resource_after = {}
for resource_type, resource_id, package_key in RESOURCE_SPECS:
    row = exact_resource(resource_type, resource_id)
    assert row is not None, (resource_type, resource_id)
    assert row.get("status") == "ACTIVE", row
    assert row.get("visibility") == "CONSOLE", row
    assert row.get("data") == package[package_key], f"Resource data mismatch: {resource_type}/{resource_id}"
    resource_after[f"{resource_type}/{resource_id}"] = row

write("core-state-after.json", core_after)
write("events-after.json", events_after)
write("audit-after.json", audit_after)
write("target-resources-after.json", resource_after)
write("operation-verification.json", verification)

if none_present:
    assert int(core_after["version"]) == state_version + 1, (core_before, core_after)
    assert verification.get("verified") is True, verification
    assert verification.get("idempotency", {}).get("matching_operation_rows") == 1, verification
else:
    assert int(core_after["version"]) == state_version, (core_before, core_after)

opponent_after = core_after.get("opponent") or {}
assert opponent_after.get("name") == "Baltimore Admirals", opponent_after
assert opponent_after.get("record") == "2-0", opponent_after
assert opponent_after.get("known_note") == current_opponent["known_note"], opponent_after
assert opponent_after.get("preparation_status") == "Full Week Three opponent package established; formal film review ready.", opponent_after
assert opponent_after.get("package_id") == "bal-2026-w03", opponent_after
assert len(rows(players_after)) == len(rows(players_before)) == 69
assert len(rows(staff_after)) == len(rows(staff_before)) == 16
assert core_after.get("roster") == core_before.get("roster"), (core_before.get("roster"), core_after.get("roster"))
assert core_after.get("medical") == core_before.get("medical"), (core_before.get("medical"), core_after.get("medical"))

summary = {
    "backend_version": capabilities["backend_version"],
    "state_version_before": state_version,
    "state_version_after": int(core_after["version"]),
    "already_applied": all_present,
    "resources_verified": len(resource_after),
    "active_roster_profiles": len(package["team_roster"]["active_roster"]),
    "practice_squad_profiles": len(package["team_roster"]["practice_squad"]),
    "staff_profiles": len(package["team_staff"]["staff"]),
    "archers_player_resource_count_unchanged": len(rows(players_after)),
    "archers_staff_resource_count_unchanged": len(rows(staff_after)),
    "archers_roster_state_unchanged": True,
    "archers_medical_state_unchanged": True,
    "real_archers_personnel_transaction_executed": False,
    "season_rollover_executed": False,
    "operation_verified": verification.get("verified") if none_present else True,
    "idempotency_key": REAL_KEY,
}
write("production-summary.json", summary)
print(json.dumps(summary, indent=2, sort_keys=True))
