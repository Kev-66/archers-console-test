(() => {
  const SUPABASE_URL = "https://oqbylwlkrabxvpdhugrf.supabase.co";
  const SUPABASE_KEY = "sb_publishable_z-EjW-S0x7GZH2VREEaXAw_NOOrbH-m";
  const FRANCHISE_ID = "stl-2026";
  const RESOURCE_ID = "draft-capital";

  const draftClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const CHECKPOINT_DRAFT_CAPITAL = {
    current_draft_year: 2027,
    as_of_label: "Sealed Week Two checkpoint",
    display_rule: "Full next draft; later years show transaction-created assets only",
    years: [
      {
        year: 2027,
        display_mode: "FULL",
        picks: [
          { round: 1, original_team: "St. Louis", status: "CONFIRMED", asset_type: "NATIVE" },
          { round: 1, original_team: "Las Vegas", status: "CONFIRMED", asset_type: "ACQUIRED" },
          { round: 2, original_team: "St. Louis", status: "CONFIRMED", asset_type: "NATIVE" },
          { round: 2, original_team: "Dallas", status: "CONFIRMED", asset_type: "ACQUIRED" },
          { round: 3, original_team: "St. Louis", status: "CONFIRMED", asset_type: "NATIVE" },
          { round: 3, original_team: "Las Vegas", status: "CONFIRMED", asset_type: "ACQUIRED" },
          { round: 4, original_team: "St. Louis", status: "CONFIRMED", asset_type: "NATIVE" },
          { round: 5, original_team: "St. Louis", status: "CONFIRMED", asset_type: "NATIVE" },
          { round: 6, original_team: "St. Louis", status: "CONFIRMED", asset_type: "NATIVE" },
          { round: 7, original_team: "St. Louis", status: "CONFIRMED", asset_type: "NATIVE" }
        ]
      },
      {
        year: 2028,
        display_mode: "TRANSACTION_ONLY",
        picks: [
          { round: 2, original_team: "Las Vegas", status: "CONFIRMED", asset_type: "ACQUIRED", note: "Acquired selection" },
          { round: 7, original_team: "Birmingham", status: "SECURED", asset_type: "CONDITIONAL", note: "Conveyance secured" },
          { round: 7, original_team: "New Orleans", status: "SECURED", asset_type: "CONDITIONAL", upgrade_round: 6, progress: "Tavon McCray: 2 active games, approximately 29% defensive snaps", condition: "Upgrades at 10 active games and at least 25% defensive snaps" },
          { round: 7, original_team: "Carolina", status: "SECURED", asset_type: "CONDITIONAL", upgrade_round: 6, progress: "Rashad Crowder: 93 rushing yards, 1 touchdown", condition: "Upgrades at 500 rushing yards or 8 combined touchdowns" },
          { round: 7, original_team: "Seattle", status: "PROVISIONAL", asset_type: "CONDITIONAL", upgrade_round: 6, progress: "Owen Bell: 2 active games, 11 punts", condition: "Sixth-round trigger at 8 active games or 50 punts" },
          { round: 7, original_team: "San Diego", status: "PROVISIONAL", asset_type: "CONDITIONAL", progress: "Samir Haddad: 2 of 3 active games", condition: "One more active game secures the seventh" },
          { round: 7, original_team: "Arizona", status: "PROVISIONAL", asset_type: "CONDITIONAL", upgrade_round: 6, progress: "Luis Ortega: 2 appearances, 5 made field goals, 5-for-6", condition: "Seventh at 4 appearances or 8 made field goals; sixth at 85% or better over 20 attempts" },
          { round: 7, original_team: "Phoenix", status: "PROVISIONAL", asset_type: "CONDITIONAL", upgrade_round: 6, progress: "Elijah Ross: 2 of 3 active games, approximately 40% defensive snaps", condition: "Sixth-round path also requires remaining on the roster through Week 12" },
          { round: 7, original_team: "Montréal", status: "PROVISIONAL", asset_type: "CONDITIONAL", progress: "Brennan Tupuola: 1 of 3 active games", condition: "Three active games secures the seventh" }
        ]
      }
    ]
  };

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const normalizeStatus = (value) => String(value ?? "CONFIRMED").trim().toUpperCase();

  function statusLabel(value) {
    const status = normalizeStatus(value);
    if (status === "SECURED") return "Secured";
    if (status === "PROVISIONAL") return "Provisional";
    if (status === "CONDITIONAL") return "Conditional";
    if (status === "CONFIRMED") return "Confirmed";
    return status.replaceAll("_", " ");
  }

  function statusClass(value) {
    const status = normalizeStatus(value);
    if (status === "PROVISIONAL" || status === "CONDITIONAL") return "warn";
    return "good";
  }

  function ensureMarkup() {
    const frontOffice = document.getElementById("frontoffice");
    if (!frontOffice) return false;
    if (document.getElementById("fo-draft-capital")) return true;

    const layout = frontOffice.querySelector(".fo-layout");
    const section = document.createElement("section");
    section.id = "fo-draft-capital";
    section.className = "panel fo-draft-capital";
    section.innerHTML = `
      <div class="section-head fo-draft-heading">
        <div>
          <h2>Draft Capital</h2>
          <p>Every pick in the next draft, plus only acquired or conditional assets from later years.</p>
        </div>
        <span id="fo-draft-source" class="pill warn">Loading draft ledger…</span>
      </div>
      <div id="fo-draft-metrics" class="fo-draft-metrics">
        <div class="fo-draft-metric"><span>Next Draft Picks</span><strong>—</strong></div>
        <div class="fo-draft-metric"><span>Later Trade Assets</span><strong>—</strong></div>
        <div class="fo-draft-metric"><span>Provisional</span><strong>—</strong></div>
        <div class="fo-draft-metric"><span>Upgrade Paths</span><strong>—</strong></div>
      </div>
      <div id="fo-draft-years" class="fo-draft-years">
        <div class="empty fo-loading">Loading draft capital…</div>
      </div>
      <p id="fo-draft-rule" class="fo-draft-rule"></p>`;

    frontOffice.insertBefore(section, layout ?? null);
    return true;
  }

  function normalizedYears(data) {
    const years = Array.isArray(data?.years) ? data.years : Array.isArray(data?.draft_years) ? data.draft_years : [];
    return years
      .map((entry) => ({
        year: Number(entry?.year),
        display_mode: entry?.display_mode ?? "TRANSACTION_ONLY",
        picks: Array.isArray(entry?.picks) ? entry.picks : []
      }))
      .filter((entry) => Number.isFinite(entry.year))
      .sort((a, b) => a.year - b.year);
  }

  function renderMetrics(years, currentYear) {
    const target = document.getElementById("fo-draft-metrics");
    if (!target) return;

    const currentPicks = years.find((entry) => entry.year === currentYear)?.picks ?? [];
    const laterPicks = years.filter((entry) => entry.year > currentYear).flatMap((entry) => entry.picks);
    const allPicks = years.flatMap((entry) => entry.picks);
    const provisional = allPicks.filter((pick) => ["PROVISIONAL", "CONDITIONAL"].includes(normalizeStatus(pick.status))).length;
    const upgrades = allPicks.filter((pick) => Number.isFinite(Number(pick.upgrade_round))).length;

    target.innerHTML = `
      <div class="fo-draft-metric"><span>${escapeHtml(currentYear)} Picks</span><strong>${currentPicks.length}</strong><small>Complete next-draft inventory</small></div>
      <div class="fo-draft-metric"><span>Later Trade Assets</span><strong>${laterPicks.length}</strong><small>Native later-year picks hidden</small></div>
      <div class="fo-draft-metric"><span>Provisional</span><strong>${provisional}</strong><small>Not yet fully secured</small></div>
      <div class="fo-draft-metric"><span>Upgrade Paths</span><strong>${upgrades}</strong><small>Selections that can improve</small></div>`;
  }

  function renderPick(pick) {
    const round = Number(pick.round);
    const upgradeRound = Number(pick.upgrade_round);
    const hasUpgrade = Number.isFinite(upgradeRound);
    const assetLabel = String(pick.asset_type ?? "").toUpperCase() === "NATIVE" ? "Native" : "From";

    return `
      <article class="fo-draft-pick ${statusClass(pick.status)}">
        <div class="fo-draft-pick-top">
          <div class="fo-draft-round"><span>Round</span><strong>${Number.isFinite(round) ? round : "—"}</strong></div>
          <div class="fo-draft-origin">
            <strong>${escapeHtml(pick.original_team ?? "Origin unavailable")}</strong>
            <span>${escapeHtml(assetLabel)}${hasUpgrade ? ` • can become Round ${escapeHtml(upgradeRound)}` : ""}</span>
          </div>
          <span class="pill ${statusClass(pick.status)}">${escapeHtml(statusLabel(pick.status))}</span>
        </div>
        ${pick.progress ? `<p class="fo-draft-progress"><strong>Progress:</strong> ${escapeHtml(pick.progress)}</p>` : ""}
        ${pick.condition ? `<p class="fo-draft-condition">${escapeHtml(pick.condition)}</p>` : ""}
        ${pick.note ? `<p class="fo-draft-condition">${escapeHtml(pick.note)}</p>` : ""}
      </article>`;
  }

  function renderYear(entry, currentYear) {
    const isCurrent = entry.year === currentYear;
    const title = isCurrent ? `${entry.year} Draft Board` : `${entry.year} Transaction Assets`;
    const subtitle = isCurrent
      ? "Complete owned-pick inventory"
      : "Only acquired, conditional, secured or provisional selections";

    const picks = [...entry.picks].sort((a, b) => Number(a.round) - Number(b.round) || String(a.original_team ?? "").localeCompare(String(b.original_team ?? "")));

    return `
      <section class="fo-draft-year">
        <div class="fo-draft-year-head">
          <div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(subtitle)}</p></div>
          <strong>${picks.length} ${picks.length === 1 ? "pick" : "picks"}</strong>
        </div>
        <div class="fo-draft-pick-grid">
          ${picks.map(renderPick).join("") || '<div class="empty">No displayed selections.</div>'}
        </div>
      </section>`;
  }

  function renderDraftCapital(data, source) {
    const years = normalizedYears(data);
    const currentYear = Number(data?.current_draft_year) || years[0]?.year;
    const target = document.getElementById("fo-draft-years");
    const sourceBadge = document.getElementById("fo-draft-source");
    const rule = document.getElementById("fo-draft-rule");
    if (!target || !sourceBadge || !rule || !Number.isFinite(currentYear)) return;

    renderMetrics(years, currentYear);
    target.innerHTML = years.map((entry) => renderYear(entry, currentYear)).join("") || '<div class="empty">No draft-capital years were returned.</div>';

    sourceBadge.className = `pill ${source.kind === "resource" ? "good" : "warn"}`;
    sourceBadge.textContent = source.kind === "resource" ? `Live resource v${source.version}` : "Checkpoint snapshot";
    rule.textContent = `${data?.display_rule ?? "Full next draft; later years show transaction-created assets only"} • ${data?.as_of_label ?? source.label}`;
  }

  async function fetchDraftResource() {
    const { data, error } = await draftClient
      .from("archers_resources")
      .select("resource_id, version, data, updated_at")
      .eq("franchise_id", FRANCHISE_ID)
      .eq("resource_type", "draft_capital")
      .eq("resource_id", RESOURCE_ID)
      .eq("status", "ACTIVE")
      .eq("visibility", "CONSOLE")
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async function loadDraftCapital(attempt = 0) {
    if (!ensureMarkup()) {
      if (attempt < 20) setTimeout(() => loadDraftCapital(attempt + 1).catch(showError), 50);
      return;
    }

    const resource = await fetchDraftResource();
    if (resource?.data) {
      renderDraftCapital(resource.data, { kind: "resource", version: resource.version, label: resource.updated_at ?? "live resource" });
      return;
    }

    renderDraftCapital(CHECKPOINT_DRAFT_CAPITAL, { kind: "checkpoint", label: CHECKPOINT_DRAFT_CAPITAL.as_of_label });
  }

  function showError(error) {
    if (!ensureMarkup()) return;
    const target = document.getElementById("fo-draft-years");
    const source = document.getElementById("fo-draft-source");
    if (source) {
      source.className = "pill bad";
      source.textContent = "Draft ledger unavailable";
    }
    if (target) target.innerHTML = `<div class="empty fo-loading">Draft capital could not load: ${escapeHtml(error?.message ?? error)}</div>`;
  }

  window.addEventListener("DOMContentLoaded", () => {
    loadDraftCapital().catch(showError);
    draftClient.channel("archers-draft-capital-phase3")
      .on("postgres_changes", { event: "*", schema: "public", table: "archers_resources", filter: `franchise_id=eq.${FRANCHISE_ID}` }, () => loadDraftCapital().catch(showError))
      .subscribe();
  });
})();
