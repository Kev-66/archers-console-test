import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

PROJECT_REF = os.environ["PROJECT_REF"]
ACTION_KEY = os.environ["ARCHERS_ACTION_KEY"]
BASE = f"https://{PROJECT_REF}.supabase.co/functions/v1/archers-franchise"
HEADERS = {"x-archers-key": ACTION_KEY, "Content-Type": "application/json"}
OUT = Path("evidence")
OUT.mkdir(exist_ok=True)


def call(query: str, attempts: int = 8):
    url = BASE + "?" + query
    last_error = None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, method="GET", headers=HEADERS)
            with urllib.request.urlopen(req, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            last_error = exc
            if attempt + 1 == attempts:
                raise
            time.sleep(min(2 ** attempt, 15))
    raise last_error


def write(name: str, value):
    with (OUT / name).open("w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, sort_keys=True, ensure_ascii=False)
        handle.write("\n")


capabilities = call("scope=capabilities")
core = call("scope=core_state")
state_fields = call(
    "scope=state_fields&" + urllib.parse.urlencode({
        "fields": ",".join([
            "timeline",
            "timeline.season",
            "timeline.in_universe_date",
            "current_season",
            "season",
            "franchise",
            "culture",
            "continuation",
            "canon",
            "roster",
            "resources",
            "medical",
            "opponent",
        ])
    })
)

resources = []
offset = 0
while True:
    page = call(
        "scope=resources&" + urllib.parse.urlencode({
            "status": "ACTIVE",
            "include_data": "true",
            "limit": 100,
            "offset": offset,
        })
    )
    rows = page.get("resources") if isinstance(page, dict) else None
    if rows is None and isinstance(page, list):
        rows = page
    rows = rows or []
    resources.extend(rows)
    if len(rows) < 100:
        break
    offset += len(rows)

players = [row for row in resources if row.get("resource_type") == "player"]
staff = [row for row in resources if row.get("resource_type") == "staff"]
contract_resources = [
    row for row in resources
    if row.get("resource_type") in {"contract", "player_contract", "staff_contract"}
]

summary = {
    "backend_version": capabilities.get("backend_version"),
    "state_version": core.get("version"),
    "active_resource_count": len(resources),
    "active_player_count": len(players),
    "active_staff_count": len(staff),
    "active_standalone_contract_count": len(contract_resources),
}

write("capabilities.json", capabilities)
write("core-state.json", core)
write("organizational-state-fields.json", state_fields)
write("active-resources.json", resources)
write("active-player-resources.json", players)
write("active-staff-resources.json", staff)
write("active-contract-resources.json", contract_resources)
write("export-summary.json", summary)
print(json.dumps(summary, indent=2, sort_keys=True))
