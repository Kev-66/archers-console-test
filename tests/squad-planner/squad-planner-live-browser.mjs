import { chromium } from "playwright";
import fs from "node:fs/promises";

const baseUrl = process.env.PLANNER_BASE_URL ?? "http://127.0.0.1:4173";
const outputDirectory = process.env.PLANNER_EVIDENCE_DIR ?? "squad-planner-browser-evidence";
await fs.mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1500, height: 1050 },
  deviceScaleFactor: 1,
  colorScheme: "dark"
});
const page = await context.newPage();
const pageErrors = [];
const consoleErrors = [];
const blockedWrites = [];
const failedRequests = [];

page.on("pageerror", (error) => pageErrors.push(String(error?.stack ?? error)));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("requestfailed", (request) => {
  const failure = request.failure()?.errorText ?? "unknown failure";
  if (!failure.includes("ERR_ABORTED")) failedRequests.push(`${request.method()} ${request.url()} • ${failure}`);
});

await page.route("https://oqbylwlkrabxvpdhugrf.supabase.co/**", async (route) => {
  const method = route.request().method().toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    blockedWrites.push(`${method} ${route.request().url()}`);
    await route.abort("blockedbyclient");
    return;
  }
  await route.continue();
});

try {
  await page.goto(`${baseUrl}/index-phase3.html#squadplanner`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000
  });
  await page.waitForFunction(() => {
    const status = document.getElementById("squad-planner-status")?.textContent ?? "";
    return status.includes("Live roster connected") && status.includes("player resources loaded");
  }, null, { timeout: 60_000 });
  await page.waitForTimeout(1_000);

  const before = await page.evaluate(() => {
    const roster = document.querySelector('.tab-button[data-tab="roster"]');
    const planner = document.querySelector('.tab-button[data-tab="squadplanner"]');
    const snapshot = window.ArchersSquadPlanner?.getSnapshot();
    const cards = [...document.querySelectorAll(".squad-player-card")];
    return {
      navAfterRoster: roster?.nextElementSibling === planner,
      activeRoute: document.querySelector(".tab-button.active")?.dataset.tab ?? null,
      panelActive: document.getElementById("squadplanner")?.classList.contains("active") ?? false,
      stateVersion: snapshot?.stateVersion ?? null,
      playerResources: snapshot?.playerResources ?? null,
      activeCount: cards.filter((card) => card.textContent.includes("Active")).length,
      practiceCount: cards.filter((card) => card.textContent.includes("Practice squad")).length,
      draggableCount: cards.filter((card) => card.draggable).length,
      roomCount: document.querySelectorAll(".squad-planner-room").length,
      boundary: document.querySelector(".squad-planner-boundary")?.textContent?.replace(/\s+/g, " ").trim() ?? null
    };
  });

  if (!before.navAfterRoster || before.activeRoute !== "squadplanner" || !before.panelActive) {
    throw new Error(`Squad Planner navigation failed: ${JSON.stringify(before)}`);
  }
  if (before.playerResources !== 69 || before.activeCount !== 53 || before.practiceCount !== 16) {
    throw new Error(`Expected 69 players with 53/16 roster split: ${JSON.stringify(before)}`);
  }
  if (before.draggableCount !== 69 || before.roomCount !== 13) {
    throw new Error(`Planner room/card inventory is incomplete: ${JSON.stringify(before)}`);
  }
  if (!before.boundary?.includes("No Supabase writes") || !before.boundary.includes("No roster moves")) {
    throw new Error("Read-only, non-canon boundary copy is missing.");
  }

  await page.screenshot({
    path: `${outputDirectory}/squad-planner-desktop.png`,
    fullPage: true
  });

  const movable = page.locator(".squad-player-action[data-move='1']:not([disabled])").first();
  await movable.click();
  await page.waitForFunction(() => document.getElementById("squad-planner-status")?.textContent?.includes("Local non-canon only"), null, { timeout: 10_000 });
  const afterMove = await page.evaluate(() => ({
    stateVersion: window.ArchersSquadPlanner?.getSnapshot()?.stateVersion ?? null,
    localDraft: localStorage.getItem("archers-console-squad-planner-v1-scenario"),
    status: document.getElementById("squad-planner-status")?.textContent?.trim() ?? null
  }));
  if (afterMove.stateVersion !== before.stateVersion || !afterMove.localDraft) {
    throw new Error(`Local reorder changed or lost the live baseline: ${JSON.stringify(afterMove)}`);
  }

  await page.locator("#squad-planner-reset").click();
  const afterReset = await page.evaluate(() => ({
    stateVersion: window.ArchersSquadPlanner?.getSnapshot()?.stateVersion ?? null,
    localDraft: localStorage.getItem("archers-console-squad-planner-v1-scenario"),
    status: document.getElementById("squad-planner-status")?.textContent?.trim() ?? null
  }));
  if (afterReset.stateVersion !== before.stateVersion || afterReset.localDraft !== null || !afterReset.status?.includes("No franchise write occurred")) {
    throw new Error(`Reset did not return to the live baseline: ${JSON.stringify(afterReset)}`);
  }

  await page.setViewportSize({ width: 760, height: 1000 });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: `${outputDirectory}/squad-planner-narrow.png`,
    fullPage: true
  });

  if (blockedWrites.length) throw new Error(`Squad Planner attempted blocked Supabase writes:\n${blockedWrites.join("\n")}`);
  if (pageErrors.length) throw new Error(`Page errors:\n${pageErrors.join("\n\n")}`);
  const filteredConsoleErrors = consoleErrors.filter((message) =>
    !message.includes("favicon.ico")
    && !message.includes("Failed to load resource: the server responded with a status of 404")
  );
  if (filteredConsoleErrors.length) throw new Error(`Console errors:\n${filteredConsoleErrors.join("\n")}`);

  const summary = {
    result: "Squad Planner v1 live Chromium validation passed",
    before,
    afterMove: { ...afterMove, localDraft: Boolean(afterMove.localDraft) },
    afterReset,
    blockedWrites,
    pageErrors,
    consoleErrors,
    failedRequests
  };
  await fs.writeFile(`${outputDirectory}/squad-planner-live-summary.json`, JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
}
