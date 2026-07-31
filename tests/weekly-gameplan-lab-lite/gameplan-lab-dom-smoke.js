const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(root, "phase4-weekly-gameplan-lab-lite.js"), "utf8");

function makePlayers() {
  const positions = ["QB", "RB", "WR", "WR", "TE", "LT", "RT", "EDGE", "DE", "DT", "CB", "FS", "SS", "LB"];
  return Array.from({ length: 53 }, (_, index) => ({
    resource_id: index === 0 ? "player-damon-kirkland" : `archers-player-${index + 1}`,
    data: {
      player_name: index === 0 ? "Damon Kirkland" : `Archers Player ${index + 1}`,
      position_code: positions[index % positions.length],
      roster_status: "ACTIVE_ROSTER"
    }
  }));
}

function opponentRows({ unresolved = ["Baltimore nickel alignment remains projected."], omit = [] } = {}) {
  const rows = [
    { resource_type: "team_identity", data: {
      team_name: "Baltimore Admirals",
      defensive_identity: { core_intent: "Disguise pressure and force protection communication." },
      offensive_identity: { core_intent: "Control tempo through efficient run-pass sequencing." }
    } },
    { resource_type: "team_staff", data: { staff: [] } },
    { resource_type: "team_roster", data: {
      active_roster: [
        { player_id: "bal-edge-1", player_name: "Baltimore Edge One", position: "EDGE" },
        { player_id: "bal-edge-2", player_name: "Baltimore Edge Two", position: "DE" },
        { player_id: "bal-cb-1", player_name: "Baltimore Corner One", position: "CB" },
        { player_id: "bal-s-1", player_name: "Baltimore Safety One", position: "FS" },
        { player_id: "bal-lt-1", player_name: "Baltimore Left Tackle", position: "LT" },
        { player_id: "bal-c-1", player_name: "Baltimore Center", position: "C" },
        { player_id: "bal-wr-1", player_name: "Baltimore Primary Receiver", position: "WR" }
      ],
      practice_squad: []
    } },
    { resource_type: "team_depth_chart", data: {
      week: 3,
      offense: [
        { role: "LT", players: ["bal-lt-1"] },
        { role: "C", players: ["bal-c-1"] },
        { role: "WR1", players: ["bal-wr-1"] }
      ],
      defense: [
        { role: "EDGE", players: ["bal-edge-1", "bal-edge-2"] },
        { role: "CB", players: ["bal-cb-1"] },
        { role: "FS", players: ["bal-s-1"] }
      ],
      special_teams: [{ role: "Kicker", players: [] }, { role: "Punter", players: [] }],
      unresolved
    } },
    { resource_type: "opponent_scouting", data: {
      week: 3,
      defensive_tendencies: [
        { situation: "Third down", tendency: "Baltimore disguises pressure before the snap." },
        { situation: "Red zone", tendency: "Baltimore compresses throwing windows." }
      ],
      offensive_tendencies: [
        { situation: "Early downs", tendency: "Baltimore uses balanced run-pass sequencing." },
        { situation: "Two minute", tendency: "Baltimore accelerates with boundary concepts." }
      ],
      matchup_board: [
        { matchup: "Archers tackles vs Baltimore edge", archers_path: "Protection response requires staff review." },
        { matchup: "Archers coverage vs Baltimore receivers", archers_path: "Exact coverage assignment is not recorded." }
      ],
      key_threats: [{ player_id: "bal-wr-1", reason: "Primary receiving threat stresses coverage leverage." }]
    } }
  ];
  return rows.filter((row) => !omit.includes(row.resource_type));
}

function fixture({ damonStatus = "Questionable", decisions = true, unresolved, omit } = {}) {
  return {
    stateRow: {
      id: "stl-2026",
      version: 38,
      state: {
        timeline: { season: 2026, week: 3, day: "Friday" },
        opponent: { name: "Baltimore Admirals", preparation_status: "PREPARATION" },
        medical: [{ player_name: "Damon Kirkland", issue: "Knee", status: damonStatus }]
      }
    },
    players: makePlayers(),
    decisionQueue: {
      version: 4,
      data: {
        decisions: decisions ? [{
          decision_id: "week-three-protection",
          title: "Week Three protection correction",
          summary: "Protection response remains open for staff review.",
          category: "GAME_PLAN",
          status: "OPEN",
          due_week: 3
        }] : []
      }
    },
    opponentRows: opponentRows({ unresolved, omit })
  };
}

