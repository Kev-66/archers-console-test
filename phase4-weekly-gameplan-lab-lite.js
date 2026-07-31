(() => {
  "use strict";

  const APP = window.ArchersApp;
  if (!APP?.config || !APP?.createSupabaseClient) {
    console.error("Weekly Gameplan Lab Lite requires archers-app-config.js");
    return;
  }

  const { franchiseId, storagePrefix } = APP.config;
  const client = APP.createSupabaseClient();
  const STORAGE_KEY = `${storagePrefix}-weekly-gameplan-lab-lite-v1`;
  const OPEN_STATUSES = new Set(["OPEN", "READY_FOR_REVIEW", "AWAITING_KEVIN", "BLOCKED"]);
  const RESOURCE_SPECS = Object.freeze([
    ["team_identity", "bal-2026"],
    ["team_staff", "bal-2026"],
    ["team_roster", "bal-2026"],
    ["team_depth_chart", "bal-2026-w03"],
    ["opponent_scouting", "stl-bal-2026-w03"]
  ]);
  const PRACTICE_ITEMS = Object.freeze([
    ["pass-protection", "Pass protection"],
    ["ball-security", "Ball security"],
    ["third-down", "Third down"],
    ["red-zone", "Red zone"],
    ["two-minute-offense", "Two-minute offense"],
    ["run-fits", "Run fits"],
    ["pressure-recognition", "Pressure recognition"],
    ["special-teams-assignments", "Special teams assignments"]
  ]);

  let currentSnapshot = null;
  let localPlan = readLocalPlan();
  let channel = null;
  let reloadTimer = null;

  const byId = (id) => document.getElementById(id);
  const asArray = (value) => Array.isArray(value) ? value : value == null ? [] : [value];
  const upper = (value) => String(value ?? "").trim().toUpperCase().replaceAll(" ", "_");
  const pretty = (value) => String(value ?? "—").replaceAll("_", " ");
  const normalize = (value) => String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  function defaultLocalPlan() {
    return {
      schemaVersion: 1,
      practice: Object.fromEntries(PRACTICE_ITEMS.map(([id]) => [id, false])),
      notes: {},
      updatedAt: null
    };
  }

  function readLocalPlan() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      if (parsed?.schemaVersion !== 1) return defaultLocalPlan();
      return {
        ...defaultLocalPlan(),
        ...parsed,
        practice: { ...defaultLocalPlan().practice, ...(parsed.practice ?? {}) },
        notes: parsed.notes && typeof parsed.notes === "object" ? parsed.notes : {}
      };
    } catch {
      return defaultLocalPlan();
    }
  }

  function saveLocalPlan(message) {
    localPlan.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(localPlan));
    const target = byId("gameplan-local-status");
    if (target) target.textContent = message;
  }

  function resetLocalPlan() {
    localStorage.removeItem(STORAGE_KEY);
    localPlan = defaultLocalPlan();
    if (currentSnapshot) renderAll(currentSnapshot);
    const target = byId("gameplan-local-status");
    if (target) target.textContent = "Local checklist and matchup notes reset. No franchise data changed.";
  }

  function ensureMarkup(attempt = 0) {
    const weeklyOps = byId("weeklyops");
    if (!weeklyOps) {
      if (attempt < 120) setTimeout(() => ensureMarkup(attempt + 1), 50);
      return null;
    }

    if (!byId("wo-gameplan-lab")) {
      const opponentRoom = byId("wo-opponent-room");
      const fallback = byId("wo-opponent")?.closest(".wo-two-column") ?? byId("wo-opponent")?.closest("article");
      const anchor = opponentRoom ?? fallback ?? weeklyOps.querySelector(".wo-metrics");
      const section = document.createElement("section");
      section.id = "wo-gameplan-lab";
      section.className = "gameplan-lab-shell";
      section.innerHTML = `
        <section class="gameplan-lab-hero panel">
          <div>
            <div class="eyebrow">Weekly Ops • Read-only preparation surface</div>
            <h2>Weekly Gameplan Lab Lite</h2>
            <p>Organize authoritative Week Three facts, Baltimore scouting evidence, unresolved questions and browser-local preparation notes without creating an official coaching plan.</p>
          </div>
          <div class="gameplan-lab-boundary">
            <strong>Planning, not approval</strong>
            <span>No Supabase writes, no personnel actions, no medical decisions and no invented Kevin Dorey choices.</span>
          </div>
        </section>

        <section id="gameplan-readiness" class="gameplan-readiness" aria-label="Week Three readiness"></section>

        <section class="gameplan-legend panel" aria-label="Evidence legend">
          <span class="gameplan-evidence fact">Authoritative fact</span>
          <span class="gameplan-evidence scouting">Scouting observation</span>
          <span class="gameplan-evidence unknown">Unknown / unresolved</span>
          <span class="gameplan-evidence local">Browser-local note</span>
        </section>

        <section class="panel gameplan-section">
          <div class="section-head"><div><h2>Matchup Plan Board</h2><p>Evidence-backed prompts only. Any Archers response remains unapproved unless authoritative data explicitly records it.</p></div><span id="gameplan-plan-status" class="pill warn">No authoritative plan recorded</span></div>
          <div id="gameplan-plan-board" class="gameplan-plan-board"></div>
        </section>

        <section class="panel gameplan-section">
          <div class="section-head"><div><h2>Key Matchup Cards</h2><p>Position-group pairings avoid false one-to-one assignments when alignment is uncertain.</p></div></div>
          <div id="gameplan-matchups" class="gameplan-matchup-grid"></div>
        </section>

        <section class="panel gameplan-section gameplan-practice-section">
          <div class="section-head"><div><h2>Practice Emphasis Planner</h2><p>Selections are stored only in this browser and never represent an official coaching decision.</p></div><span class="pill local">Local • non-canon</span></div>
          <div id="gameplan-practice" class="gameplan-practice-grid"></div>
          <div class="gameplan-local-footer">
            <span id="gameplan-local-status" aria-live="polite">Local checklist ready.</span>
            <button id="gameplan-local-reset" type="button" class="gameplan-reset-button">Reset local planning data</button>
          </div>
        </section>

        <section class="panel gameplan-section">
          <div class="section-head"><div><h2>Pre-game Decision Gate</h2><p>Unresolved recorded items that may need attention before kickoff. No deadlines are invented.</p></div><span id="gameplan-gate-count" class="pill warn">Checking</span></div>
          <div id="gameplan-decision-gate" class="gameplan-decision-gate"></div>
        </section>

        <section class="panel gameplan-safety-note">
          <strong>Safety boundary</strong>
          <span>This lab is read-only. Local checkmarks and notes are planning aids, not Kevin Dorey dialogue, commitments, approvals or canon actions.</span>
        </section>`;
      anchor?.insertAdjacentElement("afterend", section);
      if (!anchor) weeklyOps.append(section);
      bindInteractions(section);
    }

    ensureOpponentLink();
    return byId("wo-gameplan-lab");
  }

  function ensureOpponentLink() {
    const room = byId("wo-opponent-room");
    if (!room || room.querySelector("[data-open-gameplan-lab]")) return;
    const host = room.querySelector(".opponent-room-badges") ?? room.querySelector(".opponent-room-head");
    if (!host) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "opponent-text-button gameplan-open-button";
    button.dataset.openGameplanLab = "true";
    button.textContent = "Open Gameplan Lab";
    button.addEventListener("click", openLab);
    host.append(button);
  }

  function bindInteractions(root) {
    root.addEventListener("change", (event) => {
      const checkbox = event.target.closest?.("[data-practice-item]");
      if (!checkbox) return;
      localPlan.practice[checkbox.dataset.practiceItem] = Boolean(checkbox.checked);
      saveLocalPlan(`${checkbox.checked ? "Selected" : "Cleared"} ${checkbox.dataset.practiceLabel}. Local non-canon only.`);
      renderPractice();
    });
    root.addEventListener("input", (event) => {
      const note = event.target.closest?.("[data-matchup-note]");
      if (!note) return;
      localPlan.notes[note.dataset.matchupNote] = note.value;
      saveLocalPlan("Browser-local matchup note saved. No franchise write occurred.");
    });
    byId("gameplan-local-reset")?.addEventListener("click", resetLocalPlan);
  }

  function openLab() {
    APP.routeTo("weeklyops");
    ensureMarkup();
    byId("wo-gameplan-lab")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function normalizeDecision(item, index) {
    return {
      id: String(item?.decision_id ?? item?.id ?? `decision-${index + 1}`),
      title: String(item?.title ?? item?.name ?? item?.decision ?? `Decision ${index + 1}`),
      summary: String(item?.summary ?? item?.note ?? item?.description ?? item?.decision_question ?? ""),
      category: upper(item?.category, "OTHER"),
      status: upper(item?.status, "OPEN"),
      approvalOwner: String(item?.approval_owner ?? ""),
      dueWeek: item?.due_week ?? null,
      deadline: String(item?.deadline_label ?? item?.deadline ?? item?.due_date ?? "")
    };
  }

  function buildSnapshot(input = {}) {
    const stateRow = input.stateRow ?? input.state ?? null;
    const state = stateRow?.state ?? input.franchiseState ?? {};
    const players = asArray(input.players);
    const decisionResource = input.decisionQueue ?? input.decisionResource ?? null;
    const decisions = asArray(decisionResource?.data?.decisions ?? decisionResource?.decisions)
      .map(normalizeDecision)
      .filter((item) => OPEN_STATUSES.has(item.status));
    const opponentRows = asArray(input.opponentRows);
    const opponentByType = new Map(opponentRows.map((row) => [row.resource_type, row.data ?? {}]));
    const missingOpponentResources = RESOURCE_SPECS
      .filter(([type]) => !opponentByType.has(type))
      .map(([type]) => type);

    return {
      stateRow,
      state,
      players,
      decisions,
      decisionResource,
      opponentRows,
      opponentByType,
      missingOpponentResources,
      identity: opponentByType.get("team_identity") ?? null,
      staff: opponentByType.get("team_staff") ?? null,
      opponentRoster: opponentByType.get("team_roster") ?? null,
      depth: opponentByType.get("team_depth_chart") ?? null,
      scouting: opponentByType.get("opponent_scouting") ?? null
    };
  }

  function playerName(player) {
    return String(player?.data?.player_name ?? player?.data?.name ?? player?.resource_id ?? "Unknown player");
  }

  function playerPosition(player) {
    return upper(player?.data?.position_code ?? player?.data?.position);
  }

  function activePlayers(snapshot) {
    return snapshot.players.filter((player) => upper(player?.data?.roster_status) === "ACTIVE_ROSTER");
  }

  function medicalEntries(snapshot) {
    const entries = [
      ...asArray(snapshot.state?.medical ?? snapshot.state?.availability?.medical),
      ...asArray(snapshot.identity?.known_availability)
    ];
    const seen = new Set();
    return entries.filter((item) => {
      const key = normalize(`${item?.player_id ?? item?.player_resource_id ?? item?.player_name ?? item?.name} ${item?.issue ?? item?.injury ?? item?.diagnosis}`);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function medicalMatchesPlayer(item, player) {
    const itemId = normalize(item?.resource_id ?? item?.player_resource_id ?? item?.player_id);
    const itemName = normalize(item?.player_name ?? item?.name);
    const playerId = normalize(player?.resource_id);
    const name = normalize(playerName(player));
    return Boolean((itemId && itemId === playerId) || (itemName && itemName === name));
  }

  function medicalStatusText(item) {
    return String(
      item?.availability
      ?? item?.status
      ?? item?.designation
      ?? item?.medical_status
      ?? item?.resolution
      ?? "Unknown"
    );
  }

  function isExplicitMedicalResolution(value) {
    const text = normalize(value);
    return /\b(cleared|available|full participant|resolved|out|injured reserve|ir|inactive)\b/.test(text)
      && !/\b(questionable|unknown|pending|unresolved|limited|monitor|game time)\b/.test(text);
  }

  function damonKirklandStatus(snapshot) {
    const damon = snapshot.players.find((player) => normalize(playerName(player)) === "damon kirkland") ?? null;
    const medical = medicalEntries(snapshot).find((item) => {
      if (damon && medicalMatchesPlayer(item, damon)) return true;
      return normalize(item?.player_name ?? item?.name) === "damon kirkland";
    }) ?? null;
    const status = medicalStatusText(medical);
    const issue = String(medical?.issue ?? medical?.injury ?? medical?.diagnosis ?? "Knee status");
    const resolved = Boolean(medical && isExplicitMedicalResolution(status));
    return {
      player: damon,
      medical,
      status: resolved ? status : (medical ? `${status} • unresolved` : "Unknown • unresolved"),
      issue,
      resolved,
      detail: resolved
        ? `Authoritative medical entry: ${status}.`
        : medical
          ? `The recorded ${issue.toLowerCase()} entry does not establish a final availability decision.`
          : "No authoritative knee clearance or availability designation is recorded."
    };
  }

  function gameAffectingDecision(decision) {
    const categoryMatch = ["GAME_PLAN", "LINEUP", "MEDICAL", "AVAILABILITY", "PRACTICE", "SPECIAL_TEAMS", "DEPTH_CHART"].includes(decision.category);
    const text = normalize(`${decision.title} ${decision.summary}`);
    const textMatch = /\b(game plan|gameplan|protection|lineup|depth chart|starter|kickoff|baltimore|kirkland|availability|special teams|practice)\b/.test(text);
    return categoryMatch || textMatch;
  }

  function authoritativeOpponentName(snapshot) {
    return String(
      snapshot.state?.opponent?.name
      ?? snapshot.state?.opponent?.team_name
      ?? snapshot.identity?.team_name
      ?? snapshot.identity?.name
      ?? "Opponent unavailable"
    );
  }

  function authoritativeWeek(snapshot) {
    return snapshot.state?.timeline?.week ?? snapshot.scouting?.week ?? snapshot.depth?.week ?? null;
  }

  function preparationStatus(snapshot) {
    return snapshot.state?.preparation_status
      ?? snapshot.state?.game_status
      ?? snapshot.state?.opponent?.preparation_status
      ?? snapshot.state?.opponent?.game_status
      ?? snapshot.state?.opponent?.status
      ?? snapshot.state?.timeline?.status
      ?? null;
  }

  function renderReadiness(snapshot) {
    const target = byId("gameplan-readiness");
    if (!target) return;
    const active = activePlayers(snapshot);
    const medical = medicalEntries(snapshot);
    const knownInjuries = medical.filter((item) => item?.issue || item?.injury || item?.diagnosis);
    const unresolvedMedical = medical.filter((item) => !isExplicitMedicalResolution(medicalStatusText(item)));
    const damon = damonKirklandStatus(snapshot);
    const gameDecisions = snapshot.decisions.filter(gameAffectingDecision);
    const status = preparationStatus(snapshot);
    const injuryNames = knownInjuries.map((item) => item?.player_name ?? item?.name).filter(Boolean);

    target.innerHTML = `
      <article class="gameplan-readiness-card"><span>Current week</span><strong>${authoritativeWeek(snapshot) == null ? "Unknown" : `Week ${escapeHtml(authoritativeWeek(snapshot))}`}</strong><small>${escapeHtml(snapshot.state?.timeline?.day ?? "Preparation day not recorded")}</small></article>
      <article class="gameplan-readiness-card"><span>Current opponent</span><strong>${escapeHtml(authoritativeOpponentName(snapshot))}</strong><small>${escapeHtml(status ?? "Preparation status not recorded")}</small></article>
      <article class="gameplan-readiness-card"><span>Archers active roster</span><strong>${escapeHtml(active.length)}</strong><small>Derived from active player resources</small></article>
      <article class="gameplan-readiness-card"><span>Known injuries</span><strong>${escapeHtml(knownInjuries.length)}</strong><small>${escapeHtml(injuryNames.length ? injuryNames.join(", ") : "No authoritative injury entries")}</small></article>
      <article class="gameplan-readiness-card ${damon.resolved ? "" : "warn"}"><span>Unresolved medical</span><strong>${escapeHtml(Math.max(unresolvedMedical.length, damon.resolved ? 0 : 1))}</strong><small>Damon Kirkland: ${escapeHtml(damon.status)}</small></article>
      <article class="gameplan-readiness-card ${gameDecisions.length ? "warn" : ""}"><span>Game-affecting decisions</span><strong>${escapeHtml(gameDecisions.length)}</strong><small>${escapeHtml(gameDecisions.length ? gameDecisions.map((item) => item.title).join(" • ") : "No qualifying open decisions recorded")}</small></article>
      <article class="gameplan-readiness-card"><span>Global state</span><strong>v${escapeHtml(snapshot.stateRow?.version ?? "Unknown")}</strong><small>Last authoritative version loaded</small></article>`;
  }

  function evidenceRow(kind, label, text) {
    return `<div class="gameplan-evidence-row ${kind}"><span>${escapeHtml(label)}</span><p>${escapeHtml(text)}</p></div>`;
  }

  function firstRecorded(values, fallback) {
    return values.map((value) => String(value ?? "").trim()).find(Boolean) ?? fallback;
  }

  function recordedPlanSection(snapshot, keys) {
    const source = snapshot.state?.weekly_gameplan ?? snapshot.state?.gameplan ?? snapshot.state?.coaching_plan ?? null;
    if (!source || typeof source !== "object") return null;
    for (const key of keys) {
      if (source[key] != null) return source[key];
    }
    return null;
  }

  function planCard(title, facts, observations, unknowns, recordedPlan) {
    const planText = typeof recordedPlan === "string"
      ? recordedPlan
      : recordedPlan?.summary ?? recordedPlan?.status ?? null;
    return `<article class="gameplan-plan-card">
      <h3>${escapeHtml(title)}</h3>
      <div class="gameplan-plan-evidence">
        ${facts.map((item) => evidenceRow("fact", "Authoritative fact", item)).join("")}
        ${observations.map((item) => evidenceRow("scouting", "Scouting observation", item)).join("")}
        ${unknowns.map((item) => evidenceRow("unknown", "Unknown / unresolved", item)).join("")}
        ${planText
          ? evidenceRow("fact", "Recorded Archers plan", planText)
          : evidenceRow("unknown", "Archers response", "No authoritative plan recorded. Staff review remains required.")}
      </div>
    </article>`;
  }

  function renderPlanBoard(snapshot) {
    const target = byId("gameplan-plan-board");
    if (!target) return;
    const scouting = snapshot.scouting ?? {};
    const identity = snapshot.identity ?? {};
    const depth = snapshot.depth ?? {};
    const defensiveTendencies = asArray(scouting.defensive_tendencies);
    const offensiveTendencies = asArray(scouting.offensive_tendencies);
    const situational = [...defensiveTendencies, ...offensiveTendencies]
      .filter((item) => /third|red zone|two minute|late|goal|short yardage|fourth/i.test(String(item?.situation)))
      .slice(0, 3);
    const specialRoles = asArray(depth.special_teams).map((row) => row?.role).filter(Boolean);
    const missing = snapshot.missingOpponentResources;

    const defensiveIntent = String(identity.defensive_identity?.core_intent ?? "").trim();
    const offensiveIntent = String(identity.offensive_identity?.core_intent ?? "").trim();
    const prepStatus = preparationStatus(snapshot);
    const cards = [
      planCard(
        "When the Archers have the ball",
        defensiveIntent ? [defensiveIntent] : [],
        defensiveTendencies.slice(0, 2).map((item) => `${pretty(item.situation)}: ${item.tendency}`),
        [
          ...(!defensiveIntent ? ["Baltimore defensive identity is unavailable."] : []),
          ...(!defensiveTendencies.length ? ["No authoritative Baltimore defensive tendency entries are available."] : []),
          ...(missing.length ? [`Opponent package incomplete: ${missing.join(", ")}.`] : [])
        ],
        recordedPlanSection(snapshot, ["offense", "archers_offense", "when_archers_have_ball"])
      ),
      planCard(
        "When Baltimore has the ball",
        offensiveIntent ? [offensiveIntent] : [],
        offensiveTendencies.slice(0, 2).map((item) => `${pretty(item.situation)}: ${item.tendency}`),
        [
          ...(!offensiveIntent ? ["Baltimore offensive identity is unavailable."] : []),
          ...(!offensiveTendencies.length ? ["No authoritative Baltimore offensive tendency entries are available."] : []),
          ...(missing.length ? [`Opponent package incomplete: ${missing.join(", ")}.`] : [])
        ],
        recordedPlanSection(snapshot, ["defense", "archers_defense", "when_baltimore_has_ball"])
      ),
      planCard(
        "Special teams",
        specialRoles.length ? [`Baltimore projected roles: ${specialRoles.join(", ")}.`] : [],
        [],
        [
          ...(!specialRoles.length ? ["Baltimore special-teams depth is not available."] : []),
          ...(snapshot.depth ? asArray(snapshot.depth.unresolved).filter((item) => /special|kick|punt|return/i.test(String(item))) : ["Projected special-teams assignments are unavailable."])
        ],
        recordedPlanSection(snapshot, ["special_teams", "specialTeams"])
      ),
      planCard(
        "Situational football",
        prepStatus ? [String(prepStatus)] : [],
        situational.map((item) => `${pretty(item.situation)}: ${item.tendency}`),
        [
          ...(!prepStatus ? ["Game or preparation status is not recorded."] : []),
          ...(!situational.length ? ["No authoritative situational tendency entries are available."] : [])
        ],
        recordedPlanSection(snapshot, ["situational", "situational_football"])
      )
    ];

    target.innerHTML = cards.join("");
    const hasRecordedPlan = Boolean(snapshot.state?.weekly_gameplan ?? snapshot.state?.gameplan ?? snapshot.state?.coaching_plan);
    const badge = byId("gameplan-plan-status");
    if (badge) {
      badge.className = `pill ${hasRecordedPlan ? "good" : "warn"}`;
      badge.textContent = hasRecordedPlan ? "Authoritative plan data present" : "No authoritative plan recorded";
    }
  }

  function statusOrUnknown(value, fallback) {
    return value == null || String(value).trim() === "" ? fallback : String(value);
  }

  function opponentPlayerLookup(snapshot) {
    return new Map([
      ...asArray(snapshot.opponentRoster?.active_roster),
      ...asArray(snapshot.opponentRoster?.practice_squad)
    ].map((player) => [String(player.player_id), player]));
  }

  function opponentDepthPlayers(snapshot, unit, rolePattern) {
    const lookup = opponentPlayerLookup(snapshot);
    return asArray(snapshot.depth?.[unit])
      .filter((row) => rolePattern.test(String(row?.role ?? "")))
      .flatMap((row) => asArray(row?.players).map((id) => lookup.get(String(id))).filter(Boolean));
  }

  function archersGroup(snapshot, positions) {
    const allowed = new Set(positions.map(upper));
    return activePlayers(snapshot).filter((player) => allowed.has(playerPosition(player)));
  }

  function groupLabel(players, limit = 6) {
    if (!players.length) return "No authoritative players resolved";
    const names = players.slice(0, limit).map((player) => {
      const name = player.player_name ?? playerName(player);
      const position = player.position ?? playerPosition(player);
      return `${name}${position ? ` (${position})` : ""}`;
    });
    return `${names.join(", ")}${players.length > limit ? ` +${players.length - limit} more` : ""}`;
  }

  function scoutingMatch(snapshot, patterns) {
    const items = asArray(snapshot.scouting?.matchup_board);
    const match = items.find((item) => patterns.some((pattern) => pattern.test(String(item?.matchup ?? ""))));
    if (match) return `${match.matchup}: ${match.archers_path ?? match.observation ?? "Recorded matchup entry"}`;
    const threat = asArray(snapshot.scouting?.key_threats).find((item) => patterns.some((pattern) => pattern.test(String(item?.reason ?? ""))));
    return threat ? String(threat.reason) : null;
  }

  function matchupCard(id, title, archers, baltimore, observation, unresolved) {
    return `<article class="gameplan-matchup-card" data-matchup-card="${escapeHtml(id)}">
      <div class="gameplan-matchup-heading"><h3>${escapeHtml(title)}</h3><span class="pill">Group matchup</span></div>
      ${evidenceRow("fact", "Authoritative fact", `Archers active group: ${groupLabel(archers)}.`)}
      ${evidenceRow("fact", "Authoritative fact", `Baltimore projected group: ${groupLabel(baltimore)}.`)}
      ${observation
        ? evidenceRow("scouting", "Scouting observation", observation)
        : evidenceRow("unknown", "Scouting observation", "No directly matching scouting observation is recorded.")}
      ${evidenceRow("unknown", "Unknown / unresolved", unresolved || "Exact one-to-one assignments and alignments are not authoritative.")}
      <label class="gameplan-local-note"><span>Browser-local planning note</span><textarea data-matchup-note="${escapeHtml(id)}" maxlength="500" placeholder="Local note only; not an official plan">${escapeHtml(localPlan.notes[id] ?? "")}</textarea></label>
    </article>`;
  }

  function renderMatchups(snapshot) {
    const target = byId("gameplan-matchups");
    if (!target) return;
    const depthUnresolved = asArray(snapshot.depth?.unresolved).map(String);
    const matchups = [
      matchupCard(
        "archers-ot-vs-baltimore-edge",
        "Archers offensive tackles vs. Baltimore edge defenders",
        archersGroup(snapshot, ["LT", "RT", "OT"]),
        opponentDepthPlayers(snapshot, "defense", /EDGE|END|DE|OLB/i),
        scoutingMatch(snapshot, [/tackle/i, /edge/i, /protection/i]),
        depthUnresolved.find((item) => /edge|front|rush/i.test(item))
      ),
      matchupCard(
        "archers-receivers-vs-baltimore-coverage",
        "Archers receivers vs. Baltimore coverage personnel",
        archersGroup(snapshot, ["WR", "TE", "WR-PR", "WR-KR", "TE-HB"]),
        opponentDepthPlayers(snapshot, "defense", /CB|CORNER|NICKEL|SAFETY|FS|SS/i),
        scoutingMatch(snapshot, [/receiver/i, /coverage/i, /corner/i]),
        depthUnresolved.find((item) => /corner|nickel|safety|coverage/i.test(item))
      ),
      matchupCard(
        "archers-front-vs-baltimore-ol",
        "Archers defensive front vs. Baltimore offensive line",
        archersGroup(snapshot, ["EDGE", "DE", "DT", "NT"]),
        opponentDepthPlayers(snapshot, "offense", /LT|LG|CENTER|\bC\b|RG|RT|TACKLE|GUARD|OL/i),
        scoutingMatch(snapshot, [/front/i, /offensive line/i, /run fit/i]),
        depthUnresolved.find((item) => /line|tackle|guard|center/i.test(item))
      ),
      matchupCard(
        "archers-coverage-vs-baltimore-threats",
        "Archers coverage personnel vs. Baltimore receiving threats",
        archersGroup(snapshot, ["CB", "NB", "FS", "SS", "S", "LB", "MLB", "OLB"]),
        receivingThreats(snapshot),
        scoutingMatch(snapshot, [/coverage/i, /receiver/i, /tight end/i, /passing/i]),
        depthUnresolved.find((item) => /receiver|tight end|back|slot/i.test(item))
      )
    ];
    target.innerHTML = matchups.join("");
  }

  function receivingThreats(snapshot) {
    const lookup = opponentPlayerLookup(snapshot);
    const threats = asArray(snapshot.scouting?.key_threats)
      .map((item) => lookup.get(String(item?.player_id)))
      .filter((player) => player && /WR|TE|RB|FB/i.test(String(player.position)));
    if (threats.length) return threats;
    return opponentDepthPlayers(snapshot, "offense", /WR|RECEIVER|TE|TIGHT END|RB|BACK/i);
  }

  function renderPractice() {
    const target = byId("gameplan-practice");
    if (!target) return;
    target.innerHTML = PRACTICE_ITEMS.map(([id, label]) => `
      <label class="gameplan-practice-item ${localPlan.practice[id] ? "selected" : ""}">
        <input type="checkbox" data-practice-item="${escapeHtml(id)}" data-practice-label="${escapeHtml(label)}" ${localPlan.practice[id] ? "checked" : ""}>
        <span><strong>${escapeHtml(label)}</strong><small>Browser-local • non-canon</small></span>
      </label>`).join("");
    const selected = Object.values(localPlan.practice).filter(Boolean).length;
    const status = byId("gameplan-local-status");
    if (status) status.textContent = `${selected} of ${PRACTICE_ITEMS.length} local emphasis items selected.`;
  }

  function gateDecisionType(decision) {
    const text = normalize(`${decision.category} ${decision.title} ${decision.summary}`);
    if (/protection|pass pro|blocking/.test(text)) return "Open protection decision";
    if (/lineup|depth chart|starter|starting/.test(text)) return "Open lineup decision";
    if (decision.status === "AWAITING_KEVIN" || normalize(decision.approvalOwner) === "kevin dorey") return "Staff recommendation awaiting Kevin Dorey";
    return "Open game-affecting decision";
  }

  function renderDecisionGate(snapshot) {
    const target = byId("gameplan-decision-gate");
    const badge = byId("gameplan-gate-count");
    if (!target || !badge) return;
    const items = [];
    const damon = damonKirklandStatus(snapshot);
    if (!damon.resolved) {
      items.push({ type: "Unresolved medical question", title: "Damon Kirkland knee status", detail: damon.detail, kind: "unknown" });
    }

    snapshot.decisions.filter(gameAffectingDecision).forEach((decision) => {
      const deadline = decision.deadline || (decision.dueWeek != null ? `Due Week ${decision.dueWeek}` : "No recorded deadline");
      items.push({ type: gateDecisionType(decision), title: decision.title, detail: `${decision.summary || "No additional context recorded."} • ${deadline}`, kind: "fact" });
    });

    if (!snapshot.depth) {
      items.push({ type: "Missing depth-chart confirmation", title: "Baltimore projected depth chart unavailable", detail: "The authoritative team_depth_chart resource is missing.", kind: "unknown" });
    } else {
      asArray(snapshot.depth.unresolved).forEach((item) => {
        items.push({ type: "Unresolved Baltimore information", title: "Projected depth question", detail: String(item), kind: "unknown" });
      });
    }

    snapshot.missingOpponentResources
      .filter((type) => type !== "team_depth_chart")
      .forEach((type) => {
        items.push({ type: "Unresolved Baltimore information", title: pretty(type), detail: "Authoritative resource is unavailable; no substitute assumption was generated.", kind: "unknown" });
      });

    badge.className = `pill ${items.length ? "warn" : "good"}`;
    badge.textContent = items.length ? `${items.length} unresolved` : "Gate clear";
    target.innerHTML = items.length
      ? items.map((item) => `<article class="gameplan-gate-item ${item.kind}"><span>${escapeHtml(item.type)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p></article>`).join("")
      : '<div class="gameplan-empty-state"><strong>No qualifying pre-game items are recorded.</strong><span>The gate is clear based only on the authoritative data currently loaded.</span></div>';
  }

  function renderAll(snapshot) {
    ensureMarkup();
    renderReadiness(snapshot);
    renderPlanBoard(snapshot);
    renderMatchups(snapshot);
    renderPractice();
    renderDecisionGate(snapshot);
    window.dispatchEvent(new CustomEvent("archers:gameplan-lab-rendered", {
      detail: {
        stateVersion: snapshot.stateRow?.version ?? null,
        week: authoritativeWeek(snapshot),
        opponent: authoritativeOpponentName(snapshot),
        activeRosterCount: activePlayers(snapshot).length,
        missingOpponentResources: [...snapshot.missingOpponentResources],
        localOnly: true
      }
    }));
  }

  async function fetchResource(resourceType, resourceId) {
    const result = await client
      .from("archers_resources")
      .select("resource_type, resource_id, version, data, updated_at")
      .eq("franchise_id", franchiseId)
      .eq("resource_type", resourceType)
      .eq("resource_id", resourceId)
      .eq("status", "ACTIVE")
      .eq("visibility", "CONSOLE")
      .maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  }

  async function readLiveSnapshot() {
    const [stateResult, playersResult, decisionResource, ...opponentResources] = await Promise.all([
      client.from("archers_franchise_state").select("id, version, state, updated_at").eq("id", franchiseId).single(),
      client.from("archers_resources").select("resource_id, version, data, updated_at").eq("franchise_id", franchiseId).eq("resource_type", "player").eq("status", "ACTIVE").eq("visibility", "CONSOLE").order("resource_id"),
      fetchResource("decision_queue", "decision-queue"),
      ...RESOURCE_SPECS.map(([type, id]) => fetchResource(type, id))
    ]);
    if (stateResult.error) throw stateResult.error;
    if (playersResult.error) throw playersResult.error;
    return buildSnapshot({
      stateRow: stateResult.data,
      players: playersResult.data ?? [],
      decisionQueue: decisionResource,
      opponentRows: opponentResources.filter(Boolean)
    });
  }

  async function loadLab() {
    ensureMarkup();
    currentSnapshot = await readLiveSnapshot();
    renderAll(currentSnapshot);
    return currentSnapshot;
  }

  function showError(error) {
    console.error("Weekly Gameplan Lab Lite could not load", error);
    ensureMarkup();
    const readiness = byId("gameplan-readiness");
    if (readiness) readiness.innerHTML = `<div class="gameplan-empty-state bad"><strong>Gameplan Lab data unavailable.</strong><span>${escapeHtml(error?.message ?? error)}</span></div>`;
  }

  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => loadLab().catch(showError), 250);
  }

  function subscribe() {
    if (!client.channel) return;
    if (channel && client.removeChannel) client.removeChannel(channel);
    channel = client.channel("archers-weekly-gameplan-lab-lite-v1")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "archers_franchise_state", filter: `id=eq.${franchiseId}` }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "archers_resources", filter: `franchise_id=eq.${franchiseId}` }, scheduleReload)
      .subscribe();
  }

  function start() {
    ensureMarkup();
    loadLab().then(subscribe).catch(showError);
  }

  window.ArchersWeeklyGameplanLab = Object.freeze({
    storageKey: STORAGE_KEY,
    getSnapshot: () => currentSnapshot ? JSON.parse(JSON.stringify({
      stateVersion: currentSnapshot.stateRow?.version ?? null,
      week: authoritativeWeek(currentSnapshot),
      opponent: authoritativeOpponentName(currentSnapshot),
      activeRosterCount: activePlayers(currentSnapshot).length,
      missingOpponentResources: currentSnapshot.missingOpponentResources,
      localPlan
    })) : null,
    reload: () => loadLab(),
    open: openLab,
    renderSnapshot: (input) => {
      currentSnapshot = buildSnapshot(input);
      renderAll(currentSnapshot);
      return currentSnapshot;
    },
    resetLocal: resetLocalPlan
  });

  if (window.__ARCHERS_GAMEPLAN_LAB_AUTO_START__ !== false) {
    if (document.readyState === "loading") {
      window.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
  } else {
    ensureMarkup();
  }

  window.addEventListener("beforeunload", () => {
    if (channel && client.removeChannel) client.removeChannel(channel);
  });
})();
