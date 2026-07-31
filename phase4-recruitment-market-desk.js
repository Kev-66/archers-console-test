(() => {
  "use strict";

  const APP = window.ArchersApp;
  if (!APP?.config || !APP?.createSupabaseClient) {
    console.error("Recruitment & Market Desk requires archers-app-config.js");
    return;
  }

  const { franchiseId, season, storagePrefix } = APP.config;
  const marketClient = APP.createSupabaseClient();
  const WATCHLIST_KEY = `${storagePrefix}-market-desk-v1-watchlist`;
  const RESOURCE_IDS = {
    league_player_index: "league-player-index",
    team_market_state: "team-market-state",
    trade_market: "trade-market",
    free_agent_market: "free-agent-market",
    draft_prospect_index: "draft-prospect-index"
  };
  const SINGLETON_TYPES = Object.keys(RESOURCE_IDS);
  const ACTIVE_TRADE_STATUSES = new Set(["ACTIVELY_SHOPPED", "AVAILABLE", "LISTENING"]);
  const EVIDENCE_ORDER = ["VERIFIED", "TEAM_CONTACT", "STAFF_SCOUTED", "PUBLIC_REPORT", "MODEL_INFERENCE"];
  const ROOM_DEFINITIONS = [
    ["QB", "Quarterback", ["QB"]],
    ["RB", "Running Back", ["RB", "FB", "RB_KR"]],
    ["WR", "Wide Receiver", ["WR", "WR_PR", "WR_KR"]],
    ["TE", "Tight End", ["TE", "TE_HB"]],
    ["OT", "Offensive Tackle", ["LT", "RT", "OT"]],
    ["IOL", "Interior OL", ["LG", "RG", "C", "G", "C_G", "G_T"]],
    ["EDGE", "Edge", ["EDGE", "DE"]],
    ["DT", "Defensive Tackle", ["DT", "NT"]],
    ["LB", "Linebacker", ["MLB", "LB", "OLB", "ILB"]],
    ["CB", "Cornerback", ["CB", "NB", "CB_S"]],
    ["S", "Safety", ["FS", "SS", "S", "S_NB"]],
    ["ST", "Specialist", ["K", "P", "LS"]]
  ];
  const ROOM_BY_POSITION = new Map(
    ROOM_DEFINITIONS.flatMap(([roomId, , positions]) => positions.map((position) => [position, roomId]))
  );

  const state = {
    franchise: null,
    players: [],
    teams: [],
    resources: {},
    scoutingReports: [],
    candidates: [],
    lane: "all",
    search: "",
    position: "ALL",
    evidence: "ALL",
    watchlist: loadWatchlist(),
    compare: new Set(),
    channel: null,
    reloadTimer: null
  };

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const upper = (value) => String(value ?? "").trim().toUpperCase().replaceAll("-", "_").replaceAll("/", "_").replaceAll(" ", "_");
  const numberOrNull = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
  const array = (value) => Array.isArray(value) ? value : [];
  const known = (value, fallback = "Unknown") => value === null || value === undefined || value === "" ? fallback : String(value);
  const label = (value) => known(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

  function loadWatchlist() {
    try {
      const parsed = JSON.parse(localStorage.getItem(WATCHLIST_KEY) ?? "[]");
      return new Set(array(parsed).map(String));
    } catch {
      return new Set();
    }
  }

  function saveWatchlist() {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify([...state.watchlist]));
  }

  function resource(type) {
    return state.resources[type] ?? null;
  }

  function resourceData(type) {
    return resource(type)?.data ?? {};
  }

  function teamName(teamId) {
    const team = state.teams.find((entry) => entry.team_id === teamId);
    return team?.team_name ?? ([team?.city, team?.nickname].filter(Boolean).join(" ") || teamId || "Unknown team");
  }

  function currentWeek() {
    return numberOrNull(
      state.franchise?.state?.timeline?.week
      ?? state.franchise?.state?.week
    );
  }

  function freshness(entry, parent) {
    const asOfWeek = numberOrNull(entry?.as_of_week ?? parent?.as_of_week);
    const reviewAfterWeek = numberOrNull(entry?.review_after_week ?? parent?.review_after_week);
    const week = currentWeek();
    return {
      asOfWeek,
      reviewAfterWeek,
      stale: week !== null && reviewAfterWeek !== null && week > reviewAfterWeek
    };
  }

  function reportFor(subjectType, subjectId) {
    return state.scoutingReports.find((report) =>
      upper(report.subject_type) === upper(subjectType)
      && String(report.subject_id) === String(subjectId)
    ) ?? null;
  }

  function normalizeCandidate(base, report) {
    const evidence = upper(report?.evidence ?? base.evidence) || "UNKNOWN";
    const reportNotes = report?.summary
      ?? [...array(report?.strengths), ...array(report?.risks)].join(" • ");
    return {
      ...base,
      position: upper(base.position) || "UNKNOWN",
      evidence,
      notes: reportNotes || base.notes || null,
      reportId: report?.report_id ?? null
    };
  }

  function buildTradeCandidates() {
    const leagueResource = resourceData("league_player_index");
    const marketResource = resourceData("trade_market");
    const leaguePlayers = array(leagueResource.players);
    return array(marketResource.entries)
      .filter((entry) => ACTIVE_TRADE_STATUSES.has(upper(entry.availability)))
      .map((entry) => {
        const player = leaguePlayers.find((item) => String(item.player_id) === String(entry.player_id))
          ?? entry.player
          ?? null;
        if (!player?.player_name || !player?.position) return null;
        const fresh = freshness(entry, marketResource);
        return normalizeCandidate({
          id: `trade:${entry.player_id}`,
          sourceId: String(entry.player_id),
          lane: "trade",
          sourceLabel: "Trade Target",
          name: player.player_name,
          position: player.position_code ?? player.position,
          evidence: entry.evidence,
          availability: entry.availability,
          organization: player.team_name ?? teamName(entry.team_id ?? player.team_id),
          rating: numberOrNull(player.overall_rating),
          age: numberOrNull(player.age),
          development: player.development_trait ?? null,
          role: player.role ?? null,
          cost: entry.asking_price ?? player.contract_summary ?? null,
          notes: entry.movable_reason ?? player.football_notes ?? null,
          ...fresh
        }, reportFor("TRADE_TARGET", entry.player_id));
      })
      .filter(Boolean);
  }

  function buildFreeAgentCandidates() {
    const market = resourceData("free_agent_market");
    return array(market.entries)
      .filter((entry) => upper(entry.availability) !== "UNAVAILABLE")
      .map((entry) => {
        const fresh = freshness(entry, market);
        return normalizeCandidate({
          id: `free-agent:${entry.candidate_id}`,
          sourceId: String(entry.candidate_id),
          lane: "free-agent",
          sourceLabel: "Free Agent",
          name: entry.player_name,
          position: entry.position_code ?? entry.position,
          evidence: entry.evidence,
          availability: entry.availability,
          organization: entry.previous_team ?? "Open market",
          rating: numberOrNull(entry.overall_rating),
          age: numberOrNull(entry.age),
          development: entry.development_trait ?? null,
          role: entry.role ?? null,
          cost: entry.contract_expectation ?? null,
          notes: entry.football_notes ?? null,
          ...fresh
        }, reportFor("FREE_AGENT", entry.candidate_id));
      })
      .filter((entry) => entry.name && entry.position);
  }

  function buildProspectCandidates() {
    const index = resourceData("draft_prospect_index");
    return array(index.prospects)
      .map((entry) => {
        const fresh = freshness(entry, index);
        return normalizeCandidate({
          id: `prospect:${entry.prospect_id}`,
          sourceId: String(entry.prospect_id),
          lane: "prospect",
          sourceLabel: "Draft Prospect",
          name: entry.player_name,
          position: entry.position,
          evidence: entry.evidence,
          availability: entry.projected_range ?? "DRAFT_EVALUATION",
          organization: entry.school ?? "School unknown",
          rating: numberOrNull(entry.overall_grade),
          age: null,
          development: entry.development_trait ?? null,
          role: entry.role_projection ?? null,
          cost: entry.projected_range ?? null,
          notes: entry.football_notes ?? (array(entry.traits).join(" • ") || null),
          draftClass: index.draft_class ?? null,
          ...fresh
        }, reportFor("DRAFT_PROSPECT", entry.prospect_id));
      })
      .filter((entry) => entry.name && entry.position);
  }

  function buildCandidates() {
    state.candidates = [
      ...buildFreeAgentCandidates(),
      ...buildTradeCandidates(),
      ...buildProspectCandidates()
    ].sort((a, b) =>
      (EVIDENCE_ORDER.indexOf(a.evidence) < 0 ? 99 : EVIDENCE_ORDER.indexOf(a.evidence))
      - (EVIDENCE_ORDER.indexOf(b.evidence) < 0 ? 99 : EVIDENCE_ORDER.indexOf(b.evidence))
      || (b.rating ?? -1) - (a.rating ?? -1)
      || a.name.localeCompare(b.name)
    );
    const validIds = new Set(state.candidates.map((candidate) => candidate.id));
    state.watchlist = new Set([...state.watchlist].filter((id) => validIds.has(id)));
    state.compare = new Set([...state.compare].filter((id) => validIds.has(id)));
    saveWatchlist();
  }

  function positionRoom(value) {
    return ROOM_BY_POSITION.get(upper(value)) ?? upper(value) ?? "OTHER";
  }

  function contractControlled(player, year) {
    const endSeason = numberOrNull(player.data?.contract?.end_season);
    if (endSeason === null) return null;
    return endSeason >= year;
  }

  function rosterNeeds() {
    const active = state.players.filter((player) => upper(player.data?.roster_status) === "ACTIVE_ROSTER");
    return ROOM_DEFINITIONS.map(([roomId, roomLabel]) => {
      const room = active.filter((player) => positionRoom(player.data?.position_code ?? player.data?.position) === roomId);
      const controlled = room.filter((player) => contractControlled(player, season + 1) === true).length;
      const unknown = room.filter((player) => contractControlled(player, season + 1) === null).length;
      const ratio = room.length ? controlled / room.length : 1;
      return {
        roomId,
        label: roomLabel,
        active: room.length,
        controlled,
        unknown,
        ratio,
        priority: ratio < .5 ? "high" : ratio < .75 || unknown ? "medium" : "covered"
      };
    })
      .filter((room) => room.active > 0)
      .sort((a, b) => a.ratio - b.ratio || b.unknown - a.unknown || a.label.localeCompare(b.label))
      .slice(0, 5);
  }

  function setupMarkup() {
    const root = document.getElementById("market-desk-root");
    if (!root) return null;
    if (root.dataset.ready === "true") return root;
    root.dataset.ready = "true";
    root.className = "market-desk-shell";
    root.innerHTML = `
      <section class="market-desk-hero">
        <div>
          <div class="market-desk-kicker">Recruitment &amp; Market Desk • Read-only research</div>
          <h2>Build the board. Verify the market.</h2>
          <p>Bring free agents, explicit trade targets and draft prospects into one evidence-aware talent board, then compare them against the Archers' recorded roster needs.</p>
        </div>
        <aside class="market-desk-boundary">
          <strong>No personnel action occurs here.</strong>
          <span>Watchlists and comparisons stay in this browser. The desk cannot sign, offer, claim, contact a team, change canon, or write to Supabase.</span>
        </aside>
      </section>

      <section id="market-desk-coverage" class="market-desk-coverage" aria-label="Market data coverage"></section>

      <section class="market-desk-section">
        <div class="section-head">
          <div><h2>Squad Planner Need Overlay</h2><p>Lowest ${season + 1} contract-control coverage first. These are planning signals, not recruitment decisions.</p></div>
          <button type="button" class="market-desk-button" data-market-route="squadplanner">Open Squad Planner</button>
        </div>
        <div id="market-desk-needs" class="market-desk-needs"></div>
      </section>

      <section class="market-desk-toolbar">
        <div class="market-desk-lanes" role="tablist" aria-label="Talent lanes">
          <button type="button" class="market-desk-lane active" data-lane="all">All Talent</button>
          <button type="button" class="market-desk-lane" data-lane="free-agent">Free Agents</button>
          <button type="button" class="market-desk-lane" data-lane="trade">Trade Targets</button>
          <button type="button" class="market-desk-lane" data-lane="prospect">Draft Prospects</button>
          <button type="button" class="market-desk-lane" data-lane="watchlist">Watchlist</button>
        </div>
        <div class="market-desk-filters">
          <label class="market-desk-field">Search
            <input id="market-desk-search" type="search" placeholder="Name, team, school, role or notes">
          </label>
          <label class="market-desk-field">Position
            <select id="market-desk-position"><option value="ALL">All positions</option></select>
          </label>
          <label class="market-desk-field">Evidence
            <select id="market-desk-evidence">
              <option value="ALL">All evidence</option>
              ${EVIDENCE_ORDER.map((item) => `<option value="${item}">${escapeHtml(label(item))}</option>`).join("")}
            </select>
          </label>
        </div>
        <div id="market-desk-status" class="market-desk-status" aria-live="polite">Reading the authoritative state and market coverage…</div>
      </section>

      <section>
        <div class="market-desk-results-heading">
          <div><h2 id="market-desk-results-title">Authoritative Talent Board</h2><p id="market-desk-results-note">No candidate is inferred from an absent market record.</p></div>
          <div class="market-desk-footer-actions">
            <button type="button" class="market-desk-button" data-market-route="frontoffice">Open Trade Finder</button>
          </div>
        </div>
        <div id="market-desk-grid" class="market-desk-grid"></div>
      </section>

      <section id="market-desk-compare" class="market-desk-compare" aria-live="polite">
        <div class="market-desk-compare-heading">
          <div><h2>Candidate Comparison</h2><p>Recorded facts only; unknown values stay unknown.</p></div>
          <button id="market-desk-clear-compare" type="button" class="market-desk-button">Clear</button>
        </div>
        <div id="market-desk-compare-grid" class="market-desk-compare-grid"></div>
      </section>`;
    return root;
  }

  function ensureNavigation() {
    const tabs = document.querySelector(".tabs");
    const plannerButton = tabs?.querySelector('.tab-button[data-tab="squadplanner"]');
    if (!tabs || !plannerButton) return;
    let button = tabs.querySelector('.tab-button[data-tab="marketdesk"]');
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "tab-button";
      button.dataset.tab = "marketdesk";
      button.textContent = "Recruitment & Market";
      plannerButton.insertAdjacentElement("afterend", button);
      button.addEventListener("click", () => activateMarketDesk());
    }
    if (location.hash === "#marketdesk") activateMarketDesk(false);
  }

  function activateMarketDesk(updateHash = true) {
    document.querySelectorAll(".tab-button").forEach((button) => button.classList.toggle("active", button.dataset.tab === "marketdesk"));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === "marketdesk"));
    localStorage.setItem(`${storagePrefix}-tab`, "marketdesk");
    if (updateHash) history.replaceState(null, "", "#marketdesk");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setStatus(message, kind = "") {
    const target = document.getElementById("market-desk-status");
    if (!target) return;
    target.className = `market-desk-status ${kind}`.trim();
    target.textContent = message;
  }

  function renderCoverage() {
    const target = document.getElementById("market-desk-coverage");
    if (!target) return;
    const tradePresent = ["league_player_index", "team_market_state", "trade_market"].filter((type) => resource(type)).length;
    const freeAgentPresent = Boolean(resource("free_agent_market"));
    const prospectPresent = Boolean(resource("draft_prospect_index"));
    const cards = [
      {
        label: "Authoritative state",
        value: `v${state.franchise?.version ?? "Unknown"}`,
        note: `Week ${currentWeek() ?? "unknown"} • ${state.players.length} Archers player resources`,
        kind: state.franchise ? "good" : "bad"
      },
      {
        label: "Trade foundation",
        value: `${tradePresent}/3 resources`,
        note: `${state.candidates.filter((candidate) => candidate.lane === "trade").length} explicit active market entries`,
        kind: tradePresent === 3 ? "good" : tradePresent ? "warn" : "bad"
      },
      {
        label: "Free-agent market",
        value: freeAgentPresent ? "Connected" : "Not initialized",
        note: `${state.candidates.filter((candidate) => candidate.lane === "free-agent").length} available candidates`,
        kind: freeAgentPresent ? "good" : "bad"
      },
      {
        label: "Draft prospect index",
        value: prospectPresent ? "Connected" : "Not initialized",
        note: `${state.candidates.filter((candidate) => candidate.lane === "prospect").length} prospects • ${state.scoutingReports.length} scouting reports`,
        kind: prospectPresent ? "good" : "bad"
      }
    ];
    target.innerHTML = cards.map((card) => `
      <article class="market-desk-coverage-card ${card.kind}">
        <div class="label">${escapeHtml(card.label)}</div>
        <strong>${escapeHtml(card.value)}</strong>
        <small>${escapeHtml(card.note)}</small>
      </article>`).join("");
  }

  function renderNeeds() {
    const target = document.getElementById("market-desk-needs");
    if (!target) return;
    const needs = rosterNeeds();
    target.innerHTML = needs.length ? needs.map((need) => `
      <article class="market-desk-need-card ${need.priority}" data-need-position="${escapeHtml(need.roomId)}">
        <div class="label">${escapeHtml(need.label)}</div>
        <strong>${need.controlled}/${need.active} controlled</strong>
        <small>${need.unknown} unknown contract ${need.unknown === 1 ? "record" : "records"} for ${season + 1}</small>
      </article>`).join("") : '<div class="market-desk-empty"><strong>Roster need overlay unavailable</strong>No active roster records were returned.</div>';
  }

  function renderPositionOptions() {
    const select = document.getElementById("market-desk-position");
    if (!select) return;
    const positions = [...new Set(state.candidates.map((candidate) => candidate.position))].sort();
    const selected = positions.includes(state.position) ? state.position : "ALL";
    state.position = selected;
    select.innerHTML = `<option value="ALL">All positions</option>${positions.map((position) => `<option value="${escapeHtml(position)}">${escapeHtml(position)}</option>`).join("")}`;
    select.value = selected;
  }

  function filteredCandidates() {
    const search = state.search.trim().toLowerCase();
    return state.candidates.filter((candidate) => {
      if (state.lane === "watchlist" && !state.watchlist.has(candidate.id)) return false;
      if (!["all", "watchlist"].includes(state.lane) && candidate.lane !== state.lane) return false;
      if (state.position !== "ALL" && candidate.position !== state.position) return false;
      if (state.evidence !== "ALL" && candidate.evidence !== state.evidence) return false;
      if (!search) return true;
      return [
        candidate.name,
        candidate.organization,
        candidate.position,
        candidate.role,
        candidate.availability,
        candidate.notes
      ].some((value) => String(value ?? "").toLowerCase().includes(search));
    });
  }

  function candidateCard(candidate) {
    const watched = state.watchlist.has(candidate.id);
    const compared = state.compare.has(candidate.id);
    const freshnessLabel = candidate.stale
      ? `Stale after W${candidate.reviewAfterWeek}`
      : candidate.asOfWeek !== null
        ? `As of W${candidate.asOfWeek}`
        : "Freshness unknown";
    return `
      <article class="market-desk-card" data-candidate-id="${escapeHtml(candidate.id)}">
        <div class="market-desk-card-top">
          <span class="market-desk-source">${escapeHtml(candidate.sourceLabel)}</span>
          <span class="market-desk-evidence">${escapeHtml(label(candidate.evidence))}${candidate.stale ? " • Stale" : ""}</span>
        </div>
        <div>
          <h3>${escapeHtml(candidate.name)}</h3>
          <div class="market-desk-card-subtitle">${escapeHtml(candidate.position)} • ${escapeHtml(candidate.organization)}</div>
        </div>
        <div class="market-desk-facts">
          <div class="market-desk-fact"><span>Grade</span><strong>${escapeHtml(known(candidate.rating))}</strong></div>
          <div class="market-desk-fact"><span>Role</span><strong>${escapeHtml(label(candidate.role))}</strong></div>
          <div class="market-desk-fact"><span>Status</span><strong>${escapeHtml(label(candidate.availability))}</strong></div>
        </div>
        <div class="market-desk-card-note">${escapeHtml(candidate.notes ?? "No football notes recorded.")}</div>
        <div class="market-desk-card-subtitle">${escapeHtml(freshnessLabel)} • Cost: ${escapeHtml(known(candidate.cost))}</div>
        <div class="market-desk-card-actions">
          <button type="button" class="primary" data-watch="${escapeHtml(candidate.id)}">${watched ? "Remove Watchlist" : "Add to Watchlist"}</button>
          <button type="button" data-compare="${escapeHtml(candidate.id)}">${compared ? "Remove Compare" : "Compare"}</button>
          ${candidate.lane === "trade" ? '<button type="button" data-market-route="frontoffice">Trade Finder</button>' : ""}
        </div>
      </article>`;
  }

  function renderCandidates() {
    const target = document.getElementById("market-desk-grid");
    const title = document.getElementById("market-desk-results-title");
    const note = document.getElementById("market-desk-results-note");
    if (!target || !title || !note) return;
    const candidates = filteredCandidates();
    const laneLabels = {
      all: "Authoritative Talent Board",
      "free-agent": "Free Agents",
      trade: "Trade Targets",
      prospect: "Draft Prospects",
      watchlist: "Browser-local Watchlist"
    };
    title.textContent = laneLabels[state.lane] ?? laneLabels.all;
    note.textContent = `${candidates.length} of ${state.candidates.length} recorded candidates shown. Absence never implies availability.`;
    if (candidates.length) {
      target.innerHTML = candidates.map(candidateCard).join("");
      return;
    }

    const laneResource = {
      "free-agent": ["free_agent_market", "free-agent-market"],
      trade: ["trade_market", "trade-market plus league-player-index and team-market-state"],
      prospect: ["draft_prospect_index", "draft-prospect-index"]
    }[state.lane];
    let heading = state.lane === "watchlist" ? "Your local watchlist is empty" : "No candidates match this view";
    let message = state.lane === "watchlist"
      ? "Add an authoritative candidate to keep it in this browser."
      : "Adjust the filters or wait for authoritative market resources.";
    if (!state.candidates.length) {
      heading = "The authoritative market is not initialized";
      message = "No candidates are invented. Populate the free-agent market, trade-market foundation, or draft-prospect index through a separately reviewed canon-data workflow.";
    } else if (laneResource && !resource(laneResource[0])) {
      heading = `${label(laneResource[0])} is not initialized`;
      message = `This lane requires ${laneResource[1]}. The website remains safely empty until that canonical resource exists.`;
    }
    target.innerHTML = `<div class="market-desk-empty"><strong>${escapeHtml(heading)}</strong>${escapeHtml(message)}</div>`;
  }

  function renderCompare() {
    const section = document.getElementById("market-desk-compare");
    const target = document.getElementById("market-desk-compare-grid");
    if (!section || !target) return;
    const candidates = [...state.compare]
      .map((id) => state.candidates.find((candidate) => candidate.id === id))
      .filter(Boolean);
    section.classList.toggle("active", candidates.length > 0);
    target.innerHTML = candidates.map((candidate) => `
      <article class="market-desk-compare-card">
        <h3>${escapeHtml(candidate.name)}</h3>
        <dl>
          <dt>Lane</dt><dd>${escapeHtml(candidate.sourceLabel)}</dd>
          <dt>Position</dt><dd>${escapeHtml(candidate.position)}</dd>
          <dt>Grade</dt><dd>${escapeHtml(known(candidate.rating))}</dd>
          <dt>Role</dt><dd>${escapeHtml(label(candidate.role))}</dd>
          <dt>Evidence</dt><dd>${escapeHtml(label(candidate.evidence))}</dd>
          <dt>Cost</dt><dd>${escapeHtml(known(candidate.cost))}</dd>
          <dt>Freshness</dt><dd>${candidate.stale ? "Stale" : escapeHtml(candidate.asOfWeek === null ? "Unknown" : `Week ${candidate.asOfWeek}`)}</dd>
        </dl>
      </article>`).join("");
  }

  function renderAll() {
    renderCoverage();
    renderNeeds();
    renderPositionOptions();
    renderCandidates();
    renderCompare();
  }

  function bindInteractions(root) {
    root.addEventListener("click", (event) => {
      const route = event.target.closest?.("[data-market-route]")?.dataset.marketRoute;
      if (route) {
        APP.routeTo(route);
        return;
      }

      const lane = event.target.closest?.("[data-lane]")?.dataset.lane;
      if (lane) {
        state.lane = lane;
        root.querySelectorAll("[data-lane]").forEach((button) => button.classList.toggle("active", button.dataset.lane === lane));
        renderCandidates();
        return;
      }

      const watchId = event.target.closest?.("[data-watch]")?.dataset.watch;
      if (watchId) {
        if (state.watchlist.has(watchId)) state.watchlist.delete(watchId);
        else state.watchlist.add(watchId);
        saveWatchlist();
        renderCandidates();
        setStatus("Local watchlist updated. No franchise or market write occurred.", "good");
        return;
      }

      const compareId = event.target.closest?.("[data-compare]")?.dataset.compare;
      if (compareId) {
        if (state.compare.has(compareId)) state.compare.delete(compareId);
        else if (state.compare.size >= 3) {
          setStatus("Compare is limited to three candidates. Remove one before adding another.", "warn");
          return;
        } else state.compare.add(compareId);
        renderCandidates();
        renderCompare();
        return;
      }

      const needPosition = event.target.closest?.("[data-need-position]")?.dataset.needPosition;
      if (needPosition && [...document.getElementById("market-desk-position").options].some((option) => option.value === needPosition)) {
        state.position = needPosition;
        document.getElementById("market-desk-position").value = needPosition;
        renderCandidates();
      }
    });

    document.getElementById("market-desk-search")?.addEventListener("input", (event) => {
      state.search = event.target.value;
      renderCandidates();
    });
    document.getElementById("market-desk-position")?.addEventListener("change", (event) => {
      state.position = event.target.value;
      renderCandidates();
    });
    document.getElementById("market-desk-evidence")?.addEventListener("change", (event) => {
      state.evidence = event.target.value;
      renderCandidates();
    });
    document.getElementById("market-desk-clear-compare")?.addEventListener("click", () => {
      state.compare.clear();
      renderCandidates();
      renderCompare();
    });
  }

  function singletonResource(rows, type) {
    return rows.find((row) => row.resource_type === type && row.resource_id === RESOURCE_IDS[type]) ?? null;
  }

  async function loadDesk() {
    setupMarkup();
    const [franchiseResult, playersResult, marketResult, scoutingResult, teamsResult] = await Promise.all([
      marketClient.from("archers_franchise_state").select("id, version, state, updated_at").eq("id", franchiseId).single(),
      marketClient.from("archers_resources").select("resource_id, version, data, updated_at").eq("franchise_id", franchiseId).eq("resource_type", "player").eq("status", "ACTIVE").eq("visibility", "CONSOLE").order("resource_id"),
      marketClient.from("archers_resources").select("resource_type, resource_id, version, data, updated_at").eq("franchise_id", franchiseId).in("resource_type", SINGLETON_TYPES).eq("status", "ACTIVE").eq("visibility", "CONSOLE"),
      marketClient.from("archers_resources").select("resource_type, resource_id, version, data, updated_at").eq("franchise_id", franchiseId).eq("resource_type", "scouting_report").eq("status", "ACTIVE").eq("visibility", "CONSOLE"),
      marketClient.from("cff_teams").select("team_id, team_name, city, nickname, active").eq("active", true).order("team_name")
    ]);

    for (const result of [franchiseResult, playersResult, marketResult, scoutingResult, teamsResult]) {
      if (result.error) throw result.error;
    }

    state.franchise = franchiseResult.data;
    state.players = playersResult.data ?? [];
    state.teams = teamsResult.data ?? [];
    state.resources = Object.fromEntries(SINGLETON_TYPES.map((type) => [type, singletonResource(marketResult.data ?? [], type)]));
    state.scoutingReports = (scoutingResult.data ?? []).map((row) => row.data ?? {}).filter((report) => report.report_id && report.subject_id);
    buildCandidates();
    renderAll();
    const staleCount = state.candidates.filter((candidate) => candidate.stale).length;
    setStatus(
      `Live state ${state.franchise.version} • ${state.candidates.length} authoritative candidates • ${staleCount} stale • watchlist is browser-local.`,
      state.candidates.length ? (staleCount ? "warn" : "good") : "warn"
    );
    window.dispatchEvent(new CustomEvent("archers:market-desk-rendered", {
      detail: {
        stateVersion: state.franchise.version,
        playerResources: state.players.length,
        candidates: state.candidates.length,
        marketResources: SINGLETON_TYPES.filter((type) => resource(type)).length,
        readOnly: true
      }
    }));
  }

  function showError(error) {
    console.error("Recruitment & Market Desk could not load", error);
    setupMarkup();
    setStatus(`Recruitment & Market Desk unavailable: ${error?.message ?? error}`, "bad");
    const grid = document.getElementById("market-desk-grid");
    if (grid) grid.innerHTML = '<div class="market-desk-empty"><strong>Market data unavailable</strong>The console made no write and preserved the empty-safe boundary.</div>';
  }

  function scheduleReload() {
    clearTimeout(state.reloadTimer);
    state.reloadTimer = setTimeout(() => loadDesk().catch(showError), 220);
  }

  function subscribe() {
    if (!marketClient.channel) return;
    if (state.channel && marketClient.removeChannel) marketClient.removeChannel(state.channel);
    state.channel = marketClient.channel("archers-recruitment-market-desk-v1")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "archers_franchise_state", filter: `id=eq.${franchiseId}` }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "archers_resources", filter: `franchise_id=eq.${franchiseId}` }, scheduleReload)
      .subscribe();
  }

  function start() {
    const root = setupMarkup();
    ensureNavigation();
    if (root) bindInteractions(root);
    loadDesk().then(subscribe).catch(showError);
  }

  window.ArchersMarketDesk = Object.freeze({
    getSnapshot: () => ({
      stateVersion: state.franchise?.version ?? null,
      playerResources: state.players.length,
      candidates: state.candidates.map((candidate) => ({
        id: candidate.id,
        lane: candidate.lane,
        evidence: candidate.evidence,
        stale: candidate.stale
      })),
      resourcesPresent: SINGLETON_TYPES.filter((type) => resource(type)),
      watchlist: [...state.watchlist],
      compare: [...state.compare],
      readOnly: true
    }),
    reload: () => loadDesk(),
    open: () => activateMarketDesk()
  });

  start();
})();
