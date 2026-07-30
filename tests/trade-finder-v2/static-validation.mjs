import fs from "node:fs";

const engine = fs.readFileSync("phase3-trade-finder-engine.js", "utf8");
const ui = fs.readFileSync("phase3-trade-center.js", "utf8");
const css = fs.readFileSync("phase3-trade-center.css", "utf8");
const index = fs.readFileSync("index-phase3.html", "utf8");
const design = fs.readFileSync("TRADE_FINDER_V2_DESIGN.md", "utf8");
const contract = fs.readFileSync("TRADE_FINDER_V2_RESOURCE_CONTRACT.md", "utf8");

for (const token of [
  "marketEligibility",
  "FRANCHISE_CORNERSTONE",
  "UNAVAILABLE",
  "BUYER",
  "SELLER",
  "REBUILDER",
  "CONTENDER",
  "no_market_count",
  "protect_first_rounders",
  "AVAILABLE",
  "CONSIDER",
  "UNTOUCHABLE"
]) {
  if (!engine.includes(token)) throw new Error(`Engine missing ${token}`);
}

for (const token of [
  'const MARKET_RESOURCE_TYPES = ["league_player_index", "team_market_state", "trade_market"]',
  'Find Trade Offers',
  'Entire League',
  'Archers Asset Policy',
  'Missing market evidence produces no offer',
  'Send to Staff Review',
  'The website output is a read-only proposal',
  'tradeClient.from("cff_teams")',
  '.in("resource_type", MARKET_RESOURCE_TYPES)'
]) {
  if (!ui.includes(token)) throw new Error(`UI missing ${token}`);
}

for (const forbidden of [".insert(", ".update(", ".upsert(", ".delete(", "executeArchersOperation", "ARCHERS_ACTION_KEY"]) {
  if (ui.includes(forbidden)) throw new Error(`Forbidden write or secret token in UI: ${forbidden}`);
}

for (const token of [
  "phase3-trade-finder-engine.js?v=20260730-2",
  "phase3-trade-center.js?v=20260730-2",
  "phase3-trade-center.css?v=20260730-2"
]) {
  if (!index.includes(token)) throw new Error(`Loader missing ${token}`);
}

for (const token of [
  ".fo-trade-finder-hero",
  ".fo-trade-policy-control",
  ".fo-trade-offer-card",
  ".fo-trade-no-market"
]) {
  if (!css.includes(token)) throw new Error(`CSS missing ${token}`);
}

for (const token of [
  "A valid search may return no offers",
  "Searching the entire league does not make the entire league available",
  "Available, Consider, or Untouchable"
]) {
  if (!design.includes(token)) throw new Error(`Design missing ${token}`);
}

for (const token of [
  "Absence is not availability",
  "team_market_state",
  "trade_market",
  "league_player_index"
]) {
  if (!contract.includes(token)) throw new Error(`Resource contract missing ${token}`);
}

for (const path of [
  "schemas/trade-finder-v2/team-market-state-v1.schema.json",
  "schemas/trade-finder-v2/league-player-index-v1.schema.json",
  "schemas/trade-finder-v2/trade-market-v1.schema.json"
]) {
  JSON.parse(fs.readFileSync(path, "utf8"));
}

console.log(`Trade Finder v2 static validation passed; engine=${engine.length} ui=${ui.length} css=${css.length}`);
