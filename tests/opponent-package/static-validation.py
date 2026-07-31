import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = ROOT / "data/opponents/bal-2026-w03.json"
SCHEMA_PATH = ROOT / "schemas/opponent-package-v1/opponent-package-v1.schema.json"
JS_PATH = ROOT / "phase4-opponent-package.js"
CSS_PATH = ROOT / "phase4-opponent-package.css"
LOADER_PATH = ROOT / "index-phase3.html"

package = json.loads(DATA_PATH.read_text(encoding="utf-8"))
schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
js = JS_PATH.read_text(encoding="utf-8")
css = CSS_PATH.read_text(encoding="utf-8")
loader = LOADER_PATH.read_text(encoding="utf-8")

assert package["package_schema_version"] == 1
assert package["package_id"] == "bal-2026-w03"
assert package["authorized_scope"] == "FULL_OPPONENT_PACKAGE"

identity = package["team_identity"]
staff = package["team_staff"]
roster = package["team_roster"]
depth = package["team_depth_chart"]
scouting = package["opponent_scouting"]

assert identity["team_id"] == "bal"
assert identity["team_name"] == "Baltimore Admirals"
assert identity["conference"] == "Continental"
assert identity["division"] == "Atlantic"
assert identity["record"] == "2-0"
assert identity["season"] == 2026 and identity["as_of_week"] == 3
assert identity["general_manager"] == "Nadia Winslow"
assert identity["head_coach"] == "Caleb Rourke"

active = roster["active_roster"]
practice = roster["practice_squad"]
assert roster["active_count"] == len(active) == 53
assert roster["practice_squad_count"] == len(practice) == 16
assert len(staff["staff"]) == 13

players = active + practice
player_ids = [player["player_id"] for player in players]
assert len(player_ids) == len(set(player_ids)) == 69
assert all(player["team_id"] == "bal" for player in players)
assert all(player["roster_status"] == "ACTIVE_ROSTER" for player in active)
assert all(player["roster_status"] == "PRACTICE_SQUAD" for player in practice)
assert all(40 <= int(player["overall_rating"]) <= 99 for player in players)

kirkland = next(player for player in players if player["player_id"] == "bal-damon-kirkland")
assert kirkland["player_name"] == "Damon Kirkland"
assert kirkland["position"] == "RG"
assert kirkland["availability"] == "QUESTIONABLE"
assert any("unresolved" in item["issue"].lower() for item in identity["known_availability"] if item["player_id"] == kirkland["player_id"])

for unit in (depth["offense"], depth["defense"], depth["special_teams"]):
    for row in unit:
        for player_id in row.get("players", []):
            assert player_id in player_ids, (row["role"], player_id)

for threat in scouting["key_threats"]:
    assert threat["player_id"] in player_ids, threat
assert len(scouting["key_threats"]) >= 8
assert len(scouting["matchup_board"]) >= 7
assert len(scouting["practice_priorities"]) >= 7
assert any("Kirkland" in item for item in scouting["evidence_boundaries"])
assert any("contract" in item.lower() for item in scouting["evidence_boundaries"])

forbidden_contract_keys = {
    "contract",
    "contract_summary",
    "salary_by_season",
    "cap_hit_by_season",
    "guarantees",
    "options",
    "dead_money",
}


def walk(value, path="root"):
    if isinstance(value, dict):
        for key, child in value.items():
            assert key not in forbidden_contract_keys, f"forbidden opponent contract key at {path}.{key}"
            walk(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            walk(child, f"{path}[{index}]")


walk(package)

assert 'from("archers_resources")' in js
for token in ["team_identity", "team_staff", "team_roster", "team_depth_chart", "opponent_scouting"]:
    assert token in js
for forbidden in [".insert(", ".update(", ".delete(", ".upsert(", ".rpc("]:
    assert forbidden not in js, forbidden
assert "Opponent Command Room" in js
assert "Coaches" in js and "Depth Chart" in js and "Roster" in js and "Scouting" in js
assert "phase4-opponent-package.css" in loader
assert "phase4-opponent-package.js" in loader
assert ".opponent-room" in css
assert schema["properties"]["team_roster"]["properties"]["active_count"]["const"] == 53

print(json.dumps({
    "package_id": package["package_id"],
    "active_players": len(active),
    "practice_squad_players": len(practice),
    "staff_profiles": len(staff["staff"]),
    "key_threats": len(scouting["key_threats"]),
    "matchups": len(scouting["matchup_board"]),
    "practice_priorities": len(scouting["practice_priorities"]),
    "read_only_frontend": True,
}, indent=2, sort_keys=True))
