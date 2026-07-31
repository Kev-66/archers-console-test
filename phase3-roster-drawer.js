(() => {
  const SUPABASE_URL = "https://oqbylwlkrabxvpdhugrf.supabase.co";
  const SUPABASE_KEY = "sb_publishable_z-EjW-S0x7GZH2VREEaXAw_NOOrbH-m";
  const FRANCHISE_ID = "stl-2026";

  const drawerClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  let returnFocus = null;

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const hasValue = (value) => value !== null && value !== undefined && value !== "";
  const displayValue = (value) => hasValue(value) ? value : "—";

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

  function formatMillions(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `$${number.toFixed(number % 1 === 0 ? 1 : 2)}M` : "—";
  }

  function formatMoney(value) {
    const number = Number(value);
    return Number.isFinite(number)
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(number)
      : "—";
  }

  function detailItem(label, value) {
    if (!hasValue(value)) return "";
    return `<div class="player-detail-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  }

  function ensureDrawer() {
    if (document.getElementById("roster-player-drawer-layer")) return;

    document.body.insertAdjacentHTML("beforeend", `
      <div id="roster-player-drawer-layer" class="player-drawer-layer" aria-hidden="true">
        <aside id="roster-player-drawer" class="player-drawer" role="dialog" aria-modal="true" aria-labelledby="player-drawer-name">
          <button id="player-drawer-close" class="player-drawer-close" type="button" aria-label="Close player profile">×</button>
          <div id="player-drawer-content" class="player-drawer-content" aria-live="polite">
            <div class="player-drawer-loading">Select a player to open their profile.</div>
          </div>
        </aside>
      </div>`);

    const layer = document.getElementById("roster-player-drawer-layer");
    document.getElementById("player-drawer-close")?.addEventListener("click", closeDrawer);
    layer?.addEventListener("click", (event) => {
      if (event.target === layer) closeDrawer();
    });
  }

  function showDrawer() {
    ensureDrawer();
    const layer = document.getElementById("roster-player-drawer-layer");
    layer?.classList.add("open");
    layer?.setAttribute("aria-hidden", "false");
    document.body.classList.add("player-drawer-open");
  }

  function closeDrawer() {
    const layer = document.getElementById("roster-player-drawer-layer");
    layer?.classList.remove("open");
    layer?.setAttribute("aria-hidden", "true");
    document.body.classList.remove("player-drawer-open");
    if (returnFocus instanceof HTMLElement) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }

  function renderProfile(resource) {
    const target = document.getElementById("player-drawer-content");
    if (!target) return;

    const data = resource.data ?? {};
    const currentOvr = data.overall_rating;
    const startOvr = data.season_start_overall_rating;
    const delta = Number.isFinite(Number(currentOvr)) && Number.isFinite(Number(startOvr))
      ? Number(currentOvr) - Number(startOvr)
      : null;
    const deltaText = delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta}`;
    const isPractice = data.roster_status === "PRACTICE_SQUAD";

    const progressionItems = [
      detailItem("Previous OVR", data.previous_overall_rating),
      detailItem("Effective after week", data.effective_after_week),
      detailItem("Trait changed", hasValue(data.development_trait_changed) ? (data.development_trait_changed ? "Yes" : "No") : ""),
      detailItem("Change basis", data.change_basis)
    ].join("");

    const rosterItems = [
      detailItem("Age", data.age),
      detailItem("Entry", data.entry_summary),
      detailItem("Unit", data.unit),
      detailItem("Role", data.role),
      detailItem("Special teams", data.special_teams_role)
    ].join("");

    const contractItems = [
      detailItem("Contract", data.contract_summary),
      detailItem("2026 cap hit", hasValue(data.cap_hit_2026_millions) ? formatMillions(data.cap_hit_2026_millions) : ""),
      detailItem("Weekly salary", hasValue(data.practice_squad_weekly_salary) ? formatMoney(data.practice_squad_weekly_salary) : ""),
      detailItem("Week One protected", hasValue(data.week_one_protected) ? (data.week_one_protected ? "Yes" : "No") : ""),
      detailItem("Elevation profile", data.elevation_profile)
    ].join("");

    target.innerHTML = `
      <header class="player-profile-header">
        <div class="eyebrow">${escapeHtml(data.position_code ?? data.position ?? "Player")} • ${escapeHtml(statusLabel(data.roster_status))}</div>
        <h2 id="player-drawer-name">${escapeHtml(data.player_name ?? resource.resource_id)}</h2>
        <p>${escapeHtml(data.position ?? "Position unavailable")}${isPractice ? " • Practice squad" : ""}</p>
      </header>

      <section class="player-ovr-card">
        <div class="player-current-ovr">
          <span>Current OVR</span>
          <strong>${escapeHtml(displayValue(currentOvr))}</strong>
        </div>
        <div class="player-ovr-details">
          <div><span>Season start</span><strong>${escapeHtml(displayValue(startOvr))}</strong></div>
          <div><span>Change</span><strong class="${delta > 0 ? "positive" : ""}">${escapeHtml(deltaText)}</strong></div>
          <div><span>Development</span><strong class="player-profile-trait ${traitClass(data.development_trait)}">${escapeHtml(displayValue(data.development_trait))}</strong></div>
        </div>
      </section>

      ${rosterItems ? `<section class="player-profile-section"><h3>Football Profile</h3><div class="player-detail-grid">${rosterItems}</div></section>` : ""}
      ${contractItems ? `<section class="player-profile-section"><h3>${isPractice ? "Practice Squad and Contract" : "Contract"}</h3><div class="player-detail-grid">${contractItems}</div></section>` : ""}
      ${progressionItems ? `<section class="player-profile-section"><h3>Progression Record</h3><div class="player-detail-grid">${progressionItems}</div></section>` : ""}
      ${hasValue(data.contract_notes) ? `<section class="player-profile-section"><h3>Contract Notes</h3><p class="player-profile-note">${escapeHtml(data.contract_notes)}</p></section>` : ""}
      ${hasValue(data.football_notes) ? `<section class="player-profile-section"><h3>Football Notes</h3><p class="player-profile-note">${escapeHtml(data.football_notes)}</p></section>` : ""}

      <footer class="player-profile-footer">
        Resource ${escapeHtml(resource.resource_id)} • version ${escapeHtml(resource.version)}${resource.updated_at ? ` • updated ${escapeHtml(new Date(resource.updated_at).toLocaleString())}` : ""}
      </footer>`;
  }

  function renderError(error) {
    const target = document.getElementById("player-drawer-content");
    if (!target) return;
    target.innerHTML = `<div class="player-drawer-error"><h2>Profile unavailable</h2><p>${escapeHtml(error?.message ?? error)}</p></div>`;
  }

  async function openProfile(resourceId, opener) {
    if (!resourceId) return;
    returnFocus = opener instanceof HTMLElement ? opener : null;
    showDrawer();

    const target = document.getElementById("player-drawer-content");
    if (target) target.innerHTML = '<div class="player-drawer-loading">Loading player profile…</div>';

    const { data, error } = await drawerClient
      .from("archers_resources")
      .select("resource_id, version, data, updated_at")
      .eq("franchise_id", FRANCHISE_ID)
      .eq("resource_type", "player")
      .eq("resource_id", resourceId)
      .eq("status", "ACTIVE")
      .eq("visibility", "CONSOLE")
      .single();

    if (error) throw error;
    renderProfile(data);
    document.getElementById("player-drawer-close")?.focus({ preventScroll: true });
  }

  document.addEventListener("click", (event) => {
    const row = event.target.closest?.(".roster-player-row");
    if (!row) return;
    openProfile(row.dataset.resourceId, row).catch(renderError);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.getElementById("roster-player-drawer-layer")?.classList.contains("open")) {
      closeDrawer();
      return;
    }

    if ((event.key === "Enter" || event.key === " ") && event.target.matches?.(".roster-player-row")) {
      event.preventDefault();
      openProfile(event.target.dataset.resourceId, event.target).catch(renderError);
    }
  });

  const prepareRows = () => {
    document.querySelectorAll(".roster-player-row").forEach((row) => {
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      const name = row.querySelector(".roster-player-cell strong")?.textContent
        ?? row.closest(".squad-player-card")?.querySelector(".squad-player-name")?.textContent
        ?? "player";
      if (!row.hasAttribute("aria-label")) row.setAttribute("aria-label", `Open profile for ${name}`);
    });
  };

  window.addEventListener("DOMContentLoaded", () => {
    ensureDrawer();
    prepareRows();
    const rosterDirectory = document.getElementById("roster-directory");
    if (rosterDirectory) {
      new MutationObserver(prepareRows).observe(rosterDirectory, { childList: true, subtree: true });
    }
  });
})();
