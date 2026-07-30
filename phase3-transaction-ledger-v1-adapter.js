(() => {
  const SUPABASE_URL = "https://oqbylwlkrabxvpdhugrf.supabase.co";
  const SUPABASE_KEY = "sb_publishable_z-EjW-S0x7GZH2VREEaXAw_NOOrbH-m";
  const FRANCHISE_ID = "stl-2026";
  const RESOURCE_TYPE = "transaction_ledger";
  const RESOURCE_ID = "transaction-ledger";

  const ledgerClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
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
  let transactions = [];
  let resourceVersion = null;

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const asArray = (value) => Array.isArray(value) ? value : value == null ? [] : [value];
  const numberOrNull = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

  function broadCategory(value, summary = "") {
    const type = String(value ?? "OTHER").trim().toUpperCase().replaceAll(" ", "_");
    const text = `${type} ${summary}`.toLowerCase();
    if (type === "TRADE" || /\btrade\b|traded/.test(text)) return "TRADE";
    if (["SIGNING"].includes(type) || /signed|signing|free agent/.test(text)) return "SIGNING";
    if (["RELEASE", "WAIVER"].includes(type) || /released|waived|waiver|cut/.test(text)) return "RELEASE";
    if (["PRACTICE_SQUAD", "ELEVATION"].includes(type) || /practice squad|elevat|protect|promotion/.test(text)) return "PRACTICE_SQUAD";
    if (type === "CONTRACT" || /contract|extension|restructure|cap/.test(text)) return "CONTRACT";
    if (type === "DRAFT_PICK" || /draft pick|selection|convey|round [1-7]/.test(text)) return "DRAFT_PICK";
    return "OTHER";
  }

  function categoryLabel(category) {
    return ({
      TRADE: "Trade",
      SIGNING: "Signing",
      RELEASE: "Release / Waiver",
      PRACTICE_SQUAD: "Practice Squad",
      CONTRACT: "Contract",
      DRAFT_PICK: "Draft Pick",
      OTHER: "Personnel"
    })[category] ?? category;
  }

  function categoryIcon(category) {
    return ({ TRADE: "⇄", SIGNING: "+", RELEASE: "−", PRACTICE_SQUAD: "PS", CONTRACT: "$", DRAFT_PICK: "#", OTHER: "•" })[category] ?? "•";
  }

  function statusClass(value) {
    const text = String(value ?? "").toLowerCase();
    if (/void|revers|failed/.test(text)) return "bad";
    if (/provisional|pending|conditional|amended/.test(text)) return "warn";
    return "good";
  }

  function teamLabel(team) {
    if (!team) return "";
    if (typeof team === "string") return team;
    return team.team_name ?? team.name ?? team.team_id ?? "";
  }

  function capNote(entry) {
    if (entry.cap_note || entry.contract_note) return entry.cap_note ?? entry.contract_note;
    const effects = entry.contract_effects;
    if (!effects || typeof effects !== "object") return "";
    const pieces = [];
    if (effects.contract_summary) pieces.push(effects.contract_summary);
    const cap = numberOrNull(effects.cap_effect_2026_millions ?? effects.cap_effect_millions);
    if (cap !== null) pieces.push(`${cap >= 0 ? "+" : ""}$${cap.toFixed(2)}M cap effect`);
    const dead = numberOrNull(effects.dead_cap_millions);
    if (dead !== null) pieces.push(`$${dead.toFixed(2)}M dead cap`);
    if (effects.notes) pieces.push(effects.notes);
    return pieces.join(" • ");
  }

  function rosterNote(entry) {
    const effects = entry.roster_effects;
    if (!effects || typeof effects !== "object") return "";
    const pieces = [];
    const active = numberOrNull(effects.active_roster_delta);
    const practice = numberOrNull(effects.practice_squad_delta);
    const reserve = numberOrNull(effects.reserve_list_delta);
    if (active !== null) pieces.push(`Active roster ${active >= 0 ? "+" : ""}${active}`);
    if (practice !== null) pieces.push(`Practice squad ${practice >= 0 ? "+" : ""}${practice}`);
    if (reserve !== null) pieces.push(`Reserve list ${reserve >= 0 ? "+" : ""}${reserve}`);
    if (effects.notes) pieces.push(effects.notes);
    return pieces.join(" • ");
  }

  function normalizePlayer(player) {
    if (typeof player === "string") return { playerName: player, resourceId: null, detail: "" };
    const playerName = player?.player_name ?? player?.name ?? player?.resource_id ?? "Player";
    const resourceId = player?.resource_id ?? player?.player_resource_id ?? null;
    const movement = player?.movement ?? player?.direction ?? "";
    const transition = [player?.team_before, player?.team_after].filter(Boolean).join(" → ");
    const detail = [player?.position, movement, transition, player?.external_player ? "External snapshot" : null].filter(Boolean).join(" • ");
    return { playerName, resourceId, detail };
  }

  function normalizeAsset(asset) {
    if (typeof asset === "string") return { label: asset, condition: "", status: "" };
    const assetType = String(asset?.asset_type ?? "OTHER").toUpperCase();
    const draftLabel = [asset?.year, asset?.round ? `Round ${asset.round}` : null, asset?.original_team ? `from ${asset.original_team}` : null].filter(Boolean).join(" • ");
    const playerLabel = [asset?.position, asset?.player_name ?? asset?.name].filter(Boolean).join(" ");
    const label = asset?.label ?? asset?.description ?? (assetType === "DRAFT_PICK" ? draftLabel : assetType === "PLAYER" ? playerLabel : assetType.replaceAll("_", " "));
    return {
      label: label || "Asset",
      condition: asset?.condition ?? asset?.note ?? "",
      status: asset?.status ?? ""
    };
  }

  function normalizeEntry(entry, index) {
    const transactionType = entry.transaction_type ?? entry.category ?? entry.type ?? entry.event_type ?? "OTHER";
    const category = broadCategory(transactionType, `${entry.title ?? ""} ${entry.summary ?? ""}`);
    const occurredAt = entry.occurred_at ?? entry.created_at ?? entry.timestamp ?? (entry.effective_date ? `${entry.effective_date}T12:00:00` : null);
    const dateLabel = entry.date_label
      ?? entry.week_label
      ?? (entry.effective_week != null ? `Week ${entry.effective_week}` : null)
      ?? (entry.week != null ? `Week ${entry.week}` : null)
      ?? (entry.effective_date ? new Date(`${entry.effective_date}T12:00:00`).toLocaleDateString() : null)
      ?? (occurredAt ? new Date(occurredAt).toLocaleString() : "Date not recorded");

    const players = asArray(entry.players ?? entry.player).map(normalizePlayer);
    const assetsIn = asArray(entry.assets_in).map(normalizeAsset);
    const assetsOut = asArray(entry.assets_out).map(normalizeAsset);
    const legacyAssets = asArray(entry.assets ?? entry.draft_assets ?? entry.consideration).map(normalizeAsset);

    return {
      id: entry.transaction_id ?? entry.id ?? entry.event_id ?? `transaction-${index + 1}`,
      transactionType: String(transactionType).toUpperCase(),
      category,
      title: entry.title ?? categoryLabel(category),
      summary: entry.summary ?? entry.note ?? entry.description ?? "",
      status: entry.status ?? "CONFIRMED",
      dateLabel,
      occurredAt,
      stateVersion: entry.resulting_state_version ?? entry.state_version ?? null,
      sourceLabel: entry.source_label ?? entry.source ?? "Transaction ledger",
      counterparty: teamLabel(entry.counterparty_team ?? entry.counterparty),
      players,
      assetsIn,
      assetsOut,
      legacyAssets,
      capNote: capNote(entry),
      rosterNote: rosterNote(entry),
      auditId: entry.source_audit_operation_id ?? entry.audit_operation_id ?? null,
      canonEventId: entry.source_canon_event_id ?? entry.canon_event_id ?? null,
      amendsId: entry.amends_transaction_id ?? null,
      reversesId: entry.reverses_transaction_id ?? null,
      notes: asArray(entry.notes)
    };
  }

  function renderPlayer(player) {
    const label = player.detail ? `${player.playerName} • ${player.detail}` : player.playerName;
    if (!player.resourceId) return `<span class="fo-transaction-chip">${escapeHtml(label)}</span>`;
    return `<button type="button" class="fo-transaction-chip fo-transaction-player roster-player-row" data-resource-id="${escapeHtml(player.resourceId)}">${escapeHtml(label)}</button>`;
  }

  function renderAsset(asset) {
    return `<li><span>${escapeHtml(asset.label)}</span>${asset.status ? ` <span class="pill ${statusClass(asset.status)}">${escapeHtml(asset.status)}</span>` : ""}${asset.condition ? `<div>${escapeHtml(asset.condition)}</div>` : ""}</li>`;
  }

  function renderAssetGroup(label, className, assets) {
    if (!assets.length) return "";
    return `<div class="fo-transaction-assets ${className}"><strong>${escapeHtml(label)}</strong><ul>${assets.map(renderAsset).join("")}</ul></div>`;
  }

  function renderEntry(entry) {
    const meta = [
      entry.dateLabel,
      entry.counterparty ? `Counterparty: ${entry.counterparty}` : null,
      entry.stateVersion != null ? `State v${entry.stateVersion}` : null,
      entry.sourceLabel
    ].filter(Boolean).join(" • ");
    const recordLinks = [
      entry.auditId != null ? `Audit ${entry.auditId}` : null,
      entry.canonEventId != null ? `Canon event ${entry.canonEventId}` : null,
      entry.amendsId ? `Amends ${entry.amendsId}` : null,
      entry.reversesId ? `Reverses ${entry.reversesId}` : null
    ].filter(Boolean);

    return `<article class="fo-transaction-entry">
      <div class="fo-transaction-marker ${entry.category.toLowerCase()}">${escapeHtml(categoryIcon(entry.category))}</div>
      <div class="fo-transaction-content">
        <div class="fo-transaction-entry-head">
          <div><div class="fo-transaction-kicker">${escapeHtml(categoryLabel(entry.category))} • ${escapeHtml(entry.transactionType)}</div><h3>${escapeHtml(entry.title)}</h3></div>
          <span class="pill ${statusClass(entry.status)}">${escapeHtml(entry.status)}</span>
        </div>
        <div class="fo-transaction-meta">${escapeHtml(meta)}</div>
        ${entry.summary ? `<p class="fo-transaction-summary">${escapeHtml(entry.summary)}</p>` : ""}
        ${entry.players.length ? `<div class="fo-transaction-players"><strong>Players</strong><div>${entry.players.map(renderPlayer).join("")}</div></div>` : ""}
        ${renderAssetGroup("St. Louis receives", "assets-in", entry.assetsIn)}
        ${renderAssetGroup("St. Louis sends", "assets-out", entry.assetsOut)}
        ${renderAssetGroup("Assets", "assets-legacy", entry.legacyAssets)}
        ${entry.capNote ? `<p class="fo-transaction-cap-note"><strong>Cap / contract:</strong> ${escapeHtml(entry.capNote)}</p>` : ""}
        ${entry.rosterNote ? `<p class="fo-transaction-roster-note"><strong>Roster effect:</strong> ${escapeHtml(entry.rosterNote)}</p>` : ""}
        ${entry.notes.length ? `<div class="fo-transaction-record-notes">${entry.notes.map((note) => `<span>${escapeHtml(note)}</span>`).join("")}</div>` : ""}
        ${recordLinks.length ? `<div class="fo-transaction-record-links">${recordLinks.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
      </div>
    </article>`;
  }

  function renderFilters() {
    const target = document.getElementById("fo-transaction-filters");
    if (!target) return;
    target.innerHTML = FILTERS.map(([value, label]) => `<button type="button" class="fo-transaction-filter${currentFilter === value ? " active" : ""}" data-ledger-filter="${value}" aria-pressed="${currentFilter === value}">${escapeHtml(label)}</button>`).join("");
    target.querySelectorAll("[data-ledger-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        currentFilter = button.dataset.ledgerFilter;
        render();
      });
    });
  }

  function renderMetrics() {
    const target = document.getElementById("fo-transaction-metrics");
    if (!target) return;
    const count = (category) => transactions.filter((entry) => entry.category === category).length;
    const rosterMoves = count("RELEASE") + count("PRACTICE_SQUAD");
    target.innerHTML = `<div class="fo-transaction-metric"><span>Recorded</span><strong>${transactions.length}</strong><small>Structured ledger entries</small></div>
      <div class="fo-transaction-metric"><span>Trades</span><strong>${count("TRADE")}</strong><small>Asset exchanges</small></div>
      <div class="fo-transaction-metric"><span>Signings</span><strong>${count("SIGNING")}</strong><small>Player additions</small></div>
      <div class="fo-transaction-metric"><span>Roster Moves</span><strong>${rosterMoves}</strong><small>Release and practice-squad activity</small></div>`;
  }

  function render() {
    const target = document.getElementById("fo-transaction-list");
    const source = document.getElementById("fo-transaction-source");
    const note = document.getElementById("fo-transaction-note");
    if (!target || !source || !note) return false;
    renderFilters();
    renderMetrics();
    const visible = currentFilter === "ALL" ? transactions : transactions.filter((entry) => entry.category === currentFilter);
    target.innerHTML = visible.map(renderEntry).join("") || `<div class="empty fo-transaction-empty">${transactions.length ? "No matching transactions are recorded." : "The structured ledger exists but contains no transaction entries."}</div>`;
    source.className = "pill good";
    source.textContent = `Live resource v${resourceVersion}`;
    note.textContent = "Transaction Ledger Schema v1 • directional assets, external-player snapshots, cap and roster effects, corrections, canon-event links and audit provenance.";
    return true;
  }

  async function load(attempt = 0) {
    if (!document.getElementById("fo-transaction-center")) {
      if (attempt < 80) setTimeout(() => load(attempt + 1).catch(showError), 50);
      return;
    }
    const { data, error } = await ledgerClient.from("archers_resources")
      .select("version, data, updated_at")
      .eq("franchise_id", FRANCHISE_ID)
      .eq("resource_type", RESOURCE_TYPE)
      .eq("resource_id", RESOURCE_ID)
      .eq("status", "ACTIVE")
      .eq("visibility", "CONSOLE")
      .maybeSingle();
    if (error) throw error;
    if (!data?.data) return;
    const entries = data.data.transactions ?? data.data.entries ?? data.data.events;
    if (!Array.isArray(entries)) {
      const source = document.getElementById("fo-transaction-source");
      const target = document.getElementById("fo-transaction-list");
      if (source) { source.className = "pill bad"; source.textContent = `Live resource v${data.version} • schema unsupported`; }
      if (target) target.innerHTML = '<div class="empty fo-transaction-empty">The transaction-ledger resource was found, but no transactions array was recognized.</div>';
      return;
    }
    resourceVersion = data.version;
    transactions = entries.map(normalizeEntry).sort((a, b) => String(b.occurredAt ?? b.id).localeCompare(String(a.occurredAt ?? a.id)));
    render();
  }

  function showError(error) {
    const source = document.getElementById("fo-transaction-source");
    const target = document.getElementById("fo-transaction-list");
    if (source) { source.className = "pill bad"; source.textContent = "Ledger v1 adapter unavailable"; }
    if (target) target.innerHTML = `<div class="empty fo-transaction-empty">Transaction Ledger v1 adapter failed: ${escapeHtml(error?.message ?? error)}</div>`;
  }

  window.addEventListener("DOMContentLoaded", () => {
    load().catch(showError);
    ledgerClient.channel("archers-transaction-ledger-v1-adapter")
      .on("postgres_changes", { event: "*", schema: "public", table: "archers_resources", filter: `franchise_id=eq.${FRANCHISE_ID}` }, () => load().catch(showError))
      .subscribe();
  });
})();
