const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "../..");
const html = `<!doctype html><html><body>
  <main>
    <div class="tabs-wrap"><nav class="tabs">
      <button class="tab-button" data-tab="overview">Portal</button>
      <button class="tab-button" data-tab="roster">Roster</button>
      <button class="tab-button" data-tab="squadplanner">Squad Planner</button>
      <button class="tab-button" data-tab="frontoffice">Front Office</button>
      <button class="tab-button" data-tab="schedule">Schedule</button>
    </nav></div>
    <section id="overview" class="tab-panel"></section>
    <section id="roster" class="tab-panel"></section>
    <section id="squadplanner" class="tab-panel"></section>
    <section id="marketdesk" class="tab-panel">
      <div id="market-desk-root" class="market-desk-loading"></div>
    </section>
    <section id="frontoffice" class="tab-panel"></section>
    <section id="schedule" class="tab-panel"></section>
  </main>
</body></html>`;

const dom = new JSDOM(html, {
  url: "https://example.test/index-phase3.html#marketdesk",
  runScripts: "outside-only",
  pretendToBeVisual: true
});
const { window } = dom;
window.console = console;
window.CSS = window.CSS || {};
window.CSS.escape = window.CSS.escape || ((value) => String(value));
window.scrollTo = () => {};

const writes = [];
const stateRow = {
  id: "stl-2026",
  version: 38,
  updated_at: "2026-07-31T12:00:00Z",
  state: { timeline: { season: 2026, week: 3, day: "Tuesday" } }
};
const players = [
  {
    resource_id: "archers-qb-1",
    data: {
      player_name: "Archers Quarterback",
      position_code: "QB",
      roster_status: "ACTIVE_ROSTER",
      contract: { end_season: 2028 }
    }
  },
  {
    resource_id: "archers-cb-1",
    data: {
      player_name: "Archers Corner",
      position_code: "CB",
      roster_status: "ACTIVE_ROSTER",
      contract: { end_season: 2026 }
    }
  },
  {
    resource_id: "archers-cb-2",
    data: {
      player_name: "Unknown Control Corner",
      position_code: "CB",
      roster_status: "ACTIVE_ROSTER",
      contract: {}
    }
  }
];
const marketRows = [
  {
    resource_type: "league_player_index",
    resource_id: "league-player-index",
    data: {
      as_of_week: 3,
      players: [{
        player_id: "trade-wr-1",
        team_id: "bal-2026",
        player_name: "Verified Trade Receiver",
        position: "WR",
        overall_rating: 81,
        age: 26,
        role: "STARTER"
      }]
    }
  },
  {
    resource_type: "team_market_state",
    resource_id: "team-market-state",
    data: { as_of_week: 3, teams: [] }
  },
  {
    resource_type: "trade_market",
    resource_id: "trade-market",
    data: {
      as_of_week: 3,
      review_after_week: 4,
      entries: [{
        market_id: "trade-1",
        player_id: "trade-wr-1",
        team_id: "bal-2026",
        availability: "LISTENING",
        evidence: "VERIFIED",
        asking_price: "Day 2 pick",
        movable_reason: "Explicit test-fixture market record"
      }]
    }
  },
  {
    resource_type: "free_agent_market",
    resource_id: "free-agent-market",
    data: {
      as_of_week: 3,
      entries: [{
        candidate_id: "fa-edge-1",
        player_name: "Scouted Free Agent",
        position: "EDGE",
        availability: "FREE_AGENT",
        evidence: "STAFF_SCOUTED",
        overall_rating: 75,
        role: "ROTATION",
        contract_expectation: "Unknown"
      }]
    }
  },
  {
    resource_type: "draft_prospect_index",
    resource_id: "draft-prospect-index",
    data: {
      draft_class: 2027,
      as_of_week: 3,
      prospects: [{
        prospect_id: "prospect-cb-1",
        player_name: "Public Prospect",
        position: "CB",
        school: "Test University",
        overall_grade: 88,
        projected_range: "Round 1",
        evidence: "PUBLIC_REPORT"
      }]
    }
  }
];
const scoutingRows = [{
  resource_type: "scouting_report",
  resource_id: "report-fa-edge-1",
  data: {
    report_id: "report-fa-edge-1",
    subject_type: "FREE_AGENT",
    subject_id: "fa-edge-1",
    summary: "Recorded rotation projection.",
    evidence: "STAFF_SCOUTED",
    as_of_week: 3
  }
}];
const teams = [{ team_id: "bal-2026", team_name: "Baltimore Admirals", active: true }];

