import { chromium } from "playwright";
import fs from "node:fs/promises";

const baseUrl = process.env.PORTAL_BASE_URL ?? "http://127.0.0.1:4173";
const outputDirectory = process.env.PORTAL_EVIDENCE_DIR ?? "portal-browser-evidence";
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
  const request = route.request();
  const method = request.method().toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    blockedWrites.push(`${method} ${request.url()}`);
    await route.abort("blockedbyclient");
    return;
  }
  await route.continue();
});

try {
  await page.goto(`${baseUrl}/index-phase3.html#overview`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000
  });

  await page.waitForFunction(() => {
    const button = document.querySelector('.tab-button[data-tab="overview"]');
    const source = document.getElementById("portal-source-status");
    return button?.textContent?.trim() === "Portal"
      && source?.textContent?.includes("Live sources connected");
  }, null, { timeout: 60_000 });

  await page.waitForTimeout(1_500);

  const snapshot = await page.evaluate(() => ({
    title: document.title,
    overviewLabel: document.querySelector('.tab-button[data-tab="overview"]')?.textContent?.trim() ?? null,
    activeTab: document.querySelector(".tab-button.active")?.dataset.tab ?? null,
    portalActive: document.getElementById("overview")?.classList.contains("active") ?? false,
    sourceStatus: document.getElementById("portal-source-status")?.textContent?.trim() ?? null,
    decisionCount: document.getElementById("portal-decision-count")?.textContent?.trim() ?? null,
    continuation: document.getElementById("portal-current-position")?.textContent?.trim() ?? null,
    attentionText: document.getElementById("portal-attention-list")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
    briefingText: document.getElementById("portal-briefing-list")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
    calendarText: document.getElementById("portal-calendar-list")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
    pulseText: document.getElementById("portal-pulse-list")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
    outlookText: document.getElementById("portal-outlook-list")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
    activityText: document.getElementById("portal-activity-list")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
    quickRoutes: [...document.querySelectorAll("[data-portal-route]")].map((node) => node.dataset.portalRoute),
    compatibilityAnchors: [
      "continuation", "decisions", "overviewMedical", "kevinLock", "dialogueRule",
      "constitution", "operationsManual", "archivedBible", "checkpoint", "seal",
      "bow", "standard", "term", "cap", "overviewCentral"
    ].filter((id) => document.getElementById(id)).length
  }));

  if (snapshot.title !== "St. Louis Archers Franchise Console") {
    throw new Error(`Unexpected rendered title: ${snapshot.title}`);
  }
  if (snapshot.overviewLabel !== "Portal" || snapshot.activeTab !== "overview" || !snapshot.portalActive) {
    throw new Error(`Portal route did not become active: ${JSON.stringify(snapshot)}`);
  }
  if (!snapshot.sourceStatus?.includes("Live sources connected")) {
    throw new Error(`Live Portal sources did not connect: ${snapshot.sourceStatus}`);
  }
  if (!snapshot.continuation || snapshot.continuation.includes("Loading")) {
    throw new Error(`Continuation point did not render: ${snapshot.continuation}`);
  }
  if (!snapshot.attentionText || snapshot.attentionText.includes("Loading live decisions")) {
    throw new Error("Needs Your Attention did not finish rendering.");
  }
  if (!snapshot.briefingText || !snapshot.calendarText || !snapshot.pulseText || !snapshot.outlookText || !snapshot.activityText) {
    throw new Error("One or more Portal rooms did not render content.");
  }
  if (snapshot.compatibilityAnchors !== 15) {
    throw new Error(`Expected 15 compatibility anchors, found ${snapshot.compatibilityAnchors}`);
  }
  for (const route of ["weeklyops", "roster", "frontoffice", "gameday", "league", "schedule", "archive"]) {
    if (!snapshot.quickRoutes.includes(route)) throw new Error(`Quick Launch route missing: ${route}`);
  }

  await page.screenshot({
    path: `${outputDirectory}/archers-portal-desktop.png`,
    fullPage: true
  });

  await page.setViewportSize({ width: 760, height: 1000 });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: `${outputDirectory}/archers-portal-narrow.png`,
    fullPage: true
  });

  await page.setViewportSize({ width: 1500, height: 1050 });
  const rosterButton = page.locator('[data-portal-route="roster"]').first();
  await rosterButton.click();
  await page.waitForFunction(() => document.querySelector(".tab-button.active")?.dataset.tab === "roster", null, { timeout: 10_000 });
  const routedToRoster = await page.evaluate(() => document.getElementById("roster")?.classList.contains("active") ?? false);
  if (!routedToRoster) throw new Error("Quick Launch did not activate the Roster room.");

  if (blockedWrites.length) {
    throw new Error(`Portal attempted blocked Supabase writes:\n${blockedWrites.join("\n")}`);
  }
  if (pageErrors.length) {
    throw new Error(`Page errors:\n${pageErrors.join("\n\n")}`);
  }

  const filteredConsoleErrors = consoleErrors.filter((message) =>
    !message.includes("favicon.ico")
    && !message.includes("Failed to load resource: the server responded with a status of 404")
  );
  if (filteredConsoleErrors.length) {
    throw new Error(`Console errors:\n${filteredConsoleErrors.join("\n")}`);
  }

  await fs.writeFile(
    `${outputDirectory}/portal-live-summary.json`,
    JSON.stringify({
      ...snapshot,
      blockedWrites,
      pageErrors,
      consoleErrors,
      failedRequests
    }, null, 2),
    "utf8"
  );

  console.log(JSON.stringify({
    result: "Archers Portal live Chromium validation passed",
    decisionCount: snapshot.decisionCount,
    sourceStatus: snapshot.sourceStatus,
    compatibilityAnchors: snapshot.compatibilityAnchors,
    blockedWrites: blockedWrites.length,
    pageErrors: pageErrors.length
  }, null, 2));
} finally {
  await browser.close();
}
