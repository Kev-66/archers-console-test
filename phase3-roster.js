(() => {
  const SUPABASE_URL = "https://oqbylwlkrabxvpdhugrf.supabase.co";
  const SUPABASE_KEY = "sb_publishable_z-EjW-S0x7GZH2VREEaXAw_NOOrbH-m";
  const FRANCHISE_ID = "stl-2026";

  const rosterClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  let allPlayers = [];
  let rosterQuery = "";

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const normalizeSearch = (value) => String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  const numberOrNull = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const average = (values) => {
    const valid = values.filter((value) => value !== null);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
  };

  const rosterOrder = new Map([
    ["ACTIVE_ROSTER", 0],
    ["PRACTICE_SQUAD", 1]
  ]);

  const unitOrder = new Map([
    ["OFFENSE", 0],
    ["DEFENSE", 1],
    ["SPECIALISTS", 2]
  ]);

  const positionOrder = new Map([
    ["QB", 0], ["RB", 1], ["RB/KR", 2], ["WR", 3], ["WR/PR", 4], ["WR/KR", 5],
    ["TE", 6], ["TE/HB", 7], ["LT", 8], ["LG", 9], ["C", 10], ["RG", 11], ["RT", 12],
    ["OT", 13], ["G", 14], ["C/G", 15], ["G/T", 16], ["EDGE", 20], ["DT", 21],
    ["MLB", 22], ["LB", 23], ["CB", 24], ["CB/S", 25], ["NB", 26], ["FS", 27],
    ["SS", 28], ["S", 29], ["S/NB", 30], ["K", 40], ["P", 41], ["LS", 42]
  ]);

  function statusLabel(value) {
    if (value === "ACTIVE_ROSTER") return "Active Roster";
    if (value === "PRACTICE_SQUAD") return "Practice Squad";
    return String(value ?? "Unknown").replaceAll("_", " ");
  }

  function traitClass(value) {
    const normalized = String(value ?? "").toLowerCase().replaceAll("-", "").replaceAll(" ", "");
    if (normalized === "xfactor") return "xfactor";
    if (normalized === "superstar") return "superstar";
    if (normalized === "star") return "star";
    if (normalized === "hidden") return "hidden";
    return "normal";
  }

  function traitLabel(value) {
    const normalized = traitClass(value);
    if (normalized === "xfactor") return "X-Factor";
    if (normalized === "superstar") return "Superstar";
    if (normalized === "star") return "Star";
    if (normalized === "hidden") return "Hidden";
    return "Normal";
  }

  function playerDelta(row) {
    const current = numberOrNull(row.data?.overall_rating);
    const start = numberOrNull(row.data?.season_start_overall_rating);
    return current !== null && start !== null ? current - start : null;
  }

  function ensureMarkup() {
    const rosterPanel = document.getElementById("roster");
    if (!rosterPanel || document.getElementById("roster-directory-panel")) return;

    rosterPanel.insertAdjacentHTML("beforeend", `
      <article id="roster-directory-panel" class="panel roster-directory-panel">
        <div class="section-head roster-directory-head">
          <div>
            <h2>Organizational Roster</h2>
            <p>Current console-safe profiles from the authoritative player-resource ledger.</p>
          </div>
          <div id="roster-directory-summary" class="roster-directory-summary">Loading profiles…</div>
        </div>
        <section id="roster-dashboard" class="roster-dashboard" aria-label="Roster dashboard">
          <div class="empty roster-directory-loading">Calculating roster dashboard…</div>
        </section>
        <div class="roster-directory-tools">
          <label class="roster-search-label" for="roster-search">Search roster</label>
          <input id="roster-search" class="roster-search" type="search" placeholder="Search name, position, status, trait or role" autocomplete="off" spellcheck="false">
          <div id="roster-search-status" class="roster-search-status" aria-live="polite">Showing all profiles</div>
        </div>
        <div id="roster-directory" class="table-wrap roster-table-wrap">
          <div class="empty roster-directory-loading">Loading organizational roster…</div>
        </div>
      </article>`);

    document.getElementById("roster-search")?.addEventListener("input", (event) => {
      rosterQuery = event.target.value;
      renderRoster(allPlayers);
    });
  }

  function sortPlayers(rows) {
    return [...rows].sort((a, b) => {
      const ad = a.data ?? {};
      const bd = b.data ?? {};
      return (rosterOrder.get(ad.roster_status) ?? 9) - (rosterOrder.get(bd.roster_status) ?? 9)
        || (unitOrder.get(ad.unit) ?? 9) - (unitOrder.get(bd.unit) ?? 9)
        || (positionOrder.get(ad.position_code) ?? 99) - (positionOrder.get(bd.position_code) ?? 99)
        || String(ad.player_name ?? a.resource_id).localeCompare(String(bd.player_name ?? b.resource_id));
    });
  }

  function matchesSearch(row, query) {
    if (!query) return true;
    const data = row.data ?? {};
    const searchable = [
      row.resource_id,
      data.player_name,
      data.position,
      data.position_code,
      data.unit,
      data.roster_status,
      statusLabel(data.roster_status),
      data.overall_rating,
      data.development_trait,
      data.role,
      data.special_teams_role
    ].map(normalizeSearch).join(" ");
    return searchable.includes(query);
  }

  function renderDashboard(players) {
    const target = document.getElementById("roster-dashboard");
    if (!target) return;

    if (!players.length) {
      target.innerHTML = '<div class="empty roster-directory-loading">Roster metrics are unavailable.</div>';
      return;
    }

    const activeCount = players.filter((row) => row.data?.roster_status === "ACTIVE_ROSTER").length;
    const practiceCount = players.filter((row) => row.data?.roster_status === "PRACTICE_SQUAD").length;
    const avgOvr = average(players.map((row) => numberOrNull(row.data?.overall_rating)));
    const avgAge = average(players.map((row) => numberOrNull(row.data?.age)));
    const improved = players.filter((row) => (playerDelta(row) ?? 0) > 0);

    const unitCounts = { OFFENSE: 0, DEFENSE: 0, SPECIALISTS: 0 };
    const traitCounts = { "X-Factor": 0, Superstar: 0, Star: 0, Hidden: 0, Normal: 0 };

    players.forEach((row) => {
      const unit = row.data?.unit;
      if (Object.prototype.hasOwnProperty.call(unitCounts, unit)) unitCounts[unit] += 1;
      traitCounts[traitLabel(row.data?.development_trait)] += 1;
    });

    const topRated = [...players]
      .filter((row) => numberOrNull(row.data?.overall_rating) !== null)
      .sort((a, b) =>
        numberOrNull(b.data?.overall_rating) - numberOrNull(a.data?.overall_rating)
        || String(a.data?.player_name ?? a.resource_id).localeCompare(String(b.data?.player_name ?? b.resource_id))
      )
      .slice(0, 3);

    const topRisers = [...improved]
      .sort((a, b) =>
        playerDelta(b) - playerDelta(a)
        || numberOrNull(b.data?.overall_rating) - numberOrNull(a.data?.overall_rating)
        || String(a.data?.player_name ?? a.resource_id).localeCompare(String(b.data?.player_name ?? b.resource_id))
      )
      .slice(0, 5);

    const leaderboard = (rows, valueFor) => rows.map((row, index) => `
      <div class="roster-leader-row">
        <span class="roster-leader-rank">${index + 1}</span>
        <span class="roster-leader-player">
          <strong>${escapeHtml(row.data?.player_name ?? row.resource_id)}</strong>
          <small>${escapeHtml(row.data?.position_code ?? row.data?.position ?? "—")}</small>
        </span>
        <strong class="roster-leader-value">${escapeHtml(valueFor(row))}</strong>
      </div>`).join("") || '<div class="empty">No qualifying players.</div>';

    target.innerHTML = `
      <div class="roster-metric-grid">
        <div class="roster-metric-card"><span>Players</span><strong>${players.length}</strong><small>${activeCount} active • ${practiceCount} practice squad</small></div>
        <div class="roster-metric-card"><span>Organization Avg OVR</span><strong>${avgOvr === null ? "—" : avgOvr.toFixed(1)}</strong><small>Across current profiles</small></div>
        <div class="roster-metric-card"><span>Organization Avg Age</span><strong>${avgAge === null ? "—" : avgAge.toFixed(1)}</strong><small>Years old</small></div>
        <div class="roster-metric-card"><span>Improved Players</span><strong>${improved.length}</strong><small>Above season-start OVR</small></div>
      </div>
      <div class="roster-dashboard-lower">
        <div class="roster-breakdown-card">
          <h3>Unit Breakdown</h3>
          <div class="roster-breakdown-chips">
            <span class="roster-breakdown-chip"><strong>${unitCounts.OFFENSE}</strong> Offense</span>
            <span class="roster-breakdown-chip"><strong>${unitCounts.DEFENSE}</strong> Defense</span>
            <span class="roster-breakdown-chip"><strong>${unitCounts.SPECIALISTS}</strong> Specialists</span>
          </div>
          <h3 class="roster-traits-heading">Development Traits</h3>
          <div class="roster-breakdown-chips">
            ${Object.entries(traitCounts).filter(([, count]) => count > 0).map(([label, count]) =>
              `<span class="roster-breakdown-chip trait-${traitClass(label)}"><strong>${count}</strong> ${escapeHtml(label)}</span>`
            ).join("")}
          </div>
        </div>
        <div class="roster-leader-card">
          <h3>Highest Rated</h3>
          ${leaderboard(topRated, (row) => row.data?.overall_rating ?? "—")}
        </div>
        <div class="roster-leader-card">
          <h3>Biggest Risers</h3>
          ${leaderboard(topRisers, (row) => {
            const delta = playerDelta(row);
            return delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta}`;
          })}
        </div>
      </div>`;
  }

  function renderRoster(rows) {
    const target = document.getElementById("roster-directory");
    const summary = document.getElementById("roster-directory-summary");
    const searchStatus = document.getElementById("roster-search-status");
    if (!target || !summary || !searchStatus) return;

    const players = sortPlayers(rows);
    const activeCount = players.filter((row) => row.data?.roster_status === "ACTIVE_ROSTER").length;
    const practiceCount = players.filter((row) => row.data?.roster_status === "PRACTICE_SQUAD").length;
    const normalizedQuery = normalizeSearch(rosterQuery);
    const visiblePlayers = players.filter((row) => matchesSearch(row, normalizedQuery));

    summary.textContent = `${players.length} profiles • ${activeCount} active • ${practiceCount} practice squad`;
    searchStatus.textContent = normalizedQuery
      ? `Showing ${visiblePlayers.length} of ${players.length} profiles`
      : `Showing all ${players.length} profiles`;

    renderDashboard(players);

    if (!players.length) {
      target.innerHTML = '<div class="empty roster-directory-loading">No console-visible player profiles were returned.</div>';
      return;
    }

    if (!visiblePlayers.length) {
      target.innerHTML = `<div class="empty roster-directory-loading">No players match “${escapeHtml(rosterQuery.trim())}”.</div>`;
      return;
    }

    target.innerHTML = `
      <table class="roster-table">
        <thead>
          <tr>
            <th>Pos</th>
            <th>Player</th>
            <th>Status</th>
            <th>OVR</th>
            <th>Development</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          ${visiblePlayers.map((row) => {
            const data = row.data ?? {};
            const isPractice = data.roster_status === "PRACTICE_SQUAD";
            return `
              <tr class="roster-player-row${isPractice ? " practice-squad" : ""}" data-resource-id="${escapeHtml(row.resource_id)}">
                <td class="roster-position">${escapeHtml(data.position_code ?? data.position ?? "—")}</td>
                <td class="roster-player-cell">
                  <strong>${escapeHtml(data.player_name ?? row.resource_id)}</strong>
                  <span>${escapeHtml(data.position ?? "Position unavailable")}</span>
                </td>
                <td><span class="pill ${isPractice ? "warn" : "good"}">${escapeHtml(statusLabel(data.roster_status))}</span></td>
                <td class="roster-ovr">${escapeHtml(data.overall_rating ?? "—")}</td>
                <td><span class="roster-trait ${traitClass(data.development_trait)}">${escapeHtml(data.development_trait ?? "—")}</span></td>
                <td class="roster-role">${escapeHtml(data.role || "—")}</td>
              </tr>`;
          }).join("")}
        </tbody>
      </table>`;
  }

  async function loadRoster() {
    ensureMarkup();

    const { data, error } = await rosterClient
      .from("archers_resources")
      .select("resource_id, version, data, updated_at")
      .eq("franchise_id", FRANCHISE_ID)
      .eq("resource_type", "player")
      .eq("status", "ACTIVE")
      .eq("visibility", "CONSOLE")
      .order("resource_id");

    if (error) throw error;
    allPlayers = data ?? [];
    renderRoster(allPlayers);
  }

  function showError(error) {
    ensureMarkup();
    const target = document.getElementById("roster-directory");
    const dashboard = document.getElementById("roster-dashboard");
    const summary = document.getElementById("roster-directory-summary");
    const searchStatus = document.getElementById("roster-search-status");
    if (summary) summary.textContent = "Roster unavailable";
    if (searchStatus) searchStatus.textContent = "Search unavailable";
    if (dashboard) dashboard.innerHTML = '<div class="empty roster-directory-loading">Roster dashboard unavailable.</div>';
    if (target) {
      target.innerHTML = `<div class="empty roster-directory-loading">The roster directory could not load: ${escapeHtml(error?.message ?? error)}</div>`;
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    loadRoster().catch(showError);

    rosterClient.channel("archers-roster-phase3")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "archers_resources", filter: `franchise_id=eq.${FRANCHISE_ID}` },
        () => loadRoster().catch(showError)
      )
      .subscribe();
  });
})();