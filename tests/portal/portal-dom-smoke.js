const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "../..");
const html = `<!doctype html><html><body>
  <main>
    <header><div><h1>St. Louis Archers</h1><p>Old subtitle</p></div></header>
    <div class="tabs-wrap"><nav class="tabs">
      <button class="tab-button active" data-tab="overview">Overview</button>
      <button class="tab-button" data-tab="roster">Roster</button>
      <button class="tab-button" data-tab="weeklyops">Weekly Ops</button>
      <button class="tab-button" data-tab="frontoffice">Front Office</button>
    </nav></div>
    <section id="overview" class="tab-panel active"></section>
    <section id="roster" class="tab-panel"></section>
    <section id="weeklyops" class="tab-panel"></section>
    <section id="frontoffice" class="tab-panel"></section>
  </main>
</body></html>`;

const dom = new JSDOM(html, {
  url: "https://example.test/index-phase3.html#overview",
  runScripts: "outside-only",
  pretendToBeVisual: true
});
const { window } = dom;
window.console = console;
window.CSS = window.CSS || {};
window.CSS.escape = window.CSS.escape || ((value) => String(value));
window.scrollTo = () => {};
window.navigator.clipboard = { writeText: async () => {} };

const writes = [];
const stateRow = {
  id: "stl-2026",
  version: 37,
  updated_at: "2026-07-31T01:12:52Z",
  state: {
    season: 2026,
    current_season: 2026,
    timeline: {
      season: 2026,
      week: 3,
      day: "Tuesday",
      exact_continuation_point: "Kevin is reviewing the Week Three operations brief."
    },
    franchise: {
      record: { wins: 1, losses: 1, central_position: "2nd Federal Central", point_differential: 4 }
    },
    opponent: { name: "Omaha Pioneers", kickoff_label: "Sunday • 1:00 PM CT" },
    roster: { active_count: 53, practice_squad_count: 16, week_three_protections_status: "Pending" },
    medical: [{ name: "Jalen Knox", issue: "Contact management", plan: "Continue verified restrictions" }],
    resources: { cap: { practical_flexibility_millions: 6.25 } }
  }
};

const resources = [
  {
    resource_type: "decision_queue",
    resource_id: "decision-queue",
    version: 7,
    data: {
      decisions: [
        {
          decision_id: "portal-test-decision",
          title: "Review the Week Three plan",
          summary: "A current football operations decision requires Kevin's review.",
          status: "AWAITING_KEVIN",
          priority: "HIGH",
          category: "GAME_PLAN",
          due_week: 3,
          source_label: "Football Operations"
        },
        {
          decision_id: "deferred-test",
          title: "Deferred item",
          status: "DEFERRED",
          priority: "LOW"
        }
      ]
    }
  },
  {
    resource_type: "transaction_ledger",
    resource_id: "transaction-ledger",
    version: 2,
    data: { transactions: [{ title: "Signed a practice-squad player", status: "CONFIRMED", occurred_at: "2026-07-30T12:00:00Z" }] }
  },
  {
    resource_type: "player",
    resource_id: "player-qb-test",
    data: { player_name: "Test Quarterback", position_code: "QB", roster_status: "ACTIVE_ROSTER", contract: { end_season: 2027, rollover_status: "ACTIVE" } }
  },
  {
    resource_type: "player",
    resource_id: "player-rg-test",
    data: { player_name: "Test Guard", position_code: "RG", roster_status: "ACTIVE_ROSTER", contract: { end_season: 2026, rollover_status: "FINAL_YEAR" } }
  },
  {
    resource_type: "staff",
    resource_id: "staff-test",
    data: { name: "Test Coach", contract: { end_season: 2027, rollover_status: "ACTIVE" } }
  }
];

const tableResults = {
  archers_franchise_state: { data: stateRow, error: null },
  archers_resources: { data: resources, error: null },
  archers_canon_events: { data: [{ event_id: 39, state_version: 37, event_type: "CONTRACT_NORMALIZATION", summary: "Contracts normalized", source_label: "SYSTEM", created_at: "2026-07-30T23:45:00Z" }], error: null },
  archers_schedule: { data: [{ season: 2026, week: 3, opponent_team_id: "omaha", site: "Home", kickoff_time_ct: "1:00 PM", status: "SCHEDULED" }], error: null }
};

function builderFor(table) {
  const builder = {
    select() { return this; },
    eq() { return this; },
    in() { return this; },
    order() { return this; },
    limit() { return this; },
    single() { return Promise.resolve(tableResults[table]); },
    maybeSingle() { return Promise.resolve(tableResults[table]); },
    insert() { writes.push("insert"); return this; },
    update() { writes.push("update"); return this; },
    delete() { writes.push("delete"); return this; },
    upsert() { writes.push("upsert"); return this; },
    then(resolve, reject) { return Promise.resolve(tableResults[table]).then(resolve, reject); }
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
window.eval(fs.readFileSync(path.join(root, "phase4-archers-portal.js"), "utf8"));

setTimeout(() => {
  try {
    const document = window.document;
    if (document.querySelector('[data-tab="overview"]').textContent !== "Portal") throw new Error("Overview tab was not renamed Portal");
    if (!document.getElementById("overview").classList.contains("archers-portal")) throw new Error("Portal class missing");
    if (document.getElementById("portal-decision-count").textContent !== "1") throw new Error("Active decision count is incorrect");
    if (!document.getElementById("portal-attention-list").textContent.includes("Review the Week Three plan")) throw new Error("Active decision did not render");
    if (document.getElementById("portal-attention-list").textContent.includes("Deferred item")) throw new Error("Deferred decision incorrectly rendered");
    if (!document.getElementById("portal-outlook-list").textContent.includes("RG room")) throw new Error("Squad outlook did not render");
    if (!document.getElementById("portal-activity-list").textContent.includes("Contracts normalized")) throw new Error("Canon activity did not render");
    if (writes.length) throw new Error(`Portal attempted writes: ${writes.join(", ")}`);
    for (const compatibilityId of ["continuation", "decisions", "overviewMedical", "kevinLock", "overviewCentral"]) {
      if (!document.getElementById(compatibilityId)) throw new Error(`Compatibility anchor missing: ${compatibilityId}`);
    }
    console.log("Archers Portal DOM smoke test passed");
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}, 80);
