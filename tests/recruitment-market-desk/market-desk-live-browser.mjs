import { chromium } from "playwright";
import fs from "node:fs/promises";

const baseUrl = process.env.MARKET_DESK_BASE_URL ?? "http://127.0.0.1:4173";
const outputDirectory = process.env.MARKET_DESK_EVIDENCE_DIR ?? "market-desk-browser-evidence";
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
  await page.goto(`${baseUrl}/index-phase3.html#marketdesk`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000
  });
  await page.waitForFunction(() => {
    const status = document.getElementById("market-desk-status")?.textContent ?? "";
    return status.includes("Live state") && status.includes("authoritative candidates");
  }, null, { timeout: 60_000 });
  await page.waitForTimeout(1_000);

  const snapshot = await page.evaluate(() => {
    const planner = document.querySelector('.tab-button[data-tab="squadplanner"]');
    const market = document.querySelector('.tab-button[data-tab="marketdesk"]');
    const frontOffice = document.querySelector('.tab-button[data-tab="frontoffice"]');
    const desk = window.ArchersMarketDesk?.getSnapshot();
    return {
      navAfterPlanner: planner?.nextElementSibling === market,
      navBeforeFrontOffice: market?.nextElementSibling === frontOffice,
      activeRoute: document.querySelector(".tab-button.active")?.dataset.tab ?? null,
      panelActive: document.getElementById("marketdesk")?.classList.contains("active") ?? false,
      stateVersion: desk?.stateVersion ?? null,
      playerResources: desk?.playerResources ?? null,
      candidates: desk?.candidates?.length ?? null,
      resourcesPresent: desk?.resourcesPresent ?? [],
      readOnly: desk?.readOnly ?? null,
      boundary: document.querySelector(".market-desk-boundary")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
      coverage: document.getElementById("market-desk-coverage")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
      emptyState: document.getElementById("market-desk-grid")?.textContent?.replace(/\s+/g, " ").trim() ?? null
    };
  });

  if (!snapshot.navAfterPlanner || !snapshot.navBeforeFrontOffice || snapshot.activeRoute !== "marketdesk" || !snapshot.panelActive) {
    throw new Error(`Market Desk navigation failed: ${JSON.stringify(snapshot)}`);
  }
  if (!Number.isInteger(snapshot.stateVersion) || snapshot.stateVersion < 38 || snapshot.playerResources !== 69) {
    throw new Error(`Expected an authoritative state at or beyond checkpoint 38 and 69 Archers players: ${JSON.stringify(snapshot)}`);
  }
  if (snapshot.readOnly !== true || !snapshot.boundary?.includes("cannot sign, offer, claim, contact a team")) {
    throw new Error("Read-only personnel boundary is missing.");
  }
  if (snapshot.resourcesPresent.length === 0) {
    if (snapshot.candidates !== 0) throw new Error(`Candidates appeared without market resources: ${JSON.stringify(snapshot)}`);
    if (!snapshot.coverage?.includes("0/3 resources") || !snapshot.coverage.includes("Not initialized")) {
      throw new Error(`Empty-safe coverage is incomplete: ${snapshot.coverage}`);
    }
    if (!snapshot.emptyState?.includes("authoritative market is not initialized")) {
      throw new Error(`Expected an explicit empty market state: ${snapshot.emptyState}`);
    }
  }

  await page.screenshot({
    path: `${outputDirectory}/market-desk-empty-production.png`,
    fullPage: true
  });
  await page.setViewportSize({ width: 760, height: 1000 });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: `${outputDirectory}/market-desk-narrow.png`,
    fullPage: true
  });

  if (blockedWrites.length) throw new Error(`Market Desk attempted blocked Supabase writes:\n${blockedWrites.join("\n")}`);
  if (pageErrors.length) throw new Error(`Page errors:\n${pageErrors.join("\n\n")}`);
  const filteredConsoleErrors = consoleErrors.filter((message) =>
    !message.includes("favicon.ico")
    && !message.includes("Failed to load resource: the server responded with a status of 404")
  );
  if (filteredConsoleErrors.length) throw new Error(`Console errors:\n${filteredConsoleErrors.join("\n")}`);

  const summary = {
    result: "Recruitment & Market Desk v1 live Chromium validation passed",
    snapshot,
    blockedWrites,
    pageErrors,
    consoleErrors,
    failedRequests
  };
  await fs.writeFile(`${outputDirectory}/market-desk-live-summary.json`, JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
}
