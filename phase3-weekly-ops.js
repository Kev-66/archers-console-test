(() => {
  const SUPABASE_URL = "https://oqbylwlkrabxvpdhugrf.supabase.co";
  const SUPABASE_KEY = "sb_publishable_z-EjW-S0x7GZH2VREEaXAw_NOOrbH-m";
  const FRANCHISE_ID = "stl-2026";
  const SEASON = 2026;

  const weeklyClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  let stateRow = null;
  let players = [];
  let decisions = [];
  let activeDecision = null;
  let returnFocus = null;

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const normalizeText = (value) => String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  const asArray = (value) => Array.isArray(value) ? value : value == null ? [] : [value];

  function statusClass(value) {
    const text = String(value ?? "").toLowerCase();
    if (text.includes("out") || text.includes("blocked") || text.includes("failed")) return "bad";
    if (text.includes("next") || text.includes("monitor") || text.includes("pending") || text.includes("question") || text.includes("required")) return "warn";
    if (text.includes("clear") || text.includes("confirmed") || text.includes("active") || text.includes("ready")) return "good";
    return "";
  }

  function activateWeeklyOps() {
    document.querySelectorAll(".tab-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === "weeklyops");
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === "weeklyops");
    });
    localStorage.setItem("archers-console-tab", "weeklyops");
    history.replaceState(null, "", "#weeklyops");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function ensureMarkup() {
    const tabs = document.querySelector(".tabs");
    const gameDayButton = tabs?.querySelector('[data-tab="gameday"]');
    if (tabs && !tabs.querySelector('[data-tab="weeklyops"]')) {
      const button = document.createElement("button");
      button.className = "tab-button";
      button.dataset.tab = "weeklyops";
      button.textContent = "Weekly Ops";
      button.addEventListener("click", activateWeeklyOps);
      tabs.insertBefore(button, gameDayButton ?? null);
    }

    if (!document.getElementById("weeklyops")) {
      const gameDayPanel = document.getElementById("gameday");
      const section = document.createElement("section");
      section.id = "weeklyops";
      section.className = "tab-panel";
      section.innerHTML = `
        <div class="section-head wo-page-heading">
          <div>
            <h2>Weekly Operations</h2>
            <p id="wo-current-position">Current-week decisions, availability, opponent context and practice-squad work.</p>
          </div>
          <div id="wo-live-status" class="wo-live-status">Loading weekly operations…</div>
        </div>

        <section id="wo-metrics" class="wo-metrics">
          <div class="wo-metric-card"><span>Current Week</span><strong>—</strong><small>Loading timeline</small></div>
          <div class="wo-metric-card"><span>Next Opponent</span><strong>—</strong><small>Loading matchup</small></div>
          <div class="wo-metric-card"><span>Open Decisions</span><strong>—</strong><small>Loading queue</small></div>
          <div class="wo-metric-card"><span>Medical Flags</span><strong>—</strong><small>Loading availability</small></div>
        </section>

        <section id="wo-next-action" class="panel wo-full-section fo-collapsible-section">
          <div class="section-head wo-section-heading">
            <div><h2>Next Required Action</h2><p>The first recorded decision marked next or required.</p></div>
            <span id="wo-next-source" class="pill warn">Loading</span>
          </div>
          <div id="wo-next-body" class="fo-section-body"><div class="empty">Loading next action…</div></div>
        </section>

        <section class="wo-two-column">
          <article class="panel">
            <div class="section-head"><div><h2>Opponent Snapshot</h2><p>Current structured matchup context.</p></div></div>
            <div id="wo-opponent"><div class="empty">Loading opponent…</div></div>
          </article>
          <article class="panel">
            <div class="section-head"><div><h2>Medical & Availability</h2><p>Recorded medical items only.</p></div></div>
            <div id="wo-medical" class="list"><div class="empty">Loading medical board…</div></div>
          </article>
        </section>

        <section id="wo-decision-queue" class="panel wo-full-section fo-collapsible-section">
          <div class="section-head wo-section-heading">
            <div><h2>Decision Queue</h2><p>Review recorded choices and prepare a secure canon-action prompt.</p></div>
            <span id="wo-queue-source" class="pill warn">Loading</span>
          </div>
          <div id="wo-queue-body" class="fo-section-body"><div class="empty">Loading decision queue…</div></div>
        </section>

        <section id="wo-practice-squad" class="panel wo-full-section fo-collapsible-section">
          <div class="section-head wo-section-heading">
            <div><h2>Practice Squad Operations</h2><p>Protections, elevation context and current player profiles.</p></div>
            <span id="wo-ps-source" class="pill warn">Loading</span>
          </div>
          <div id="wo-ps-body" class="fo-section-body"><div class="empty">Loading practice squad…</div></div>
        </section>

        <section class="wo-two-column">
          <article class="panel">
            <div class="section-head"><div><h2>Evidence Boundaries</h2><p>Current limits on what may be inferred.</p></div></div>
            <div id="wo-boundaries" class="list"><div class="empty">Loading boundaries…</div></div>
          </article>
          <article class="panel wo-safety-card">
            <div class="section-head"><div><h2>Decision Safety</h2><p>Weekly Ops v1 remains read-only.</p></div></div>
            <div class="guardrail">Reviewing or copying a prepared prompt does not modify canon. Authenticated writes remain inside the dedicated Draft a Dynasty GPT.</div>
          </article>
        </section>`;
      gameDayPanel?.parentNode?.insertBefore(section, gameDayPanel);
    }

    ensureDialog();
    const requested = location.hash.slice(1) || localStorage.getItem("archers-console-tab");
    if (requested === "weeklyops") activateWeeklyOps();
    return true;
  }

  function ensureDialog() {
    if (document.getElementById("wo-decision-dialog")) return;
    document.body.insertAdjacentHTML("beforeend", `
      <dialog id="wo-decision-dialog" class="wo-decision-dialog" aria-labelledby="wo-dialog-title">
        <form method="dialog" class="wo-dialog-shell">
          <button class="wo-dialog-close" value="cancel" aria-label="Close decision review">×</button>
          <div class="eyebrow">Weekly Ops • Read-only review</div>
          <h2 id="wo-dialog-title">Decision Review</h2>
          <div id="wo-dialog-content"></div>
          <div class="wo-dialog-actions">
            <button type="button" id="wo-copy-prompt" class="wo-primary-button">Copy Canon Prompt</button>
            <button value="cancel" class="wo-secondary-button">Close</button>
          </div>
          <div id="wo-copy-status" class="wo-copy-status" aria-live="polite"></div>
        </form>
      </dialog>`);

    const dialog = document.getElementById("wo-decision-dialog");
    dialog?.addEventListener("close", () => {
      activeDecision = null;
      if (returnFocus instanceof HTMLElement) returnFocus.focus({ preventScroll: true });
      returnFocus = null;
    });
    dialog?.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    document.getElementById("wo-copy-prompt")?.addEventListener("click", copyPreparedPrompt);
  }

  function normalizeChoice(choice) {
    if (typeof choice === "string") return { label: choice, value: choice };
    const label = choice?.label ?? choice?.title ?? choice?.name ?? choice?.option ?? choice?.value;
    const value = choice?.value ?? choice?.instruction ?? choice?.label ?? choice?.title ?? choice?.name;
    return label ? { label: String(label), value: String(value ?? label) } : null;
  }

  function normalizeDecision(item, index) {
    const title = item?.title ?? item?.decision ?? item?.name ?? `Decision ${index + 1}`;
    const choices = asArray(item?.choices ?? item?.options ?? item?.available_choices ?? item?.actions)
      .map(normalizeChoice)
      .filter(Boolean);
    return {
      id: item?.decision_id ?? item?.id ?? `decision-${index + 1}`,
      title,
      note: item?.note ?? item?.summary ?? item?.description ?? "",
      status: item?.status ?? "Open",
      choices,
      raw: item
    };
  }

  function findPlayer(name) {
    const needle = normalizeText(name);
    if (!needle) return null;
    return players.find((row) => normalizeText(row.data?.player_name) === needle)
      ?? players.find((row) => normalizeText(row.data?.player_name).includes(needle) || needle.includes(normalizeText(row.data?.player_name)));
  }

  function playerNameMarkup(name, position = "") {
    const resource = findPlayer(name);
    const label = [name, position].filter(Boolean).join(" • ");
    if (!resource) return `<strong>${escapeHtml(label)}</strong>`;
    return `<button type="button" class="wo-player-link roster-player-row" data-resource-id="${escapeHtml(resource.resource_id)}">${escapeHtml(label)}</button>`;
  }

  function chooseNextDecision(items) {
    return items.find((item) => /next|required|urgent/i.test(String(item.status))) ?? items[0] ?? null;
  }

  function renderMetrics(state) {
    const target = document.getElementById("wo-metrics");
    if (!target) return;
    const timeline = state.timeline ?? {};
    const opponent = state.opponent ?? {};
    const medical = asArray(state.medical);

    target.innerHTML = `
      <div class="wo-metric-card"><span>Current Week</span><strong>Week ${escapeHtml(timeline.week ?? "—")}</strong><small>${escapeHtml(timeline.day ?? "Day unavailable")}</small></div>
      <div class="wo-metric-card"><span>Next Opponent</span><strong>${escapeHtml(opponent.name ?? opponent.team_name ?? "—")}</strong><small>${escapeHtml(opponent.kickoff_label ?? "Kickoff unavailable")}</small></div>
      <div class="wo-metric-card"><span>Open Decisions</span><strong>${decisions.length}</strong><small>${decisions.length === 1 ? "Recorded franchise decision" : "Recorded franchise decisions"}</small></div>
      <div class="wo-metric-card"><span>Medical Flags</span><strong>${medical.length}</strong><small>Recorded availability items</small></div>`;
  }

  function renderNextAction() {
    const target = document.getElementById("wo-next-body");
    const badge = document.getElementById("wo-next-source");
    if (!target || !badge) return;
    const next = chooseNextDecision(decisions);

    if (!next) {
      badge.className = "pill good";
      badge.textContent = "Queue clear";
      target.innerHTML = '<div class="empty">No open franchise decisions are recorded.</div>';
      return;
    }

    const index = decisions.indexOf(next);
    badge.className = `pill ${statusClass(next.status) || "warn"}`;
    badge.textContent = next.status;
    target.innerHTML = `
      <div class="wo-next-card">
        <div>
          <div class="eyebrow">First meaningful decision</div>
          <h3>${escapeHtml(next.title)}</h3>
          <p>${escapeHtml(next.note || "No additional note was recorded.")}</p>
          <div class="wo-context-line">State v${escapeHtml(stateRow?.version ?? "—")} • Kevin approval required before any canon write</div>
        </div>
        <button type="button" class="wo-review-button" data-review-decision="${index}">Review Decision</button>
      </div>`;
  }

  function renderDecisionQueue() {
    const target = document.getElementById("wo-queue-body");
    const badge = document.getElementById("wo-queue-source");
    if (!target || !badge) return;

    badge.className = `pill ${decisions.length ? "warn" : "good"}`;
    badge.textContent = `${decisions.length} open`;
    target.innerHTML = decisions.map((decision, index) => `
      <article class="wo-decision-card">
        <div class="wo-decision-main">
          <div class="wo-decision-head">
            <h3>${escapeHtml(decision.title)}</h3>
            <span class="pill ${statusClass(decision.status)}">${escapeHtml(decision.status)}</span>
          </div>
          <p>${escapeHtml(decision.note || "No additional note was recorded.")}</p>
          <div class="wo-choice-summary">${decision.choices.length
            ? `${decision.choices.length} recorded ${decision.choices.length === 1 ? "choice" : "choices"}`
            : "No structured choices recorded • free-text instruction available in review"}</div>
        </div>
        <button type="button" class="wo-review-button" data-review-decision="${index}">Review Decision</button>
      </article>`).join("") || '<div class="empty">No open decisions are recorded.</div>';
  }

  function renderOpponent(state, teams, standings) {
    const target = document.getElementById("wo-opponent");
    if (!target) return;
    const opponent = state.opponent ?? {};
    const opponentName = opponent.name ?? opponent.team_name ?? "Opponent unavailable";
    const opponentId = opponent.team_id ?? opponent.opponent_team_id
      ?? teams.find((team) => normalizeText(team.team_name) === normalizeText(opponentName))?.team_id;
    const team = teams.find((row) => row.team_id === opponentId);
    const standing = standings.find((row) => row.team_id === opponentId);
    const record = standing ? `${standing.wins ?? 0}-${standing.losses ?? 0}${standing.ties ? `-${standing.ties}` : ""}` : "—";
    const differential = Number.isFinite(Number(standing?.point_differential))
      ? `${Number(standing.point_differential) >= 0 ? "+" : ""}${standing.point_differential}`
      : "—";

    target.innerHTML = `
      <div class="wo-opponent-name">${escapeHtml(opponentName)}</div>
      <div class="wo-opponent-kickoff">${escapeHtml(opponent.kickoff_label ?? "Kickoff unavailable")}</div>
      <dl class="wo-opponent-grid">
        <div><dt>Record</dt><dd>${escapeHtml(record)}</dd></div>
        <div><dt>Division</dt><dd>${escapeHtml(team?.division ?? "—")}</dd></div>
        <div><dt>Point Diff</dt><dd>${escapeHtml(differential)}</dd></div>
        <div><dt>Streak</dt><dd>${escapeHtml(standing?.streak ?? "—")}</dd></div>
      </dl>
      <div class="wo-data-note">${standing ? "Derived from the current recorded league standings." : "No matching structured standings row was found for this opponent."}</div>`;
  }

  function renderMedical(state) {
    const target = document.getElementById("wo-medical");
    if (!target) return;
    const medical = asArray(state.medical);
    target.innerHTML = medical.map((item) => `
      <div class="item">
        <div class="item-top">
          <div>${playerNameMarkup(item.name ?? "Player", item.position ?? "")}</div>
          <span class="pill ${statusClass(item.status)}">${escapeHtml(item.status ?? "Monitor")}</span>
        </div>
        <div class="item-note">${escapeHtml(item.issue ?? "Issue not recorded")}</div>
        ${item.plan ? `<div class="item-note"><strong>Plan:</strong> ${escapeHtml(item.plan)}</div>` : ""}
      </div>`).join("") || '<div class="empty">No active medical items are recorded.</div>';
  }

  function formatMoney(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(parsed)
      : "—";
  }

  function renderPracticeSquad(state) {
    const target = document.getElementById("wo-ps-body");
    const badge = document.getElementById("wo-ps-source");
    if (!target || !badge) return;
    const roster = state.roster ?? {};
    const psPlayers = players
      .filter((row) => row.data?.roster_status === "PRACTICE_SQUAD")
      .sort((a, b) => String(a.data?.position_code ?? "").localeCompare(String(b.data?.position_code ?? "")) || String(a.data?.player_name ?? "").localeCompare(String(b.data?.player_name ?? "")));

    badge.className = `pill ${psPlayers.length ? "good" : "warn"}`;
    badge.textContent = `${psPlayers.length} players`;
    target.innerHTML = `
      <div class="wo-ps-banner">
        <div><span>Week Three protections</span><strong>${escapeHtml(roster.week_three_protections_status ?? "Not recorded")}</strong></div>
        <div><span>Recorded elevations</span><strong>${escapeHtml(asArray(roster.elevations).length)}</strong></div>
      </div>
      <div class="table-wrap">
        <table class="wo-ps-table">
          <thead><tr><th>Player</th><th>Pos</th><th>OVR</th><th>Role</th><th>Weekly Salary</th><th>Elevation Profile</th></tr></thead>
          <tbody>${psPlayers.map((row) => `
            <tr class="roster-player-row" data-resource-id="${escapeHtml(row.resource_id)}">
              <td><strong>${escapeHtml(row.data?.player_name ?? row.resource_id)}</strong></td>
              <td>${escapeHtml(row.data?.position_code ?? row.data?.position ?? "—")}</td>
              <td>${escapeHtml(row.data?.overall_rating ?? "—")}</td>
              <td>${escapeHtml(row.data?.role ?? "—")}</td>
              <td>${escapeHtml(formatMoney(row.data?.practice_squad_weekly_salary))}</td>
              <td>${escapeHtml(row.data?.elevation_profile ?? "—")}</td>
            </tr>`).join("") || '<tr><td colspan="6">No practice-squad profiles are visible.</td></tr>'}</tbody>
        </table>
      </div>`;
  }

  function renderBoundaries(state) {
    const target = document.getElementById("wo-boundaries");
    if (!target) return;
    const boundaries = asArray(state.canon?.evidence_boundaries);
    target.innerHTML = boundaries.map((item) => `<div class="item"><div class="item-note">${escapeHtml(item)}</div></div>`).join("")
      || '<div class="empty">No evidence boundaries are recorded.</div>';
  }

  function renderPage(data, teams, standings) {
    const state = data.state ?? {};
    decisions = asArray(state.open_decisions).map(normalizeDecision);
    renderMetrics(state);
    renderNextAction();
    renderDecisionQueue();
    renderOpponent(state, teams, standings);
    renderMedical(state);
    renderPracticeSquad(state);
    renderBoundaries(state);

    const status = document.getElementById("wo-live-status");
    if (status) {
      const updated = data.updated_at ? new Date(data.updated_at).toLocaleString() : "update time unavailable";
      status.textContent = `State v${data.version} • ${updated}`;
    }
    const currentPosition = document.getElementById("wo-current-position");
    if (currentPosition) currentPosition.textContent = state.timeline?.exact_continuation_point ?? state.timeline?.current_position ?? "Current-week decisions, availability, opponent context and practice-squad work.";
    setupCollapsibles();
  }

  function setupCollapsibles(attempt = 0) {
    const upgrade = window.ArchersCollapsibleSections?.upgradeSection;
    if (!upgrade) {
      if (attempt < 80) setTimeout(() => setupCollapsibles(attempt + 1), 50);
      return;
    }

    const specs = [
      ["wo-next-action", ".wo-section-heading", "wo-next-body", "wo-next-source", "archers-weeklyops-next-action-collapsed", "Next Required Action"],
      ["wo-decision-queue", ".wo-section-heading", "wo-queue-body", "wo-queue-source", "archers-weeklyops-decision-queue-collapsed", "Decision Queue"],
      ["wo-practice-squad", ".wo-section-heading", "wo-ps-body", "wo-ps-source", "archers-weeklyops-practice-squad-collapsed", "Practice Squad Operations"]
    ];

    specs.forEach(([sectionId, headingSelector, bodyId, sourceId, storageKey, label]) => {
      const section = document.getElementById(sectionId);
      upgrade({
        section,
        heading: section?.querySelector(headingSelector),
        body: document.getElementById(bodyId),
        source: document.getElementById(sourceId),
        storageKey,
        label
      });
    });
  }

  function buildCanonPrompt(decision, instruction) {
    const state = stateRow?.state ?? {};
    const boundaries = asArray(state.canon?.evidence_boundaries);
    const cleanInstruction = String(instruction ?? "").trim() || "[Kevin must enter an explicit decision before continuing]";
    return `Read the current franchise snapshot, current Action capabilities, recent audit log, and every active resource relevant to this decision. Do not assume the displayed state version is still current.\n\nDecision under review: ${decision.title}\nRecorded status: ${decision.status}\nRecorded note: ${decision.note || "No additional note recorded"}\nDisplayed state version: ${stateRow?.version ?? "unknown"}\nKevin's explicit instruction: ${cleanInstruction}\n\nEvidence boundaries currently displayed by the console:\n${boundaries.length ? boundaries.map((item) => `- ${item}`).join("\n") : "- None recorded in the current snapshot"}\n\nVerify the current state and relevant resources before continuing. If anything material changed, stop and explain the conflict. Respect the Kevin lock, do not invent Kevin's dialogue or deliberate actions, and follow the current authenticated Action requirements. Afterward, return a compact technical handoff with the outcome, affected records and versions, resulting state version, verification results, and unresolved issues.`;
  }

  function openDecisionReview(index, opener) {
    const decision = decisions[index];
    const dialog = document.getElementById("wo-decision-dialog");
    const content = document.getElementById("wo-dialog-content");
    if (!decision || !dialog || !content) return;
    activeDecision = decision;
    returnFocus = opener instanceof HTMLElement ? opener : null;

    content.innerHTML = `
      <div class="wo-dialog-status"><span class="pill ${statusClass(decision.status)}">${escapeHtml(decision.status)}</span><span>Displayed state v${escapeHtml(stateRow?.version ?? "—")}</span></div>
      <section class="wo-dialog-section"><h3>${escapeHtml(decision.title)}</h3><p>${escapeHtml(decision.note || "No additional note was recorded.")}</p></section>
      ${decision.choices.length ? `<fieldset class="wo-choice-fieldset"><legend>Recorded choices</legend>${decision.choices.map((choice) => `<label><input type="radio" name="wo-choice" value="${escapeHtml(choice.value)}"><span>${escapeHtml(choice.label)}</span></label>`).join("")}</fieldset>` : '<div class="wo-dialog-note">No structured choices were recorded for this item. Enter Kevin’s explicit instruction below.</div>'}
      <label class="wo-instruction-label" for="wo-decision-instruction">Kevin’s explicit instruction</label>
      <textarea id="wo-decision-instruction" rows="4" placeholder="Example: Protect Player A, Player B, Player C and Player D for Week Three."></textarea>
      <details class="wo-prompt-preview"><summary>Preview prepared canon prompt</summary><pre id="wo-prompt-preview-text"></pre></details>
      <div class="wo-dialog-note">This review does not execute a write. The prepared prompt must be sent to the authenticated Draft a Dynasty GPT.</div>`;

    const textarea = document.getElementById("wo-decision-instruction");
    const preview = document.getElementById("wo-prompt-preview-text");
    const refreshPreview = () => {
      if (preview) preview.textContent = buildCanonPrompt(decision, textarea?.value);
    };
    content.querySelectorAll('input[name="wo-choice"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        if (textarea) textarea.value = radio.value;
        refreshPreview();
      });
    });
    textarea?.addEventListener("input", refreshPreview);
    refreshPreview();
    document.getElementById("wo-copy-status").textContent = "";

    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    textarea?.focus({ preventScroll: true });
  }

  async function copyPreparedPrompt() {
    const status = document.getElementById("wo-copy-status");
    const instruction = document.getElementById("wo-decision-instruction")?.value ?? "";
    if (!activeDecision) return;
    const prompt = buildCanonPrompt(activeDecision, instruction);
    try {
      await navigator.clipboard.writeText(prompt);
      if (status) status.textContent = "Canon-action prompt copied. No franchise write occurred.";
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = prompt;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
      if (status) status.textContent = "Canon-action prompt copied. No franchise write occurred.";
    }
  }

  async function loadWeeklyOps() {
    ensureMarkup();
    const [stateResult, playersResult, teamsResult, standingsResult] = await Promise.all([
      weeklyClient.from("archers_franchise_state").select("version, state, updated_at").eq("id", FRANCHISE_ID).single(),
      weeklyClient.from("archers_resources").select("resource_id, version, data, updated_at").eq("franchise_id", FRANCHISE_ID).eq("resource_type", "player").eq("status", "ACTIVE").eq("visibility", "CONSOLE").order("resource_id"),
      weeklyClient.from("cff_teams").select("team_id, team_name, conference, division").eq("active", true),
      weeklyClient.from("cff_standings").select("team_id, wins, losses, ties, point_differential, streak").eq("season", SEASON)
    ]);

    for (const result of [stateResult, playersResult, teamsResult, standingsResult]) {
      if (result.error) throw result.error;
    }

    stateRow = stateResult.data;
    players = playersResult.data ?? [];
    renderPage(stateRow, teamsResult.data ?? [], standingsResult.data ?? []);
  }

  function showError(error) {
    ensureMarkup();
    const status = document.getElementById("wo-live-status");
    if (status) status.textContent = "Weekly Ops unavailable";
    const target = document.getElementById("wo-next-body");
    if (target) target.innerHTML = `<div class="empty">Weekly Operations could not load: ${escapeHtml(error?.message ?? error)}</div>`;
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-review-decision]");
    if (!button) return;
    openDecisionReview(Number(button.dataset.reviewDecision), button);
  });

  window.addEventListener("DOMContentLoaded", () => {
    loadWeeklyOps().catch(showError);
    weeklyClient.channel("archers-weekly-ops-phase3")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "archers_franchise_state", filter: `id=eq.${FRANCHISE_ID}` }, () => loadWeeklyOps().catch(showError))
      .on("postgres_changes", { event: "*", schema: "public", table: "archers_resources", filter: `franchise_id=eq.${FRANCHISE_ID}` }, () => loadWeeklyOps().catch(showError))
      .on("postgres_changes", { event: "*", schema: "public", table: "cff_standings" }, () => loadWeeklyOps().catch(showError))
      .subscribe();
  });
})();
