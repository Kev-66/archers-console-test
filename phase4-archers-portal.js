(() => {
  const APP = window.ArchersApp;
  if (!APP?.config || !APP?.createSupabaseClient) {
    console.error("Archers Portal requires archers-app-config.js");
    return;
  }

  const { franchiseId, season } = APP.config;
  const portalClient = APP.createSupabaseClient();
  const ACTIVE_DECISION_STATUSES = new Set(["OPEN", "READY_FOR_REVIEW", "AWAITING_KEVIN", "BLOCKED"]);
  const PRIORITY_RANK = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

  let snapshot = null;
  let reloadTimer = null;
  let channel = null;

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const asArray = (value) => Array.isArray(value) ? value : value == null ? [] : [value];
  const upper = (value, fallback = "") => String(value ?? fallback).trim().toUpperCase().replaceAll(" ", "_");
  const numberOrNull = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

  function setText(id, value) {
    const target = document.getElementById(id);
    if (target) target.textContent = value ?? "—";
  }

  function statusClass(value) {
    const status = upper(value);
    if (["RESOLVED", "READY_FOR_REVIEW", "CONFIRMED", "ACTIVE", "FINAL"].includes(status)) return "good";
    if (["BLOCKED", "EXPIRED", "OUT", "FAILED"].includes(status)) return "bad";
    return "warn";
  }

  function decisionSort(a, b) {
    const priority = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
    if (priority) return priority;
    const aDue = a.dueWeek == null ? 999 : Number(a.dueWeek);
    const bDue = b.dueWeek == null ? 999 : Number(b.dueWeek);
    if (aDue !== bDue) return aDue - bDue;
    return a.title.localeCompare(b.title);
  }

  function normalizeDecision(item, index) {
    return {
      id: String(item?.decision_id ?? item?.id ?? `decision-${index + 1}`),
      title: String(item?.title ?? item?.decision ?? item?.name ?? `Decision ${index + 1}`),
      summary: String(item?.summary ?? item?.note ?? item?.description ?? item?.decision_question ?? ""),
      status: upper(item?.status, "OPEN"),
      priority: upper(item?.priority, "NORMAL"),
      category: upper(item?.category, "OTHER"),
      dueWeek: item?.due_week ?? null,
      dueDate: item?.due_date ?? null,
      deadlineLabel: String(item?.deadline_label ?? item?.deadline ?? ""),
      recommendation: String(item?.recommended_action ?? ""),
      sourceLabel: String(item?.source_label ?? "Decision Queue")
    };
  }

  function deadlineText(decision) {
    if (decision.deadlineLabel) return decision.deadlineLabel;
    if (decision.dueWeek != null) return `Due Week ${decision.dueWeek}`;
    if (decision.dueDate) {
      const parsed = new Date(decision.dueDate);
      return Number.isNaN(parsed.getTime()) ? decision.dueDate : `Due ${parsed.toLocaleDateString()}`;
    }
    return "No recorded deadline";
  }

  function setupPortalMarkup() {
    const overview = document.getElementById("overview");
    if (!overview || overview.dataset.portalReady === "true") return overview;

    overview.dataset.portalReady = "true";
    overview.classList.add("archers-portal");

    const overviewButton = document.querySelector('.tab-button[data-tab="overview"]');
    if (overviewButton) {
      overviewButton.textContent = "Portal";
      overviewButton.setAttribute("aria-label", "Open Archers Portal");
    }

    const headerSubtitle = document.querySelector("main > header p");
    if (headerSubtitle) headerSubtitle.textContent = "Owner and General Manager Command Center";

    overview.innerHTML = `
      <div class="portal-shell">
        <section class="portal-hero" aria-labelledby="portal-title">
          <div class="portal-hero-copy">
            <div class="eyebrow">Archers Portal • Current Operations</div>
            <h2 id="portal-title">Your franchise morning briefing</h2>
            <p id="portal-hero-summary" class="portal-hero-summary">Connecting the live Decision Queue, roster, contracts, calendar and franchise history…</p>
            <div class="portal-context-line">
              <span id="portal-current-position">Loading continuation point…</span>
              <span id="portal-source-status" class="portal-source-status"><i class="portal-source-dot"></i><b>Connecting</b></span>
            </div>
          </div>
          <div class="portal-hero-actions">
            <button id="portal-continue" type="button" class="portal-primary-action">Copy Continue Franchise Prompt</button>
            <button id="portal-next-decision" type="button" class="portal-secondary-action" disabled>Review Next Decision</button>
            <div id="portal-action-note" class="portal-action-note" aria-live="polite">No canon write can occur from the Portal.</div>
          </div>
        </section>

        <section class="portal-metrics" aria-label="Franchise status">
          <div class="portal-metric"><div class="label">Record</div><div id="record" class="value">—</div><div id="standing" class="subvalue">—</div></div>
          <div class="portal-metric"><div class="label">Current Week</div><div id="week" class="value">—</div><div id="day" class="subvalue">—</div></div>
          <div class="portal-metric"><div class="label">Next Opponent</div><div id="opponent" class="value">—</div><div id="kickoff" class="subvalue">—</div></div>
          <div class="portal-metric"><div class="label">Needs Attention</div><div id="portal-decision-count" class="value">—</div><div id="portal-decision-subtitle" class="subvalue">Loading Decision Queue</div></div>
          <div class="portal-metric"><div class="label">State Version</div><div id="version" class="value">—</div><div id="updated" class="subvalue">—</div></div>
        </section>

        <details class="portal-section" open>
          <summary><div class="portal-summary-copy"><h2>Needs Your Attention</h2><p>Only active, authoritative Decision Queue items appear here.</p></div><span id="portal-attention-badge" class="pill warn">Loading</span></summary>
          <div id="portal-attention-list" class="portal-section-body portal-attention-list"><div class="portal-loading">Loading live decisions…</div></div>
        </details>

        <section class="portal-priority-grid">
          <article class="portal-card">
            <div class="section-head"><div><h2>Staff Briefing</h2><p>Evidence-based operational summaries, never invented staff dialogue.</p></div></div>
            <div id="portal-briefing-list" class="portal-briefing-list"><div class="portal-loading">Preparing staff desks…</div></div>
          </article>
          <article class="portal-card">
            <div class="section-head"><div><h2>Upcoming Calendar</h2><p>Current position, decision deadlines and scheduled football events.</p></div></div>
            <div id="portal-calendar-list" class="portal-calendar-list"><div class="portal-loading">Loading calendar…</div></div>
          </article>
        </section>

        <section class="portal-lower-grid">
          <article class="portal-card">
            <div class="section-head"><div><h2>Team Pulse</h2><p>Roster, medical, contract and cap pressure at a glance.</p></div></div>
            <div id="portal-pulse-list" class="portal-pulse-list"><div class="portal-loading">Reading team pulse…</div></div>
          </article>
          <article class="portal-card portal-squad-foundation">
            <div class="section-head"><div><h2>Squad Planner Outlook</h2><p>The first app-ready bridge into future positional planning.</p></div><span class="pill">Foundation</span></div>
            <div id="portal-outlook-list" class="portal-outlook-list"><div class="portal-loading">Calculating 2027 control…</div></div>
            <button type="button" class="portal-inline-button" data-portal-route="squadplanner" style="margin-top:12px">Open Squad Planner</button>
          </article>
        </section>

        <details class="portal-section" open>
          <summary><div class="portal-summary-copy"><h2>Recent Activity</h2><p>Transactions and canon events drawn from authoritative records.</p></div><span id="portal-activity-badge" class="pill">Loading</span></summary>
          <div id="portal-activity-list" class="portal-section-body portal-activity-list"><div class="portal-loading">Loading recent activity…</div></div>
        </details>

        <article class="portal-card">
          <div class="section-head"><div><h2>Quick Launch</h2><p>Move from the morning briefing to the responsible operations room.</p></div></div>
          <div class="portal-quick-grid">
            <button type="button" class="portal-quick-link" data-portal-route="weeklyops"><span class="portal-quick-icon">📋</span><strong>Weekly Ops</strong><span>Opponent, availability and the full Decision Queue.</span></button>
            <button type="button" class="portal-quick-link" data-portal-route="roster"><span class="portal-quick-icon">👥</span><strong>Roster</strong><span>Players, depth, practice squad and profile drawers.</span></button>
            <button type="button" class="portal-quick-link" data-portal-route="squadplanner"><span class="portal-quick-icon">🧩</span><strong>Squad Planner</strong><span>Local, non-canon position-room and future-control planning.</span></button>
            <button type="button" class="portal-quick-link" data-portal-route="frontoffice"><span class="portal-quick-icon">🏢</span><strong>Front Office</strong><span>Contracts, cap, transactions and Trade Finder.</span></button>
            <button type="button" class="portal-quick-link" data-portal-route="gameday"><span class="portal-quick-icon">🏟️</span><strong>Game Day</strong><span>Live game operations and official reconciliation.</span></button>
            <button type="button" class="portal-quick-link" data-portal-route="league"><span class="portal-quick-icon">🗺️</span><strong>League</strong><span>Standings, scoreboard and confirmed alignment.</span></button>
            <button type="button" class="portal-quick-link" data-portal-route="schedule"><span class="portal-quick-icon">🗓️</span><strong>Schedule</strong><span>The Archers season calendar and preserved results.</span></button>
            <button type="button" class="portal-quick-link" data-portal-route="archive"><span class="portal-quick-icon">🏛️</span><strong>Archive</strong><span>Canon events, checkpoints and dynasty history foundation.</span></button>
          </div>
        </article>

        <div class="portal-legacy-bridge" aria-hidden="true">
          <p id="continuation"></p><div id="decisions"></div><div id="overviewMedical"></div><div id="kevinLock"></div><div id="dialogueRule"></div>
          <span id="constitution"></span><span id="operationsManual"></span><span id="archivedBible"></span><span id="checkpoint"></span><span id="seal"></span>
          <span id="bow"></span><span id="standard"></span><span id="term"></span><span id="cap"></span><div id="overviewCentral"></div>
        </div>
      </div>`;

    overview.querySelectorAll("[data-portal-route]").forEach((button) => {
      button.addEventListener("click", () => APP.routeTo(button.dataset.portalRoute));
    });
    document.getElementById("portal-continue")?.addEventListener("click", copyContinuationPrompt);
    document.getElementById("portal-next-decision")?.addEventListener("click", (event) => {
      const decisionId = event.currentTarget.dataset.decisionId;
      if (!decisionId) return;
      const reviewButton = document.createElement("button");
      reviewButton.type = "button";
      reviewButton.dataset.dqReview = decisionId;
      reviewButton.hidden = true;
      document.body.append(reviewButton);
      reviewButton.click();
      reviewButton.remove();
    });

    return overview;
  }

  function renderAttention(decisions, queueVersion) {
    const target = document.getElementById("portal-attention-list");
    const badge = document.getElementById("portal-attention-badge");
    const nextButton = document.getElementById("portal-next-decision");
    if (!target || !badge || !nextButton) return;

    setText("portal-decision-count", decisions.length);
    setText("portal-decision-subtitle", decisions.length ? `Decision Queue v${queueVersion ?? "—"}` : "Queue clear");
    badge.className = `pill ${decisions.length ? "warn" : "good"}`;
    badge.textContent = decisions.length ? `${decisions.length} active` : "Queue clear";

    const next = decisions[0] ?? null;
    nextButton.disabled = !next;
    nextButton.dataset.decisionId = next?.id ?? "";
    nextButton.textContent = next ? `Review: ${next.title}` : "No Active Decision";

    target.innerHTML = decisions.slice(0, 5).map((decision) => `
      <article class="portal-attention-card">
        <div>
          <div class="portal-kicker"><span class="pill ${statusClass(decision.priority)}">${escapeHtml(decision.priority)}</span><span>${escapeHtml(decision.category.replaceAll("_", " "))}</span><span>${escapeHtml(deadlineText(decision))}</span></div>
          <h3>${escapeHtml(decision.title)}</h3>
          <p>${escapeHtml(decision.summary || "No additional decision context was recorded.")}</p>
          <div class="portal-decision-meta">${escapeHtml(decision.status.replaceAll("_", " "))} • ${escapeHtml(decision.sourceLabel)} • ID ${escapeHtml(decision.id)}</div>
        </div>
        <button type="button" class="portal-inline-button" data-dq-review="${escapeHtml(decision.id)}">Review Decision</button>
      </article>`).join("") || '<div class="portal-empty">No active decisions require Kevin’s attention.</div>';
  }

  function contractFacts(resources) {
    const contracts = resources
      .filter((row) => ["player", "staff"].includes(row.resource_type))
      .map((row) => ({ row, contract: row.data?.contract }))
      .filter((item) => item.contract && typeof item.contract === "object");

    const finalYear = contracts.filter(({ contract }) => upper(contract.rollover_status) === "FINAL_YEAR" || Number(contract.end_season) === season);
    const expired = contracts.filter(({ contract }) => upper(contract.rollover_status) === "EXPIRED" || Number(contract.end_season) < season);
    const optionsDue = contracts.filter(({ contract }) => asArray(contract.options_due).length || asArray(contract.options).some((option) => Number(option?.decision_season ?? option?.exercise_season) === season));
    return { contracts, finalYear, expired, optionsDue };
  }

  function renderBriefing(state, decisions, resources) {
    const target = document.getElementById("portal-briefing-list");
    if (!target) return;
    const medical = asArray(state.medical);
    const roster = state.roster ?? {};
    const facts = contractFacts(resources);
    const next = decisions[0];
    const firstMedical = medical[0];

    const cards = [
      {
        source: next?.sourceLabel ?? "Football Operations",
        title: next ? next.title : "No active football decision",
        body: next?.recommendation || next?.summary || "The live Decision Queue is clear."
      },
      {
        source: "Medical Board",
        title: medical.length ? `${medical.length} recorded availability ${medical.length === 1 ? "item" : "items"}` : "Medical board clear",
        body: firstMedical ? [firstMedical.name, firstMedical.issue, firstMedical.plan].filter(Boolean).join(" • ") : "No active medical item is recorded in franchise state."
      },
      {
        source: "Contract Desk",
        title: `${facts.finalYear.length} final-year • ${facts.optionsDue.length} option-due`,
        body: facts.expired.length ? `${facts.expired.length} active resource contracts are marked expired and require review.` : `${facts.contracts.length} current player and staff contracts are available to the planning layer.`
      },
      {
        source: "Personnel Operations",
        title: `${roster.active_count ?? "—"} active • ${roster.practice_squad_count ?? "—"} practice squad`,
        body: roster.week_three_protections_status ? `Protection status: ${roster.week_three_protections_status}` : "Roster counts are derived from the current franchise state."
      }
    ];

    target.innerHTML = cards.map((card) => `
      <article class="portal-briefing-item">
        <div class="portal-briefing-head"><div><div class="portal-briefing-source">${escapeHtml(card.source)}</div><h3>${escapeHtml(card.title)}</h3></div></div>
        <p>${escapeHtml(card.body)}</p>
      </article>`).join("");
  }

  function renderCalendar(state, decisions, schedule) {
    const target = document.getElementById("portal-calendar-list");
    if (!target) return;
    const timeline = state.timeline ?? {};
    const currentWeek = Number(timeline.week ?? 0);
    const rows = [{
      date: "Now",
      title: timeline.day ? `${timeline.day} • Week ${timeline.week ?? "—"}` : `Week ${timeline.week ?? "—"}`,
      note: timeline.exact_continuation_point ?? timeline.current_position ?? "Current continuation point unavailable",
      status: "CURRENT"
    }];

    decisions.filter((item) => item.dueWeek != null || item.dueDate || item.deadlineLabel).slice(0, 3).forEach((decision) => {
      rows.push({ date: decision.dueWeek != null ? `W${decision.dueWeek}` : "Due", title: decision.title, note: deadlineText(decision), status: decision.status });
    });

    schedule
      .filter((item) => upper(item.status) !== "FINAL" && Number(item.week ?? 0) >= currentWeek)
      .sort((a, b) => Number(a.week ?? 999) - Number(b.week ?? 999))
      .slice(0, 2)
      .forEach((item) => {
        const date = item.game_date ? new Date(`${item.game_date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : `W${item.week}`;
        const site = item.site === "Away" ? "at" : item.site === "Home" ? "vs" : "";
        rows.push({ date, title: `${site} ${item.opponent_team_id ?? "Opponent"}`.trim(), note: item.kickoff_time_ct ?? item.note ?? `Week ${item.week}`, status: item.status ?? "SCHEDULED" });
      });

    target.innerHTML = rows.slice(0, 6).map((item) => `
      <article class="portal-calendar-item">
        <div class="portal-calendar-date">${escapeHtml(item.date)}</div>
        <div><div class="portal-calendar-title">${escapeHtml(item.title)}</div><div class="portal-calendar-note">${escapeHtml(item.note)}</div></div>
        <span class="pill ${statusClass(item.status)}">${escapeHtml(upper(item.status, "RECORDED").replaceAll("_", " "))}</span>
      </article>`).join("");
  }

  function renderPulse(state, resources) {
    const target = document.getElementById("portal-pulse-list");
    if (!target) return;
    const facts = contractFacts(resources);
    const players = resources.filter((row) => row.resource_type === "player");
    const active = players.filter((row) => row.data?.roster_status === "ACTIVE_ROSTER").length;
    const practice = players.filter((row) => row.data?.roster_status === "PRACTICE_SQUAD").length;
    const medical = asArray(state.medical);
    const cap = numberOrNull(state.resources?.cap?.practical_flexibility_millions);

    const items = [
      ["Medical flags", medical.length, medical.length ? "Recorded availability items" : "No active medical items", medical.length ? "warn" : "good"],
      ["Active roster", active || state.roster?.active_count || "—", `${practice || state.roster?.practice_squad_count || "—"} practice-squad players`, "good"],
      ["Final-year contracts", facts.finalYear.length, `${facts.optionsDue.length} option decisions currently due`, facts.finalYear.length ? "warn" : "good"],
      ["Practical cap flexibility", cap == null ? "—" : `$${cap.toFixed(4)}M`, "Current franchise-state estimate", cap != null && cap < 5 ? "warn" : "good"]
    ];

    target.innerHTML = items.map(([label, value, note, kind]) => `
      <article class="portal-pulse-item">
        <div class="portal-pulse-head"><div><div class="portal-pulse-label">${escapeHtml(label)}</div><div class="portal-pulse-value">${escapeHtml(value)}</div></div><span class="pill ${kind}">${escapeHtml(kind === "good" ? "Stable" : "Watch")}</span></div>
        <div class="portal-calendar-note">${escapeHtml(note)}</div>
      </article>`).join("");
  }

  function renderOutlook(resources) {
    const target = document.getElementById("portal-outlook-list");
    if (!target) return;
    const players = resources.filter((row) => row.resource_type === "player" && row.data?.roster_status === "ACTIVE_ROSTER");
    const groups = new Map();

    players.forEach((row) => {
      const position = String(row.data?.position_code ?? row.data?.position ?? "UNK").toUpperCase();
      const current = groups.get(position) ?? { position, count: 0, controlled: 0, finalYear: 0 };
      current.count += 1;
      const contract = row.data?.contract ?? {};
      const endSeason = numberOrNull(contract.end_season);
      if (endSeason != null && endSeason >= season + 1) current.controlled += 1;
      if (upper(contract.rollover_status) === "FINAL_YEAR" || endSeason === season) current.finalYear += 1;
      groups.set(position, current);
    });

    const outlook = [...groups.values()].map((group) => {
      const ratio = group.count ? group.controlled / group.count : 0;
      const risk = group.controlled === 0 ? 0 : ratio < .5 ? 1 : group.finalYear ? 2 : 3;
      const label = group.controlled === 0 ? "No 2027 control" : ratio < .5 ? "Thin 2027 control" : group.finalYear ? "Final-year pressure" : "Covered into 2027";
      const kind = risk === 0 ? "bad" : risk < 3 ? "warn" : "good";
      return { ...group, risk, label, kind };
    }).sort((a, b) => a.risk - b.risk || b.count - a.count || a.position.localeCompare(b.position)).slice(0, 6);

    target.innerHTML = outlook.map((group) => `
      <article class="portal-outlook-item">
        <div class="portal-outlook-head"><div><div class="portal-outlook-label">${escapeHtml(group.position)} room</div><div class="portal-outlook-value">${group.controlled}/${group.count} controlled</div></div><span class="pill ${group.kind}">${escapeHtml(group.label)}</span></div>
        <div class="portal-calendar-note">${group.finalYear} final-year ${group.finalYear === 1 ? "contract" : "contracts"} in the current room.</div>
      </article>`).join("") || '<div class="portal-empty">Player contract coverage is not available yet.</div>';
  }

  function normalizeTransactions(resource) {
    const entries = resource?.data?.transactions ?? resource?.data?.items ?? resource?.data?.entries ?? [];
    return asArray(entries).map((item, index) => ({
      kind: "Transaction",
      title: String(item?.title ?? item?.transaction_type ?? item?.category ?? `Transaction ${index + 1}`).replaceAll("_", " "),
      summary: String(item?.summary ?? item?.note ?? item?.description ?? ""),
      status: String(item?.status ?? "CONFIRMED"),
      timestamp: item?.occurred_at ?? item?.created_at ?? item?.timestamp ?? item?.effective_date ?? "",
      source: item?.source_label ?? "Transaction Ledger"
    }));
  }

  function renderActivity(events, ledgerResource) {
    const target = document.getElementById("portal-activity-list");
    const badge = document.getElementById("portal-activity-badge");
    if (!target || !badge) return;
    const activity = [
      ...normalizeTransactions(ledgerResource),
      ...events.map((event) => ({
        kind: "Canon Event",
        title: `${event.event_type ?? "Event"} • State v${event.state_version ?? "—"}`,
        summary: event.summary ?? "",
        status: "RECORDED",
        timestamp: event.created_at ?? "",
        source: event.source_label ?? "Canon Events"
      }))
    ].sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()).slice(0, 8);

    badge.className = `pill ${activity.length ? "good" : ""}`;
    badge.textContent = activity.length ? `${activity.length} recent` : "No activity";
    target.innerHTML = activity.map((item) => `
      <article class="portal-activity-item">
        <div class="portal-activity-head"><div><div class="portal-kicker">${escapeHtml(item.kind)} • ${escapeHtml(item.source)}</div><h3>${escapeHtml(item.title)}</h3></div><span class="pill ${statusClass(item.status)}">${escapeHtml(upper(item.status).replaceAll("_", " "))}</span></div>
        ${item.summary ? `<p>${escapeHtml(item.summary)}</p>` : ""}
        <div class="portal-activity-meta">${item.timestamp ? escapeHtml(new Date(item.timestamp).toLocaleString()) : "Time not recorded"}</div>
      </article>`).join("") || '<div class="portal-empty">No transactions or canon events are recorded.</div>';
  }

  function renderHeader(stateRow, decisions) {
    const state = stateRow.state ?? {};
    const timeline = state.timeline ?? {};
    const opponent = state.opponent ?? {};
    const record = state.franchise?.record ?? {};
    const continuation = timeline.exact_continuation_point ?? timeline.current_position ?? "Continuation point unavailable";

    setText("record", `${record.wins ?? "—"}-${record.losses ?? "—"}`);
    setText("standing", `${record.central_position ?? "—"} • ${Number(record.point_differential ?? 0) >= 0 ? "+" : ""}${record.point_differential ?? "—"} differential`);
    setText("week", `Week ${timeline.week ?? "—"}`);
    setText("day", timeline.day ?? "—");
    setText("opponent", opponent.name ?? opponent.team_name ?? "—");
    setText("kickoff", opponent.kickoff_label ?? "—");
    setText("version", stateRow.version ?? "—");
    setText("updated", stateRow.updated_at ? new Date(stateRow.updated_at).toLocaleString() : "—");
    setText("continuation", continuation);
    setText("portal-current-position", continuation);
    setText("portal-hero-summary", decisions.length ? `${decisions.length} active franchise ${decisions.length === 1 ? "decision is" : "decisions are"} connected to the live operational picture.` : "The active Decision Queue is clear. Review the calendar, roster pressure and recent organizational activity below.");
  }

  function renderPortal(data) {
    snapshot = data;
    const state = data.stateRow.state ?? {};
    const decisionQueue = data.resources.find((row) => row.resource_type === "decision_queue" && row.resource_id === "decision-queue");
    const ledger = data.resources.find((row) => row.resource_type === "transaction_ledger" && row.resource_id === "transaction-ledger");
    const decisionEntries = decisionQueue?.data?.decisions ?? decisionQueue?.data?.items ?? decisionQueue?.data?.queue ?? [];
    const decisions = asArray(decisionEntries)
      .map(normalizeDecision)
      .filter((item) => ACTIVE_DECISION_STATUSES.has(item.status))
      .sort(decisionSort);

    renderHeader(data.stateRow, decisions);
    renderAttention(decisions, decisionQueue?.version);
    renderBriefing(state, decisions, data.resources);
    renderCalendar(state, decisions, data.schedule);
    renderPulse(state, data.resources);
    renderOutlook(data.resources);
    renderActivity(data.events, ledger);

    const source = document.getElementById("portal-source-status");
    if (source) {
      source.className = "portal-source-status good";
      source.innerHTML = '<i class="portal-source-dot"></i><b>Live sources connected</b>';
    }
    window.dispatchEvent(new CustomEvent("archers:portal-rendered", { detail: { stateVersion: data.stateRow.version, activeDecisions: decisions.length } }));
  }

  async function loadPortal() {
    const [stateResult, resourcesResult, eventsResult, scheduleResult] = await Promise.all([
      portalClient.from("archers_franchise_state").select("id, version, state, source_checkpoint_id, seal_status, updated_at").eq("id", franchiseId).single(),
      portalClient.from("archers_resources").select("resource_type, resource_id, version, data, updated_at").eq("franchise_id", franchiseId).in("resource_type", ["decision_queue", "transaction_ledger", "player", "staff"]).eq("status", "ACTIVE").eq("visibility", "CONSOLE"),
      portalClient.from("archers_canon_events").select("event_id, state_version, event_type, summary, source_label, created_at").eq("franchise_id", franchiseId).order("event_id", { ascending: false }).limit(12),
      portalClient.from("archers_schedule").select("season, week, game_date, opponent_team_id, site, kickoff_time_ct, status, archers_score, opponent_score, note, updated_at").eq("season", season).order("week")
    ]);

    for (const result of [stateResult, resourcesResult, eventsResult, scheduleResult]) {
      if (result.error) throw result.error;
    }

    renderPortal({
      stateRow: stateResult.data,
      resources: resourcesResult.data ?? [],
      events: eventsResult.data ?? [],
      schedule: scheduleResult.data ?? []
    });
  }

  function showError(error) {
    console.error("Archers Portal could not load", error);
    const source = document.getElementById("portal-source-status");
    if (source) {
      source.className = "portal-source-status bad";
      source.innerHTML = `<i class="portal-source-dot"></i><b>Portal data unavailable</b>`;
      source.title = String(error?.message ?? error);
    }
    ["portal-attention-list", "portal-briefing-list", "portal-calendar-list", "portal-pulse-list", "portal-outlook-list", "portal-activity-list"].forEach((id) => {
      const target = document.getElementById(id);
      if (target?.querySelector(".portal-loading")) target.innerHTML = `<div class="portal-error">${escapeHtml(error?.message ?? error)}</div>`;
    });
  }

  function continuationPrompt() {
    const stateRow = snapshot?.stateRow;
    const state = stateRow?.state ?? {};
    const timeline = state.timeline ?? {};
    const opponent = state.opponent ?? {};
    return `Read the current franchise state and continue from the exact saved continuation point.\n\nUse the smallest authoritative reads required under the v4.0 workflow. Consult the relevant Knowledge modules before acting. Do not write or modify anything until the required context has been read.\n\nDisplayed state version: ${stateRow?.version ?? "unknown"}\nDisplayed season: ${timeline.season ?? state.current_season ?? state.season ?? season}\nDisplayed week: ${timeline.week ?? "unknown"}\nDisplayed day: ${timeline.day ?? "unknown"}\nDisplayed opponent: ${opponent.name ?? opponent.team_name ?? "unknown"}\nDisplayed continuation point: ${timeline.exact_continuation_point ?? timeline.current_position ?? "unknown"}\n\nTreat every displayed value as a pointer that must be verified against current authoritative state. Roleplay every non-Kevin character as needed. Identify every speaker by full name and current position or job. Never invent Kevin Dorey’s dialogue, deliberate actions, promises, commitments, or decisions. Stop when Kevin reaches the first meaningful decision.`;
  }

  async function copyContinuationPrompt() {
    const note = document.getElementById("portal-action-note");
    try {
      const prompt = continuationPrompt();
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(prompt);
      else {
        const textarea = document.createElement("textarea");
        textarea.value = prompt;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.append(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      if (note) note.textContent = "Continuation prompt copied. No franchise write occurred.";
    } catch (error) {
      if (note) note.textContent = `Copy failed: ${error?.message ?? error}`;
    }
  }

  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => loadPortal().catch(showError), 220);
  }

  function subscribe() {
    if (channel) portalClient.removeChannel(channel);
    channel = portalClient.channel("archers-portal-v1")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "archers_franchise_state", filter: `id=eq.${franchiseId}` }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "archers_resources", filter: `franchise_id=eq.${franchiseId}` }, scheduleReload)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "archers_canon_events", filter: `franchise_id=eq.${franchiseId}` }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "archers_schedule" }, scheduleReload)
      .subscribe();
  }

  function start() {
    setupPortalMarkup();
    loadPortal().then(subscribe).catch(showError);
  }

  start();
})();
