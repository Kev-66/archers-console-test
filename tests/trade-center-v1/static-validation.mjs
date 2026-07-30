import fs from "node:fs";

const js = fs.readFileSync("phase3-trade-center.js", "utf8");
const css = fs.readFileSync("phase3-trade-center.css", "utf8");
const index = fs.readFileSync("index-phase3.html", "utf8");
const collapsible = fs.readFileSync("phase3-collapsible-sections.js", "utf8");
const design = fs.readFileSync("TRADE_CENTER_V1_DESIGN.md", "utf8");

const requiredJs = [
  'const SCENARIO_STORAGE_KEY = "archers-trade-center-v1-scenarios"',
  'section.id = "fo-trade-center"',
  'Read-only evaluation ready',
  'Copy Staff Review Prompt',
  'Do not write or modify anything.',
  'tradeClient.from("archers_franchise_state")',
  '.eq("resource_type", "player")',
  '.eq("resource_type", DRAFT_RESOURCE_TYPE)',
  'MAX_SCENARIOS = 3'
];
for (const token of requiredJs) {
  if (!js.includes(token)) throw new Error(`Missing Trade Center JS token: ${token}`);
}

for (const forbidden of [".insert(", ".update(", ".upsert(", "executeArchersOperation", "ARCHERS_ACTION_KEY"]) {
  if (js.includes(forbidden)) throw new Error(`Forbidden write or secret token in Trade Center JS: ${forbidden}`);
}
if (/tradeClient\s*\.from\([^;]+\)\s*\.delete\s*\(/s.test(js)) throw new Error("Forbidden Supabase delete in Trade Center JS");

for (const token of ["phase3-trade-center.css", "phase3-trade-center.js"]) {
  if (!index.includes(token)) throw new Error(`Phase Three loader missing ${token}`);
}

for (const token of ["fo-trade-center", "fo-trade-collapsible-body", "archers-frontoffice-trade-center-collapsed"]) {
  if (!collapsible.includes(token)) throw new Error(`Collapsible integration missing ${token}`);
}

for (const token of [".fo-trade-center", ".fo-trade-score-grid", ".fo-trade-scenarios"]) {
  if (!css.includes(token)) throw new Error(`Trade Center CSS missing ${token}`);
}

for (const token of ["performs no Supabase writes", "not an acceptance predictor", "Phase 3.3B"]) {
  if (!design.includes(token)) throw new Error(`Design document missing ${token}`);
}

console.log(`Trade Center v1 static validation passed; js=${js.length} css=${css.length}`);
