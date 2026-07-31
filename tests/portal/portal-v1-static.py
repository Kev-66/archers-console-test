from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
loader = (ROOT / "index-phase3.html").read_text(encoding="utf-8")
config = (ROOT / "archers-app-config.js").read_text(encoding="utf-8")
portal = (ROOT / "phase4-archers-portal.js").read_text(encoding="utf-8")
styles = (ROOT / "phase4-archers-portal.css").read_text(encoding="utf-8")

required_loader_assets = [
    "archers-app-config.js",
    "phase4-archers-portal.js",
    "phase4-archers-portal.css",
    "phase4-squad-planner.js",
    "phase4-squad-planner.css",
    "phase3-weekly-ops.js",
    "phase3-decision-queue-active-loader.js",
    "phase3-trade-center.js",
    "phase3-transaction-ledger-v1-adapter.js",
]
for token in required_loader_assets:
    assert token in loader, token

assert loader.index("archers-app-config.js") < loader.index("phase4-archers-portal.js")
assert "STYLE_ASSETS" in loader
assert "SCRIPT_ASSETS" in loader
assert 'fetch("index-phase2.html"' in loader

for token in [
    "window.ArchersApp",
    "createSupabaseClient",
    "routeTo",
    'defaultRoute: "overview"',
    'storagePrefix: "archers-console"',
]:
    assert token in config, token

for token in [
    "Needs Your Attention",
    "Staff Briefing",
    "Upcoming Calendar",
    "Team Pulse",
    "Squad Planner Outlook",
    "Recent Activity",
    "Quick Launch",
    'data-portal-route="squadplanner"',
    "Open Squad Planner",
    "Copy Continue Franchise Prompt",
    "Evidence-based operational summaries, never invented staff dialogue.",
    "No canon write can occur from the Portal.",
    "Never invent Kevin Dorey’s dialogue",
    "archers:portal-rendered",
]:
    assert token in portal, token

for compatibility_id in [
    "continuation",
    "decisions",
    "overviewMedical",
    "kevinLock",
    "dialogueRule",
    "constitution",
    "operationsManual",
    "archivedBible",
    "checkpoint",
    "seal",
    "bow",
    "standard",
    "term",
    "cap",
    "overviewCentral",
]:
    assert f'id="{compatibility_id}"' in portal, compatibility_id

assert 'new Set(["OPEN", "READY_FOR_REVIEW", "AWAITING_KEVIN", "BLOCKED"])' in portal
assert '"DEFERRED"' not in portal.split("ACTIVE_DECISION_STATUSES", 1)[1].split(";", 1)[0]

for forbidden_write in [".insert(", ".update(", ".delete(", ".upsert(", ".rpc("]:
    assert forbidden_write not in portal, forbidden_write

for token in [
    ".portal-hero",
    ".portal-metrics",
    ".portal-priority-grid",
    ".portal-quick-grid",
    ".portal-legacy-bridge",
    "@media (max-width: 760px)",
]:
    assert token in styles, token

for secret_name in ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "service_role"]:
    assert secret_name not in config
    assert secret_name not in portal

print("Archers Portal v1 static checks passed")
