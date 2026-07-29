(() => {
  const SUPABASE_URL = "https://oqbylwlkrabxvpdhugrf.supabase.co";
  const SUPABASE_KEY = "sb_publishable_z-EjW-S0x7GZH2VREEaXAw_NOOrbH-m";
  const FRANCHISE_ID = "stl-2026";

  const rosterClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

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
    const normalized = String(value ?? "").toLowerCase().replaceAll("-", "");
    if (normalized === "xfactor") return "xfactor";
    if (normalized === "superstar") return "superstar";
    if (normalized === "star") return "star";
    if (normalized === "hidden") return "hidden";
    return "normal";
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
          <div id="roster-directory-summary" class="roster-directory-summary">Loading 69 profiles…</div>
        </div>
        <div id="roster-directory" class="table-wrap roster-table-wrap">
          <div class="empty roster-directory-loading">Loading organizational roster…</div>
        </div>
      </article>`);
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

  function renderRoster(rows) {
    const target = document.getElementById("roster-directory");
    const summary = document.getElementById("roster-directory-summary");
    if (!target || !summary) return;

    const players = sortPlayers(rows);
    const activeCount = players.filter((row) => row.data?.roster_status === "ACTIVE_ROSTER").length;
    const practiceCount = players.filter((row) => row.data?.roster_status === "PRACTICE_SQUAD").length;

    summary.textContent = `${players.length} profiles • ${activeCount} active • ${practiceCount} practice squad`;

    if (!players.length) {
      target.innerHTML = '<div class="empty roster-directory-loading">No console-visible player profiles were returned.</div>';
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
          ${players.map((row) => {
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
    renderRoster(data ?? []);
  }

  function showError(error) {
    ensureMarkup();
    const target = document.getElementById("roster-directory");
    const summary = document.getElementById("roster-directory-summary");
    if (summary) summary.textContent = "Roster unavailable";
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
