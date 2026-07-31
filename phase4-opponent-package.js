(() => {
  const APP = window.ArchersApp;
  if (!APP?.config || !APP?.createSupabaseClient) {
    console.error("Opponent Package requires archers-app-config.js");
    return;
  }

  const client = APP.createSupabaseClient();
  const { franchiseId } = APP.config;
  const RESOURCE_SPECS = [
    ["team_identity", "bal-2026"],
    ["team_staff", "bal-2026"],
    ["team_roster", "bal-2026"],
    ["team_depth_chart", "bal-2026-w03"],
    ["opponent_scouting", "stl-bal-2026-w03"]
  ];

  let packageData = null;
  let reloadTimer = null;
  let channel = null;

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const asArray = (value) => Array.isArray(value) ? value : [];
  const pretty = (value) => String(value ?? "—").replaceAll("_", " ");
  const byId = (id) => document.getElementById(id);

  function statusClass(value) {
    const text = String(value ?? "").toUpperCase();
    if (["URGENT", "CRITICAL", "OUT", "BLOCKED"].some((token) => text.includes(token))) return "bad";
    if (["HIGH", "QUESTIONABLE", "WATCH", "UNRESOLVED"].some((token) => text.includes(token))) return "warn";
    if (["AVAILABLE", "VERIFIED", "READY", "STABLE", "OPPORTUNITY"].some((token) => text.includes(token))) return "good";
    return "";
  }

  function ensureMarkup(attempt = 0) {
    const weeklyOps = byId("weeklyops");
    const snapshot = byId("wo-opponent");
    if (!weeklyOps || !snapshot) {
      if (attempt < 120) setTimeout(() => ensureMarkup(attempt + 1), 50);
      return null;
    }

    if (!byId("wo-opponent-room")) {
      const anchor = snapshot.closest(".wo-two-column") ?? snapshot.closest("article") ?? snapshot;
      const section = document.createElement("section");
      section.id = "wo-opponent-room";
      section.className = "panel wo-full-section opponent-room";
      section.innerHTML = `
        <div class="opponent-room-head">
          <div>
            <div class="eyebrow">Week Three • Baltimore Admirals</div>
            <h2>Opponent Command Room</h2>
            <p id="opponent-room-summary">Connecting the roster, staff, depth chart and scouting dossier…</p>
          </div>
          <div class="opponent-room-badges">
            <span id="opponent-room-record" class="pill">2-0</span>
            <span id="opponent-room-status" class="pill warn">Loading</span>
          </div>
        </div>
        <nav class="opponent-subnav" aria-label="Baltimore opponent sections">
          <button type="button" class="opponent-subnav-button active" data-opponent-view="overview">Overview</button>
          <button type="button" class="opponent-subnav-button" data-opponent-view="coaches">Coaches</button>
          <button type="button" class="opponent-subnav-button" data-opponent-view="depth">Depth Chart</button>
          <button type="button" class="opponent-subnav-button" data-opponent-view="roster">Roster</button>
          <button type="button" class="opponent-subnav-button" data-opponent-view="scouting">Scouting</button>
        </nav>
        <div class="opponent-view active" data-opponent-panel="overview"><div class="opponent-loading">Loading team identity…</div></div>
        <div class="opponent-view" data-opponent-panel="coaches"><div class="opponent-loading">Loading coaching staff…</div></div>
        <div class="opponent-view" data-opponent-panel="depth"><div class="opponent-loading">Loading depth chart…</div></div>
        <div class="opponent-view" data-opponent-panel="roster"><div class="opponent-loading">Loading roster…</div></div>
        <div class="opponent-view" data-opponent-panel="scouting"><div class="opponent-loading">Loading scouting dossier…</div></div>`;
      anchor.insertAdjacentElement("afterend", section);

      section.querySelectorAll("[data-opponent-view]").forEach((button) => {
        button.addEventListener("click", () => activateView(button.dataset.opponentView));
      });
    }

    enhanceSnapshot();
    return byId("wo-opponent-room");
  }

  function enhanceSnapshot() {
    const target = byId("wo-opponent");
    if (!target || target.querySelector("[data-open-opponent-room]")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wo-review-button opponent-open-button";
    button.dataset.openOpponentRoom = "true";
    button.textContent = "Open Full Baltimore Dossier";
    button.addEventListener("click", () => {
      activateView("overview");
      byId("wo-opponent-room")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    target.append(button);
  }

  function activateView(view) {
    const room = byId("wo-opponent-room");
    if (!room) return;
    room.querySelectorAll("[data-opponent-view]").forEach((button) => {
      button.classList.toggle("active", button.dataset.opponentView === view);
      button.setAttribute("aria-selected", String(button.dataset.opponentView === view));
    });
    room.querySelectorAll("[data-opponent-panel]").forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.opponentPanel === view);
    });
    localStorage.setItem("archers-opponent-room-view", view);
  }

  function playerLookup(roster) {
    return new Map([...asArray(roster?.active_roster), ...asArray(roster?.practice_squad)].map((player) => [player.player_id, player]));
  }

  function playerLabel(player, options = {}) {
    if (!player) return "Unknown player";
    const rating = options.rating === false || player.overall_rating == null ? "" : ` • ${player.overall_rating} OVR`;
    return `${player.player_name} • ${player.position}${rating}`;
  }

  function renderOverview(identity, roster, depth, scouting) {
    const target = document.querySelector('[data-opponent-panel="overview"]');
    if (!target) return;
    const availability = asArray(identity.known_availability);
    const threats = asArray(scouting.key_threats).slice(0, 5);
    const lookup = playerLookup(roster);

    target.innerHTML = `
      <div class="opponent-overview-grid">
        <article class="opponent-card opponent-identity-card">
          <div class="opponent-card-heading"><h3>Team Identity</h3><span class="pill good">${escapeHtml(identity.competitive_window ?? "Established")}</span></div>
          <p class="opponent-lead">${escapeHtml(identity.organizational_summary)}</p>
          <div class="opponent-trait-row">${asArray(identity.culture_traits).map((trait) => `<span>${escapeHtml(pretty(trait))}</span>`).join("")}</div>
          <dl class="opponent-facts">
            <div><dt>General Manager</dt><dd>${escapeHtml(identity.general_manager)}</dd></div>
            <div><dt>Head Coach</dt><dd>${escapeHtml(identity.head_coach)}</dd></div>
            <div><dt>Offense</dt><dd>${escapeHtml(identity.offensive_identity?.name)}</dd></div>
            <div><dt>Defense</dt><dd>${escapeHtml(identity.defensive_identity?.name)}</dd></div>
          </dl>
        </article>
        <article class="opponent-card">
          <div class="opponent-card-heading"><h3>Game Status</h3><span class="pill ${statusClass(availability[0]?.status)}">${escapeHtml(availability[0]?.status ?? "No flags")}</span></div>
          ${availability.map((item) => `
            <div class="opponent-alert">
              <strong>${escapeHtml(item.player_name)} • ${escapeHtml(item.position)}</strong>
              <span>${escapeHtml(item.issue)}</span>
            </div>`).join("") || '<div class="opponent-empty">No known Baltimore availability items.</div>'}
          <div class="opponent-roster-counts">
            <div><strong>${escapeHtml(roster.active_count)}</strong><span>Active roster</span></div>
            <div><strong>${escapeHtml(roster.practice_squad_count)}</strong><span>Practice squad</span></div>
            <div><strong>${escapeHtml(asArray(roster.captains).length)}</strong><span>Captains</span></div>
          </div>
        </article>
      </div>
      <div class="opponent-overview-grid opponent-overview-lower">
        <article class="opponent-card">
          <div class="opponent-card-heading"><h3>Offensive Operating System</h3><span class="pill">${escapeHtml(identity.offensive_identity?.tempo)}</span></div>
          <p>${escapeHtml(identity.offensive_identity?.core_intent)}</p>
          <div class="opponent-tag-groups"><div><b>Personnel</b>${asArray(identity.offensive_identity?.base_personnel).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div><div><b>Run family</b>${asArray(identity.offensive_identity?.run_game).map((item) => `<span>${escapeHtml(pretty(item))}</span>`).join("")}</div></div>
        </article>
        <article class="opponent-card">
          <div class="opponent-card-heading"><h3>Defensive Operating System</h3><span class="pill">Pressure disguise</span></div>
          <p>${escapeHtml(identity.defensive_identity?.core_intent)}</p>
          <div class="opponent-tag-groups"><div><b>Coverage</b>${asArray(identity.defensive_identity?.coverage_family).map((item) => `<span>${escapeHtml(pretty(item))}</span>`).join("")}</div><div><b>Pressure</b>${asArray(identity.defensive_identity?.pressure_tools).map((item) => `<span>${escapeHtml(pretty(item))}</span>`).join("")}</div></div>
        </article>
      </div>
      <article class="opponent-card opponent-threat-strip">
        <div class="opponent-card-heading"><h3>Five Players Driving the Week</h3><button type="button" class="opponent-text-button" data-jump-scouting>Open scouting board</button></div>
        <div class="opponent-threat-grid">${threats.map((threat) => {
          const player = lookup.get(threat.player_id);
          return `<div class="opponent-threat"><span class="pill ${statusClass(threat.priority)}">${escapeHtml(threat.priority)}</span><strong>${escapeHtml(playerLabel(player))}</strong><p>${escapeHtml(threat.reason)}</p></div>`;
        }).join("")}</div>
      </article>`;

    target.querySelector("[data-jump-scouting]")?.addEventListener("click", () => activateView("scouting"));
  }

  function renderCoaches(staffResource) {
    const target = document.querySelector('[data-opponent-panel="coaches"]');
    if (!target) return;
    const staff = asArray(staffResource.staff);
    const leaders = staff.filter((item) => ["General Manager", "Head Coach", "Offensive Coordinator", "Defensive Coordinator", "Special Teams Coordinator"].includes(item.job));
    const assistants = staff.filter((item) => !leaders.includes(item));
    const card = (person, large = false) => `
      <article class="opponent-staff-card ${large ? "featured" : ""}">
        <div class="opponent-staff-top"><div><span>${escapeHtml(person.department)}</span><h3>${escapeHtml(person.name)}</h3><b>${escapeHtml(person.job)}</b></div><span class="pill">Year ${escapeHtml(person.years_with_team)}</span></div>
        <p>${escapeHtml(person.profile)}</p>
        <dl><div><dt>Decision lens</dt><dd>${escapeHtml(person.decision_lens)}</dd></div><div><dt>Voice</dt><dd>${escapeHtml(person.voice)}</dd></div></dl>
      </article>`;

    target.innerHTML = `
      <div class="opponent-section-intro"><div><h3>Leadership and Coordinators</h3><p>Established roles and portrayal notes for Baltimore scenes.</p></div><span class="pill good">${staff.length} staff profiles</span></div>
      <div class="opponent-staff-grid featured-grid">${leaders.map((person) => card(person, true)).join("")}</div>
      <div class="opponent-section-intro"><div><h3>Position and Performance Staff</h3><p>Current staff responsible for the weekly plan and player development.</p></div></div>
      <div class="opponent-staff-grid">${assistants.map((person) => card(person)).join("")}</div>`;
  }

  function renderDepth(depth, roster) {
    const target = document.querySelector('[data-opponent-panel="depth"]');
    if (!target) return;
    const lookup = playerLookup(roster);
    const unitTable = (title, rows) => `
      <article class="opponent-card opponent-depth-card">
        <div class="opponent-card-heading"><h3>${escapeHtml(title)}</h3><span class="pill">Projected Week 3</span></div>
        <div class="table-wrap"><table class="opponent-depth-table"><thead><tr><th>Role</th><th>First</th><th>Second</th><th>Additional / Note</th></tr></thead><tbody>
          ${asArray(rows).map((row) => {
            const players = asArray(row.players).map((id) => lookup.get(id));
            return `<tr><td><strong>${escapeHtml(row.role)}</strong></td><td>${escapeHtml(playerLabel(players[0], { rating: false }))}</td><td>${escapeHtml(playerLabel(players[1], { rating: false }))}</td><td>${escapeHtml(row.note ?? (players.slice(2).map((player) => playerLabel(player, { rating: false })).join(" • ") || "—"))}</td></tr>`;
          }).join("")}
        </tbody></table></div>
      </article>`;

    target.innerHTML = `
      <div class="opponent-depth-layout">
        ${unitTable("Offense", depth.offense)}
        ${unitTable("Defense", depth.defense)}
        ${unitTable("Special Teams", depth.special_teams)}
      </div>
      <article class="opponent-card opponent-boundary-card"><div class="opponent-card-heading"><h3>Unresolved Depth Questions</h3><span class="pill warn">Do not assume</span></div>${asArray(depth.unresolved).map((item) => `<p>${escapeHtml(item)}</p>`).join("") || '<p>No unresolved depth questions recorded.</p>'}</article>`;
  }

  function rosterRow(player) {
    return `<details class="opponent-player-row" data-unit="${escapeHtml(player.unit)}" data-status="${escapeHtml(player.roster_status)}" data-player-search="${escapeHtml(`${player.player_name} ${player.position} ${player.football_notes}`.toLowerCase())}">
      <summary><span class="opponent-number">#${escapeHtml(player.jersey_number)}</span><strong>${escapeHtml(player.player_name)}</strong><span>${escapeHtml(player.position)}</span><span>${escapeHtml(player.age)} yrs</span><span>${escapeHtml(player.overall_rating)} OVR</span><span class="pill ${statusClass(player.availability)}">${escapeHtml(pretty(player.role))}</span></summary>
      <div class="opponent-player-detail"><p>${escapeHtml(player.football_notes)}</p><div>${asArray(player.traits).map((trait) => `<span>${escapeHtml(pretty(trait))}</span>`).join("")}</div><small>${escapeHtml(pretty(player.roster_status))} • ${escapeHtml(pretty(player.development_trait))} development • ${escapeHtml(pretty(player.availability))}</small></div>
    </details>`;
  }

  function renderRoster(roster) {
    const target = document.querySelector('[data-opponent-panel="roster"]');
    if (!target) return;
    const active = asArray(roster.active_roster);
    const practice = asArray(roster.practice_squad);
    target.innerHTML = `
      <div class="opponent-roster-tools">
        <div class="opponent-filter-row" role="group" aria-label="Roster filter">
          <button type="button" class="active" data-roster-filter="ALL">All</button>
          <button type="button" data-roster-filter="OFFENSE">Offense</button>
          <button type="button" data-roster-filter="DEFENSE">Defense</button>
          <button type="button" data-roster-filter="SPECIAL_TEAMS">Special Teams</button>
          <button type="button" data-roster-filter="PRACTICE_SQUAD">Practice Squad</button>
        </div>
        <label class="opponent-roster-search"><span>Search</span><input id="opponent-roster-search" type="search" placeholder="Player, position or trait"></label>
      </div>
      <div class="opponent-roster-summary"><span><strong>${active.length}</strong> active</span><span><strong>${practice.length}</strong> practice squad</span><span><strong>${asArray(roster.captains).length}</strong> captains</span><span>Contracts: ${escapeHtml(pretty(roster.contract_data_status))}</span></div>
      <div id="opponent-roster-list" class="opponent-roster-list">${[...active, ...practice].map(rosterRow).join("")}</div>
      <div id="opponent-roster-empty" class="opponent-empty" hidden>No Baltimore players match this filter.</div>`;

    const buttons = target.querySelectorAll("[data-roster-filter]");
    const search = byId("opponent-roster-search");
    let filter = "ALL";
    const apply = () => {
      const needle = String(search?.value ?? "").trim().toLowerCase();
      let visible = 0;
      target.querySelectorAll(".opponent-player-row").forEach((row) => {
        const unitMatch = filter === "ALL" || (filter === "PRACTICE_SQUAD" ? row.dataset.status === "PRACTICE_SQUAD" : row.dataset.unit === filter && row.dataset.status !== "PRACTICE_SQUAD");
        const textMatch = !needle || row.dataset.playerSearch.includes(needle);
        row.hidden = !(unitMatch && textMatch);
        if (!row.hidden) visible += 1;
      });
      byId("opponent-roster-empty").hidden = visible !== 0;
    };
    buttons.forEach((button) => button.addEventListener("click", () => {
      filter = button.dataset.rosterFilter;
      buttons.forEach((item) => item.classList.toggle("active", item === button));
      apply();
    }));
    search?.addEventListener("input", apply);
  }

  function renderScouting(scouting, roster) {
    const target = document.querySelector('[data-opponent-panel="scouting"]');
    if (!target) return;
    const lookup = playerLookup(roster);
    target.innerHTML = `
      <article class="opponent-card opponent-scouting-lead">
        <div class="opponent-card-heading"><h3>Executive Summary</h3><span class="pill good">${escapeHtml(pretty(scouting.overall_confidence))}</span></div>
        <p>${escapeHtml(scouting.executive_summary)}</p>
      </article>
      <div class="opponent-scouting-grid">
        <article class="opponent-card"><div class="opponent-card-heading"><h3>Key Threats</h3><span class="pill warn">${escapeHtml(asArray(scouting.key_threats).length)} tracked</span></div><div class="opponent-threat-list">${asArray(scouting.key_threats).map((threat) => {
          const player = lookup.get(threat.player_id);
          return `<div><span class="pill ${statusClass(threat.priority)}">${escapeHtml(threat.priority)}</span><strong>${escapeHtml(playerLabel(player))}</strong><p>${escapeHtml(threat.reason)}</p><small><b>Control point:</b> ${escapeHtml(threat.control_point)}</small></div>`;
        }).join("")}</div></article>
        <article class="opponent-card"><div class="opponent-card-heading"><h3>Practice Priorities</h3><span class="pill">Install order</span></div><ol class="opponent-priority-list">${asArray(scouting.practice_priorities).map((item) => `<li><span>${escapeHtml(item.order)}</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></div></li>`).join("")}</ol></article>
      </div>
      <article class="opponent-card"><div class="opponent-card-heading"><h3>Matchup Board</h3><span class="pill">Archers path</span></div><div class="opponent-matchup-grid">${asArray(scouting.matchup_board).map((item) => `<div><span class="pill ${statusClass(item.risk)}">${escapeHtml(item.risk)}</span><strong>${escapeHtml(item.matchup)}</strong><p>${escapeHtml(item.archers_path)}</p></div>`).join("")}</div></article>
      <div class="opponent-scouting-grid">
        <article class="opponent-card"><div class="opponent-card-heading"><h3>Baltimore Offense</h3><span class="pill">Tendencies</span></div>${asArray(scouting.offensive_tendencies).map((item) => `<div class="opponent-tendency"><b>${escapeHtml(pretty(item.situation))}</b><span>${escapeHtml(item.tendency)}</span><small>${escapeHtml(pretty(item.confidence))}</small></div>`).join("")}</article>
        <article class="opponent-card"><div class="opponent-card-heading"><h3>Baltimore Defense</h3><span class="pill">Tendencies</span></div>${asArray(scouting.defensive_tendencies).map((item) => `<div class="opponent-tendency"><b>${escapeHtml(pretty(item.situation))}</b><span>${escapeHtml(item.tendency)}</span><small>${escapeHtml(pretty(item.confidence))}</small></div>`).join("")}</article>
      </div>
      <article class="opponent-card opponent-boundary-card"><div class="opponent-card-heading"><h3>Evidence Boundaries</h3><span class="pill warn">Unknown stays unknown</span></div><ul>${asArray(scouting.evidence_boundaries).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></article>`;
  }

  function renderPackage(rows) {
    const byType = new Map(rows.map((row) => [row.resource_type, row.data ?? {}]));
    const identity = byType.get("team_identity");
    const staff = byType.get("team_staff");
    const roster = byType.get("team_roster");
    const depth = byType.get("team_depth_chart");
    const scouting = byType.get("opponent_scouting");
    const missing = RESOURCE_SPECS.filter(([type]) => !byType.has(type)).map(([type]) => type);

    packageData = { identity, staff, roster, depth, scouting, missing };
    const status = byId("opponent-room-status");
    if (status) {
      status.className = `pill ${missing.length ? "warn" : "good"}`;
      status.textContent = missing.length ? `${missing.length} source${missing.length === 1 ? "" : "s"} missing` : "Live dossier connected";
    }
    if (identity) byId("opponent-room-record").textContent = identity.record ?? "2-0";
    byId("opponent-room-summary").textContent = scouting?.executive_summary ?? identity?.organizational_summary ?? "Opponent package is not initialized.";

    if (missing.length) {
      document.querySelectorAll("[data-opponent-panel]").forEach((panel) => {
        panel.innerHTML = `<div class="opponent-empty"><strong>Opponent package incomplete.</strong><br>Missing: ${escapeHtml(missing.join(", "))}</div>`;
      });
      return;
    }

    renderOverview(identity, roster, depth, scouting);
    renderCoaches(staff);
    renderDepth(depth, roster);
    renderRoster(roster);
    renderScouting(scouting, roster);
    activateView(localStorage.getItem("archers-opponent-room-view") || "overview");
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

  async function loadPackage() {
    ensureMarkup();
    const rows = (await Promise.all(RESOURCE_SPECS.map(([type, id]) => fetchResource(type, id)))).filter(Boolean);
    renderPackage(rows);
  }

  function showError(error) {
    ensureMarkup();
    const status = byId("opponent-room-status");
    if (status) {
      status.className = "pill bad";
      status.textContent = "Dossier unavailable";
    }
    byId("opponent-room-summary").textContent = "The Baltimore package could not load.";
    document.querySelectorAll("[data-opponent-panel]").forEach((panel) => {
      panel.innerHTML = `<div class="opponent-empty">Opponent package load failed: ${escapeHtml(error?.message ?? error)}</div>`;
    });
  }

  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => loadPackage().catch(showError), 250);
  }

  window.addEventListener("DOMContentLoaded", () => {
    ensureMarkup();
    loadPackage().catch(showError);
    channel = client.channel("archers-opponent-package-v1")
      .on("postgres_changes", { event: "*", schema: "public", table: "archers_resources", filter: `franchise_id=eq.${franchiseId}` }, scheduleReload)
      .subscribe();
  });

  window.addEventListener("beforeunload", () => {
    if (channel) client.removeChannel(channel);
  });

  window.ArchersOpponentPackage = Object.freeze({
    getSnapshot: () => packageData,
    reload: () => loadPackage(),
    open: (view = "overview") => {
      APP.routeTo("weeklyops");
      ensureMarkup();
      activateView(view);
      byId("wo-opponent-room")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
})();
