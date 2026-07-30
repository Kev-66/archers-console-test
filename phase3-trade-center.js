(() => {
  "use strict";

  const SUPABASE_URL = "https://oqbylwlkrabxvpdhugrf.supabase.co";
  const SUPABASE_KEY = "sb_publishable_z-EjW-S0x7GZH2VREEaXAw_NOOrbH-m";
  const FRANCHISE_ID = "stl-2026";
  const CURRENT_SEASON = 2026;
  const DRAFT_RESOURCE_TYPE = "draft_capital";
  const DRAFT_RESOURCE_ID = "draft-capital";
  const MARKET_RESOURCE_TYPES = ["league_player_index", "team_market_state", "trade_market"];
  const MARKET_RESOURCE_IDS = {
    league_player_index: "league-player-index",
    team_market_state: "team-market-state",
    trade_market: "trade-market"
  };
  const POLICY_STORAGE_KEY = "archers-trade-finder-v2-asset-policy";
  const PINNED_STORAGE_KEY = "archers-trade-finder-v2-pinned-offers";
  const MAX_PINNED = 3;

  const engine = globalThis.ArchersTradeFinderEngine;
  if (!engine) {
    console.error("Trade Finder engine is unavailable.");
    return;
  }

  const tradeClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const POSITIONS = ["QB", "RB", "WR", "TE", "OT", "IOL", "EDGE", "DT", "LB", "CB", "S", "K", "P"];
  const ROLE_LABELS = { DEPTH: "Depth", ROTATION: "Rotation", STARTER: "Starter", PREMIUM: "Premium" };
  const POSTURE_LABELS = {
    BUYER: "Buyer",
    SELLER: "Seller",
    HOLD: "Holding",
    HYBRID: "Hybrid",
    REBUILDER: "Rebuilder",
    CONTENDER: "Contender"
  };
  const POLICY_LABELS = { AVAILABLE: "Available", CONSIDER: "Consider", UNTOUCHABLE: "Untouchable" };

  const state = {
    franchise: null,
    players: [],
    picks: [],
    teams: [],
    currentDraftYear: 2027,
    currentWeek: null,
    marketResources: {},
    teamMarkets: [],
    leaguePlayers: [],
    tradeMarket: [],
    assetPolicies: loadJson(POLICY_STORAGE_KEY, {}),
    pinned: loadJson(PINNED_STORAGE_KEY, []).slice(0, MAX_PINNED),
    playerSearch: "",
    lastSearch: null,
    activeStrategyByOffer: new Map()
  };

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  function loadJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? "");
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Browser-only preferences may remain session-local when storage is unavailable.
    }
  }

  function numberOrNull(value) {
    return engine.numberOrNull(value);
  }

  function normalizeKey(value) {
    return engine.normalizeKey(value);
  }

  function formatMillions(value) {
    const parsed = numberOrNull(value);
    return parsed === null ? "—" : `$${parsed.toFixed(parsed % 1 === 0 ? 1 : 2)}M`;
  }

  function fieldValue(id) {
    return document.getElementById(id)?.value ?? "";
  }

  function fieldChecked(id) {
    return document.getElementById(id)?.checked === true;
  }

  function currentObjective() {
    return {
      position: fieldValue("fo-trade-finder-position"),
      role: fieldValue("fo-trade-finder-role") || "STARTER",
      team_id: fieldValue("fo-trade-finder-team") || "ALL"
    };
  }

  function currentOptions() {
    return {
      package_preference: fieldValue("fo-trade-finder-package-preference") || "BALANCED",
      max_assets: numberOrNull(fieldValue("fo-trade-finder-max-assets")) ?? 3,
      protect_first_rounders: fieldChecked("fo-trade-finder-protect-firsts")
    };
  }

  function assetPolicy(identity) {
    const policy = normalizeKey(state.assetPolicies[identity] ?? "CONSIDER");
    return ["AVAILABLE", "CONSIDER", "UNTOUCHABLE"].includes(policy) ? policy : "CONSIDER";
  }

  function setAssetPolicy(identity, policy) {
    state.assetPolicies[identity] = policy;
    saveJson(POLICY_STORAGE_KEY, state.assetPolicies);
  }

  function normalizePick(raw, year, index) {
    const round = numberOrNull(raw?.round ?? raw?.draft_round ?? raw?.pick_round ?? raw?.round_number);
    const pickYear = numberOrNull(raw?.year ?? raw?.draft_year ?? raw?.pick_year ?? year);
    if (round === null || pickYear === null) return null;
    const originalTeam = raw?.original_team ?? raw?.origin_team ?? raw?.from_team ?? raw?.source_team ?? raw?.team ?? null;
    const status = normalizeKey(raw?.status ?? raw?.asset_status ?? raw?.pick_status ?? "CONFIRMED");
    const identity = String(raw?.pick_id ?? raw?.asset_id ?? raw?.selection_id ?? raw?.id ?? `${pickYear}-${round}-${originalTeam ?? "unknown"}-${index}`);
    return {
      kind: "PICK",
      identity: `pick:${identity}`,
      asset_id: identity,
      year: pickYear,
      round,
      original_team: originalTeam,
      status,
      asset_type: normalizeKey(raw?.asset_type ?? raw?.pick_type ?? (raw?.native ? "NATIVE" : "ACQUIRED")),
      upgrade_round: numberOrNull(raw?.upgrade_round ?? raw?.upgrade_to_round),
      note: raw?.note ?? raw?.summary ?? "",
      condition: raw?.condition ?? raw?.condition_text ?? "",
      policy: assetPolicy(`pick:${identity}`)
    };
  }

  function extractPicks(data) {
    const years = Array.isArray(data?.years) ? data.years : Array.isArray(data?.draft_years) ? data.draft_years : [];
    const picks = [];
    if (years.length) {
      years.forEach((entry) => {
        (Array.isArray(entry?.picks) ? entry.picks : []).forEach((pick, index) => {
          const normalized = normalizePick(pick, entry?.year, index);
          if (normalized) picks.push(normalized);
        });
      });
      return picks;
    }

    const visited = new Set();
    function walk(node, path = "root", depth = 0) {
      if (depth > 8 || node == null || typeof node !== "object" || visited.has(node)) return;
      visited.add(node);
      if (Array.isArray(node)) {
        const yearMatch = path.match(/20\d{2}/);
        node.forEach((item, index) => {
          const normalized = normalizePick(item, yearMatch ? Number(yearMatch[0]) : data?.current_draft_year, index);
          if (normalized) picks.push(normalized);
          walk(item, `${path}[${index}]`, depth + 1);
        });
        return;
      }
      Object.entries(node).forEach(([key, value]) => walk(value, `${path}.${key}`, depth + 1));
    }
    walk(data);
    const unique = new Map();
    picks.forEach((pick) => unique.set(pick.identity, pick));
    return [...unique.values()];
  }

  function archersAssets() {
    const playerAssets = state.players.map((row) => {
      const data = row.data ?? {};
      const identity = `player:${row.resource_id}`;
      return {
        kind: "PLAYER",
        identity,
        resource_id: row.resource_id,
        ...data,
        policy: assetPolicy(identity)
      };
    });
    return [...playerAssets, ...state.picks.map((pick) => ({ ...pick, policy: assetPolicy(pick.identity) }))];
  }

  function teamName(teamId) {
    const team = state.teams.find((item) => String(item.team_id) === String(teamId));
    return team?.team_name ?? team?.name ?? teamId;
  }

  function statusClass(kind) {
    const key = normalizeKey(kind);
    if (["GOOD", "CREDIBLE", "WORKS", "VERIFIED", "ACTIVELY_SHOPPED", "AVAILABLE"].includes(key)) return "good";
    if (["BAD", "NO_MARKET", "DOES_NOT_WORK", "UNAVAILABLE", "FRANCHISE_CORNERSTONE"].includes(key)) return "bad";
    return "warn";
  }

  function policyCounts() {
    const assets = archersAssets();
    return ["AVAILABLE", "CONSIDER", "UNTOUCHABLE"].reduce((result, policy) => {
      result[policy] = assets.filter((asset) => asset.policy === policy).length;
      return result;
    }, {});
  }

  function renderMarketMetrics() {
    const target = document.getElementById("fo-trade-market-metrics");
    if (!target) return;
    const sellers = state.teamMarkets.filter((team) => ["SELLER", "REBUILDER"].includes(team.posture)).length;
    const buyers = state.teamMarkets.filter((team) => ["BUYER", "CONTENDER"].includes(team.posture)).length;
    const stale = state.tradeMarket.filter((entry) => engine.isStale(entry, state.currentWeek)).length;
    target.innerHTML = `
      <div class="fo-trade-market-metric"><span>Active Market Entries</span><strong>${escapeHtml(state.tradeMarket.length - stale)}</strong><small>Current player-specific markets</small></div>
      <div class="fo-trade-market-metric"><span>Sellers / Rebuilders</span><strong>${escapeHtml(sellers)}</strong><small>Teams leaning toward future value</small></div>
      <div class="fo-trade-market-metric"><span>Buyers / Contenders</span><strong>${escapeHtml(buyers)}</strong><small>Teams leaning toward immediate help</small></div>
      <div class="fo-trade-market-metric"><span>Stale Entries Ignored</span><strong>${escapeHtml(stale)}</strong><small>Past their review window</small></div>`;
  }

  function renderTeamOptions() {
    const select = document.getElementById("fo-trade-finder-team");
    const manual = document.getElementById("fo-trade-manual-team");
    if (!select || !manual) return;
    const current = select.value || "ALL";
    const manualCurrent = manual.value || "";
    const options = state.teams
      .filter((team) => String(team.team_id) !== FRANCHISE_ID && !team.is_archers)
      .sort((a, b) => String(a.team_name ?? "").localeCompare(String(b.team_name ?? "")))
      .map((team) => `<option value="${escapeHtml(team.team_id)}">${escapeHtml(team.team_name ?? team.team_id)}</option>`)
      .join("");
    select.innerHTML = `<option value="ALL">Entire League</option>${options}`;
    manual.innerHTML = `<option value="">Select team</option>${options}`;
    if ([...select.options].some((option) => option.value === current)) select.value = current;
    if ([...manual.options].some((option) => option.value === manualCurrent)) manual.value = manualCurrent;
  }

  function policyButton(identity, policy, active) {
    return `<button type="button" class="fo-trade-policy-button ${active ? "active" : ""} ${policy.toLowerCase()}" data-trade-policy-id="${escapeHtml(identity)}" data-trade-policy="${policy}">${escapeHtml(POLICY_LABELS[policy])}</button>`;
  }

  function renderPlayers() {
    const target = document.getElementById("fo-trade-player-assets");
    const summary = document.getElementById("fo-trade-player-summary");
    if (!target || !summary) return;
    const query = state.playerSearch.trim().toLowerCase();
    const rows = [...state.players]
      .sort((a, b) =>
        (a.data?.roster_status === "ACTIVE_ROSTER" ? 0 : 1) - (b.data?.roster_status === "ACTIVE_ROSTER" ? 0 : 1)
        || (numberOrNull(b.data?.overall_rating) ?? 0) - (numberOrNull(a.data?.overall_rating) ?? 0)
        || String(a.data?.player_name ?? a.resource_id).localeCompare(String(b.data?.player_name ?? b.resource_id))
      )
      .filter((row) => !query || `${row.data?.player_name ?? ""} ${row.data?.position_code ?? ""} ${row.data?.role ?? ""}`.toLowerCase().includes(query));

    const counts = policyCounts();
    summary.textContent = `${counts.AVAILABLE} available • ${counts.CONSIDER} consider • ${counts.UNTOUCHABLE} untouchable`;

    target.innerHTML = rows.map((row) => {
      const data = row.data ?? {};
      const identity = `player:${row.resource_id}`;
      const policy = assetPolicy(identity);
      return `<article class="fo-trade-asset-row policy-${policy.toLowerCase()}">
        <div class="fo-trade-asset-main">
          <strong>${escapeHtml(data.player_name ?? row.resource_id)}</strong>
          <small>${escapeHtml(data.position_code ?? data.position ?? "—")} • ${escapeHtml(data.role ?? "Role unavailable")} • ${escapeHtml(data.overall_rating ?? "—")} OVR • ${escapeHtml(formatMillions(data.cap_hit_2026_millions))}</small>
        </div>
        <div class="fo-trade-policy-control" role="group" aria-label="Trade policy for ${escapeHtml(data.player_name ?? row.resource_id)}">
          ${["AVAILABLE", "CONSIDER", "UNTOUCHABLE"].map((option) => policyButton(identity, option, option === policy)).join("")}
        </div>
        <button type="button" class="fo-trade-profile roster-player-row" data-resource-id="${escapeHtml(row.resource_id)}">Profile</button>
      </article>`;
    }).join("") || '<div class="empty">No verified players match this search.</div>';

    bindPolicyButtons(target);
  }

  function pickLabel(pick) {
    const origin = pick.original_team ? ` from ${pick.original_team}` : "";
    return `${pick.year} Round ${pick.round}${origin}`;
  }

  function renderPicks() {
    const target = document.getElementById("fo-trade-pick-assets");
    const summary = document.getElementById("fo-trade-pick-summary");
    if (!target || !summary) return;
    const counts = state.picks.reduce((result, pick) => {
      result[assetPolicy(pick.identity)] += 1;
      return result;
    }, { AVAILABLE: 0, CONSIDER: 0, UNTOUCHABLE: 0 });
    summary.textContent = `${counts.AVAILABLE} available • ${counts.CONSIDER} consider • ${counts.UNTOUCHABLE} untouchable`;

    target.innerHTML = state.picks.map((pick) => {
      const policy = assetPolicy(pick.identity);
      const conditional = ["PROVISIONAL", "CONDITIONAL"].includes(normalizeKey(pick.status));
      return `<article class="fo-trade-asset-row fo-trade-pick-row policy-${policy.toLowerCase()}">
        <div class="fo-trade-pick-round"><strong>R${escapeHtml(pick.round)}</strong><small>${escapeHtml(pick.year)}</small></div>
        <div class="fo-trade-asset-main">
          <strong>${escapeHtml(pick.original_team ?? "Origin unavailable")}</strong>
          <small>${escapeHtml(pick.asset_type)}${pick.upgrade_round ? ` • can become R${escapeHtml(pick.upgrade_round)}` : ""}</small>
        </div>
        <span class="pill ${conditional ? "warn" : "good"}">${escapeHtml(normalizeKey(pick.status).replaceAll("_", " "))}</span>
        <div class="fo-trade-policy-control" role="group" aria-label="Trade policy for ${escapeHtml(pickLabel(pick))}">
          ${["AVAILABLE", "CONSIDER", "UNTOUCHABLE"].map((option) => policyButton(pick.identity, option, option === policy)).join("")}
        </div>
      </article>`;
    }).join("") || '<div class="empty">No live draft assets were returned.</div>';

    bindPolicyButtons(target);
  }

  function bindPolicyButtons(root) {
    root.querySelectorAll("[data-trade-policy-id]").forEach((button) => {
      button.addEventListener("click", () => {
        setAssetPolicy(button.dataset.tradePolicyId, button.dataset.tradePolicy);
        renderPlayers();
        renderPicks();
        if (state.lastSearch) runFinder(false);
      });
    });
  }

  function selectedPackage(offer) {
    const strategy = state.activeStrategyByOffer.get(offer.market_id) || "BALANCED";
    return offer.packages[strategy] ?? offer.primary;
  }

  function assetDisplay(asset) {
    if (asset.kind === "PICK") return pickLabel(asset);
    return `${asset.player_name} (${asset.position_code ?? asset.position ?? "—"}, ${asset.overall_rating ?? "—"} OVR)`;
  }

  function strategyButton(offer, strategy, label) {
    const available = Boolean(offer.packages[strategy]);
    const active = selectedPackage(offer)?.strategy === strategy;
    return `<button type="button" data-trade-strategy-market="${escapeHtml(offer.market_id)}" data-trade-strategy="${strategy}" ${available ? "" : "disabled"} class="${active ? "active" : ""}">${escapeHtml(label)}</button>`;
  }

  function offerCard(offer) {
    const packageData = selectedPackage(offer);
    const player = offer.player;
    const cap = engine.capResult(offer.entry, packageData, state.franchise?.state?.resources?.cap?.practical_flexibility_millions);
    const teamMarket = offer.team_market;
    const marketStatus = normalizeKey(offer.entry.availability).replaceAll("_", " ");
    const packageList = packageData.assets.map(assetDisplay).join(" • ");
    const tierLabel = offer.tier === "CREDIBLE" ? "Credible offer" : offer.tier === "EXPENSIVE" ? "Possible, but expensive" : "Possible offer";
    const netCap = cap.net_cap === null ? "Unknown" : `${cap.net_cap > 0 ? "+" : ""}${formatMillions(cap.net_cap)}`;
    return `<article class="fo-trade-offer-card tier-${offer.tier.toLowerCase()}">
      <header class="fo-trade-offer-head">
        <div>
          <span>${escapeHtml(tierLabel)} • ${escapeHtml(offer.team_name)}</span>
          <h3>${escapeHtml(player.player_name)}</h3>
          <p>${escapeHtml(player.position)} • ${escapeHtml(player.overall_rating ?? "—")} OVR • ${escapeHtml(ROLE_LABELS[player.role] ?? player.role)} • ${escapeHtml(formatMillions(player.cap_hit_2026_millions))}</p>
        </div>
        <div class="fo-trade-offer-market">
          <span class="pill ${statusClass(offer.entry.availability)}">${escapeHtml(marketStatus)}</span>
          <small>${escapeHtml(POSTURE_LABELS[teamMarket.posture] ?? teamMarket.posture)}</small>
        </div>
      </header>
      <div class="fo-trade-offer-package">
        <div><span>St. Louis receives</span><strong>${escapeHtml(`${player.player_name} • ${player.position} • ${player.overall_rating ?? "—"} OVR`)}</strong></div>
        <div><span>${escapeHtml(offer.team_name)} receives</span><strong>${escapeHtml(packageList)}</strong></div>
      </div>
      <div class="fo-trade-offer-scorebar">
        <span>Fit <strong>${escapeHtml(offer.fit_score >= 80 ? "Great" : offer.fit_score >= 65 ? "Good" : "Marginal")}</strong></span>
        <span>Cost <strong>${escapeHtml(packageData.archers_cost < 24 ? "Low" : packageData.archers_cost < 48 ? "Moderate" : packageData.archers_cost < 78 ? "High" : "Premium")}</strong></span>
        <span>Cap <strong class="${statusClass(cap.kind)}">${escapeHtml(cap.label)}</strong></span>
        <span>Confidence <strong>${escapeHtml(offer.confidence_label)}</strong></span>
      </div>
      <div class="fo-trade-offer-reasons">
        <p><strong>Why movable:</strong> ${escapeHtml(offer.why_movable)}</p>
        <p><strong>Why they listen:</strong> ${escapeHtml(offer.why_team_listens)}</p>
        ${offer.entry.asking_price ? `<p><strong>Market note:</strong> ${escapeHtml(offer.entry.asking_price)}</p>` : ""}
        <p><strong>Net 2026 cap:</strong> ${escapeHtml(netCap)}</p>
      </div>
      <div class="fo-trade-strategy-switcher" aria-label="Package strength">
        ${strategyButton(offer, "VALUE", "Value")}
        ${strategyButton(offer, "BALANCED", "Balanced")}
        ${strategyButton(offer, "STRONG", "Strong")}
      </div>
      <div class="fo-trade-offer-actions">
        <button type="button" data-pin-trade-offer="${escapeHtml(offer.market_id)}">Pin Offer</button>
        <button type="button" class="primary" data-copy-trade-offer="${escapeHtml(offer.market_id)}">Send to Staff Review</button>
      </div>
    </article>`;
  }

  function renderResults(result) {
    const target = document.getElementById("fo-trade-results");
    const summary = document.getElementById("fo-trade-result-summary");
    if (!target || !summary) return;

    const credible = result.offers.filter((offer) => offer.tier === "CREDIBLE");
    const possible = result.offers.filter((offer) => offer.tier !== "CREDIBLE");
    summary.textContent = `${result.offers.length} generated offer${result.offers.length === 1 ? "" : "s"} • ${result.no_market_count} matching indexed players with no current market`;

    if (!result.offers.length) {
      const missingMarket = state.tradeMarket.length === 0;
      target.innerHTML = `<div class="fo-trade-no-market">
        <strong>${missingMarket ? "No active league trade market is published." : "No credible offers fit the current market and Archers asset policy."}</strong>
        <p>${missingMarket
          ? "The finder does not invent availability. Add or refresh the trade_market / trade-market resource before it can generate league offers."
          : "Try a different role, make more Archers assets available, relax first-round protection, or wait for the league market to change."}</p>
      </div>`;
      return;
    }

    target.innerHTML = `
      ${credible.length ? `<section class="fo-trade-result-group"><div class="fo-trade-result-group-head"><h3>Credible Offers</h3><span>${credible.length}</span></div><div class="fo-trade-offer-grid">${credible.map(offerCard).join("")}</div></section>` : ""}
      ${possible.length ? `<section class="fo-trade-result-group"><div class="fo-trade-result-group-head"><h3>Possible, but Expensive or Uncertain</h3><span>${possible.length}</span></div><div class="fo-trade-offer-grid">${possible.map(offerCard).join("")}</div></section>` : ""}
      ${result.no_market_count ? `<div class="fo-trade-no-market compact"><strong>${escapeHtml(result.no_market_count)} matching player${result.no_market_count === 1 ? "" : "s"} had no current trade market.</strong><p>They were not converted into fake offers.</p></div>` : ""}`;

    bindResultActions(target, result);
  }

  function bindResultActions(root, result) {
    root.querySelectorAll("[data-trade-strategy-market]").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeStrategyByOffer.set(button.dataset.tradeStrategyMarket, button.dataset.tradeStrategy);
        renderResults(result);
      });
    });

    root.querySelectorAll("[data-pin-trade-offer]").forEach((button) => {
      button.addEventListener("click", () => {
        const offer = result.offers.find((item) => item.market_id === button.dataset.pinTradeOffer);
        if (!offer) return;
        pinOffer(offer);
      });
    });

    root.querySelectorAll("[data-copy-trade-offer]").forEach((button) => {
      button.addEventListener("click", async () => {
        const offer = result.offers.find((item) => item.market_id === button.dataset.copyTradeOffer);
        if (!offer) return;
        try {
          await copyText(buildStaffPrompt(offer));
          setMessage("Staff-review prompt copied. No outreach or canon write occurred.", "good");
        } catch (error) {
          setMessage(`The staff-review prompt could not be copied: ${error?.message ?? error}`, "bad");
        }
      });
    });
  }

  function pinOffer(offer) {
    const packageData = selectedPackage(offer);
    const pin = {
      id: `${offer.market_id}:${packageData.strategy}`,
      created_at: new Date().toISOString(),
      team_name: offer.team_name,
      team_id: offer.team_id,
      player: offer.player,
      posture: offer.team_market.posture,
      availability: offer.entry.availability,
      confidence: offer.confidence_label,
      fit_score: offer.fit_score,
      cap: engine.capResult(offer.entry, packageData, state.franchise?.state?.resources?.cap?.practical_flexibility_millions),
      package: {
        strategy: packageData.strategy,
        assets: packageData.assets.map((asset) => ({ ...asset })),
        ratio: packageData.ratio,
        archers_cost: packageData.archers_cost
      }
    };
    state.pinned = [pin, ...state.pinned.filter((item) => item.id !== pin.id)].slice(0, MAX_PINNED);
    saveJson(PINNED_STORAGE_KEY, state.pinned);
    renderPinned();
    setMessage("Offer pinned in this browser for comparison.", "good");
  }

  function renderPinned() {
    const target = document.getElementById("fo-trade-pinned");
    if (!target) return;
    target.innerHTML = state.pinned.map((pin, index) => `
      <article class="fo-trade-pinned-card">
        <header><div><span>Pinned ${index + 1}</span><h3>${escapeHtml(pin.team_name)} • ${escapeHtml(pin.player.player_name)}</h3></div><button type="button" data-remove-pinned-offer="${escapeHtml(pin.id)}">Remove</button></header>
        <p><strong>Archers send:</strong> ${escapeHtml(pin.package.assets.map(assetDisplay).join(" • "))}</p>
        <div><span>Fit <strong>${escapeHtml(pin.fit_score)}</strong></span><span>Cap <strong>${escapeHtml(pin.cap.label)}</strong></span><span>Market <strong>${escapeHtml(pin.confidence)}</strong></span><span>Package <strong>${escapeHtml(pin.package.strategy)}</strong></span></div>
      </article>`).join("") || '<div class="empty">Pin up to three generated offers for quick comparison.</div>';

    target.querySelectorAll("[data-remove-pinned-offer]").forEach((button) => {
      button.addEventListener("click", () => {
        state.pinned = state.pinned.filter((item) => item.id !== button.dataset.removePinnedOffer);
        saveJson(PINNED_STORAGE_KEY, state.pinned);
        renderPinned();
      });
    });
  }

  function buildStaffPrompt(offer) {
    const packageData = selectedPackage(offer);
    const assets = packageData.assets.map((asset) => {
      if (asset.kind === "PICK") return `- ${pickLabel(asset)} • identity: ${asset.identity} • status: ${asset.status}`;
      return `- ${asset.player_name} • ${asset.position} • ${asset.overall_rating ?? "—"} OVR • resource_id: ${asset.resource_id}`;
    }).join("\n");
    return `TRADE FINDER OFFER REVIEW

Do not write or modify anything.

Read the current authoritative franchise, roster, contract, cap, draft-capital, team-market, trade-market, league-player, transaction, and Decision Queue context needed to verify this generated offer.

The website output is a read-only proposal. Do not treat the target, availability, team posture, asking price, or package as current canon until the exact live resources confirm them. Do not contact another team, open negotiations, make an offer, execute a trade, or create a Decision Queue item.

ARCHERS OBJECTIVE
- Position: ${currentObjective().position}
- Desired role: ${currentObjective().role}

GENERATED OFFER
- Market entry: ${offer.market_id}
- Other team: ${offer.team_name} (${offer.team_id})
- Team posture: ${offer.team_market.posture}
- Target: ${offer.player.player_name}
- Target player_id: ${offer.player.player_id}
- Position: ${offer.player.position}
- OVR: ${offer.player.overall_rating ?? "Unknown"}
- Age: ${offer.player.age ?? "Unknown"}
- Development: ${offer.player.development_trait ?? "Unknown"}
- 2026 cap hit: ${formatMillions(offer.player.cap_hit_2026_millions)}
- Contract years remaining: ${offer.player.contract_years_remaining ?? "Unknown"}
- Market availability: ${offer.entry.availability}
- Evidence: ${offer.entry.evidence}
- Asking-price note: ${offer.entry.asking_price || "None"}
- Finder reason movable: ${offer.why_movable}
- Finder reason team may listen: ${offer.why_team_listens}

ST. LOUIS SENDS
${assets}

FINDER OUTPUT
- Package strength: ${packageData.strategy}
- Package ratio: ${packageData.ratio.toFixed(2)}
- Roster fit: ${offer.fit_score}/100
- Market confidence: ${offer.confidence_score}/100
- Cap result: ${engine.capResult(offer.entry, packageData, state.franchise?.state?.resources?.cap?.practical_flexibility_millions).label}

Return the responsible staff's verification and analysis. State what is verified, stale, unsupported, or missing. Explain why the other team would or would not engage. Stop for Kevin Dorey's decision before any outreach, offer, negotiation, transaction, Decision Queue creation, or canon write.`;
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function setMessage(message, kind = "warn") {
    const target = document.getElementById("fo-trade-message");
    if (!target) return;
    target.className = `fo-trade-message ${kind}`;
    target.textContent = message;
  }

  function runFinder(announce = true) {
    const objective = currentObjective();
    if (!objective.position) {
      setMessage("Choose a position before searching the league.", "bad");
      return;
    }

    const result = engine.findOffers({
      objective,
      teams: state.teams,
      teamMarkets: state.teamMarkets,
      tradeMarket: state.tradeMarket,
      leaguePlayers: state.leaguePlayers,
      archersAssets: archersAssets(),
      archersPlayers: state.players,
      currentDraftYear: state.currentDraftYear,
      currentWeek: state.currentWeek,
      practicalFlexibility: state.franchise?.state?.resources?.cap?.practical_flexibility_millions,
      options: currentOptions()
    });
    state.lastSearch = result;
    renderResults(result);
    if (announce) {
      setMessage(
        result.offers.length
          ? `Generated ${result.offers.length} current-market offer${result.offers.length === 1 ? "" : "s"}. Nothing was written.`
          : "No credible offer was generated under the current market and asset policy.",
        result.offers.length ? "good" : "warn"
      );
    }
  }

  function manualEntry() {
    const teamId = fieldValue("fo-trade-manual-team");
    const name = fieldValue("fo-trade-manual-name").trim();
    const position = fieldValue("fo-trade-manual-position");
    const overall = numberOrNull(fieldValue("fo-trade-manual-ovr"));
    if (!teamId || !name || !position || overall === null) return null;
    return engine.normalizeTradeMarketEntry({
      market_id: `manual-${Date.now()}`,
      player: {
        player_id: `manual-${normalizeKey(teamId)}-${normalizeKey(name)}`,
        team_id: teamId,
        team_name: teamName(teamId),
        player_name: name,
        position,
        overall_rating: overall,
        age: numberOrNull(fieldValue("fo-trade-manual-age")),
        cap_hit_2026_millions: numberOrNull(fieldValue("fo-trade-manual-cap")),
        contract_years_remaining: numberOrNull(fieldValue("fo-trade-manual-years")),
        development_trait: fieldValue("fo-trade-manual-trait") || "NORMAL",
        role: fieldValue("fo-trade-manual-role") || engine.normalizeRole("", overall)
      },
      availability: "UNLIKELY",
      evidence: "MODEL_INFERENCE",
      asking_price: "Manual specific-player evaluation. Availability is not verified."
    }, new Map(), `manual-${Date.now()}`);
  }

  function runManualEvaluation() {
    const entry = manualEntry();
    if (!entry) {
      setMessage("Complete team, player, position, and OVR for a specific-player evaluation.", "bad");
      return;
    }
    const teamState = state.teamMarkets.find((team) => team.team_id === entry.team_id)
      ?? engine.normalizeTeamMarket({ team_id: entry.team_id, posture: "HOLD", confidence: "MODEL_INFERENCE" });
    const result = engine.findOffers({
      objective: { position: entry.player.position, role: entry.player.role, team_id: entry.team_id },
      teams: state.teams,
      teamMarkets: [...state.teamMarkets.filter((team) => team.team_id !== entry.team_id), teamState],
      tradeMarket: [entry],
      leaguePlayers: [entry.player],
      archersAssets: archersAssets(),
      archersPlayers: state.players,
      currentDraftYear: state.currentDraftYear,
      currentWeek: state.currentWeek,
      practicalFlexibility: state.franchise?.state?.resources?.cap?.practical_flexibility_millions,
      options: currentOptions()
    });
    state.lastSearch = result;
    renderResults(result);
    setMessage("Specific-player evaluation generated as speculative only. Nothing was written.", "warn");
  }

  function setAllPolicies(policy, kind = "ALL") {
    archersAssets().forEach((asset) => {
      if (kind !== "ALL" && asset.kind !== kind) return;
      setAssetPolicy(asset.identity, policy);
    });
    renderPlayers();
    renderPicks();
    if (state.lastSearch) runFinder(false);
  }

  function protectFirstRounders() {
    state.picks.filter((pick) => pick.round === 1).forEach((pick) => setAssetPolicy(pick.identity, "UNTOUCHABLE"));
    renderPicks();
    if (state.lastSearch) runFinder(false);
  }

  function bindEvents() {
    document.getElementById("fo-trade-find")?.addEventListener("click", () => runFinder(true));
    document.getElementById("fo-trade-player-search")?.addEventListener("input", (event) => {
      state.playerSearch = event.target.value;
      renderPlayers();
    });
    document.getElementById("fo-trade-all-consider")?.addEventListener("click", () => setAllPolicies("CONSIDER"));
    document.getElementById("fo-trade-protect-firsts-button")?.addEventListener("click", protectFirstRounders);
    document.getElementById("fo-trade-players-available")?.addEventListener("click", () => setAllPolicies("AVAILABLE", "PLAYER"));
    document.getElementById("fo-trade-picks-consider")?.addEventListener("click", () => setAllPolicies("CONSIDER", "PICK"));
    document.getElementById("fo-trade-manual-evaluate")?.addEventListener("click", runManualEvaluation);
    document.querySelectorAll("#fo-trade-center select, #fo-trade-center input").forEach((control) => {
      if (control.id === "fo-trade-player-search") return;
      control.addEventListener("change", () => {
        if (state.lastSearch && ["fo-trade-finder-team", "fo-trade-finder-package-preference", "fo-trade-finder-max-assets", "fo-trade-finder-protect-firsts"].includes(control.id)) {
          runFinder(false);
        }
      });
    });
  }

  function ensureMarkup(attempt = 0) {
    const frontOffice = document.getElementById("frontoffice");
    if (!frontOffice) {
      if (attempt < 100) setTimeout(() => ensureMarkup(attempt + 1), 50);
      return false;
    }
    if (document.getElementById("fo-trade-center")) return true;

    const draftSection = document.getElementById("fo-draft-capital");
    const transactionSection = document.getElementById("fo-transaction-center");
    const layout = frontOffice.querySelector(".fo-layout");
    const section = document.createElement("section");
    section.id = "fo-trade-center";
    section.className = "panel fo-trade-center";
    section.innerHTML = `
      <div class="section-head fo-trade-heading">
        <div>
          <h2>Trade Finder</h2>
          <p>Search the current league market for complete offers. Missing market evidence produces no offer, not an invented one.</p>
        </div>
        <span id="fo-trade-source" class="pill warn">Loading league market…</span>
      </div>
      <div id="fo-trade-collapsible-body" class="fo-section-body">
        <div class="fo-trade-safety-note"><strong>Planning surface only.</strong> The finder reads current market resources and never contacts a team, creates canon, or writes to Supabase.</div>
        <div id="fo-trade-market-metrics" class="fo-trade-market-metrics">
          <div class="fo-trade-market-metric"><span>Active Market Entries</span><strong>—</strong></div>
          <div class="fo-trade-market-metric"><span>Sellers / Rebuilders</span><strong>—</strong></div>
          <div class="fo-trade-market-metric"><span>Buyers / Contenders</span><strong>—</strong></div>
          <div class="fo-trade-market-metric"><span>Stale Entries Ignored</span><strong>—</strong></div>
        </div>

        <section class="fo-trade-finder-hero">
          <div class="fo-trade-finder-fields">
            <label>Position<select id="fo-trade-finder-position"><option value="">Select position</option>${POSITIONS.map((position) => `<option value="${position}">${position}</option>`).join("")}</select></label>
            <label>Role<select id="fo-trade-finder-role"><option value="DEPTH">Depth</option><option value="ROTATION">Rotation</option><option value="STARTER" selected>Starter</option><option value="PREMIUM">Premium</option></select></label>
            <label>Team<select id="fo-trade-finder-team"><option value="ALL">Entire League</option></select></label>
            <button id="fo-trade-find" class="primary" type="button">Find Trade Offers</button>
          </div>
          <details class="fo-trade-advanced">
            <summary>Advanced package rules</summary>
            <div class="fo-trade-advanced-grid">
              <label>Package preference<select id="fo-trade-finder-package-preference"><option value="BALANCED">Balanced</option><option value="PICKS_FIRST">Picks first</option><option value="PLAYERS_FIRST">Players first</option></select></label>
              <label>Maximum outgoing assets<select id="fo-trade-finder-max-assets"><option value="2">2</option><option value="3" selected>3</option><option value="4">4</option></select></label>
              <label class="fo-trade-checkbox"><input id="fo-trade-finder-protect-firsts" type="checkbox"><span>Never use a first-round pick</span></label>
            </div>
          </details>
        </section>

        <section class="fo-trade-subpanel fo-trade-assets-panel">
          <div class="fo-trade-subhead"><span>1</span><div><h3>Archers Asset Policy</h3><p>Available assets are preferred, Consider assets are used only when needed, and Untouchable assets are excluded.</p></div></div>
          <div class="fo-trade-quick-actions">
            <button id="fo-trade-all-consider" type="button">Reset All to Consider</button>
            <button id="fo-trade-protect-firsts-button" type="button">Protect First-Round Picks</button>
            <button id="fo-trade-players-available" type="button">Make Players Available</button>
            <button id="fo-trade-picks-consider" type="button">Keep Picks at Consider</button>
          </div>
          <div class="fo-trade-assets-grid">
            <div>
              <div class="fo-trade-asset-head"><div><h4>Players</h4><span id="fo-trade-player-summary">Loading profiles…</span></div><input id="fo-trade-player-search" type="search" placeholder="Search players"></div>
              <div id="fo-trade-player-assets" class="fo-trade-asset-list"><div class="empty">Loading roster assets…</div></div>
            </div>
            <div>
              <div class="fo-trade-asset-head"><div><h4>Draft Assets</h4><span id="fo-trade-pick-summary">Loading picks…</span></div></div>
              <div id="fo-trade-pick-assets" class="fo-trade-asset-list"><div class="empty">Loading draft capital…</div></div>
            </div>
          </div>
        </section>

        <section class="fo-trade-subpanel">
          <div class="fo-trade-subhead"><span>2</span><div><h3>Generated Offers</h3><p>Offers require a plausible market reason for the other team. A valid search may return none.</p></div></div>
          <div id="fo-trade-result-summary" class="fo-trade-result-summary">Choose a position and role to search the league.</div>
          <div id="fo-trade-results"><div class="empty">No search has been run.</div></div>
          <p id="fo-trade-message" class="fo-trade-message">No franchise data has been changed.</p>
        </section>

        <section class="fo-trade-subpanel">
          <div class="fo-trade-subhead"><span>3</span><div><h3>Pinned Offers</h3><p>Stored in this browser only. Maximum three.</p></div></div>
          <div id="fo-trade-pinned" class="fo-trade-pinned"><div class="empty">Pin up to three generated offers for quick comparison.</div></div>
        </section>

        <details class="fo-trade-subpanel fo-trade-manual">
          <summary>Evaluate a specific player not on the current market</summary>
          <p>This fallback is speculative. It does not establish availability.</p>
          <div class="fo-trade-manual-grid">
            <label>Team<select id="fo-trade-manual-team"><option value="">Select team</option></select></label>
            <label>Player name<input id="fo-trade-manual-name" type="text" placeholder="Player"></label>
            <label>Position<select id="fo-trade-manual-position"><option value="">Select position</option>${POSITIONS.map((position) => `<option value="${position}">${position}</option>`).join("")}</select></label>
            <label>OVR<input id="fo-trade-manual-ovr" type="number" min="40" max="99" step="1"></label>
            <label>Role<select id="fo-trade-manual-role"><option value="DEPTH">Depth</option><option value="ROTATION">Rotation</option><option value="STARTER" selected>Starter</option><option value="PREMIUM">Premium</option></select></label>
            <label>Age<input id="fo-trade-manual-age" type="number" min="18" max="45" step="1"></label>
            <label>2026 cap hit<input id="fo-trade-manual-cap" type="number" min="0" step="0.1"></label>
            <label>Contract years<input id="fo-trade-manual-years" type="number" min="0" max="8" step="1"></label>
            <label>Development<select id="fo-trade-manual-trait"><option value="NORMAL">Normal</option><option value="HIDDEN">Hidden</option><option value="STAR">Star</option><option value="SUPERSTAR">Superstar</option><option value="XFACTOR">X-Factor</option></select></label>
            <button id="fo-trade-manual-evaluate" type="button">Evaluate Speculatively</button>
          </div>
        </details>
      </div>`;

    if (transactionSection) transactionSection.parentNode.insertBefore(section, transactionSection);
    else if (draftSection?.nextSibling) draftSection.parentNode.insertBefore(section, draftSection.nextSibling);
    else if (draftSection) draftSection.parentNode.append(section);
    else frontOffice.insertBefore(section, layout ?? null);

    bindEvents();
    renderPinned();
    return true;
  }

  function marketResourceByType(rows, type) {
    return rows.find((row) => row.resource_type === type && row.resource_id === MARKET_RESOURCE_IDS[type]) ?? null;
  }

  function applyMarketResources(rows) {
    state.marketResources = Object.fromEntries(MARKET_RESOURCE_TYPES.map((type) => [type, marketResourceByType(rows, type)]));
    state.leaguePlayers = engine.normalizeLeaguePlayerCollection(state.marketResources.league_player_index?.data ?? {});
    state.teamMarkets = engine.normalizeTeamMarketCollection(state.marketResources.team_market_state?.data ?? {});
    state.tradeMarket = engine.normalizeTradeMarketCollection(state.marketResources.trade_market?.data ?? {}, state.leaguePlayers);
  }

  async function loadData() {
    ensureMarkup();
    const [franchiseResult, playersResult, draftResult, teamsResult, marketResult] = await Promise.all([
      tradeClient.from("archers_franchise_state").select("version, state, updated_at").eq("id", FRANCHISE_ID).single(),
      tradeClient.from("archers_resources").select("resource_id, version, data, updated_at").eq("franchise_id", FRANCHISE_ID).eq("resource_type", "player").eq("status", "ACTIVE").eq("visibility", "CONSOLE").order("resource_id"),
      tradeClient.from("archers_resources").select("resource_id, version, data, updated_at").eq("franchise_id", FRANCHISE_ID).eq("resource_type", DRAFT_RESOURCE_TYPE).eq("resource_id", DRAFT_RESOURCE_ID).eq("status", "ACTIVE").eq("visibility", "CONSOLE").maybeSingle(),
      tradeClient.from("cff_teams").select("team_id, team_name, city, nickname, conference, division, is_archers, active, version, updated_at").eq("active", true).order("team_name"),
      tradeClient.from("archers_resources").select("resource_type, resource_id, version, data, updated_at").eq("franchise_id", FRANCHISE_ID).in("resource_type", MARKET_RESOURCE_TYPES).eq("status", "ACTIVE").eq("visibility", "CONSOLE")
    ]);

    for (const result of [franchiseResult, playersResult, draftResult, teamsResult, marketResult]) {
      if (result.error) throw result.error;
    }

    state.franchise = franchiseResult.data;
    state.players = playersResult.data ?? [];
    state.teams = teamsResult.data ?? [];
    state.currentWeek = numberOrNull(
      franchiseResult.data?.state?.timeline?.week
      ?? franchiseResult.data?.state?.week
    );
    state.currentDraftYear = numberOrNull(draftResult.data?.data?.current_draft_year) ?? 2027;
    state.picks = extractPicks(draftResult.data?.data ?? {})
      .sort((a, b) => a.year - b.year || a.round - b.round || String(a.original_team ?? "").localeCompare(String(b.original_team ?? "")));
    applyMarketResources(marketResult.data ?? []);

    renderTeamOptions();
    renderMarketMetrics();
    renderPlayers();
    renderPicks();
    renderPinned();

    const source = document.getElementById("fo-trade-source");
    if (source) {
      const present = MARKET_RESOURCE_TYPES.filter((type) => state.marketResources[type]).length;
      source.className = `pill ${state.tradeMarket.length ? "good" : present ? "warn" : "bad"}`;
      source.textContent = state.tradeMarket.length
        ? `Live market • ${state.tradeMarket.length} entries`
        : present
          ? "Market resources partial"
          : "Market not initialized";
      source.title = `State v${franchiseResult.data.version} • ${present}/3 market resources • ${state.players.length} Archers players • ${state.picks.length} picks`;
    }

    if (state.lastSearch) runFinder(false);
  }

  function showError(error) {
    ensureMarkup();
    const source = document.getElementById("fo-trade-source");
    const results = document.getElementById("fo-trade-results");
    if (source) {
      source.className = "pill bad";
      source.textContent = "Trade Finder unavailable";
    }
    if (results) results.innerHTML = `<div class="empty">The Trade Finder could not load current league and Archers data: ${escapeHtml(error?.message ?? error)}</div>`;
  }

  window.addEventListener("DOMContentLoaded", () => {
    ensureMarkup();
    loadData().catch(showError);

    tradeClient.channel("archers-trade-finder-v2")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "archers_franchise_state", filter: `id=eq.${FRANCHISE_ID}` }, () => loadData().catch(showError))
      .on("postgres_changes", { event: "*", schema: "public", table: "archers_resources", filter: `franchise_id=eq.${FRANCHISE_ID}` }, () => loadData().catch(showError))
      .on("postgres_changes", { event: "*", schema: "public", table: "cff_teams" }, () => loadData().catch(showError))
      .subscribe();
  });
})();