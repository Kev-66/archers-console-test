const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "../..");
const html = `<!doctype html><html><body>
  <main>
    <div class="tabs-wrap"><nav class="tabs">
      <button class="tab-button active" data-tab="overview">Portal</button>
      <button class="tab-button" data-tab="roster">Roster</button>
      <button class="tab-button" data-tab="schedule">Schedule</button>
    </nav></div>
    <section id="overview" class="tab-panel active"></section>
    <section id="roster" class="tab-panel"></section>
    <section id="squadplanner" class="tab-panel">
      <div id="squad-planner-root" class="squad-planner-loading" aria-live="polite">Loading Squad Planner…</div>
    </section>
    <section id="schedule" class="tab-panel"></section>
  </main>
</body></html>`;

const dom = new JSDOM(html, {
  url: "https://example.test/index-phase3.html#squadplanner",
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
  state: {
    timeline: { season: 2026, week: 3, day: "Tuesday" },
    opponent: { name: "Baltimore Admirals" },
    medical: [{ name: "Second Quarterback", status: "MONITOR", issue: "Knee" }]
  }
};
const playerRows = [
  {
    resource_id: "player-qb-1",
    version: 2,
    data: {
      player_name: "First Quarterback",
      position_code: "QB",
      roster_status: "ACTIVE_ROSTER",
      overall_rating: 85,
      role: "STARTER",
      contract: { end_season: 2028, rollover_status: "ACTIVE" }
    }
  },
  {
    resource_id: "player-qb-2",
    version: 2,
    data: {
      player_name: "Second Quarterback",
      position_code: "QB",
      roster_status: "ACTIVE_ROSTER",
      overall_rating: 74,
      role: "BACKUP",
      contract: { end_season: 2026, rollover_status: "FINAL_YEAR" }
    }
  },
  {
    resource_id: "player-rb-1",
    version: 1,
    data: {
      player_name: "Practice Runner",
      position_code: "RB",
      roster_status: "PRACTICE_SQUAD",
      overall_rating: 66,
      contract_summary: "Practice squad"
    }
  }
];

function resultFor(table) {
  if (table === "archers_franchise_state") return { data: stateRow, error: null };
  if (table === "archers_resources") return { data: playerRows, error: null };
  return { data: [], error: null };
}

function builderFor(table) {
  const builder = {
    select() { return this; },
    eq() { return this; },
    order() { return this; },
    single() { return Promise.resolve(resultFor(table)); },
    insert() { writes.push("insert"); return this; },
    update() { writes.push("update"); return this; },
    delete() { writes.push("delete"); return this; },
    upsert() { writes.push("upsert"); return this; },
    rpc() { writes.push("rpc"); return this; },
    then(resolve, reject) { return Promise.resolve(resultFor(table)).then(resolve, reject); }
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
window.eval(fs.readFileSync(path.join(root, "phase4-squad-planner.js"), "utf8"));

function dataTransfer() {
  const data = {};
  return {
    effectAllowed: "none",
    dropEffect: "none",
    setData(type, value) { data[type] = value; },
    getData(type) { return data[type] ?? ""; }
  };
}

setTimeout(() => {
  try {
    const document = window.document;
    const rosterButton = document.querySelector('.tab-button[data-tab="roster"]');
    const plannerButton = document.querySelector('.tab-button[data-tab="squadplanner"]');
    if (!plannerButton || rosterButton.nextElementSibling !== plannerButton) throw new Error("Squad Planner nav is not directly after Roster");
    if (!plannerButton.classList.contains("active")) throw new Error("Squad Planner hash route did not activate");
    if (!document.getElementById("squad-planner-status").textContent.includes("state 38")) throw new Error("Live state version did not render");
    if (!document.getElementById("squad-planner-metrics").textContent.includes("3")) throw new Error("Player count did not render");
    if (!document.getElementById("squad-planner-alerts").textContent.includes("medical")) throw new Error("Medical warning did not render");

    const qbCardsBefore = [...document.querySelectorAll('[data-room="qb"] .squad-player-card')];
    if (qbCardsBefore.length !== 2 || qbCardsBefore[0].dataset.resourceId !== "player-qb-1") throw new Error("QB baseline order is wrong");
    if (qbCardsBefore.some((card) => card.getAttribute("draggable") !== "true")) throw new Error("Player cards are not draggable");

    const transfer = dataTransfer();
    const dragStart = new window.Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(dragStart, "dataTransfer", { value: transfer });
    qbCardsBefore[1].dispatchEvent(dragStart);
    const drop = new window.Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: transfer });
    qbCardsBefore[0].dispatchEvent(drop);

    const qbCardsAfter = [...document.querySelectorAll('[data-room="qb"] .squad-player-card')];
    if (qbCardsAfter[0].dataset.resourceId !== "player-qb-2") throw new Error("Drag-and-drop did not reorder the QB room");
    if (!window.localStorage.getItem("archers-console-squad-planner-v1-scenario")) throw new Error("Local scenario was not saved");
    if (!document.getElementById("squad-planner-status").textContent.includes("Local non-canon only")) throw new Error("Non-canon move notice missing");

    document.getElementById("squad-planner-reset").click();
    const resetCards = [...document.querySelectorAll('[data-room="qb"] .squad-player-card')];
    if (resetCards[0].dataset.resourceId !== "player-qb-1") throw new Error("Reset did not restore the live baseline");
    if (window.localStorage.getItem("archers-console-squad-planner-v1-scenario")) throw new Error("Reset did not clear the saved local scenario");
    if (writes.length) throw new Error(`Squad Planner attempted writes: ${writes.join(", ")}`);

    console.log("Squad Planner v1 DOM smoke test passed");
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}, 120);
