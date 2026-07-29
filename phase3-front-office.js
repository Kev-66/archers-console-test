(() => {
  const SUPABASE_URL = "https://oqbylwlkrabxvpdhugrf.supabase.co";
  const SUPABASE_KEY = "sb_publishable_z-EjW-S0x7GZH2VREEaXAw_NOOrbH-m";
  const FRANCHISE_ID = "stl-2026";

  const frontOfficeClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const numberOrNull = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const formatMillions = (value, digits = 2) => {
    const parsed = numberOrNull(value);
    return parsed === null ? "—" : `$${parsed.toFixed(digits)}M`;
  };

  const formatDollars = (value) => {
    const parsed = numberOrNull(value);
    return parsed === null ? "—" : new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0
    }).format(parsed);
  };

  const statusClass = (value) => {
    const text = String(value ?? "").toLowerCase();
    if (text.includes("next") || text.includes("monitor") || text.includes("pending")) return "warn";
    if (text.includes("out") || text.includes("blocked")) return "bad";
    return "";
  };

  function activateFrontOffice() {
    document.querySelectorAll(".tab-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === "frontoffice");
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === "frontoffice");
    });
    localStorage.setItem("archers-console-tab", "frontoffice");
    history.replaceState(null, "", "#frontoffice");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function ensureMarkup() {
    const tabs = document.querySelector(".tabs");
    const scheduleButton = tabs?.querySelector('[data-tab="schedule"]');
    if (tabs && !tabs.querySelector('[data-tab="frontoffice"]')) {
      const button = document.createElement("button");
      button.className = "tab-button";
      button.dataset.tab = "frontoffice";
      button.textContent = "Front Office";
      button.addEventListener("click", activateFrontOffice);
      tabs.insertBefore(button, scheduleButton ?? null);
    }

    if (!document.getElementById("frontoffice")) {
      const schedulePanel = document.getElementById("schedule");
      const section = document.createElement("section");
      section.id = "frontoffice";
      section.className = "tab-panel";
      section.innerHTML = `
        <div class="section-head fo-heading">
          <div>
            <h2>Front Office</h2>
            <p>Contracts, cap position, practice-squad payroll and the current personnel decision queue.</p>
          </div>
          <div id="fo-live-status" class="fo-live-status">Loading front-office ledger…</div>
        </div>

        <section id="fo-metrics" class="fo-metrics">
          <div class="fo-metric-card"><span>Practical Cap Flexibility</span><strong>—</strong><small>Loading franchise state</small></div>
          <div class="fo-metric-card"><span>Recorded 2026 Cap Hits</span><strong>—</strong><small>Loading player profiles</small></div>
          <div class="fo-metric-card"><span>Practice Squad Payroll</span><strong>—</strong><small>Weekly recorded salaries</small></div>
          <div class="fo-metric-card"><span>Contract Profiles</span><strong>—</strong><small>Structured player records</small></div>
        </section>

        <section class="fo-layout">
          <article class="panel fo-cap-panel">
            <div class="section-head"><div><h2>Largest 2026 Cap Commitments</h2><p>Recorded player-profile cap hits, not a replacement for a complete legal cap ledger.</p></div></div>
            <div id="fo-cap-table" class="table-wrap"><div class="empty fo-loading">Loading cap commitments…</div></div>
          </article>

          <div class="stack">
            <article class="panel">
              <div class="section-head"><div><h2>Personnel Decision Queue</h2><p>Current roster, contract and practice-squad decisions.</p></div></div>
              <div id="fo-decisions" class="list"><div class="empty">Loading decisions…</div></div>
            </article>

            <article class="panel">
              <div class="section-head"><div><h2>Structured Data Coverage</h2><p>What the console can calculate today without inventing missing records.</p></div></div>
              <div id="fo-coverage" class="fo-coverage-list"><div class="empty">Loading coverage…</div></div>
            </article>
          </div>
        </section>`;
      schedulePanel?.parentNode?.insertBefore(section, schedulePanel);
    }

    const requested = location.hash.slice(1) || localStorage.getItem("archers-console-tab");
    if (requested === "frontoffice") activateFrontOffice();
  }

  function renderMetrics(stateRow, players) {
    const target = document.getElementById("fo-metrics");
    if (!target) return;

    const state = stateRow.state ?? {};
    const practicalFlex = state.resources?.cap?.practical_flexibility_millions;
    const activePlayers = players.filter((row) => row.data?.roster_status === "ACTIVE_ROSTER");
    const recordedCapHits = activePlayers
      .map((row) => numberOrNull(row.data?.cap_hit_2026_millions))
      .filter((value) => value !== null);
    const capTotal = recordedCapHits.reduce((sum, value) => sum + value, 0);
    const weeklyPayroll = players
      .filter((row) => row.data?.roster_status === "PRACTICE_SQUAD")
      .map((row) => numberOrNull(row.data?.practice_squad_weekly_salary))
      .filter((value) => value !== null)
      .reduce((sum, value) => sum + value, 0);
    const contractProfiles = players.filter((row) => String(row.data?.contract_summary ?? "").trim()).length;

    target.innerHTML = `
      <div class="fo-metric-card"><span>Practical Cap Flexibility</span><strong>${escapeHtml(formatMillions(practicalFlex, 4))}</strong><small>Current franchise-state estimate</small></div>
      <div class="fo-metric-card"><span>Recorded 2026 Cap Hits</span><strong>${escapeHtml(formatMillions(capTotal))}</strong><small>${recordedCapHits.length} active-roster cap fields</small></div>
      <div class="fo-metric-card"><span>Practice Squad Payroll</span><strong>${escapeHtml(formatDollars(weeklyPayroll))}</strong><small>Weekly total across recorded salaries</small></div>
      <div class="fo-metric-card"><span>Contract Profiles</span><strong>${escapeHtml(contractProfiles)}</strong><small>${escapeHtml(players.length)} organizational players</small></div>`;
  }

  function renderCapTable(players) {
    const target = document.getElementById("fo-cap-table");
    if (!target) return;

    const rows = [...players]
      .filter((row) => row.data?.roster_status === "ACTIVE_ROSTER" && numberOrNull(row.data?.cap_hit_2026_millions) !== null)
      .sort((a, b) => numberOrNull(b.data?.cap_hit_2026_millions) - numberOrNull(a.data?.cap_hit_2026_millions))
      .slice(0, 10);

    if (!rows.length) {
      target.innerHTML = '<div class="empty fo-loading">No structured 2026 cap-hit fields are available.</div>';
      return;
    }

    target.innerHTML = `
      <table class="fo-cap-table">
        <thead><tr><th>Player</th><th>Pos</th><th>2026 Cap Hit</th><th>Contract</th></tr></thead>
        <tbody>${rows.map((row) => `
          <tr class="roster-player-row fo-cap-row" data-resource-id="${escapeHtml(row.resource_id)}">
            <td><strong>${escapeHtml(row.data?.player_name ?? row.resource_id)}</strong></td>
            <td>${escapeHtml(row.data?.position_code ?? row.data?.position ?? "—")}</td>
            <td class="fo-money">${escapeHtml(formatMillions(row.data?.cap_hit_2026_millions))}</td>
            <td>${escapeHtml(row.data?.contract_summary ?? "—")}</td>
          </tr>`).join("")}</tbody>
      </table>`;
  }

  function renderDecisions(stateRow) {
    const target = document.getElementById("fo-decisions");
    if (!target) return;

    const decisions = stateRow.state?.open_decisions ?? [];
    const personnelPattern = /roster|practice squad|elevation|protect|contract|sign|release|trade|cap|personnel|player|promotion|waiver/i;
    const personnel = decisions.filter((item) => personnelPattern.test(`${item.title ?? ""} ${item.note ?? ""} ${item.status ?? ""}`));

    target.innerHTML = personnel.map((item) => `
      <div class="item">
        <div class="item-top">
          <div class="item-title">${escapeHtml(item.title ?? "Personnel decision")}</div>
          <span class="pill ${statusClass(item.status)}">${escapeHtml(item.status ?? "Open")}</span>
        </div>
        <div class="item-note">${escapeHtml(item.note ?? "")}</div>
      </div>`).join("") || '<div class="empty">No current personnel decisions were detected.</div>';
  }

  function renderCoverage(players) {
    const target = document.getElementById("fo-coverage");
    if (!target) return;

    const contractCount = players.filter((row) => String(row.data?.contract_summary ?? "").trim()).length;
    const capCount = players.filter((row) => numberOrNull(row.data?.cap_hit_2026_millions) !== null).length;
    const salaryCount = players.filter((row) => numberOrNull(row.data?.practice_squad_weekly_salary) !== null).length;

    const items = [
      ["Player contract profiles", `${contractCount}/${players.length}`, "good"],
      ["2026 cap-hit fields", `${capCount} recorded`, capCount ? "good" : "warn"],
      ["Practice-squad salaries", `${salaryCount} recorded`, salaryCount ? "good" : "warn"],
      ["Draft-pick inventory", "Not structured", "warn"],
      ["Transaction ledger", "Not structured", "warn"],
      ["Staff directory", "Not structured", "warn"]
    ];

    target.innerHTML = items.map(([label, value, kind]) => `
      <div class="fo-coverage-row">
        <span>${escapeHtml(label)}</span>
        <span class="pill ${kind}">${escapeHtml(value)}</span>
      </div>`).join("");
  }

  function renderFrontOffice(stateRow, players) {
    renderMetrics(stateRow, players);
    renderCapTable(players);
    renderDecisions(stateRow);
    renderCoverage(players);

    const status = document.getElementById("fo-live-status");
    if (status) {
      const updated = stateRow.updated_at ? new Date(stateRow.updated_at).toLocaleString() : "update time unavailable";
      status.textContent = `State v${stateRow.version} • ${updated}`;
    }
  }

  async function loadFrontOffice() {
    ensureMarkup();
    const [stateResult, playersResult] = await Promise.all([
      frontOfficeClient
        .from("archers_franchise_state")
        .select("version, state, updated_at")
        .eq("id", FRANCHISE_ID)
        .single(),
      frontOfficeClient
        .from("archers_resources")
        .select("resource_id, version, data, updated_at")
        .eq("franchise_id", FRANCHISE_ID)
        .eq("resource_type", "player")
        .eq("status", "ACTIVE")
        .eq("visibility", "CONSOLE")
        .order("resource_id")
    ]);

    if (stateResult.error) throw stateResult.error;
    if (playersResult.error) throw playersResult.error;
    renderFrontOffice(stateResult.data, playersResult.data ?? []);
  }

  function showError(error) {
    ensureMarkup();
    const status = document.getElementById("fo-live-status");
    if (status) status.textContent = "Front Office unavailable";
    const target = document.getElementById("fo-cap-table");
    if (target) target.innerHTML = `<div class="empty fo-loading">The Front Office tab could not load: ${escapeHtml(error?.message ?? error)}</div>`;
  }

  window.addEventListener("DOMContentLoaded", () => {
    loadFrontOffice().catch(showError);
    frontOfficeClient.channel("archers-front-office-phase3")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "archers_franchise_state", filter: `id=eq.${FRANCHISE_ID}` }, () => loadFrontOffice().catch(showError))
      .on("postgres_changes", { event: "*", schema: "public", table: "archers_resources", filter: `franchise_id=eq.${FRANCHISE_ID}` }, () => loadFrontOffice().catch(showError))
      .subscribe();
  });
})();
