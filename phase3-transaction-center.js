(() => {
  const SUPABASE_URL = "https://oqbylwlkrabxvpdhugrf.supabase.co";
  const SUPABASE_KEY = "sb_publishable_z-EjW-S0x7GZH2VREEaXAw_NOOrbH-m";
  const FRANCHISE_ID = "stl-2026";
  const RESOURCE_TYPE = "transaction_ledger";
  const RESOURCE_ID = "transaction-ledger";
  const MAX_CANON_EVENTS = 100;

  const transactionClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const FILTERS = [
    ["ALL", "All"],
    ["TRADE", "Trades"],
    ["SIGNING", "Signings"],
    ["RELEASE", "Releases"],
    ["PRACTICE_SQUAD", "Practice Squad"],
    ["CONTRACT", "Contracts"],
    ["DRAFT_PICK", "Draft Picks"]
  ];

  let currentFilter = "ALL";
  let currentTransactions = [];
  let currentSource = { kind: "pending", label: "Import pending" };

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const asArray = (value) => Array.isArray(value) ? value : value == null ? [] : [value];

  function categoryLabel(category) {
    const labels = {
      TRADE: "Trade",
      SIGNING: "Signing",
      RELEASE: "Release",
      PRACTICE_SQUAD: "Practice Squad",
      CONTRACT: "Contract",
      DRAFT_PICK: "Draft Pick",
      OTHER: "Personnel"
    };
    return labels[category] ?? String(category ?? "Personnel").replaceAll("_", " ");
  }

  function categoryIcon(category) {
    const icons = {
      TRADE: "⇄",
      SIGNING: "+",
      RELEASE: "−",
      PRACTICE_SQUAD: "PS",
      CONTRACT: "$",
      DRAFT_PICK: "#",
      OTHER: "•"
    };
    return icons[category] ?? "•";
  }

  function statusClass(value) {
    const text = String(value ?? "").toLowerCase();
    if (text.includes("provisional") || text.includes("pending") || text.includes("conditional")) return "warn";
    if (text.includes("void") || text.includes("reversed") || text.includes("failed")) return "bad";
    return "good";
  }

  function classifyTransaction(eventType, summary = "") {
    const type = String(eventType ?? "").toUpperCase();
    const text = `${type} ${summary}`.toLowerCase();

    if (/\btrade\b|traded|trade_/i.test(type) || /\btrade\b|traded to|acquired from/i.test(text)) return "TRADE";
    if (/draft|pick|selection|convey|round/i.test(type) || /draft pick|draft-pick|conditional pick|selection conveyed|round [1-7]/i.test(text)) return "DRAFT_PICK";
    if (/practice|elevation|protect|promotion/i.test(type) || /practice squad|elevat|protect|promot/i.test(text)) return "PRACTICE_SQUAD";
    if (/release|waiver|cut/i.test(type) || /released|waived|waiver|cut from/i.test(text)) return "RELEASE";
    if (/contract|extension|restructure|cap/i.test(type) || /contract|extension|restructur|cap hit/i.test(text)) return "CONTRACT";
    if (/sign|addition|acquisition/i.test(type) || /signed|signing|added to (the )?roster/i.test(text)) return "SIGNING";
    return "OTHER";
  }

  function isTransactionLike(event) {
    const category = classifyTransaction(event.event_type, event.summary);
    if (category !== "OTHER") return true;
    return /personnel|roster move|player movement|free agent|reserve list|injured reserve/i.test(`${event.event_type ?? ""} ${event.summary ?? ""}`);
  }

  function normalizeStructuredEntry(entry, index) {
    const category = classifyTransaction(entry.category ?? entry.type ?? entry.event_type, `${entry.title ?? ""} ${entry.summary ?? entry.note ?? ""}`);
    const occurredAt = entry.occurred_at ?? entry.created_at ?? entry.timestamp ?? null;
    const dateLabel = entry.date_label
      ?? entry.week_label
      ?? (entry.week != null ? `Week ${entry.week}` : null)
      ?? (occurredAt ? new Date(occurredAt).toLocaleString() : "Date not recorded");

    return {
      id: entry.transaction_id ?? entry.id ?? entry.event_id ?? `transaction-${index + 1}`,
      category,
      title: entry.title ?? categoryLabel(category),
      summary: entry.summary ?? entry.note ?? entry.description ?? "",
      status: entry.status ?? "CONFIRMED",
      dateLabel,
      occurredAt,
      stateVersion: entry.state_version ?? null,
      sourceLabel: entry.source_label ?? entry.source ?? "Transaction ledger",
      players: asArray(entry.players ?? entry.player),
      assets: asArray(entry.assets ?? entry.draft_assets ?? entry.consideration),
      capNote: entry.cap_note ?? entry.contract_note ?? ""
    };
  }

  function normalizeCanonEvent(event) {
    const category = classifyTransaction(event.event_type, event.summary);
    return {
      id: event.event_id,
      category,
      title: categoryLabel(category),
      summary: event.summary ?? "",
      status: "CONFIRMED",
      dateLabel: event.created_at ? new Date(event.created_at).toLocaleString() : "Date not recorded",
      occurredAt: event.created_at ?? null,
      stateVersion: event.state_version ?? null,
      sourceLabel: event.source_label ?? "Canon event",
      players: [],
      assets: [],
      capNote: ""
    };
  }

  function ensureMarkup() {
    const frontOffice = document.getElementById("frontoffice");
    if (!frontOffice) return false;
    if (document.getElementById("fo-transaction-center")) return true;

    const draftSection = document.getElementById("fo-draft-capital");
    const layout = frontOffice.querySelector(".fo-layout");
    const section = document.createElement("section");
    section.id = "fo-transaction-center";
    section.className = "panel fo-transaction-center fo-collapsible-section";
    section.innerHTML = `
      <div class="section-head fo-transaction-heading">
        <div>
          <h2>Transaction Center</h2>
          <p>Confirmed personnel and asset movement, newest first.</p>
        </div>
        <span id="fo-transaction-source" class="pill warn">Loading transaction ledger…</span>
      </div>
      <div id="fo-transaction-metrics" class="fo-transaction-metrics">
        <div class="fo-transaction-metric"><span>Recorded</span><strong>—</strong><small>Transaction events</small></div>
        <div class="fo-transaction-metric"><span>Trades</span><strong>—</strong><small>Asset exchanges</small></div>
        <div class="fo-transaction-metric"><span>Signings</span><strong>—</strong><small>Player additions</small></div>
        <div class="fo-transaction-metric"><span>Roster Moves</span><strong>—</strong><small>Release and practice-squad activity</small></div>
      </div>
      <div id="fo-transaction-collapsible-body" class="fo-section-body">
        <div id="fo-transaction-filters" class="fo-transaction-filters" aria-label="Transaction filters"></div>
        <div id="fo-transaction-list" class="fo-transaction-list">
          <div class="empty fo-loading">Loading transaction history…</div>
        </div>
        <p id="fo-transaction-note" class="fo-transaction-note"></p>
      </div>`;

    if (draftSection?.nextSibling) {
      draftSection.parentNode.insertBefore(section, draftSection.nextSibling);
    } else if (draftSection) {
      draftSection.parentNode.append(section);
    } else {
      frontOffice.insertBefore(section, layout ?? null);
    }

    renderFilters();
    return true;
  }

  function renderFilters() {
    const target = document.getElementById("fo-transaction-filters");
    if (!target) return;
    target.innerHTML = FILTERS.map(([value, label]) => `
      <button type="button" class="fo-transaction-filter${currentFilter === value ? " active" : ""}" data-transaction-filter="${value}" aria-pressed="${currentFilter === value}">${escapeHtml(label)}</button>
    `).join("");

    target.querySelectorAll("[data-transaction-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        currentFilter = button.dataset.transactionFilter;
        renderTransactions(currentTransactions, currentSource);
      });
    });
  }

  function renderMetrics(transactions) {
    const target = document.getElementById("fo-transaction-metrics");
    if (!target) return;
    const count = (category) => transactions.filter((entry) => entry.category === category).length;
    const rosterMoves = count("RELEASE") + count("PRACTICE_SQUAD");

    target.innerHTML = `
      <div class="fo-transaction-metric"><span>Recorded</span><strong>${transactions.length}</strong><small>Transaction events</small></div>
      <div class="fo-transaction-metric"><span>Trades</span><strong>${count("TRADE")}</strong><small>Asset exchanges</small></div>
      <div class="fo-transaction-metric"><span>Signings</span><strong>${count("SIGNING")}</strong><small>Player additions</small></div>
      <div class="fo-transaction-metric"><span>Roster Moves</span><strong>${rosterMoves}</strong><small>Release and practice-squad activity</small></div>`;
  }

  function renderPlayer(player) {
    if (typeof player === "string") return `<span class="fo-transaction-chip">${escapeHtml(player)}</span>`;
    const name = player?.name ?? player?.player_name ?? player?.resource_id ?? "Player";
    const resourceId = player?.resource_id ?? player?.player_resource_id;
    if (!resourceId) return `<span class="fo-transaction-chip">${escapeHtml(name)}</span>`;
    return `<button type="button" class="fo-transaction-chip fo-transaction-player roster-player-row" data-resource-id="${escapeHtml(resourceId)}">${escapeHtml(name)}</button>`;
  }

  function renderAsset(asset) {
    if (typeof asset === "string") return `<li>${escapeHtml(asset)}</li>`;
    const label = asset?.label
      ?? asset?.description
      ?? [asset?.year, asset?.round ? `Round ${asset.round}` : null, asset?.original_team ? `from ${asset.original_team}` : null].filter(Boolean).join(" • ")
      ?? "Asset";
    return `<li>${escapeHtml(label)}</li>`;
  }

  function renderEntry(entry) {
    const meta = [
      entry.dateLabel,
      entry.stateVersion != null ? `State v${entry.stateVersion}` : null,
      entry.sourceLabel
    ].filter(Boolean).join(" • ");

    return `
      <article class="fo-transaction-entry">
        <div class="fo-transaction-marker ${entry.category.toLowerCase()}">${escapeHtml(categoryIcon(entry.category))}</div>
        <div class="fo-transaction-content">
          <div class="fo-transaction-entry-head">
            <div>
              <div class="fo-transaction-kicker">${escapeHtml(categoryLabel(entry.category))}</div>
              <h3>${escapeHtml(entry.title)}</h3>
            </div>
            <span class="pill ${statusClass(entry.status)}">${escapeHtml(entry.status)}</span>
          </div>
          <div class="fo-transaction-meta">${escapeHtml(meta)}</div>
          ${entry.summary ? `<p class="fo-transaction-summary">${escapeHtml(entry.summary)}</p>` : ""}
          ${entry.players.length ? `<div class="fo-transaction-players"><strong>Players</strong><div>${entry.players.map(renderPlayer).join("")}</div></div>` : ""}
          ${entry.assets.length ? `<div class="fo-transaction-assets"><strong>Assets</strong><ul>${entry.assets.map(renderAsset).join("")}</ul></div>` : ""}
          ${entry.capNote ? `<p class="fo-transaction-cap-note"><strong>Cap / contract:</strong> ${escapeHtml(entry.capNote)}</p>` : ""}
        </div>
      </article>`;
  }

  function renderTransactions(transactions, source) {
    const target = document.getElementById("fo-transaction-list");
    const sourceBadge = document.getElementById("fo-transaction-source");
    const note = document.getElementById("fo-transaction-note");
    if (!target || !sourceBadge || !note) return;

    renderFilters();
    renderMetrics(transactions);

    const visible = currentFilter === "ALL"
      ? transactions
      : transactions.filter((entry) => entry.category === currentFilter);

    target.innerHTML = visible.map(renderEntry).join("") || `
      <div class="empty fo-transaction-empty">${transactions.length
        ? `No ${escapeHtml(FILTERS.find(([value]) => value === currentFilter)?.[1] ?? "matching transactions")} are recorded.`
        : "No structured or transaction-like canon events are available yet. Historical import is pending."}</div>`;

    if (source.kind === "resource") {
      sourceBadge.className = "pill good";
      sourceBadge.textContent = `Live resource v${source.version}`;
      note.textContent = "Structured transaction ledger • player links open the current profile drawer when resource IDs are recorded.";
    } else if (source.kind === "canon") {
      sourceBadge.className = "pill warn";
      sourceBadge.textContent = `Canon events • ${transactions.length}`;
      note.textContent = "Fallback view derived only from transaction-like canon events. A structured ledger can later add players, assets, categories and cap details without changing this interface.";
    } else {
      sourceBadge.className = "pill warn";
      sourceBadge.textContent = "Import pending";
      note.textContent = "The interface is ready for transaction_ledger / transaction-ledger. No unverified history has been inserted.";
    }
  }

  async function fetchStructuredLedger() {
    const { data, error } = await transactionClient
      .from("archers_resources")
      .select("resource_id, version, data, updated_at")
      .eq("franchise_id", FRANCHISE_ID)
      .eq("resource_type", RESOURCE_TYPE)
      .eq("resource_id", RESOURCE_ID)
      .eq("status", "ACTIVE")
      .eq("visibility", "CONSOLE")
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async function fetchCanonTransactions() {
    const { data, error } = await transactionClient
      .from("archers_canon_events")
      .select("event_id, state_version, event_type, summary, source_label, created_at")
      .eq("franchise_id", FRANCHISE_ID)
      .order("event_id", { ascending: false })
      .limit(MAX_CANON_EVENTS);

    if (error) throw error;
    return (data ?? []).filter(isTransactionLike).map(normalizeCanonEvent);
  }

  async function loadTransactionCenter(attempt = 0) {
    if (!ensureMarkup()) {
      if (attempt < 40) setTimeout(() => loadTransactionCenter(attempt + 1).catch(showError), 50);
      return;
    }

    const resource = await fetchStructuredLedger();
    const structuredEntries = resource?.data?.transactions ?? resource?.data?.entries ?? resource?.data?.events;
    if (resource?.data && Array.isArray(structuredEntries)) {
      currentTransactions = structuredEntries.map(normalizeStructuredEntry)
        .sort((a, b) => String(b.occurredAt ?? b.id).localeCompare(String(a.occurredAt ?? a.id)));
      currentSource = { kind: "resource", version: resource.version };
      renderTransactions(currentTransactions, currentSource);
      return;
    }

    const canonTransactions = await fetchCanonTransactions();
    currentTransactions = canonTransactions;
    currentSource = canonTransactions.length
      ? { kind: "canon" }
      : { kind: "pending" };
    renderTransactions(currentTransactions, currentSource);
  }

  function showError(error) {
    if (!ensureMarkup()) return;
    const target = document.getElementById("fo-transaction-list");
    const source = document.getElementById("fo-transaction-source");
    if (source) {
      source.className = "pill bad";
      source.textContent = "Transaction ledger unavailable";
    }
    if (target) target.innerHTML = `<div class="empty fo-loading">Transaction Center could not load: ${escapeHtml(error?.message ?? error)}</div>`;
  }

  window.addEventListener("DOMContentLoaded", () => {
    loadTransactionCenter().catch(showError);
    transactionClient.channel("archers-transaction-center-phase3")
      .on("postgres_changes", { event: "*", schema: "public", table: "archers_resources", filter: `franchise_id=eq.${FRANCHISE_ID}` }, () => loadTransactionCenter().catch(showError))
      .on("postgres_changes", { event: "*", schema: "public", table: "archers_canon_events", filter: `franchise_id=eq.${FRANCHISE_ID}` }, () => loadTransactionCenter().catch(showError))
      .subscribe();
  });
})();
