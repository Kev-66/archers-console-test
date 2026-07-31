from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
loader = (ROOT / "index-phase3.html").read_text(encoding="utf-8")
base = (ROOT / "index-phase2.html").read_text(encoding="utf-8")
config = (ROOT / "archers-app-config.js").read_text(encoding="utf-8")
planner = (ROOT / "phase4-squad-planner.js").read_text(encoding="utf-8")
styles = (ROOT / "phase4-squad-planner.css").read_text(encoding="utf-8")
portal = (ROOT / "phase4-archers-portal.js").read_text(encoding="utf-8")

for asset in ["phase4-squad-planner.css", "phase4-squad-planner.js"]:
    assert asset in loader, asset

assert loader.index("phase3-roster-drawer.js") < loader.index("phase4-squad-planner.js")
assert 'id="squadplanner"' in base
assert 'id="squad-planner-root"' in base
assert 'appVersion: "4.1.0-squad-planner-v1"' in config

for token in [
    "Squad Planner",
    "Non-Canon Local Draft",
    "No Supabase writes. No roster moves.",
    "Reset to Live Roster",
    "Save Local Draft",
    "Position Rooms",
    "squad-planner-v1-scenario",
    "draggable=\"true\"",
    "dragstart",
    "data-move",
    "roster-player-row",
    "archers:squad-planner-rendered",
    'from("archers_franchise_state")',
    'from("archers_resources")',
]:
    assert token in planner, token

for forbidden_write in [".insert(", ".update(", ".delete(", ".upsert(", ".rpc("]:
    assert forbidden_write not in planner, forbidden_write

for token in [
    ".squad-planner-hero",
    ".squad-planner-toolbar",
    ".squad-planner-room-grid",
    ".squad-player-card",
    ".drag-over",
    "@media (max-width: 820px)",
]:
    assert token in styles, token

assert 'data-portal-route="squadplanner"' in portal
assert "Open Squad Planner" in portal
quick_launch = portal.split('class="portal-quick-grid"', 1)[1]
assert quick_launch.index('data-portal-route="roster"') < quick_launch.index('data-portal-route="squadplanner"')

for secret_name in ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "service_role"]:
    assert secret_name not in planner

print("Squad Planner v1 static checks passed")
