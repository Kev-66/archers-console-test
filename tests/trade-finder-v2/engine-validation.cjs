const assert = require("node:assert/strict");
const engine = require("../../phase3-trade-finder-engine.js");

const teams = [
  { team_id: "stl-2026", team_name: "St. Louis Archers", is_archers: true },
  { team_id: "carolina", team_name: "Carolina" },
  { team_id: "baltimore", team_name: "Baltimore" }
];

const leaguePlayers = engine.normalizeLeaguePlayerCollection({
  players: [
    { player_id: "car-cb-1", team_id: "carolina", player_name: "Carolina Corner", position: "CB", overall_rating: 82, age: 28, role: "STARTER", development_trait: "STAR", cap_hit_2026_millions: 6, contract_years_remaining: 2 },
    { player_id: "bal-cb-1", team_id: "baltimore", player_name: "Baltimore Corner", position: "CB", overall_rating: 84, age: 26, role: "STARTER", development_trait: "STAR", cap_hit_2026_millions: 7, contract_years_remaining: 3 },
    { player_id: "car-cb-2", team_id: "carolina", player_name: "No Market Corner", position: "CB", overall_rating: 78, age: 25, role: "STARTER" }
  ]
});

const teamMarkets = engine.normalizeTeamMarketCollection({
  teams: [
    { team_id: "carolina", posture: "SELLER", confidence: "STAFF_SCOUTED", selling_positions: ["CB"], preferred_assets: ["PICKS", "YOUNG_PLAYERS"], as_of_week: 7, review_after_week: 8 },
    { team_id: "baltimore", posture: "CONTENDER", confidence: "VERIFIED", buying_positions: ["CB"], preferred_assets: ["IMMEDIATE_STARTERS"], as_of_week: 7, review_after_week: 8 }
  ]
});

const tradeMarket = engine.normalizeTradeMarketCollection({
  entries: [
    { market_id: "car-cb-market", player_id: "car-cb-1", team_id: "carolina", availability: "AVAILABLE", evidence: "TEAM_CONTACT", movable_reason: "Veteran contract and replacement depth", desired_assets: ["PICKS"], as_of_week: 7, review_after_week: 8 },
    { market_id: "bal-cb-market", player_id: "bal-cb-1", team_id: "baltimore", availability: "LISTENING", evidence: "PUBLIC_REPORT", as_of_week: 7, review_after_week: 8 }
  ]
}, leaguePlayers);

const archersPlayers = [
  { resource_id: "stl-wr-1", data: { player_name: "Young Receiver", position_code: "WR", overall_rating: 74, age: 23, development_trait: "STAR", role: "ROTATION", cap_hit_2026_millions: 1.2, roster_status: "ACTIVE_ROSTER" } },
  { resource_id: "stl-cb-1", data: { player_name: "Archers Corner", position_code: "CB", overall_rating: 72, age: 27, development_trait: "NORMAL", role: "ROTATION", cap_hit_2026_millions: 2.4, roster_status: "ACTIVE_ROSTER" } },
  { resource_id: "stl-cb-2", data: { player_name: "Archers Depth Corner", position_code: "CB", overall_rating: 66, age: 24, development_trait: "NORMAL", role: "DEPTH", cap_hit_2026_millions: 1.0, roster_status: "ACTIVE_ROSTER" } }
];

const archersAssets = [
  { kind: "PLAYER", identity: "player:stl-wr-1", resource_id: "stl-wr-1", ...archersPlayers[0].data, policy: "AVAILABLE" },
  { kind: "PICK", identity: "pick:2027-r2-stl", year: 2027, round: 2, original_team: "St. Louis", status: "CONFIRMED", policy: "AVAILABLE" },
  { kind: "PICK", identity: "pick:2027-r1-stl", year: 2027, round: 1, original_team: "St. Louis", status: "CONFIRMED", policy: "UNTOUCHABLE" }
];

const result = engine.findOffers({
  objective: { position: "CB", role: "STARTER", team_id: "ALL" },
  teams,
  teamMarkets,
  tradeMarket,
  leaguePlayers,
  archersAssets,
  archersPlayers,
  currentDraftYear: 2027,
  currentWeek: 7,
  practicalFlexibility: 12,
  options: { max_assets: 3, package_preference: "BALANCED", protect_first_rounders: false }
});

assert.equal(result.offers.length, 1, "only the seller's credible market should generate an offer");
assert.equal(result.offers[0].team_id, "carolina");
assert.equal(result.offers[0].tier, "CREDIBLE");
assert.equal(result.no_market_count, 1, "one matching indexed player has no active market");
assert.ok(result.offers[0].primary.assets.every((asset) => asset.identity !== "pick:2027-r1-stl"), "untouchable first rounder must never appear");

const buyerEntry = tradeMarket.find((entry) => entry.team_id === "baltimore");
const buyerState = teamMarkets.find((team) => team.team_id === "baltimore");
const eligibility = engine.marketEligibility(buyerEntry, buyerState, { position: "CB", role: "STARTER", team_id: "ALL" }, 7);
assert.equal(eligibility.eligible, false, "contending buyer at the target position should not sell a merely listening starter");

const protectedResult = engine.findOffers({
  objective: { position: "CB", role: "STARTER", team_id: "ALL" },
  teams,
  teamMarkets,
  tradeMarket: [tradeMarket[0]],
  leaguePlayers,
  archersAssets: archersAssets.map((asset) => asset.identity === "pick:2027-r1-stl" ? { ...asset, policy: "AVAILABLE" } : asset),
  archersPlayers,
  currentDraftYear: 2027,
  currentWeek: 7,
  practicalFlexibility: 12,
  options: { max_assets: 3, package_preference: "BALANCED", protect_first_rounders: true }
});
assert.ok(protectedResult.offers[0].primary.assets.every((asset) => !(asset.kind === "PICK" && asset.round === 1)), "first-round protection must exclude all firsts");

const stale = engine.marketEligibility(
  { ...tradeMarket[0], review_after_week: 6 },
  teamMarkets[0],
  { position: "CB", role: "STARTER", team_id: "ALL" },
  7
);
assert.equal(stale.eligible, false);
assert.equal(stale.tier, "STALE");

const empty = engine.findOffers({
  objective: { position: "QB", role: "PREMIUM", team_id: "ALL" },
  teams,
  teamMarkets,
  tradeMarket,
  leaguePlayers,
  archersAssets,
  archersPlayers,
  currentDraftYear: 2027,
  currentWeek: 7,
  practicalFlexibility: 12,
  options: { max_assets: 3 }
});
assert.equal(empty.offers.length, 0, "no credible offer is a valid result");

console.log("Trade Finder v2 engine validation passed");
