(() => {
  const SUPABASE_URL = "https://oqbylwlkrabxvpdhugrf.supabase.co";
  const SUPABASE_KEY = "sb_publishable_z-EjW-S0x7GZH2VREEaXAw_NOOrbH-m";
  const gdClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const urgentEvents = new Set(["injury", "turnover", "interception", "fumble", "scoring", "eligibility", "ejection"]);
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const periodLabel = (quarter) => {
    if (quarter === 0) return "Pre-game";
    if (quarter >= 5) return `OT${quarter - 4}`;
    return `Q${quarter}`;
  };

  const statusClass = (status) => {
    const value = String(status ?? "").toLowerCase();
    if (value.includes("final")) return "good";
    if (value.includes("live") || value.includes("half")) return "warn";
    return "";
  };

  function baseMarkup() {
    return `
      <div class="gd-shell">
        <div id="gd-empty" class="placeholder">
          <div>
            <div class="placeholder-mark">🏟️</div>
            <h2>Game Day Ledger Loading</h2>
            <p>The console is checking for an active or recently finalized Archers game.</p>
          </div>
        </div>
        <div id="gd-live" hidden>
          <div class="gd-scoreboard">
            <div class="gd-team away">
              <div id="gd-away-name" class="gd-team-name">Away</div>
              <div id="gd-away-record" class="gd-team-record">—</div>
              <div id="gd-away-score" class="gd-score">0</div>
            </div>
            <div class="gd-center">
              <div id="gd-period" class="gd-period">Pre-game</div>
              <div id="gd-clock" class="gd-clock">—</div>
              <div class="gd-status"><span id="gd-status-pill" class="pill">—</span></div>
            </div>
            <div class="gd-team home">
              <div id="gd-home-name" class="gd-team-name">Home</div>
              <div id="gd-home-record" class="gd-team-record">—</div>
              <div id="gd-home-score" class="gd-score">0</div>
            </div>
          </div>

          <div class="gd-state-grid" style="margin-top:16px">
            <div class="gd-state-card"><div class="gd-state-label">Possession</div><div id="gd-possession" class="gd-state-value">—</div></div>
            <div class="gd-state-card"><div class="gd-state-label">Field Position</div><div id="gd-field" class="gd-state-value">—</div></div>
            <div class="gd-state-card"><div class="gd-state-label">Situation</div><div id="gd-situation" class="gd-state-value">—</div></div>
            <div class="gd-state-card"><div class="gd-state-label">Live Version</div><div id="gd-version" class="gd-state-value">—</div></div>
          </div>

          <div class="gd-layout" style="margin-top:16px">
            <article class="panel">
              <div class="section-head"><div><h2>Drive Log</h2><p>Authoritative completed possessions.</p></div></div>
              <div id="gd-drives" class="gd-log"><div class="empty">No drives recorded.</div></div>
            </article>
            <div class="stack">
              <article class="panel">
                <div class="section-head"><div><h2>Game Events</h2><p>Turnovers, injuries, scoring and other urgent events.</p></div></div>
                <div id="gd-events" class="gd-log"><div class="empty">No game events recorded.</div></div>
              </article>
              <article class="panel">
                <div class="section-head"><div><h2>Team Statistics</h2><p>Only reconciled or explicitly tracked values.</p></div></div>
                <div id="gd-team-stats" class="gd-stats-grid"><div class="empty">No team statistics recorded.</div></div>
              </article>
            </div>
          </div>

          <article class="panel" style="margin-top:16px">
            <div class="section-head"><div><h2>Player Statistics</h2><p>Current reconciled player ledger.</p></div><div id="gd-refresh" class="gd-refresh">—</div></div>
            <div id="gd-player-stats" class="table-wrap"><div class="empty" style="padding:14px">No player statistics recorded.</div></div>
          </article>
        </div>
      </div>`;
  }

  async function loadGameDay() {
    const panel = document.getElementById("gameday");
    if (!panel) return;
    if (!document.getElementById("gd-empty")) panel.innerHTML = baseMarkup();

    const [teamsResult, standingsResult, liveResult] = await Promise.all([
      gdClient.from("cff_teams").select("team_id, team_name").eq("active", true),
      gdClient.from("cff_standings").select("team_id, wins, losses, ties").eq("season", 2026),
      gdClient.from("cff_live_games").select("*").order("updated_at", { ascending: false }).limit(1).maybeSingle()
    ]);

    if (teamsResult.error) throw teamsResult.error;
    if (standingsResult.error) throw standingsResult.error;
    if (liveResult.error) throw liveResult.error;

    const teamMap = new Map((teamsResult.data ?? []).map((team) => [team.team_id, team.team_name]));
    const recordMap = new Map((standingsResult.data ?? []).map((row) => [row.team_id, `${row.wins}-${row.losses}${row.ties ? `-${row.ties}` : ""}`]));
    const live = liveResult.data;

    if (!live) {
      document.getElementById("gd-live").hidden = true;
      document.getElementById("gd-empty").hidden = false;
      document.getElementById("gd-empty").innerHTML = `
        <div>
          <div class="placeholder-mark">🏟️</div>
          <h2>No Active Game</h2>
          <p>The Phase Three Game Day backend is ready. A live ledger will appear here after the protected Action runs <strong>start_game</strong>.</p>
        </div>`;
      return;
    }

    const [drivesResult, eventsResult, teamStatsResult, playerStatsResult] = await Promise.all([
      gdClient.from("cff_game_drives").select("*").eq("game_id", live.game_id).order("drive_number"),
      gdClient.from("cff_game_events").select("*").eq("game_id", live.game_id).order("event_id", { ascending: false }),
      gdClient.from("cff_game_team_stats").select("*").eq("game_id", live.game_id).order("team_id"),
      gdClient.from("cff_game_player_stats").select("*").eq("game_id", live.game_id).order("team_id").order("player_name")
    ]);

    for (const result of [drivesResult, eventsResult, teamStatsResult, playerStatsResult]) {
      if (result.error) throw result.error;
    }

    document.getElementById("gd-empty").hidden = true;
    document.getElementById("gd-live").hidden = false;
    document.getElementById("gd-away-name").textContent = teamMap.get(live.away_team_id) ?? live.away_team_id;
    document.getElementById("gd-home-name").textContent = teamMap.get(live.home_team_id) ?? live.home_team_id;
    document.getElementById("gd-away-record").textContent = recordMap.get(live.away_team_id) ?? "—";
    document.getElementById("gd-home-record").textContent = recordMap.get(live.home_team_id) ?? "—";
    document.getElementById("gd-away-score").textContent = live.away_score;
    document.getElementById("gd-home-score").textContent = live.home_score;
    document.getElementById("gd-period").textContent = periodLabel(live.quarter);
    document.getElementById("gd-clock").textContent = live.clock_remaining ?? "—";
    const statusPill = document.getElementById("gd-status-pill");
    statusPill.textContent = live.status;
    statusPill.className = `pill ${statusClass(live.status)}`;
    document.getElementById("gd-possession").textContent = live.possession_team_id ? (teamMap.get(live.possession_team_id) ?? live.possession_team_id) : "—";
    document.getElementById("gd-field").textContent = live.field_position_label ?? "—";
    document.getElementById("gd-situation").textContent = live.down ? `${live.down}${live.down === 1 ? "st" : live.down === 2 ? "nd" : live.down === 3 ? "rd" : "th"} & ${live.distance ?? "—"}` : "—";
    document.getElementById("gd-version").textContent = `v${live.version}`;

    const drives = drivesResult.data ?? [];
    document.getElementById("gd-drives").innerHTML = drives.map((drive) => `
      <div class="gd-drive">
        <div class="gd-drive-head">
          <div><span class="gd-drive-number">Drive ${escapeHtml(drive.drive_number)}</span> • ${escapeHtml(teamMap.get(drive.offense_team_id) ?? drive.offense_team_id)}</div>
          <span class="pill ${drive.points > 0 ? "good" : ""}">${escapeHtml(drive.result)}</span>
        </div>
        <div class="gd-drive-summary">${escapeHtml(drive.summary)}</div>
        <div class="gd-drive-meta">${escapeHtml(drive.plays ?? "—")} plays • ${escapeHtml(drive.yards ?? "—")} yards • ${escapeHtml(drive.points)} points • ${escapeHtml(drive.start_clock ?? "—")} to ${escapeHtml(drive.end_clock ?? "—")}</div>
      </div>`).join("") || '<div class="empty">No drives recorded.</div>';

    const events = eventsResult.data ?? [];
    document.getElementById("gd-events").innerHTML = events.map((event) => `
      <div class="gd-event ${urgentEvents.has(String(event.event_type).toLowerCase()) ? "urgent" : ""}">
        <div class="gd-event-title">${escapeHtml(event.event_type)} • ${escapeHtml(event.summary)}</div>
        <div class="gd-event-meta">${event.quarter ? escapeHtml(periodLabel(event.quarter)) : ""} ${escapeHtml(event.clock_remaining ?? "")} ${event.team_id ? `• ${escapeHtml(teamMap.get(event.team_id) ?? event.team_id)}` : ""}</div>
      </div>`).join("") || '<div class="empty">No game events recorded.</div>';

    const teamStats = teamStatsResult.data ?? [];
    document.getElementById("gd-team-stats").innerHTML = teamStats.map((row) => {
      const entries = Object.entries(row.stats ?? {});
      return `<div class="gd-stat-card"><h3>${escapeHtml(teamMap.get(row.team_id) ?? row.team_id)}</h3>${entries.map(([key, value]) => `<div class="gd-stat-row"><span>${escapeHtml(key.replaceAll("_", " "))}</span><strong>${escapeHtml(value)}</strong></div>`).join("") || '<div class="empty">No tracked values.</div>'}<div class="item-note">${escapeHtml(row.reconciliation_status)}</div></div>`;
    }).join("") || '<div class="empty">No team statistics recorded.</div>';

    const players = playerStatsResult.data ?? [];
    document.getElementById("gd-player-stats").innerHTML = players.length ? `
      <table>
        <thead><tr><th>Team</th><th>Player</th><th>Pos</th><th>Status</th><th>Tracked Statistics</th></tr></thead>
        <tbody>${players.map((row) => `<tr><td>${escapeHtml(teamMap.get(row.team_id) ?? row.team_id)}</td><td>${escapeHtml(row.player_name)}</td><td>${escapeHtml(row.position ?? "—")}</td><td>${escapeHtml(row.reconciliation_status)}</td><td style="text-align:left">${escapeHtml(Object.entries(row.stats ?? {}).map(([key, value]) => `${key.replaceAll("_", " ")}: ${value}`).join(" • ") || "—")}</td></tr>`).join("")}</tbody>
      </table>` : '<div class="empty" style="padding:14px">No player statistics recorded.</div>';

    document.getElementById("gd-refresh").textContent = `Updated ${new Date().toLocaleTimeString()} • ${live.game_id}`;
  }

  function showError(error) {
    const panel = document.getElementById("gameday");
    if (!panel) return;
    panel.innerHTML = `<div class="placeholder"><div><div class="placeholder-mark">⚠️</div><h2>Game Day Setup Required</h2><p>${escapeHtml(error?.message ?? error)}</p></div></div>`;
  }

  window.addEventListener("DOMContentLoaded", () => {
    loadGameDay().catch(showError);
    gdClient.channel("archers-gameday-phase3")
      .on("postgres_changes", { event: "*", schema: "public", table: "cff_live_games" }, () => loadGameDay().catch(showError))
      .on("postgres_changes", { event: "*", schema: "public", table: "cff_game_drives" }, () => loadGameDay().catch(showError))
      .on("postgres_changes", { event: "*", schema: "public", table: "cff_game_events" }, () => loadGameDay().catch(showError))
      .on("postgres_changes", { event: "*", schema: "public", table: "cff_game_team_stats" }, () => loadGameDay().catch(showError))
      .on("postgres_changes", { event: "*", schema: "public", table: "cff_game_player_stats" }, () => loadGameDay().catch(showError))
      .subscribe();
  });
})();