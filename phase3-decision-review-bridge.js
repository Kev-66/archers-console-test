(() => {
  const SUPABASE_URL = "https://oqbylwlkrabxvpdhugrf.supabase.co";
  const SUPABASE_KEY = "sb_publishable_z-EjW-S0x7GZH2VREEaXAw_NOOrbH-m";
  const FRANCHISE_ID = "stl-2026";

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  let queueResource = null;
  let stateRow = null;
  let players = new Map();
  let decisions = new Map();
  let activeDecision = null;
  let returnFocus = null;
  let loadPromise = null;

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
      return {
        id: `choice-${index + 1}`,
        label: choice,
        instruction: choice,
        summary: "",
        consequences: [],
        availability: "AVAILABLE",
        evidenceStatus: "UNKNOWN"
      };
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
    return {
      id: String(item?.decision_id ?? item?.id ?? `decision-${index + 1}`),
      title: String(item?.title ?? item?.decision ?? item?.name ?? `Decision ${index + 1}`),
      summary: String(item?.summary ?? item?.note ?? item?.description ?? ""),
      question: String(item?.decision_question ?? item?.question ?? ""),
      category: upper(item?.category, "OTHER"),
      status: upper(item?.status, "OPEN"),
      priority: upper(item?.priority, "NORMAL"),
      approvalOwner: String(item?.approval_owner ?? "Kevin Dorey"),
      approvalRequired: item?.approval_required !== false,
      dueWeek: item?.due_week ?? null,
      dueDate: item?.due_date ?? null,
      deadlineLabel: String(item?.deadline_label ?? item?.deadline ?? ""),
      choices: asArray(item?.choices ?? item?.options ?? item?.available_choices).map(normalizeChoice),
      playerIds: asArray(item?.related_player_resource_ids ?? item?.player_resource_ids).map(String),
      resourceRefs: asArray(item?.related_resource_refs ?? item?.resources),
      evidenceBoundaries: asArray(item?.evidence_boundaries).map(String),
      recommendedAction: String(item?.recommended_action ?? "")
    };
  }

  function deadlineText(decision) {
    if (decision.deadlineLabel) return decision.deadlineLabel;
    if (decision.dueWeek != null) return `Due Week ${decision.dueWeek}`;
    if (decision.dueDate) return `Due ${decision.dueDate}`;
    return "No recorded deadline";
  }

  function statusClass(value) {
    const text = upper(value);
    if (["RESOLVED", "READY_FOR_REVIEW"].includes(text)) return "good";
    if (["BLOCKED", "EXPIRED", "WITHDRAWN"].includes(text)) return "bad";
    return "warn";
  }

  function priorityClass(value) {
    if (upper(value) === "URGENT") return "bad";
    if (upper(value) === "HIGH") return "warn";
    return "";
  }

  function statusLabel(value) {
    return upper(value, "OPEN").replaceAll("_", " ");
  }

  function playerMarkup(resourceId) {
    const row = players.get(resourceId);
    const name = row?.data?.player_name ?? resourceId;
    const position = row?.data?.position_code ?? row?.data?.position ?? "";
    if (!row) return `<span class="dq-resource-chip">${escapeHtml(resourceId)}</span>`;
    return `<button type="button" class="dq-player-chip roster-player-row" data-resource-id="${escapeHtml(resourceId)}">${escapeHtml(name)}${position ? ` • ${escapeHtml(position)}` : ""}</button>`;
  }

  function resourceMarkup(ref) {
    if (typeof ref === "string") return `<span class="dq-resource-chip">${escapeHtml(ref)}</span>`;
    const type = ref?.resource_type ?? ref?.type ?? "resource";
    const id = ref?.resource_id ?? ref?.id ?? "unknown";
    const version = ref?.resource_version ?? ref?.version;
    return `<span class="dq-resource-chip">${escapeHtml(type)} / ${escapeHtml(id)}${version != null ? ` • v${escapeHtml(version)}` : ""}</span>`;
  }

  function consequenceMarkup(choice) {
    if (!choice.consequences.length) return "";
    return `<ul>${choice.consequences.map((item) => `<li>${escapeHtml(typeof item === "string" ? item : item?.summary ?? item?.note ?? JSON.stringify(item))}</li>`).join("")}</ul>`;
  }

  async function loadData(force = false) {
    if (loadPromise && !force) return loadPromise;
    loadPromise = (async () => {
      const [queueResult, stateResult, playersResult] = await Promise.all([
        client.from("archers_resources")
          .select("resource_id, version, data, updated_at")
          .eq("franchise_id", FRANCHISE_ID)
          .eq("resource_type", "decision_queue")
          .eq("resource_id", "decision-queue")
          .eq("status", "ACTIVE")
          .eq("visibility", "CONSOLE")
          .maybeSingle(),
        client.from("archers_franchise_state")
          .select("version, state, updated_at")
          .eq("id", FRANCHISE_ID)
          .single(),
        client.from("archers_resources")
          .select("resource_id, data")
          .eq("franchise_id", FRANCHISE_ID)
          .eq("resource_type", "player")
          .eq("status", "ACTIVE")
          .eq("visibility", "CONSOLE")
      ]);

      if (queueResult.error) throw queueResult.error;
      if (stateResult.error) throw stateResult.error;
      if (playersResult.error) throw playersResult.error;
      if (!queueResult.data?.data) throw new Error("The live Decision Queue resource is unavailable.");

      queueResource = queueResult.data;
      stateRow = stateResult.data;
      players = new Map((playersResult.data ?? []).map((row) => [row.resource_id, row]));
      const entries = queueResource.data.decisions ?? queueResource.data.items ?? queueResource.data.queue;
      if (!Array.isArray(entries)) throw new Error("The live Decision Queue does not contain a decisions array.");
      decisions = new Map(entries.map(normalizeDecision).map((decision) => [decision.id, decision]));
    })();

    try {
      await loadPromise;
    } finally {
      loadPromise = null;
    }
  }

  function ensureDialog() {
    let dialog = document.getElementById("dq-review-bridge-dialog");
    if (dialog) return dialog;

    document.body.insertAdjacentHTML("beforeend", `<dialog id="dq-review-bridge-dialog" class="wo-decision-dialog dq-decision-dialog" aria-labelledby="dq-review-bridge-title">
      <form method="dialog" class="wo-dialog-shell">
        <button class="wo-dialog-close" value="cancel" aria-label="Close decision review">×</button>
        <div class="eyebrow">Live Decision Queue • Read-only review</div>
        <h2 id="dq-review-bridge-title">Decision Review</h2>
        <div id="dq-review-bridge-content"></div>
        <div class="wo-dialog-actions">
          <button type="button" id="dq-review-bridge-copy" class="wo-primary-button">Copy Canon Prompt</button>
          <button value="cancel" class="wo-secondary-button">Close</button>
        </div>
        <div id="dq-review-bridge-status" class="wo-copy-status" aria-live="polite"></div>
      </form>
    </dialog>`);

    dialog = document.getElementById("dq-review-bridge-dialog");
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      activeDecision = null;
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) {
        returnFocus.focus({ preventScroll: true });
      }
      returnFocus = null;
    });
    document.getElementById("dq-review-bridge-copy")?.addEventListener("click", copyPrompt);
    return dialog;
  }

  function buildPrompt(decision, instruction) {
    const cleanInstruction = String(instruction ?? "").trim() || "[Kevin must enter an explicit decision before continuing]";
    const globalBoundaries = asArray(stateRow?.state?.canon?.evidence_boundaries).filter(Boolean);
    const boundaries = [...decision.evidenceBoundaries, ...globalBoundaries];
    return `Use compact Action reads only. Do not call snapshot. Read capabilities, core_state, the active decision_queue / decision-queue resource, every directly related resource, and filtered recent audit records before acting. Do not assume displayed versions remain current.\n\nDecision ID: ${decision.id}\nDecision title: ${decision.title}\nCategory: ${decision.category}\nRecorded status: ${decision.status}\nPriority: ${decision.priority}\nDeadline: ${deadlineText(decision)}\nDisplayed Decision Queue version: ${queueResource?.version ?? "unknown"}\nDisplayed global state version: ${stateRow?.version ?? "unknown"}\nKevin's explicit instruction: ${cleanInstruction}\n\nRecorded context:\n${decision.summary || decision.question || "No additional context recorded"}\n\nEvidence boundaries:\n${boundaries.length ? boundaries.map((item) => `- ${item}`).join("\n") : "- None recorded"}\n\nVerify that the decision is still open and the instruction remains valid. If anything material changed, stop and explain the conflict. Respect the Kevin lock and do not invent Kevin's dialogue or deliberate actions. Execute only through the current authenticated Action rules. After a successful operation, update or resolve the live Decision Queue and every affected resource. Return a compact technical handoff with audit ID, canon event ID, resource versions, resulting state version, verification totals, and unresolved issues.`;
  }

  function renderDecision(decision) {
    const content = document.getElementById("dq-review-bridge-content");
    if (!content) return;

    content.innerHTML = `<div class="wo-dialog-status">
        <span class="pill ${priorityClass(decision.priority)}">${escapeHtml(decision.priority)}</span>
        <span class="pill ${statusClass(decision.status)}">${escapeHtml(statusLabel(decision.status))}</span>
        <span>Queue v${escapeHtml(queueResource?.version ?? "—")} • State v${escapeHtml(stateRow?.version ?? "—")}</span>
      </div>
      <section class="wo-dialog-section">
        <h3>${escapeHtml(decision.title)}</h3>
        <p>${escapeHtml(decision.summary || decision.question || "No additional context was recorded.")}</p>
        <div class="dq-dialog-meta">${escapeHtml(deadlineText(decision))} • ${escapeHtml(decision.category.replaceAll("_", " "))} • ID ${escapeHtml(decision.id)}</div>
      </section>
      ${decision.playerIds.length ? `<section class="wo-dialog-section"><h3>Related Players</h3><div class="dq-chip-row">${decision.playerIds.map(playerMarkup).join("")}</div></section>` : ""}
      ${decision.resourceRefs.length ? `<section class="wo-dialog-section"><h3>Related Resources</h3><div class="dq-chip-row">${decision.resourceRefs.map(resourceMarkup).join("")}</div></section>` : ""}
      ${decision.choices.length ? `<fieldset class="wo-choice-fieldset"><legend>Recorded choices</legend>${decision.choices.map((choice) => `<label class="dq-choice-option ${choice.availability === "BLOCKED" ? "is-blocked" : ""}"><input type="radio" name="dq-bridge-choice" value="${escapeHtml(choice.instruction)}" ${choice.availability === "BLOCKED" ? "disabled" : ""}><span><strong>${escapeHtml(choice.label)}</strong>${choice.summary ? `<small>${escapeHtml(choice.summary)}</small>` : ""}${consequenceMarkup(choice)}<small>${escapeHtml(choice.availability)} • evidence ${escapeHtml(choice.evidenceStatus)}</small></span></label>`).join("")}</fieldset>` : '<div class="wo-dialog-note">No structured choices were recorded. Enter Kevin’s explicit instruction below.</div>'}
      ${decision.recommendedAction ? `<div class="dq-recommendation"><strong>Recorded recommendation:</strong> ${escapeHtml(decision.recommendedAction)}</div>` : ""}
      ${decision.evidenceBoundaries.length ? `<details class="dq-boundaries"><summary>Decision-specific evidence boundaries</summary><ul>${decision.evidenceBoundaries.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></details>` : ""}
      <label class="wo-instruction-label" for="dq-review-bridge-instruction">Kevin’s explicit instruction</label>
      <textarea id="dq-review-bridge-instruction" rows="4" placeholder="Enter the exact choice or instruction to approve."></textarea>
      <details class="wo-prompt-preview"><summary>Preview prepared canon prompt</summary><pre id="dq-review-bridge-preview"></pre></details>
      <div class="wo-dialog-note">This review does not execute a write. Send the prepared prompt to the authenticated Draft a Dynasty GPT.</div>`;

    const textarea = document.getElementById("dq-review-bridge-instruction");
    const preview = document.getElementById("dq-review-bridge-preview");
    const refresh = () => {
      if (preview) preview.textContent = buildPrompt(decision, textarea?.value);
    };
    content.querySelectorAll('input[name="dq-bridge-choice"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        if (textarea) textarea.value = radio.value;
        refresh();
      });
    });
    textarea?.addEventListener("input", refresh);
    refresh();
    const status = document.getElementById("dq-review-bridge-status");
    if (status) status.textContent = "";
  }

  async function openReview(decisionId, opener) {
    const dialog = ensureDialog();
    const status = document.getElementById("dq-review-bridge-status");
    try {
      await loadData(true);
      const decision = decisions.get(String(decisionId));
      if (!decision) throw new Error(`Decision ${decisionId} is not present in the current live queue.`);
      activeDecision = decision;
      returnFocus = opener instanceof HTMLElement ? opener : null;
      renderDecision(decision);

      document.querySelectorAll("dialog[open]").forEach((openDialog) => {
        if (openDialog !== dialog && typeof openDialog.close === "function") openDialog.close();
      });
      if (!dialog.open) {
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
      }
      document.getElementById("dq-review-bridge-instruction")?.focus({ preventScroll: true });
    } catch (error) {
      activeDecision = null;
      if (status) status.textContent = `Decision review could not open: ${error?.message ?? error}`;
      console.error("Decision review bridge failed", error);
      if (!dialog.open) {
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
      }
    }
  }

  async function copyPrompt() {
    if (!activeDecision) return;
    const instruction = document.getElementById("dq-review-bridge-instruction")?.value ?? "";
    const prompt = buildPrompt(activeDecision, instruction);
    const status = document.getElementById("dq-review-bridge-status");
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
    if (status) status.textContent = "Canon-action prompt copied. No franchise write occurred.";
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-dq-review]");
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openReview(button.getAttribute("data-dq-review"), button);
  }, true);

  window.addEventListener("DOMContentLoaded", () => {
    ensureDialog();
    loadData().catch((error) => console.error("Decision review bridge preload failed", error));
    client.channel("archers-decision-review-bridge")
      .on("postgres_changes", { event: "*", schema: "public", table: "archers_resources", filter: `franchise_id=eq.${FRANCHISE_ID}` }, () => loadData(true).catch(() => {}))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "archers_franchise_state", filter: `id=eq.${FRANCHISE_ID}` }, () => loadData(true).catch(() => {}))
      .subscribe();
  });
})();