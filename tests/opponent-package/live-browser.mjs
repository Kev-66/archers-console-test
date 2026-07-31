import { chromium } from "playwright";
import fs from "node:fs/promises";

const baseUrl = process.env.OPPONENT_BASE_URL ?? "http://127.0.0.1:4173";
const outputDirectory = process.env.OPPONENT_EVIDENCE_DIR ?? "opponent-browser-evidence";
const fixture = JSON.parse(await fs.readFile("data/opponents/bal-2026-w03.json", "utf8"));
const useLive = process.env.OPPONENT_USE_LIVE === "true";
await fs.mkdir(outputDirectory, { recursive: true });

const resourceMap = new Map([
  ["team_identity/bal-2026", fixture.team_identity],
  ["team_staff/bal-2026", fixture.team_staff],
  ["team_roster/bal-2026", fixture.team_roster],
  ["team_depth_chart/bal-2026-w03", fixture.team_depth_chart],
  ["opponent_scouting/stl-bal-2026-w03", fixture.opponent_scouting]
]);

function decodeEq(url, key) {
  const value = new URL(url).searchParams.get(key);
  return value?.startsWith("eq.") ? value.slice(3) : null;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 1050 }, colorScheme: "dark" });
const page = await context.newPage();
const pageErrors = [];
const consoleErrors = [];
const blockedWrites = [];
const mockedReads = [];

page.on("pageerror", (error) => pageErrors.push(String(error?.stack ?? error)));
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

await page.route("https://oqbylwlkrabxvpdhugrf.supabase.co/**", async (route) => {
  const request = route.request();
  const method = request.method().toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    blockedWrites.push(`${method} ${request.url()}`);
    await route.abort("blockedbyclient");
    return;
  }

  if (request.url().includes("/rest/v1/archers_resources")) {
    const type = decodeEq(request.url(), "resource_type");
    const id = decodeEq(request.url(), "resource_id");
    const key = `${type}/${id}`;
    if (!useLive && resourceMap.has(key)) {
      mockedReads.push(key);
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json", "content-range": "0-0/1" },
        body: JSON.stringify({
          resource_type: type,
          resource_id: id,
          version: 1,
          data: resourceMap.get(key),
          updated_at: "2026-07-31T03:00:00Z"
        })
      });
      return;
    }
  }
  await route.continue();
});

try {
  await page.goto(`${baseUrl}/index-phase3.html#weeklyops`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => {
    const room = document.getElementById("wo-opponent-room");
    const status = document.getElementById("opponent-room-status");
    return room && status?.textContent?.includes("Live dossier connected");
  }, null, { timeout: 60_000 });
  await page.waitForTimeout(800);

  const overview = await page.evaluate(() => ({
    activeTab: document.querySelector(".tab-button.active")?.dataset.tab,
    roomHeading: document.querySelector("#wo-opponent-room h2")?.textContent?.trim(),
    status: document.getElementById("opponent-room-status")?.textContent?.trim(),
    summary: document.getElementById("opponent-room-summary")?.textContent?.trim(),
    overviewText: document.querySelector('[data-opponent-panel="overview"]')?.textContent?.replace(/\s+/g, " ").trim(),
    snapshotButton: document.querySelector("[data-open-opponent-room]")?.textContent?.trim()
  }));
  if (overview.activeTab !== "weeklyops") throw new Error(`Weekly Ops not active: ${JSON.stringify(overview)}`);
  if (overview.roomHeading !== "Opponent Command Room") throw new Error(`Room missing: ${JSON.stringify(overview)}`);
  if (!overview.overviewText?.includes("Nadia Winslow") || !overview.overviewText.includes("Caleb Rourke")) throw new Error("Team leadership did not render.");
  if (!overview.overviewText.includes("Damon Kirkland")) throw new Error("Known Kirkland availability did not render.");
  if (overview.snapshotButton !== "Open Full Baltimore Dossier") throw new Error("Snapshot deep link missing.");

  await page.screenshot({ path: `${outputDirectory}/baltimore-overview.png`, fullPage: true });

  await page.locator('[data-opponent-view="coaches"]').click();
  const coachesText = await page.locator('[data-opponent-panel="coaches"]').innerText();
  for (const expected of ["Nadia Winslow", "Caleb Rourke", "Marisol Vega", "Gideon Price", "Emmett Shaw"]) {
    if (!coachesText.includes(expected)) throw new Error(`Coach missing: ${expected}`);
  }
  await page.screenshot({ path: `${outputDirectory}/baltimore-coaches.png`, fullPage: true });

  await page.locator('[data-opponent-view="depth"]').click();
  const depthText = await page.locator('[data-opponent-panel="depth"]').innerText();
  for (const expected of ["Dorian Hale", "Malachi Boone", "Ronan Vale", "Jace Holloman"]) {
    if (!depthText.includes(expected)) throw new Error(`Depth chart player missing: ${expected}`);
  }

  await page.locator('[data-opponent-view="roster"]').click();
  const rosterText = await page.locator('[data-opponent-panel="roster"]').innerText();
  if (!rosterText.includes("53 active") || !rosterText.includes("16 practice squad")) throw new Error("Roster counts did not render.");
  await page.fill("#opponent-roster-search", "Damon Kirkland");
  const visiblePlayers = await page.locator(".opponent-player-row:not([hidden])").count();
  if (visiblePlayers !== 1) throw new Error(`Expected one Kirkland result, found ${visiblePlayers}`);
  await page.screenshot({ path: `${outputDirectory}/baltimore-roster.png`, fullPage: true });

  await page.locator('[data-opponent-view="scouting"]').click();
  const scoutingText = await page.locator('[data-opponent-panel="scouting"]').innerText();
  for (const expected of ["Executive Summary", "Practice Priorities", "Matchup Board", "Evidence Boundaries"]) {
    if (!scoutingText.includes(expected)) throw new Error(`Scouting section missing: ${expected}`);
  }
  await page.screenshot({ path: `${outputDirectory}/baltimore-scouting.png`, fullPage: true });

  await page.setViewportSize({ width: 760, height: 1000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outputDirectory}/baltimore-narrow.png`, fullPage: true });

  if (blockedWrites.length) throw new Error(`Opponent room attempted writes:\n${blockedWrites.join("\n")}`);
  if (pageErrors.length) throw new Error(`Page errors:\n${pageErrors.join("\n\n")}`);
  const filteredConsoleErrors = consoleErrors.filter((message) => !message.includes("favicon.ico") && !message.includes("404"));
  if (filteredConsoleErrors.length) throw new Error(`Console errors:\n${filteredConsoleErrors.join("\n")}`);
  const uniqueReads = [...new Set(mockedReads)];
  if (!useLive && uniqueReads.length !== resourceMap.size) throw new Error(`Expected ${resourceMap.size} mocked resources, saw ${uniqueReads.length}: ${uniqueReads}`);

  const summary = {
    result: "Baltimore opponent room browser validation passed",
    packageId: fixture.package_id,
    sourceMode: useLive ? "LIVE_PRODUCTION_RESOURCES" : "MOCKED_BRANCH_FIXTURE",
    mockedResources: uniqueReads,
    activePlayers: fixture.team_roster.active_roster.length,
    practiceSquadPlayers: fixture.team_roster.practice_squad.length,
    staffProfiles: fixture.team_staff.staff.length,
    blockedWrites,
    pageErrors,
    consoleErrors
  };
  await fs.writeFile(`${outputDirectory}/summary.json`, JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
}
