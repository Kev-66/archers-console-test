import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.GAMEPLAN_BASE_URL ?? "http://127.0.0.1:4173";
const outputDirectory = process.env.GAMEPLAN_EVIDENCE_DIR ?? "gameplan-lab-browser-evidence";
await fs.mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
const blockedWrites = [];

page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(String(error?.stack ?? error)));
page.on("request", (request) => {
  const method = request.method().toUpperCase();
  const url = request.url();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && /supabase\.co|archers_operations|archers_resources|archers_franchise_state/i.test(url)) {
    blockedWrites.push({ method, url });
  }
});

try {
  await page.goto(`${baseUrl}/index-phase3.html#weeklyops`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector("#wo-gameplan-lab", { timeout: 30000 });
  await page.waitForFunction(() => {
    const snapshot = window.ArchersWeeklyGameplanLab?.getSnapshot?.();
    return snapshot?.stateVersion != null && snapshot?.activeRosterCount != null;
  }, { timeout: 30000 });

  const snapshot = await page.evaluate(() => window.ArchersWeeklyGameplanLab.getSnapshot());
  if (snapshot.week !== 3) throw new Error(`Expected Week 3, received ${snapshot.week}`);
  if (!String(snapshot.opponent).includes("Baltimore")) throw new Error(`Expected Baltimore opponent, received ${snapshot.opponent}`);
  if (snapshot.activeRosterCount !== 53) throw new Error(`Expected 53 active-roster players, received ${snapshot.activeRosterCount}`);

  const readiness = await page.locator("#gameplan-readiness").innerText();
  for (const token of ["Week 3", "Baltimore", "53", "Damon Kirkland", "unresolved", `v${snapshot.stateVersion}`]) {
    if (!readiness.includes(token)) throw new Error(`Readiness strip missing ${token}`);
  }

  if (await page.locator(".gameplan-plan-card").count() !== 4) throw new Error("Matchup Plan Board did not render four sections");
  if (await page.locator("[data-matchup-card]").count() !== 4) throw new Error("Key matchup cards did not render four cards");
  for (const selector of [".gameplan-evidence.fact", ".gameplan-evidence.scouting", ".gameplan-evidence.unknown", ".gameplan-evidence.local"]) {
    if (!(await page.locator(selector).count())) throw new Error(`Evidence state missing: ${selector}`);
  }

  const storageKey = await page.evaluate(() => window.ArchersWeeklyGameplanLab.storageKey);
  if (storageKey !== "archers-console-weekly-gameplan-lab-lite-v1") throw new Error(`Unexpected storage key: ${storageKey}`);

  const passProtection = page.locator('[data-practice-item="pass-protection"]');
  await passProtection.check();
  const localNote = page.locator('[data-matchup-note="archers-ot-vs-baltimore-edge"]');
  await localNote.fill("Desktop persistence verification note.");
  await page.waitForTimeout(100);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#wo-gameplan-lab", { timeout: 30000 });
  await page.waitForFunction(() => window.ArchersWeeklyGameplanLab?.getSnapshot?.()?.stateVersion != null, { timeout: 30000 });
  if (!(await page.locator('[data-practice-item="pass-protection"]').isChecked())) throw new Error("Practice checklist did not persist across reload");
  if ((await page.locator('[data-matchup-note="archers-ot-vs-baltimore-edge"]').inputValue()) !== "Desktop persistence verification note.") {
    throw new Error("Matchup note did not persist across reload");
  }

  await page.screenshot({ path: path.join(outputDirectory, "weekly-gameplan-lab-desktop.png"), fullPage: true });

  await page.locator("#gameplan-local-reset").click();
  if (await page.locator('[data-practice-item="pass-protection"]').isChecked()) throw new Error("Local reset did not clear checklist");
  if (await page.locator('[data-matchup-note="archers-ot-vs-baltimore-edge"]').inputValue()) throw new Error("Local reset did not clear matchup note");
  const storedAfterReset = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  if (storedAfterReset !== null) throw new Error("Local reset did not remove the versioned storage document");

  for (const selector of [
    "#portal-current-position",
    "#wo-opponent-room",
    "#squad-planner-root",
    "#market-desk-root"
  ]) {
    if (!(await page.locator(selector).count())) throw new Error(`Existing console surface missing: ${selector}`);
  }

  await page.setViewportSize({ width: 720, height: 960 });
  await page.locator("#wo-gameplan-lab").scrollIntoViewIfNeeded();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  if (overflow) throw new Error("Narrow viewport introduced horizontal page overflow");
  await page.screenshot({ path: path.join(outputDirectory, "weekly-gameplan-lab-narrow.png"), fullPage: true });

  if (blockedWrites.length) throw new Error(`Backend write requests detected: ${JSON.stringify(blockedWrites)}`);
  if (pageErrors.length) throw new Error(`Page errors detected: ${pageErrors.join("\n")}`);
  if (consoleErrors.length) throw new Error(`Console errors detected: ${consoleErrors.join("\n")}`);

  const evidence = {
    url: page.url(),
    appVersion: await page.evaluate(() => window.ArchersApp?.config?.appVersion ?? null),
    stateVersion: snapshot.stateVersion,
    week: snapshot.week,
    opponent: snapshot.opponent,
    activeRosterCount: snapshot.activeRosterCount,
    missingOpponentResources: snapshot.missingOpponentResources,
    storageKey,
    blockedWrites,
    consoleErrors,
    pageErrors,
    screenshots: ["weekly-gameplan-lab-desktop.png", "weekly-gameplan-lab-narrow.png"]
  };
  await fs.writeFile(path.join(outputDirectory, "verification.json"), JSON.stringify(evidence, null, 2));
  console.log("Weekly Gameplan Lab Lite live browser validation passed");
} finally {
  await browser.close();
}