function resultFor(table, conditions) {
  if (table === "archers_franchise_state") return { data: stateRow, error: null };
  if (table === "cff_teams") return { data: teams, error: null };
  if (table === "archers_resources") {
    if (conditions.some(([kind, field, value]) => kind === "eq" && field === "resource_type" && value === "player")) {
      return { data: players, error: null };
    }
    if (conditions.some(([kind, field, value]) => kind === "eq" && field === "resource_type" && value === "scouting_report")) {
      return { data: scoutingRows, error: null };
    }
    return { data: marketRows, error: null };
  }
  return { data: [], error: null };
}

function builderFor(table) {
  const conditions = [];
  const builder = {
    select() { return this; },
    eq(field, value) { conditions.push(["eq", field, value]); return this; },
    in(field, value) { conditions.push(["in", field, value]); return this; },
    order() { return this; },
    single() { return Promise.resolve(resultFor(table, conditions)); },
    insert() { writes.push("insert"); return this; },
    update() { writes.push("update"); return this; },
    delete() { writes.push("delete"); return this; },
    upsert() { writes.push("upsert"); return this; },
    rpc() { writes.push("rpc"); return this; },
    then(resolve, reject) { return Promise.resolve(resultFor(table, conditions)).then(resolve, reject); }
  };
  return builder;
}

window.supabase = {
  createClient() {
    return {
      from: builderFor,
      channel() {
        return {
          on() { return this; },
          subscribe() { return this; }
        };
      },
      removeChannel() {}
    };
  }
};

window.eval(fs.readFileSync(path.join(root, "archers-app-config.js"), "utf8"));
window.eval(fs.readFileSync(path.join(root, "phase4-recruitment-market-desk.js"), "utf8"));

setTimeout(() => {
  try {
    const document = window.document;
    const plannerButton = document.querySelector('.tab-button[data-tab="squadplanner"]');
    const marketButton = document.querySelector('.tab-button[data-tab="marketdesk"]');
    if (!marketButton || plannerButton.nextElementSibling !== marketButton) throw new Error("Market Desk nav is not directly after Squad Planner");
    if (!marketButton.classList.contains("active")) throw new Error("Market Desk hash route did not activate");

    const snapshot = window.ArchersMarketDesk.getSnapshot();
    if (snapshot.stateVersion !== 38 || snapshot.candidates.length !== 3) throw new Error(`Unexpected Market Desk snapshot: ${JSON.stringify(snapshot)}`);
    if (snapshot.resourcesPresent.length !== 5 || snapshot.readOnly !== true) throw new Error("Market resource coverage or read-only flag is wrong");
    if (!document.getElementById("market-desk-status").textContent.includes("state 38")) throw new Error("Live state status did not render");
    if (document.querySelectorAll(".market-desk-card").length !== 3) throw new Error("Expected three authoritative test candidates");
    if (!document.getElementById("market-desk-needs").textContent.includes("Cornerback")) throw new Error("Squad Planner need overlay did not render");

    document.querySelector('[data-lane="free-agent"]').click();
    if (document.querySelectorAll(".market-desk-card").length !== 1 || !document.getElementById("market-desk-grid").textContent.includes("Scouted Free Agent")) {
      throw new Error("Free-agent lane did not filter correctly");
    }

    document.querySelector("[data-watch]").click();
    if (!window.localStorage.getItem("archers-console-market-desk-v1-watchlist")) throw new Error("Browser-local watchlist was not stored");
    if (!document.getElementById("market-desk-status").textContent.includes("No franchise or market write occurred")) throw new Error("Watchlist safety notice missing");

    document.querySelector("[data-compare]").click();
    if (!document.getElementById("market-desk-compare").classList.contains("active")) throw new Error("Comparison tray did not open");
    if (!document.getElementById("market-desk-compare-grid").textContent.includes("Scouted Free Agent")) throw new Error("Selected comparison candidate is missing");

    document.querySelector('[data-lane="all"]').click();
    const search = document.getElementById("market-desk-search");
    search.value = "Trade Receiver";
    search.dispatchEvent(new window.Event("input", { bubbles: true }));
    if (document.querySelectorAll(".market-desk-card").length !== 1 || !document.getElementById("market-desk-grid").textContent.includes("Verified Trade Receiver")) {
      throw new Error("Candidate search did not filter correctly");
    }
    if (writes.length) throw new Error(`Market Desk attempted writes: ${writes.join(", ")}`);

    console.log("Recruitment & Market Desk v1 DOM smoke test passed");
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}, 160);
