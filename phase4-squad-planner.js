(() => {
  const APP = window.ArchersApp;
  if (!APP?.config || !APP?.createSupabaseClient) {
    console.error("Squad Planner requires archers-app-config.js");
    return;
  }

  const { franchiseId, season, storagePrefix } = APP.config;
  const plannerClient = APP.createSupabaseClient();
  const STORAGE_KEY = `${storagePrefix}-squad-planner-v1-scenario`;
  const ROOM_DEFINITIONS = [
    ["qb", "Quarterbacks", ["QB"]],
    ["rb", "Running Backs", ["RB", "FB", "RB-KR", "RB/KR"]],
    ["wr", "Wide Receivers", ["WR", "WR-PR", "WR-KR", "WR/PR", "WR/KR"]],
    ["te", "Tight Ends", ["TE", "TE-HB", "TE/HB"]],
    ["ot", "Offensive Tackles", ["LT", "RT", "OT"]],
    ["iol", "Interior Offensive Line", ["LG", "RG", "C", "G", "C-G", "C/G", "G-T", "G/T"]],
    ["edge", "Edge Defenders", ["EDGE", "DE"]],
    ["dt", "Defensive Tackles", ["DT", "NT"]],
    ["lb", "Linebackers", ["MLB", "LB", "OLB", "ILB"]],
    ["cb", "Cornerbacks", ["CB", "NB", "CB-S", "CB/S"]],
    ["s", "Safeties", ["FS", "SS", "S", "S-NB", "S/NB"]],
    ["st", "Specialists", ["K", "P", "LS"]],
    ["other", "Other / Flex", []]
  ];
  const ROOM_BY_POSITION = new Map(
    ROOM_DEFINITIONS.flatMap(([roomId, , positions]) => positions.map((position) => [position, roomId]))
  );

  let stateRow = null;
  let players = [];
  let scenario = null;
  let selectedYear = season;
  let reloadTimer = null;
  let channel = null;
  let dragged = null;

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const upper = (value) => String(value ?? "").trim().toUpperCase().replaceAll(" ", "_");
  const asArray = (value) => Array.isArray(value) ? value : value == null ? [] : [value];
  const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

  function roomFor(player) {
    const position = upper(player.data?.position_code ?? player.data?.position);
    return ROOM_BY_POSITION.get(position) ?? "other";
  }

  function playerName(player) {
    return String(player.data?.player_name ?? player.data?.name ?? player.resource_id);
  }

  function roleRank(player) {
    const role = upper(player.data?.role);
    if (
      role.includes("STARTER")
      || role.includes("STARTING")
      || role.includes("CENTERPIECE")
      || /\b(?:QB|RB|WR|TE|EDGE|DT|LB|CB|FS|SS)1\b/.test(role)
    ) return 0;
    if (
      role.includes("ROTATION")
      || role.includes("BACKUP")
      || role.includes("RESERVE")
      || /\b(?:QB|RB|WR|TE|EDGE|DT|LB|CB)[2-9]\b/.test(role)
    ) return 1;
    return 2;
  }

  function baselineRooms() {
    const rooms = Object.fromEntries(ROOM_DEFINITIONS.map(([roomId]) => [roomId, []]));
    [...players]
      .sort((a, b) => {
        const statusRank = (upper(a.data?.roster_status) === "ACTIVE_ROSTER" ? 0 : 1)
          - (upper(b.data?.roster_status) === "ACTIVE_ROSTER" ? 0 : 1);
        return statusRank
          || roleRank(a) - roleRank(b)
          || (numeric(b.data?.overall_rating) ?? -1) - (numeric(a.data?.overall_rating) ?? -1)
          || playerName(a).localeCompare(playerName(b));
      })
      .forEach((player) => rooms[roomFor(player)].push(player.resource_id));
    return rooms;
  }

  function readSavedScenario() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      return parsed?.schemaVersion === 1 && parsed?.rooms ? parsed : null;
    } catch {
      return null;
    }
  }

  function reconcileRooms(savedRooms) {
    const baseline = baselineRooms();
    const validIds = new Set(players.map((player) => player.resource_id));
    const result = {};

    ROOM_DEFINITIONS.forEach(([roomId]) => {
      const saved = asArray(savedRooms?.[roomId]).filter((id) => validIds.has(id) && roomFor(players.find((player) => player.resource_id === id)) === roomId);
      const known = new Set(saved);
      result[roomId] = [...saved, ...baseline[roomId].filter((id) => !known.has(id))];
    });
    return result;
  }

  function newScenario(saved = null) {
    return {
      schemaVersion: 1,
      name: String(saved?.name ?? "Week 3 Squad Plan"),
      baselineStateVersion: stateRow?.version ?? null,
      updatedAt: saved?.updatedAt ?? null,
      rooms: reconcileRooms(saved?.rooms)
    };
  }

  function saveScenario(message = "Local draft saved. No franchise write occurred.") {
    scenario.name = document.getElementById("squad-planner-name")?.value.trim() || "Untitled Squad Plan";
    scenario.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scenario));
    setStatus(message, "good");
    renderMetrics();
  }

  function setStatus(message, kind = "") {
    const target = document.getElementById("squad-planner-status");
    if (!target) return;
    target.className = `squad-planner-status ${kind}`.trim();
    target.textContent = message;
  }

  function medicalEntries() {
    return asArray(stateRow?.state?.medical);
  }

  function medicalFor(player) {
    const id = upper(player.resource_id);
    const name = upper(playerName(player));
    return medicalEntries().find((item) => {
      const itemId = upper(item?.resource_id ?? item?.player_resource_id ?? item?.player_id);
      const itemName = upper(item?.name ?? item?.player_name);
      return (itemId && itemId === id) || (itemName && itemName === name);
    }) ?? null;
  }

  function contractFact(player, year) {
    const data = player.data ?? {};
    const contract = data.contract ?? {};
    const endSeason = numeric(contract.end_season);
    const rollover = upper(contract.rollover_status);

    if (endSeason == null) {
      if (year === season && rollover === "FINAL_YEAR") {
        return { label: `${season} final year`, kind: "warn", controlled: true, finalYear: true, unknown: false };
      }
      return { label: `${year} control unknown`, kind: "warn", controlled: null, finalYear: rollover === "FINAL_YEAR", unknown: true };
    }
    if (endSeason < year) return { label: `Not controlled in ${year}`, kind: "bad", controlled: false, finalYear: false, unknown: false };
    if (endSeason === year || (year === season && rollover === "FINAL_YEAR")) {
      return { label: `${year} final year`, kind: "warn", controlled: true, finalYear: true, unknown: false };
    }
    return { label: `Controlled through ${endSeason}`, kind: "good", controlled: true, finalYear: false, unknown: false };
  }

  function getPlayer(resourceId) {
    return players.find((player) => player.resource_id === resourceId);
  }

  function rosterCounts() {
    return {
      active: players.filter((player) => upper(player.data?.roster_status) === "ACTIVE_ROSTER").length,
      practice: players.filter((player) => upper(player.data?.roster_status) === "PRACTICE_SQUAD").length
    };
  }

  function renderMetrics() {
    const target = document.getElementById("squad-planner-metrics");
    if (!target) return;
    const counts = rosterCounts();
    const active = players.filter((player) => upper(player.data?.roster_status) === "ACTIVE_ROSTER");
    const future = active.map((player) => contractFact(player, season + 1));
    const controlled = future.filter((fact) => fact.controlled === true).length;
    const unknown = future.filter((fact) => fact.unknown).length;
    const saved = Boolean(scenario?.updatedAt);
    const metrics = [
      ["Player resources", players.length, `${counts.active} active + ${counts.practice} practice squad`],
      ["Roster integrity", counts.active === 53 && counts.practice === 16 ? "53 / 16" : `${counts.active} / ${counts.practice}`, counts.active === 53 && counts.practice === 16 ? "Expected counts present" : "Count mismatch - review live roster"],
      [`${season + 1} active control`, `${controlled}/${active.length}`, `${unknown} unknown contract ${unknown === 1 ? "record" : "records"}`],
      ["Live state", stateRow?.version ?? "—", `Baseline captured at state ${scenario?.baselineStateVersion ?? stateRow?.version ?? "unknown"}`],
      ["Local scenario", saved ? "Saved" : "Unsaved", saved && scenario.updatedAt ? `Updated ${new Date(scenario.updatedAt).toLocaleString()}` : "Browser-local only"]
    ];
    target.innerHTML = metrics.map(([label, value, note]) => `
      <article class="squad-planner-metric">
        <div class="label">${escapeHtml(label)}</div>
        <div class="value">${escapeHtml(value)}</div>
        <div class="subvalue">${escapeHtml(note)}</div>
      </article>`).join("");
  }

  function renderAttention() {
    const target = document.getElementById("squad-planner-alerts");
    if (!target) return;
    const counts = rosterCounts();
    const active = players.filter((player) => upper(player.data?.roster_status) === "ACTIVE_ROSTER");
    const futureFacts = active.map((player) => contractFact(player, season + 1));
    const unknown = futureFacts.filter((fact) => fact.unknown).length;
    const finalYear = active.filter((player) => contractFact(player, season).finalYear).length;
    const medical = active.filter(medicalFor).length;
    const thinRooms = ROOM_DEFINITIONS.map(([roomId, label]) => {
      const roomPlayers = active.filter((player) => roomFor(player) === roomId);
      const controlled = roomPlayers.filter((player) => contractFact(player, season + 1).controlled === true).length;
      return { label, total: roomPlayers.length, controlled };
    }).filter((room) => room.total > 0 && room.controlled < Math.max(1, Math.ceil(room.total / 2)));
    const alerts = [
      {
        kind: counts.active === 53 && counts.practice === 16 ? "good" : "bad",
        title: counts.active === 53 && counts.practice === 16 ? "Roster counts intact" : "Roster count mismatch",
        note: `${counts.active} active and ${counts.practice} practice-squad resources.`
      },
      {
        kind: thinRooms.length ? "bad" : "good",
        title: thinRooms.length ? `${thinRooms.length} thin future-control ${thinRooms.length === 1 ? "room" : "rooms"}` : "Future-control floor covered",
        note: thinRooms.length ? thinRooms.map((room) => `${room.label} ${room.controlled}/${room.total}`).join(" • ") : `Every populated room has at least half of its active players controlled for ${season + 1}.`
      },
      {
        kind: medical || finalYear || unknown ? "warn" : "good",
        title: `${medical} medical • ${finalYear} final-year • ${unknown} unknown`,
        note: "Warnings reflect recorded live data only; unknown contract information remains unknown."
      }
    ];
    target.innerHTML = alerts.map((alert) => `
      <article class="squad-planner-alert ${alert.kind}">
        <strong>${escapeHtml(alert.title)}</strong>
        <span>${escapeHtml(alert.note)}</span>
      </article>`).join("");
  }

  function renderPlayer(player, roomId, index, roomLength) {
    const data = player.data ?? {};
    const position = data.position_code ?? data.position ?? "—";
    const status = upper(data.roster_status) === "PRACTICE_SQUAD" ? "Practice squad" : "Active";
    const role = data.role ? ` • ${data.role}` : "";
    const rating = data.overall_rating == null ? "" : ` • OVR ${data.overall_rating}`;
    const contract = contractFact(player, selectedYear);
    const medical = medicalFor(player);
    return `
      <article class="squad-player-card${medical ? " medical" : ""}" draggable="true" data-room-id="${escapeHtml(roomId)}" data-resource-id="${escapeHtml(player.resource_id)}">
        <div class="squad-player-slot" aria-label="Planning slot ${index + 1}">#${index + 1}</div>
        <div>
          <div class="squad-player-name">${escapeHtml(playerName(player))}</div>
          <div class="squad-player-meta">${escapeHtml(`${position} • ${status}${role}${rating}`)}</div>
          <div class="squad-player-contract ${contract.kind}">${escapeHtml(contract.label)}${medical ? ` • Medical: ${medical.status ?? medical.issue ?? "recorded flag"}` : ""}</div>
        </div>
        <div class="squad-player-controls">
          <button type="button" class="squad-player-action" data-move="-1" aria-label="Move ${escapeHtml(playerName(player))} up" ${index === 0 ? "disabled" : ""}>↑</button>
          <button type="button" class="squad-player-action" data-move="1" aria-label="Move ${escapeHtml(playerName(player))} down" ${index === roomLength - 1 ? "disabled" : ""}>↓</button>
          <button type="button" class="squad-player-action profile roster-player-row" data-resource-id="${escapeHtml(player.resource_id)}" aria-label="Open profile for ${escapeHtml(playerName(player))}">Profile</button>
        </div>
      </article>`;
  }

  function renderRooms() {
    const target = document.getElementById("squad-planner-rooms");
    if (!target) return;
    target.innerHTML = ROOM_DEFINITIONS.map(([roomId, label]) => {
      const ids = scenario.rooms[roomId] ?? [];
      const roomPlayers = ids.map(getPlayer).filter(Boolean);
      const active = roomPlayers.filter((player) => upper(player.data?.roster_status) === "ACTIVE_ROSTER");
      const controlled = active.filter((player) => contractFact(player, season + 1).controlled === true).length;
      return `
        <section class="squad-planner-room" data-room="${escapeHtml(roomId)}">
          <div class="squad-planner-room-head">
            <div class="squad-planner-room-title"><h3>${escapeHtml(label)}</h3><span>${roomPlayers.length} total</span></div>
            <div class="squad-planner-room-summary">${active.length} active<br>${controlled}/${active.length} controlled in ${season + 1}</div>
          </div>
          <div class="squad-planner-player-list" data-drop-room="${escapeHtml(roomId)}">
            ${roomPlayers.length ? roomPlayers.map((player, index) => renderPlayer(player, roomId, index, roomPlayers.length)).join("") : '<div class="squad-planner-empty-room">No live player resources mapped to this room.</div>'}
          </div>
        </section>`;
    }).join("");
  }

  function renderAll() {
    renderMetrics();
    renderAttention();
    renderRooms();
  }

  function setupMarkup() {
    const root = document.getElementById("squad-planner-root");
    if (!root || root.dataset.ready === "true") return root;
    root.dataset.ready = "true";
    root.className = "squad-planner-shell";
    root.innerHTML = `
      <section class="squad-planner-hero">
        <div>
          <div class="eyebrow">Squad Planner • Position-Room Command</div>
          <h2>Build the next roster before it becomes canon.</h2>
          <p>Reorder players inside each position room, inspect current and future contract control, and surface depth risks using the live 69-player roster.</p>
        </div>
        <div class="squad-planner-boundary">
          <strong>Non-Canon Local Draft</strong>
          <span>No Supabase writes. No roster moves. Dragging changes only this browser's planning order and never represents a Kevin Dorey decision.</span>
        </div>
      </section>
      <section class="squad-planner-toolbar" aria-label="Squad Planner controls">
        <label class="squad-planner-field">Scenario name
          <input id="squad-planner-name" type="text" maxlength="80" value="Week 3 Squad Plan">
        </label>
        <label class="squad-planner-field">Contract view
          <select id="squad-planner-year">
            <option value="${season}">${season} current control</option>
            <option value="${season + 1}">${season + 1} future control</option>
          </select>
        </label>
        <div class="squad-planner-actions">
          <button id="squad-planner-save" type="button" class="squad-planner-action primary">Save Local Draft</button>
          <button id="squad-planner-reset" type="button" class="squad-planner-action">Reset to Live Roster</button>
        </div>
        <div id="squad-planner-status" class="squad-planner-status" aria-live="polite">Reading the authoritative roster and state version…</div>
      </section>
      <section id="squad-planner-metrics" class="squad-planner-metrics" aria-label="Squad Planner metrics"></section>
      <section class="squad-planner-attention">
        <div class="section-head"><div><h3>Planning Attention</h3><p>Roster integrity, future control, medical and contract warnings from recorded data.</p></div></div>
        <div id="squad-planner-alerts" class="squad-planner-alerts"></div>
      </section>
      <section>
        <div class="section-head"><div><h2>Position Rooms</h2><p>Drag within a room or use the arrow controls. Position assignments and roster status never change.</p></div></div>
        <div id="squad-planner-rooms" class="squad-planner-room-grid"></div>
      </section>`;
    return root;
  }

  function ensureNavigation() {
    const tabs = document.querySelector(".tabs");
    const rosterButton = tabs?.querySelector('.tab-button[data-tab="roster"]');
    if (!tabs || !rosterButton) return;
    let button = tabs.querySelector('.tab-button[data-tab="squadplanner"]');
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "tab-button";
      button.dataset.tab = "squadplanner";
      button.textContent = "Squad Planner";
      rosterButton.insertAdjacentElement("afterend", button);
      button.addEventListener("click", () => activatePlanner());
    }
    if (location.hash === "#squadplanner") activatePlanner(false);
  }

  function activatePlanner(updateHash = true) {
    document.querySelectorAll(".tab-button").forEach((button) => button.classList.toggle("active", button.dataset.tab === "squadplanner"));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === "squadplanner"));
    localStorage.setItem(`${storagePrefix}-tab`, "squadplanner");
    if (updateHash) history.replaceState(null, "", "#squadplanner");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function movePlayer(resourceId, roomId, targetIndex) {
    const room = scenario.rooms[roomId] ?? [];
    const currentIndex = room.indexOf(resourceId);
    if (currentIndex < 0) return;
    const boundedIndex = Math.max(0, Math.min(targetIndex, room.length - 1));
    room.splice(currentIndex, 1);
    room.splice(boundedIndex, 0, resourceId);
    const name = playerName(getPlayer(resourceId));
    saveScenario(`Moved ${name} to planning slot ${boundedIndex + 1} in ${ROOM_DEFINITIONS.find(([id]) => id === roomId)?.[1] ?? roomId}. Local non-canon only.`);
    renderRooms();
  }

  function bindInteractions(root) {
    root.addEventListener("click", (event) => {
      const move = event.target.closest?.("[data-move]");
      if (move) {
        const card = move.closest(".squad-player-card");
        const room = scenario.rooms[card.dataset.roomId] ?? [];
        movePlayer(card.dataset.resourceId, card.dataset.roomId, room.indexOf(card.dataset.resourceId) + Number(move.dataset.move));
      }
    });
    root.addEventListener("change", (event) => {
      if (event.target.id === "squad-planner-year") {
        selectedYear = Number(event.target.value);
        renderRooms();
        setStatus(`Showing recorded ${selectedYear} contract control.`, "good");
      }
    });
    document.getElementById("squad-planner-save")?.addEventListener("click", () => saveScenario());
    document.getElementById("squad-planner-reset")?.addEventListener("click", () => {
      localStorage.removeItem(STORAGE_KEY);
      scenario = newScenario();
      document.getElementById("squad-planner-name").value = scenario.name;
      renderAll();
      setStatus(`Reset to the live roster baseline at state ${stateRow?.version ?? "unknown"}. No franchise write occurred.`, "good");
    });

    root.addEventListener("dragstart", (event) => {
      const card = event.target.closest?.(".squad-player-card");
      if (!card) return;
      dragged = { resourceId: card.dataset.resourceId, roomId: card.dataset.roomId };
      card.classList.add("dragging");
      event.dataTransfer?.setData("text/plain", card.dataset.resourceId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    root.addEventListener("dragend", (event) => {
      event.target.closest?.(".squad-player-card")?.classList.remove("dragging");
      document.querySelectorAll(".squad-planner-player-list.drag-over").forEach((list) => list.classList.remove("drag-over"));
      dragged = null;
    });
    root.addEventListener("dragover", (event) => {
      const list = event.target.closest?.("[data-drop-room]");
      if (!list || !dragged || list.dataset.dropRoom !== dragged.roomId) return;
      event.preventDefault();
      list.classList.add("drag-over");
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });
    root.addEventListener("dragleave", (event) => {
      const list = event.target.closest?.("[data-drop-room]");
      if (list && !list.contains(event.relatedTarget)) list.classList.remove("drag-over");
    });
    root.addEventListener("drop", (event) => {
      const list = event.target.closest?.("[data-drop-room]");
      if (!list || !dragged) return;
      event.preventDefault();
      list.classList.remove("drag-over");
      if (list.dataset.dropRoom !== dragged.roomId) {
        setStatus("Cross-room moves are blocked because this planner does not change authoritative player positions.", "warn");
        return;
      }
      const targetCard = event.target.closest?.(".squad-player-card");
      const room = scenario.rooms[dragged.roomId] ?? [];
      const targetIndex = targetCard ? room.indexOf(targetCard.dataset.resourceId) : room.length - 1;
      movePlayer(dragged.resourceId, dragged.roomId, targetIndex);
    });
  }

  async function loadPlanner() {
    setupMarkup();
    const [stateResult, playersResult] = await Promise.all([
      plannerClient.from("archers_franchise_state").select("id, version, state, updated_at").eq("id", franchiseId).single(),
      plannerClient.from("archers_resources").select("resource_id, version, data, updated_at").eq("franchise_id", franchiseId).eq("resource_type", "player").eq("status", "ACTIVE").eq("visibility", "CONSOLE").order("resource_id")
    ]);
    if (stateResult.error) throw stateResult.error;
    if (playersResult.error) throw playersResult.error;

    stateRow = stateResult.data;
    players = playersResult.data ?? [];
    const saved = readSavedScenario();
    scenario = newScenario(saved);
    const nameInput = document.getElementById("squad-planner-name");
    if (nameInput) nameInput.value = scenario.name;
    renderAll();
    setStatus(`Live roster connected at state ${stateRow.version}. ${players.length} player resources loaded; edits stay in this browser.`, "good");
    window.dispatchEvent(new CustomEvent("archers:squad-planner-rendered", {
      detail: { stateVersion: stateRow.version, playerResources: players.length, localOnly: true }
    }));
  }

  function showError(error) {
    console.error("Squad Planner could not load", error);
    setupMarkup();
    setStatus(`Squad Planner data unavailable: ${error?.message ?? error}`, "bad");
  }

  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => loadPlanner().catch(showError), 220);
  }

  function subscribe() {
    if (!plannerClient.channel) return;
    if (channel && plannerClient.removeChannel) plannerClient.removeChannel(channel);
    channel = plannerClient.channel("archers-squad-planner-v1")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "archers_franchise_state", filter: `id=eq.${franchiseId}` }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "archers_resources", filter: `franchise_id=eq.${franchiseId}` }, scheduleReload)
      .subscribe();
  }

  function start() {
    const root = setupMarkup();
    ensureNavigation();
    if (root) bindInteractions(root);
    loadPlanner().then(subscribe).catch(showError);
  }

  window.ArchersSquadPlanner = Object.freeze({
    getSnapshot: () => ({
      stateVersion: stateRow?.version ?? null,
      playerResources: players.length,
      scenario: scenario ? JSON.parse(JSON.stringify(scenario)) : null
    }),
    reload: () => loadPlanner(),
    open: () => activatePlanner()
  });

  start();
})();