function createDom() {
  const html = `<!doctype html><html><body>
    <main>
      <section id="weeklyops" class="tab-panel active">
        <section class="wo-two-column"><article><div id="wo-opponent"></div></article></section>
        <section id="wo-opponent-room"><div class="opponent-room-head"><div class="opponent-room-badges"></div></div></section>
      </section>
    </main>
  </body></html>`;
  const dom = new JSDOM(html, {
    url: "https://example.test/index-phase3.html#weeklyops",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.console = console;
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.CSS = window.CSS || {};
  window.CSS.escape = window.CSS.escape || ((value) => String(value));
  window.__ARCHERS_GAMEPLAN_LAB_AUTO_START__ = false;
  window.ArchersApp = {
    config: { franchiseId: "stl-2026", storagePrefix: "archers-console" },
    createSupabaseClient: () => ({}),
    routeTo: () => true
  };
  window.eval(source);
  return dom;
}

const dom = createDom();
const { window } = dom;
const { document } = window;
window.ArchersWeeklyGameplanLab.renderSnapshot(fixture());

const lab = document.getElementById("wo-gameplan-lab");
if (!lab) throw new Error("Weekly Gameplan Lab did not render");
if (document.getElementById("wo-opponent-room").nextElementSibling !== lab) throw new Error("Gameplan Lab is not integrated after Opponent Command Room");

const readiness = document.getElementById("gameplan-readiness").textContent;
for (const token of ["Week 3", "Baltimore Admirals", "53", "v38", "Damon Kirkland", "unresolved"]) {
  if (!readiness.includes(token)) throw new Error(`Readiness strip missing ${token}`);
}
if (document.querySelectorAll(".gameplan-plan-card").length !== 4) throw new Error("Expected four matchup plan sections");
if (document.querySelectorAll("[data-matchup-card]").length !== 4) throw new Error("Expected four matchup cards");
for (const selector of [".gameplan-evidence.fact", ".gameplan-evidence.scouting", ".gameplan-evidence.unknown", ".gameplan-evidence.local"]) {
  if (!document.querySelector(selector)) throw new Error(`Evidence state missing: ${selector}`);
}
if (!document.querySelector("[data-matchup-card] .gameplan-evidence-row.fact")) throw new Error("Matchup authoritative fact state missing");
if (!document.querySelector("[data-matchup-card] .gameplan-evidence-row.scouting")) throw new Error("Matchup scouting state missing");
if (!document.querySelector("[data-matchup-card] .gameplan-evidence-row.unknown")) throw new Error("Matchup unknown state missing");
if (!document.querySelector("[data-matchup-card] .gameplan-local-note")) throw new Error("Matchup local-note state missing");

const passProtection = document.querySelector('[data-practice-item="pass-protection"]');
passProtection.checked = true;
passProtection.dispatchEvent(new window.Event("change", { bubbles: true }));
const storageKey = "archers-console-weekly-gameplan-lab-lite-v1";
let saved = JSON.parse(window.localStorage.getItem(storageKey));
if (!saved.practice["pass-protection"]) throw new Error("Practice checklist did not persist locally");

const note = document.querySelector('[data-matchup-note="archers-ot-vs-baltimore-edge"]');
note.value = "Review simulated pressure looks.";
note.dispatchEvent(new window.Event("input", { bubbles: true }));
saved = JSON.parse(window.localStorage.getItem(storageKey));
if (saved.notes["archers-ot-vs-baltimore-edge"] !== "Review simulated pressure looks.") throw new Error("Matchup note did not persist locally");

const gateText = document.getElementById("gameplan-decision-gate").textContent;
for (const token of ["Damon Kirkland knee status", "Open protection decision", "Projected depth question"]) {
  if (!gateText.includes(token)) throw new Error(`Decision gate missing ${token}`);
}

document.getElementById("gameplan-local-reset").click();
if (window.localStorage.getItem(storageKey) !== null) throw new Error("Local reset did not remove storage");
if (document.querySelector('[data-practice-item="pass-protection"]').checked) throw new Error("Local reset did not clear checklist");
if (document.querySelector('[data-matchup-note="archers-ot-vs-baltimore-edge"]').value) throw new Error("Local reset did not clear notes");

window.ArchersWeeklyGameplanLab.renderSnapshot(fixture({ damonStatus: "Available", decisions: false, unresolved: [] }));
if (!document.getElementById("gameplan-decision-gate").textContent.includes("No qualifying pre-game items are recorded")) {
  throw new Error("Decision gate safe empty state did not render");
}

window.ArchersWeeklyGameplanLab.renderSnapshot(fixture({ omit: ["team_depth_chart", "opponent_scouting"] }));
const degraded = document.getElementById("gameplan-decision-gate").textContent;
if (!degraded.includes("Baltimore projected depth chart unavailable") || !degraded.includes("opponent scouting")) {
  throw new Error("Missing Baltimore resources did not produce degraded states");
}

console.log("Weekly Gameplan Lab Lite DOM smoke test passed");
