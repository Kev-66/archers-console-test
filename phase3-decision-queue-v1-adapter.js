(() => {
  const SUPABASE_URL = "https://oqbylwlkrabxvpdhugrf.supabase.co";
  const SUPABASE_KEY = "sb_publishable_z-EjW-S0x7GZH2VREEaXAw_NOOrbH-m";
  const FRANCHISE_ID = "stl-2026";
  const RESOURCE_TYPE = "decision_queue";
  const RESOURCE_ID = "decision-queue";

  const decisionClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const OPEN_STATUSES = new Set(["OPEN", "READY_FOR_REVIEW", "AWAITING_KEVIN", "BLOCKED", "DEFERRED"]);
  const PERSONNEL_CATEGORIES = new Set(["ROSTER", "PRACTICE_SQUAD", "CONTRACT", "TRADE", "DRAFT", "FINANCE"]);
  const PRIORITY_RANK = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

  let resource = null;
  let stateRow = null;
  let players = new Map();
  let openDecisions = [];
  let allDecisions = [];
  let activeDecision = null;
  let returnFocus = null;
  let applyTimer = null;

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const asArray = (value) => Array.isArray(value) ? value : value == null ? [] : [value];
  const upper = (value, fallback = "") => String(value ?? fallback).trim().toUpperCase().replaceAll(" ", "_");

  function normalizeChoice(choice, index) {
    if (typeof choice === "string") {
      return { id: `choice-${index + 1}`, label: choice, instruction: choice, summary: "", consequences: [], availability: "AVAILABLE", evidenceStatus: "UNKNOWN" };
    }
    const label = choice?.label ?? choice?.title ?? choice?.name ?? choice?.option ?? choice?.value ?? `Choice ${index + 1}`;
    return {
      id: String(choice?.choice_id ?? choice?.id ?? `choice-${index + 1}`),
      label: String(label),
      instruction: String(choice?.instruction ?? choice?.value ?? label),
      summary: String(choice?.summary ?? choice?.note ?? ""),
      consequences: asArray(choice?.consequences),
      availability: upper(choice?.availability, "AVAILABLE"),
      evidenceStatus: upper(choice?.evidence_status, "UNKNOWN")
    };
  }

  function normalizeDecision(item, index) {
    const status = upper(item?.status, "OPEN");
    const priority = upper(item?.priority, "NORMAL");
    return {
      id: String(item?.decision_id ?? item?.id ?? `decision-${index + 1}`),
      category: upper(item?.category, "OTHER"),
      status,
      priority,
      title: String(item?.title ?? item?.decision ?? item?.name ?? `Decision ${index + 1}`),
      summary: String(item?.summary ?? item?.note ?? item?.description ?? ""),
      question: String(item?.decision_question ?? item?.question ?? ""),
      approvalRequired: item?.approval_required !== false,
      approvalOwner: String(item?.approval_owner ?? "Kevin Dorey"),
      createdWeek: item?.created_week ?? null,
      createdStateVersion: item?.created_state_version ?? null,
      dueWeek: item?.due_week ?? null,
      dueDate: item?.due_date ?? null,
      deadlineLabel: String(item?.deadline_label ?? item?.deadline ?? ""),
      reviewAfter: String(item?.review_after ?? ""),
      choices: asArray(item?.choices ?? item?.options ?? item?.available_choices).map(normalizeChoice),
      playerIds: asArray(item?.related_player_resource_ids ?? item?.player_resource_ids).map(String),
      resourceRefs: asArray(item?.related_resource_refs ?? item?.resources),
      evidenceBoundaries: asArray(item?.evidence_boundaries).map(String),
      recommendedAction: String(item?.recommended_action ?? ""),
      sourceLabel: String(item?.source_label ?? "Decision Queue"),
      resolution: item?.resolution ?? null,
      raw: item
    };
  }

  function decisionSort(a, b) {
    const priority = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
    if (priority) return priority;
    const aDue = a.dueWeek == null ? 999 : Number(a.dueWeek);
    const bDue = b.dueWeek == null ? 999 : Number(b.dueWeek);
    if (aDue !== bDue) return aDue - bDue;
    return a.title.localeCompare(b.title);
  }

  function statusClass(value) {
    const text = upper(value);
    if (["RESOLVED", "READY_FOR_REVIEW"].includes(text)) return "good";
    if (["BLOCKED", "EXPIRED", "WITHDRAWN"].includes(text)) return "bad";
    return "warn";
  }

  function priorityClass(value) {
    const text = upper(value);
    if (text === "URGENT") return "bad";
    if (text === "HIGH") return "warn";
    return "";
  }

  function statusLabel(value) {
    return upper(value, "OPEN").replaceAll("_", " ");
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

  function playerButton(resourceId) {
    const row = players.get(resourceId);
    const name = row?.data?.player_name ?? resourceId;
    const position = row?.data?.position_code ?? row?.data?.position ?? "";
    if (!row) return `<span class="dq-resource-chip">${escapeHtml(resourceId)}</span>`;
    return `<button type="button" class="dq-player-chip roster-player-row" data-resource-id="${escapeHtml(resourceId)}">${escapeHtml(name)}${position ? ` • ${escapeHtml(position)}` : ""}</button>`;
  }

  function resourceChip(ref) {
    if (typeof ref === "string") return `<span class="dq-resource-chip">${escapeHtml(ref)}</span>`;
    const type = ref?.resource_type ?? ref?.type ?? "resource";
    const id = ref?.resource_id ?? ref?.id ?? "unknown";
    return `<span class="dq-resource-chip">${escapeHtml(type)} / ${escapeHtml(id)}${ref?.resource_version != null ? ` • v${escapeHtml(ref.resource_version)}` : ""}</span>`;
  }

  function decisionCard(decision) {
    const context = [deadlineText(decision), decision.category.replaceAll("_", " "), `ID ${decision.id}`].filter(Boolean).join(" • ");
    return `<article class="wo-decision-card dq-decision-card">
      <div class="wo-decision-main">
        <div class="wo-decision-head">
          <div><div class="dq-priority-line"><span class="pill ${priorityClass(decision.priority)}">${escapeHtml(decision.priority)}</span><span>${escapeHtml(context)}</span></div><h3>${escapeHtml(decision.title)}</h3></div>
          <span class="pill ${statusClass(decision.status)}">${escapeHtml(statusLabel(decision.status))}</span>
        </div>
        <p>${escapeHtml(decision.summary || decision.question || "No additional decision context was recorded.")}</p>
        ${decision.playerIds.length ? `<div class="dq-related-row"><strong>Players</strong><div>${decision.playerIds.map(playerButton).join("")}</div></div>` : ""}
        <div class="wo-choice-summary">${decision.choices.length ? `${decision.choices.length} recorded ${decision.choices.length === 1 ? "choice" : "choices"}` : "No structured choices recorded • free-text instruction available in review"}</div>
      </div>
      <button type="button" class="wo-review-button" data-dq-review="${escapeHtml(decision.id)}">Review Decision</button>
    </article>`;
  }

  function setHtml(target, html) {
    if (target && target.innerHTML !== html) target.innerHTML = html;
  }

  function setText(target, text) {
    if (target && target.textContent !== text) target.textContent = text;
  }

  function setClass(target, className) {
    if (target && target.className !== className) target.className = className;
  }

  function renderWeeklyOps() {
    if (!resource) return;
    const queueTarget = document.getElementById("wo-queue-body");
    const queueBadge = document.getElementById("wo-queue-source");
    const nextTarget = document.getElementById("wo-next-body");
    const nextBadge = document.getElementById("wo-next-source");

    if (queueTarget && queueBadge) {
      const resolvedCount = allDecisions.filter((item) => !OPEN_STATUSES.has(item.status)).length;
      const html = `${openDecisions.map(decisionCard).join("") || '<div class="empty">No open decisions are recorded.</div>'}
        <div class="dq-history-note">${resolvedCount} closed ${resolvedCount === 1 ? "decision is" : "decisions are"} retained in the live queue history.</div>`;
      setHtml(queueTarget, html);
      setClass(queueBadge, `pill ${openDecisions.length ? "warn" : "good"}`);
      setText(queueBadge, `Live v${resource.version} • ${openDecisions.length} open`);
    }

    const next = openDecisions[0] ?? null;
    if (nextTarget && nextBadge) {
      if (!next) {
        setClass(nextBadge, "pill good");
        setText(nextBadge, "Queue clear");
        setHtml(nextTarget, '<div class="empty">No open franchise decisions are recorded.</div>');
      } else {
        setClass(nextBadge, `pill ${statusClass(next.status)}`);
        setText(nextBadge, `${next.priority} • ${statusLabel(next.status)}`);
        setHtml(nextTarget, `<div class="wo-next-card dq-next-card">
          <div><div class="eyebrow">Highest-priority live decision</div><h3>${escapeHtml(next.title)}</h3><p>${escapeHtml(next.summary || next.question || "No additional decision context was recorded.")}</p><div class="wo-context-line">${escapeHtml(deadlineText(next))} • Queue v${escapeHtml(resource.version)} • State v${escapeHtml(stateRow?.version ?? "—")} • ${next.approvalRequired ? `${escapeHtml(next.approvalOwner)} approval required` : "No explicit Kevin approval flag recorded"}</div></div>
          <button type="button" class="wo-review-button" data-dq-review="${escapeHtml(next.id)}">Review Decision</button>
        </div>`);
      }
    }

    const metric = document.querySelector("#wo-metrics .wo-metric-card:nth-child(3)");
    if (metric) {
      setHtml(metric, `<span>Open Decisions</span><strong>${openDecisions.length}</strong><small>Live Decision Queue v${resource.version}</small>`);
    }
  }

  function renderFrontOffice() {
    if (!resource) return;
    const target = document.getElementById("fo-decisions");
    if (target) {
      const personnel = openDecisions.filter((decision) => PERSONNEL_CATEGORIES.has(decision.category));
      const html = personnel.map((decision) => `<div class="item dq-frontoffice-item">
        <div class="item-top"><div><div class="item-title">${escapeHtml(decision.title)}</div><div class="item-note">${escapeHtml(decision.priority)} • ${escapeHtml(deadlineText(decision))} • ${escapeHtml(decision.id)}</div></div><span class="pill ${statusClass(decision.status)}">${escapeHtml(statusLabel(decision.status))}</span></div>
        <div class="item-note">${escapeHtml(decision.summary || decision.question || "")}</div>
      </div>`).join("") || '<div class="empty">No open personnel decisions are recorded.</div>';
      setHtml(target, html);
    }

    const coverage = document.getElementById("fo-coverage");
    if (coverage) {
      let row = [...coverage.querySelectorAll(".fo-coverage-row")].find((candidate) => candidate.firstElementChild?.textContent?.trim() === "Decision queue");
      if (!row) {
        row = document.createElement("div");
        row.className = "fo-coverage-row";
        row.innerHTML = '<span>Decision queue</span><span class="pill good"></span>';
        coverage.append(row);
      }
      const pill = row.querySelector(".pill");
      setClass(pill, "pill good");
      setText(pill, `Structured • v${resource.version}`);
    }
  }

  function ensureDialog() {
    if (document.getElementById("dq-decision-dialog")) return;
    document.body.insertAdjacentHTML("beforeend", `<dialog id="dq-decision-dialog" class="wo-decision-dialog dq-decision-dialog" aria-labelledby="dq-dialog-title">
      <form method="dialog" class="wo-dialog-shell">
        <button class="wo-dialog-close" value="cancel" aria-label="Close decision review">×</button>
        <div class="eyebrow">Live Decision Queue • Read-only review</div>
        <h2 id="dq-dialog-title">Decision Review</h2>
        <div id="dq-dialog-content"></div>
        <div class="wo-dialog-actions"><button type="button" id="dq-copy-prompt" class="wo-primary-button">Copy Canon Prompt</button><button value="cancel" class="wo-secondary-button">Close</button></div>
        <div id="dq-copy-status" class="wo-copy-status" aria-live="polite"></div>
      </form>
    </dialog>`);
    const dialog = document.getElementById("dq-decision-dialog");
    dialog?.addEventListener("close", () => {
      activeDecision = null;
      if (returnFocus instanceof HTMLElement) returnFocus.focus({ preventScroll: true });
      returnFocus = null;
    });
    dialog?.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    document.getElementById("dq-copy-prompt")?.addEventListener("click", copyPrompt);
  }

  function consequencesHtml(choice) {
    if (!choice.consequences.length) return "";
    return `<ul>${choice.consequences.map((item) => `<li>${escapeHtml(typeof item === "string" ? item : item?.summary ?? item?.note ?? JSON.stringify(item))}</li>`).join("")}</ul>`;
  }

  function buildPrompt(decision, instruction) {
    const cleanInstruction = String(instruction ?? "").trim() || "[Kevin must enter an explicit decision before continuing]";
    const boundaries = [...decision.evidenceBoundaries, ...asArray(stateRow?.state?.canon?.evidence_boundaries)].filter(Boolean);
    return `Read the current franchise state, the active decision_queue / decision-queue resource, every related resource, and the recent audit log before acting. Do not assume the displayed versions remain current.\n\nDecision ID: ${decision.id}\nDecision title: ${decision.title}\nCategory: ${decision.category}\nRecorded status: ${decision.status}\nPriority: ${decision.priority}\nDeadline: ${deadlineText(decision)}\nDisplayed Decision Queue version: ${resource?.version ?? "unknown"}\nDisplayed global state version: ${stateRow?.version ?? "unknown"}\nKevin's explicit instruction: ${cleanInstruction}\n\nRecorded context:\n${decision.summary || decision.question || "No additional context recorded"}\n\nEvidence boundaries:\n${boundaries.length ? boundaries.map((item) => `- ${item}`).join("\n") : "- None recorded"}\n\nVerify the decision is still open and the selected choice remains available. If anything material changed, stop and explain the conflict. Respect the Kevin lock and do not invent Kevin's dialogue or deliberate actions. Execute only through the current authenticated Action rules. After a successful operation, update or resolve the live decision queue and every affected resource, then return a compact technical handoff with audit ID, canon event ID, resource versions, resulting state version, verification totals, and unresolved issues.`;
  }

  function openReview(decisionId, opener) {
    const decision = allDecisions.find((item) => item.id === decisionId);
    const dialog = document.getElementById("dq-decision-dialog");
    const content = document.getElementById("dq-dialog-content");
    if (!decision || !dialog || !content) return;
    activeDecision = decision;
    returnFocus = opener instanceof HTMLElement ? opener : null;

    content.innerHTML = `<div class="wo-dialog-status"><span class="pill ${priorityClass(decision.priority)}">${escapeHtml(decision.priority)}</span><span class="pill ${statusClass(decision.status)}">${escapeHtml(statusLabel(decision.status))}</span><span>Queue v${escapeHtml(resource?.version ?? "—")} • State v${escapeHtml(stateRow?.version ?? "—")}</span></div>
      <section class="wo-dialog-section"><h3>${escapeHtml(decision.title)}</h3><p>${escapeHtml(decision.summary || decision.question || "No additional context was recorded.")}</p><div class="dq-dialog-meta">${escapeHtml(deadlineText(decision))} • ${escapeHtml(decision.category.replaceAll("_", " "))} • ID ${escapeHtml(decision.id)}</div></section>
      ${decision.playerIds.length ? `<section class="wo-dialog-section"><h3>Related Players</h3><div class="dq-chip-row">${decision.playerIds.map(playerButton).join("")}</div></section>` : ""}
      ${decision.resourceRefs.length ? `<section class="wo-dialog-section"><h3>Related Resources</h3><div class="dq-chip-row">${decision.resourceRefs.map(resourceChip).join("")}</div></section>` : ""}
      ${decision.choices.length ? `<fieldset class="wo-choice-fieldset"><legend>Recorded choices</legend>${decision.choices.map((choice) => `<label class="dq-choice-option ${choice.availability === "BLOCKED" ? "is-blocked" : ""}"><input type="radio" name="dq-choice" value="${escapeHtml(choice.instruction)}" ${choice.availability === "BLOCKED" ? "disabled" : ""}><span><strong>${escapeHtml(choice.label)}</strong>${choice.summary ? `<small>${escapeHtml(choice.summary)}</small>` : ""}${consequencesHtml(choice)}<small>${escapeHtml(choice.availability)} • evidence ${escapeHtml(choice.evidenceStatus)}</small></span></label>`).join("")}</fieldset>` : '<div class="wo-dialog-note">No structured choices were recorded. Enter Kevin’s explicit instruction below.</div>'}
      ${decision.recommendedAction ? `<div class="dq-recommendation"><strong>Recorded recommendation:</strong> ${escapeHtml(decision.recommendedAction)}</div>` : ""}
      ${decision.evidenceBoundaries.length ? `<details class="dq-boundaries"><summary>Decision-specific evidence boundaries</summary><ul>${decision.evidenceBoundaries.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></details>` : ""}
      <label class="wo-instruction-label" for="dq-decision-instruction">Kevin’s explicit instruction</label>
      <textarea id="dq-decision-instruction" rows="4" placeholder="Enter the exact choice or instruction to approve."></textarea>
      <details class="wo-prompt-preview"><summary>Preview prepared canon prompt</summary><pre id="dq-prompt-preview-text"></pre></details>
      <div class="wo-dialog-note">This review does not execute a write. Send the prepared prompt to the authenticated Draft a Dynasty GPT.</div>`;

    const textarea = document.getElementById("dq-decision-instruction");
    const preview = document.getElementById("dq-prompt-preview-text");
    const refresh = () => { if (preview) preview.textContent = buildPrompt(decision, textarea?.value); };
    content.querySelectorAll('input[name="dq-choice"]').forEach((radio) => radio.addEventListener("change", () => {
      if (textarea) textarea.value = radio.value;
      refresh();
    }));
    textarea?.addEventListener("input", refresh);
    refresh();
    setText(document.getElementById("dq-copy-status"), "");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    textarea?.focus({ preventScroll: true });
  }

  async function copyPrompt() {
    if (!activeDecision) return;
    const statusTarget = document.getElementById("dq-copy-status");
    const instruction = document.getElementById("dq-decision-instruction")?.value ?? "";
    const prompt = buildPrompt(activeDecision, instruction);
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = prompt;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setText(statusTarget, "Canon-action prompt copied. No franchise write occurred.");
  }

  function applyLiveQueue() {
    if (!resource) return;
    renderWeeklyOps();
    renderFrontOffice();
  }

  function scheduleApply() {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(applyLiveQueue, 0);
  }

  function setupObservers() {
    [document.getElementById("weeklyops"), document.getElementById("frontoffice")].filter(Boolean).forEach((target) => {
      if (target.dataset.decisionQueueObserver === "true") return;
      new MutationObserver(scheduleApply).observe(target, { childList: true, subtree: true, characterData: true });
      target.dataset.decisionQueueObserver = "true";
    });
  }

  async function load(attempt = 0) {
    ensureDialog();
    const weekly = document.getElementById("weeklyops");
    const frontOffice = document.getElementById("frontoffice");
    if (!weekly || !frontOffice) {
      if (attempt < 100) setTimeout(() => load(attempt + 1).catch(showError), 50);
      return;
    }

    const [resourceResult, stateResult, playersResult] = await Promise.all([
      decisionClient.from("archers_resources").select("resource_id, version, data, updated_at").eq("franchise_id", FRANCHISE_ID).eq("resource_type", RESOURCE_TYPE).eq("resource_id", RESOURCE_ID).eq("status", "ACTIVE").eq("visibility", "CONSOLE").maybeSingle(),
      decisionClient.from("archers_franchise_state").select("version, state, updated_at").eq("id", FRANCHISE_ID).single(),
      decisionClient.from("archers_resources").select("resource_id, data").eq("franchise_id", FRANCHISE_ID).eq("resource_type", "player").eq("status", "ACTIVE").eq("visibility", "CONSOLE")
    ]);

    if (resourceResult.error) throw resourceResult.error;
    if (stateResult.error) throw stateResult.error;
    if (playersResult.error) throw playersResult.error;

    stateRow = stateResult.data;
    players = new Map((playersResult.data ?? []).map((row) => [row.resource_id, row]));
    resource = resourceResult.data;
    if (!resource?.data) return;

    const entries = resource.data.decisions ?? resource.data.items ?? resource.data.queue;
    if (!Array.isArray(entries)) throw new Error("The live Decision Queue resource does not contain a decisions array.");
    allDecisions = entries.map(normalizeDecision);
    openDecisions = allDecisions.filter((item) => OPEN_STATUSES.has(item.status)).sort(decisionSort);
    setupObservers();
    applyLiveQueue();
  }

  function showError(error) {
    const badge = document.getElementById("wo-queue-source");
    if (badge) {
      badge.className = "pill bad";
      badge.textContent = "Decision Queue unavailable";
      badge.title = String(error?.message ?? error);
    }
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-dq-review]");
    if (!button) return;
    openReview(button.dataset.dqReview, button);
  });

  window.addEventListener("DOMContentLoaded", () => {
    load().catch(showError);
    decisionClient.channel("archers-decision-queue-v1")
      .on("postgres_changes", { event: "*", schema: "public", table: "archers_resources", filter: `franchise_id=eq.${FRANCHISE_ID}` }, () => load().catch(showError))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "archers_franchise_state", filter: `id=eq.${FRANCHISE_ID}` }, () => load().catch(showError))
      .subscribe();
  });
})();
