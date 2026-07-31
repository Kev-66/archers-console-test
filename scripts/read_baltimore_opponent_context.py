import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

PROJECT_REF = os.environ["PROJECT_REF"]
ACTION_KEY = os.environ["ARCHERS_ACTION_KEY"]
BASE = f"https://{PROJECT_REF}.supabase.co/functions/v1/archers-franchise"
HEADERS = {"x-archers-key": ACTION_KEY, "Content-Type": "application/json"}
OUT = Path("opponent-context-evidence")
OUT.mkdir(exist_ok=True)


def call(query: str):
    request = urllib.request.Request(f"{BASE}?{query}", method="GET", headers=HEADERS)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {body}") from exc


def write(name: str, value):
    with (OUT / name).open("w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, sort_keys=True, ensure_ascii=False)
        handle.write("\n")


capabilities = call("scope=capabilities")
core = call("scope=core_state")
league = call("scope=league&season=2026&week=3")

resource_types = [
    "team_identity",
    "team_roster",
    "team_staff",
    "team_depth_chart",
    "opponent_scouting",
    "league_player_index",
]
resources = {}
for resource_type in resource_types:
    resources[resource_type] = call(
        "scope=resources&" + urllib.parse.urlencode({
            "resource_type": resource_type,
            "include_archived": "true",
            "include_data": "true",
            "limit": 100,
        })
    )

write("capabilities.json", capabilities)
write("core-state.json", core)
write("league-week-3.json", league)
write("opponent-resources.json", resources)

assert capabilities.get("backend_version") == "3.4.0", capabilities
assert core.get("opponent", {}).get("name") == "Baltimore Admirals", core
assert int(core.get("version")) >= 37, core
assert "bulk_upsert_resources" in capabilities.get("write_operations", []), capabilities

team_rows = [row for row in league.get("teams", []) if row.get("team_id") == "bal"]
assert len(team_rows) == 1, team_rows

summary = {
    "backend_version": capabilities["backend_version"],
    "state_version": core["version"],
    "week": core.get("continuation", {}).get("week"),
    "opponent": core.get("opponent"),
    "baltimore_team": team_rows[0],
    "existing_resource_counts": {
        key: len(value.get("resources", []) if isinstance(value, dict) else value)
        for key, value in resources.items()
    },
    "writes_performed": False,
}
write("summary.json", summary)
print(json.dumps(summary, indent=2, sort_keys=True, ensure_ascii=False))
