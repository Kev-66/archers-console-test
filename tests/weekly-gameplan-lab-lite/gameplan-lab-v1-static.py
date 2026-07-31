from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
js = (ROOT / "phase4-weekly-gameplan-lab-lite.js").read_text(encoding="utf-8")
css = (ROOT / "phase4-weekly-gameplan-lab-lite.css").read_text(encoding="utf-8")
index = (ROOT / "index-phase3.html").read_text(encoding="utf-8")
config = (ROOT / "archers-app-config.js").read_text(encoding="utf-8")
docs = (ROOT / "WEEKLY_GAMEPLAN_LAB_LITE_V1.md").read_text(encoding="utf-8")

assert 'appVersion: "4.3.0-weekly-gameplan-lab-lite-v1"' in config
assert 'phase4-weekly-gameplan-lab-lite.css?v=20260731-1' in index
assert 'phase4-weekly-gameplan-lab-lite.js?v=20260731-1' in index
assert index.index('phase4-opponent-package.js?v=20260731-1') < index.index('phase4-weekly-gameplan-lab-lite.js?v=20260731-1')

for token in [
    "Weekly Gameplan Lab Lite",
    "Week Three readiness",
    "Matchup Plan Board",
    "Key Matchup Cards",
    "Practice Emphasis Planner",
    "Pre-game Decision Gate",
    "Authoritative fact",
    "Scouting observation",
    "Unknown / unresolved",
    "Browser-local note",
    "Damon Kirkland",
    "No authoritative plan recorded",
    "No qualifying pre-game items are recorded",
    "archers-console-weekly-gameplan-lab-lite-v1",
]:
    assert token in js or token in docs, token

for item in [
    "Pass protection",
    "Ball security",
    "Third down",
    "Red zone",
    "Two-minute offense",
    "Run fits",
    "Pressure recognition",
    "Special teams assignments",
]:
    assert item in js

for method in ("in" + "sert", "up" + "date", "up" + "sert", "de" + "lete", "r" + "pc"):
    assert not re.search(rf"\.{method}\s*\(", js), f"Forbidden backend mutation method found: {method}"

combined = "\n".join([js, css, index, config, docs]).lower()
for sensitive_fragment in ("service" + "_role", "sb_" + "secret_", "archers_" + "action_key"):
    assert sensitive_fragment not in combined

for existing in [
    "phase4-archers-portal.js",
    "phase4-opponent-package.js",
    "phase4-squad-planner.js",
    "phase4-recruitment-market-desk.js",
]:
    assert existing in index, f"Existing console asset missing: {existing}"

assert "@media (max-width: 860px)" in css
assert "@media (max-width: 560px)" in css
assert ".gameplan-plan-board" in css
assert ".gameplan-matchup-grid" in css
assert ".gameplan-practice-grid" in css

for section in ["Feature purpose", "Data sources", "Local-only behavior", "Known limitations", "Safety boundaries", "How to test", "Reset browser-local data", "Deployment verification"]:
    assert section in docs, section

print("Weekly Gameplan Lab Lite static validation passed")
