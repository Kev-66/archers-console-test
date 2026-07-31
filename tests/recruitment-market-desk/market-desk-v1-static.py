import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
loader = (ROOT / "index-phase3.html").read_text(encoding="utf-8")
base = (ROOT / "index-phase2.html").read_text(encoding="utf-8")
config = (ROOT / "archers-app-config.js").read_text(encoding="utf-8")
desk = (ROOT / "phase4-recruitment-market-desk.js").read_text(encoding="utf-8")
styles = (ROOT / "phase4-recruitment-market-desk.css").read_text(encoding="utf-8")
portal = (ROOT / "phase4-archers-portal.js").read_text(encoding="utf-8")
contract = (ROOT / "RECRUITMENT_MARKET_DESK_V1_RESOURCE_CONTRACT.md").read_text(encoding="utf-8")

for asset in [
    "phase4-recruitment-market-desk.css",
    "phase4-recruitment-market-desk.js",
]:
    assert asset in loader, asset

assert loader.index("phase4-squad-planner.js") < loader.index("phase4-recruitment-market-desk.js")
assert loader.index("phase4-recruitment-market-desk.js") < loader.index("phase3-front-office.js")
assert 'id="marketdesk"' in base
assert 'id="market-desk-root"' in base
assert 'appVersion: "4.3.0-weekly-gameplan-lab-lite-v1"' in config
assert 'data-portal-route="marketdesk"' in portal

for token in [
    "Build the board. Verify the market.",
    "No personnel action occurs here.",
    "Squad Planner Need Overlay",
    "Free Agents",
    "Trade Targets",
    "Draft Prospects",
    "Browser-local Watchlist",
    "Candidate Comparison",
    "No candidate is inferred from an absent market record.",
    "archers:market-desk-rendered",
    "window.ArchersMarketDesk",
]:
    assert token in desk, token

for resource_type in [
    "league_player_index",
    "team_market_state",
    "trade_market",
    "free_agent_market",
    "draft_prospect_index",
    "scouting_report",
]:
    assert resource_type in desk, resource_type
    assert resource_type in contract, resource_type

for forbidden_write in [".insert(", ".update(", ".upsert(", ".rpc("]:
    assert forbidden_write not in desk, forbidden_write
assert ".from(" in desk and ".select(" in desk
assert ".from(\"archers_resources\").delete(" not in desk

for token in [
    ".market-desk-hero",
    ".market-desk-coverage",
    ".market-desk-needs",
    ".market-desk-grid",
    ".market-desk-compare",
    "@media (max-width: 760px)",
]:
    assert token in styles, token

schema_directory = ROOT / "schemas" / "recruitment-market-desk-v1"
schemas = {
    "free-agent-market-v1.schema.json": ("free-agent-market", "entries"),
    "draft-prospect-index-v1.schema.json": ("draft-prospect-index", "prospects"),
    "scouting-report-v1.schema.json": (None, "subject_id"),
}
for filename, (identity, required_field) in schemas.items():
    parsed = json.loads((schema_directory / filename).read_text(encoding="utf-8"))
    assert parsed["$schema"].endswith("2020-12/schema")
    assert parsed["type"] == "object"
    assert required_field in parsed.get("properties", {})
    if identity:
        identity_field = "market_id" if "market" in identity else "index_id"
        assert parsed["properties"][identity_field]["const"] == identity

blocked_token_hashes = {
    "1d52116e2315b2fc91cae692efa984e36cac137751d1ee9e5bba33be9097e324",
    "66accdb4fe97577d2f41c3392bcd5cd43c505354e73203a0271b98662f0bad1d",
    "1a75b9283430e98d53a31bb858237c5eec0ba8a7099f174e8fdbd09c4b21f2ba",
}
for candidate in re.findall(r"[A-Za-z0-9_]+", desk):
    assert hashlib.sha256(candidate.encode("utf-8")).hexdigest() not in blocked_token_hashes

print("Recruitment & Market Desk v1 static checks passed")
