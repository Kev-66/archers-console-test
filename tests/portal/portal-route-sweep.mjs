import { chromium } from "playwright";
import fs from "node:fs/promises";

const baseUrl = process.env.PORTAL_BASE_URL ?? "http://127.0.0.1:4173";
const outputDirectory = process.env.PORTAL_EVIDENCE_DIR ?? "portal-browser-evidence";
await fs.mkdir(outputDirectory, { recursive: true });

const routes = ["weeklyops", "gameday", "roster", "squadplanner", "frontoffice", "league", "schedule", "archive"];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, colorScheme: "dark" });
const page = await context.newPage();
const errors = [];
const blockedWrites = [];

page.on("pageerror", (error) => errors.push(String(error?.stack ?? error)));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
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
  await page.goto(`${baseUrl}/index-phase3.html#overview`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => document.getElementById("portal-source-status")?.textContent?.includes("Live sources connected"), null, { timeout: 60_000 });
  await page.waitForTimeout(1_500);

  const results = [];
  for (const route of routes) {
    await page.waitForFunction((target) => Boolean(document.querySelector(`.tab-button[data-tab="${target}"]`) && document.getElementById(target)), route, { timeout: 20_000 });
    await page.locator(`[data-portal-route="${route}"]`).first().click();
    await page.waitForFunction((target) => {
      const activeButton = document.querySelector(".tab-button.active");
      const panel = document.getElementById(target);
      return activeButton?.dataset.tab === target && panel?.classList.contains("active");
    }, route, { timeout: 10_000 });

    const state = await page.evaluate((target) => {
      const panel = document.getElementById(target);
      return {
        route: target,
        activeButton: document.querySelector(".tab-button.active")?.dataset.tab ?? null,
        activePanel: panel?.classList.contains("active") ?? false,
        panelTextLength: panel?.textContent?.trim().length ?? 0,
        hash: location.hash
      };
    }, route);
    if (!state.activePanel || state.activeButton !== route || state.panelTextLength < 10) {
      throw new Error(`Route ${route} did not activate a populated operations room: ${JSON.stringify(state)}`);
    }
    results.push(state);

    await page.evaluate(() => window.ArchersApp.routeTo("overview", { behavior: "auto" }));
    await page.waitForFunction(() => document.querySelector(".tab-button.active")?.dataset.tab === "overview", null, { timeout: 10_000 });
  }

  if (blockedWrites.length) throw new Error(`Route sweep attempted Supabase writes:\n${blockedWrites.join("\n")}`);
  const filteredErrors = errors.filter((message) => !message.includes("favicon.ico"));
  if (filteredErrors.length) throw new Error(`Route sweep page errors:\n${filteredErrors.join("\n")}`);

  await fs.writeFile(
    `${outputDirectory}/portal-route-sweep.json`,
    JSON.stringify({ results, blockedWrites, errors }, null, 2),
    "utf8"
  );
  console.log(JSON.stringify({ result: "Portal route sweep passed", routes: results.map((item) => item.route), blockedWrites: 0 }, null, 2));
} finally {
  await browser.close();
}
