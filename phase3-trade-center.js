(() => {
  const SUPABASE_URL = "https://oqbylwlkrabxvpdhugrf.supabase.co";
  const SUPABASE_KEY = "sb_publishable_z-EjW-S0x7GZH2VREEaXAw_NOOrbH-m";
  const FRANCHISE_ID = "stl-2026";
  const DRAFT_RESOURCE_TYPE = "draft_capital";
  const DRAFT_RESOURCE_ID = "draft-capital";
  const SCENARIO_STORAGE_KEY = "archers-trade-center-v1-scenarios";
  const MAX_SCENARIOS = 3;

  const tradeClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const state = {
    franchise: null,
    players: [],
    picks: [],
    currentDraftYear: null,
    selectedPlayers: new Set(),
    selectedPicks: new Set(),
    scenarios: loadScenarios(),
    playerSearch: ""
  };

  const POSITIONS = ["QB", "RB", "WR", "TE", "OT", "IOL", "EDGE", "DT", "LB", "CB", "S", "K", "P"];
  const ROLE_TIERS = {
    DEPTH: { label: "Depth", bonus: 0 },
    ROTATION: { label: "Rotation", bonus: 7 },
    STARTER: { label: "Starter", bonus: 16 },
    PREMIUM: { label: "Premium", bonus: 28 }
  };
  const EVIDENCE = {
    MANUAL: { label: "Manual idea", score: 25 },
    PUBLIC_REPORT: { label: "Public report", score: 45 },
    STAFF_SCOUTED: { label: "Staff scouted", score: 60 },
    TEAM_CONTACT: { label: "Team contact", score: 80 },
    VERIFIED: { label: "Verified market entry", score: 95 }
  };
  const PICK_VALUES = { 1: 45, 2: 28, 3: 18, 4: 11, 5: 7, 6: 4, 7: 2 };
  const TRAIT_BONUS = { XFACTOR: 20, SUPERSTAR: 14, STAR: 8, HIDDEN: 6, NORMAL: 0 };

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const numberOrNull = (value) => {
    if (value === "" || value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const clamp = (value, minimum = 0, maximum = 100) => Math.max(minimum, Math.min(maximum, value));
  const round = (value) => Math.round(clamp(value));
  const normalizeKey = (value) => String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const normalizeTrait = (value) => {
    const key = normalizeKey(value).replaceAll("_", "");
    if (key === "XFACTOR") return "XFACTOR";
    if (key === "SUPERSTAR") return "SUPERSTAR";
    if (key === "STAR") return "STAR";
    if (key === "HIDDEN") return "HIDDEN";
    return "NORMAL";
  };

  function positionGroup(value) {
    const key = normalizeKey(value);
    if (["LT", "RT", "OT", "T"].includes(key)) return "OT";
    if (["LG", "RG", "C", "G", "IOL", "C_G", "G_T"].includes(key)) return "IOL";
    if (["FS", "SS", "S", "S_NB"].includes(key)) return "S";
    if (["MLB", "OLB", "ILB", "LB"].includes(key)) return "LB";
    if (["HB", "FB", "RB", "RB_KR"].includes(key)) return "RB";
    if (["WR", "WR_PR", "WR_KR"].includes(key)) return "WR";
    if (["TE", "TE_HB"].includes(key)) return "TE";
    if (["CB", "NB", "CB_S"].includes(key)) return "CB";
    return key;
  }

  function formatMillions(value) {
    const parsed = numberOrNull(value);
    return parsed === null ? "—" : `$${parsed.toFixed(parsed % 1 === 0 ? 1 : 2)}M`;
  }

  function safeStorageGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function safeStorageSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* Session-only mode is acceptable. */ }
  }

  function loadScenarios() {
    try {
      const parsed = JSON.parse(safeStorageGet(SCENARIO_STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.slice(0, MAX_SCENARIOS) : [];
    } catch {
      return [];
    }
  }

  function saveScenarioStorage() {
    safeStorageSet(SCENARIO_STORAGE_KEY, JSON.stringify(state.scenarios));
  }

  function fieldValue(id) {
    return document.getElementById(id)?.value ?? "";
  }

  function selectedPlayerRows() {
    return state.players.filter((row) => state.selectedPlayers.has(row.resource_id));
  }

  function selectedPickRows() {
    return state.picks.filter((pick) => state.selectedPicks.has(pick.identity));
  }

  function playerTradeValue(row) {
    const data = row?.data ?? row ?? {};
    const overall = numberOrNull(data.overall_rating) ?? 60;
    const age = numberOrNull(data.age);
    const cap = numberOrNull(data.cap_hit_2026_millions) ?? 0;
    const years = numberOrNull(data.contract_years_remaining ?? data.years_remaining) ?? 1;
    const trait = TRAIT_BONUS[normalizeTrait(data.development_trait)] ?? 0;
    const ageBonus = age === null ? 0 : age <= 23 ? 12 : age <= 26 ? 8 : age <= 29 ? 3 : age <= 31 ? -3 : -9;
    const rosterMultiplier = data.roster_status === "PRACTICE_SQUAD" ? 0.38 : 1;
    return Math.max(1, ((overall - 55) * 1.45 + trait + ageBonus + Math.min(years, 5) * 1.4 - cap * 0.42) * rosterMultiplier);
  }

  function pickTradeValue(pick) {
    const base = PICK_VALUES[numberOrNull(pick.round)] ?? 0;
    const currentYear = state.currentDraftYear ?? numberOrNull(pick.year) ?? new Date().getFullYear();
    const yearsOut = Math.max(0, (numberOrNull(pick.year) ?? currentYear) - currentYear);
    const yearDiscount = Math.pow(0.86, yearsOut);
    const status = normalizeKey(pick.status);
    const statusMultiplier = status === "CONFIRMED" ? 1 : status === "SECURED" ? 0.9 : status === "CONDITIONAL" ? 0.75 : status === "PROVISIONAL" ? 0.62 : 0.7;
    return Math.max(0.5, base * yearDiscount * statusMultiplier);
  }

  function targetSnapshot() {
    return {
      name: fieldValue("fo-trade-target-name").trim(),
      team: fieldValue("fo-trade-target-team").trim(),
      position: fieldValue("fo-trade-target-position"),
      overall_rating: numberOrNull(fieldValue("fo-trade-target-ovr")),
      age: numberOrNull(fieldValue("fo-trade-target-age")),
      development_trait: fieldValue("fo-trade-target-trait"),
      cap_hit_2026_millions: numberOrNull(fieldValue("fo-trade-target-cap")),
      contract_years_remaining: numberOrNull(fieldValue("fo-trade-target-years")),
      tier: fieldValue("fo-trade-target-tier"),
      evidence: fieldValue("fo-trade-target-evidence"),
      askingPrice: fieldValue("fo-trade-target-ask").trim()
    };
  }

  function objectiveSnapshot() {
    return {
      position: fieldValue("fo-trade-objective-position"),
      role: fieldValue("fo-trade-objective-role"),
      timeline: fieldValue("fo-trade-objective-timeline"),
      maxCap: numberOrNull(fieldValue("fo-trade-objective-cap"))
    };
  }

  function targetTradeValue(target) {
    if (target.overall_rating === null) return null;
    const tierBonus = ROLE_TIERS[target.tier]?.bonus ?? 0;
    return playerTradeValue({ ...target, roster_status: "ACTIVE_ROSTER" }) + tierBonus;
  }

  function positionPlayers(position) {
    const wanted = positionGroup(position);
    return state.players.filter((row) => row.data?.roster_status === "ACTIVE_ROSTER" && positionGroup(row.data?.position_code ?? row.data?.position) === wanted);
  }

  function buildEvaluation() {
    const target = targetSnapshot();
    const objective = objectiveSnapshot();
    const players = selectedPlayerRows();
    const picks = selectedPickRows();
    const targetValue = targetTradeValue(target);
    const outgoingPlayerValue = players.reduce((sum, row) => sum + playerTradeValue(row), 0);
    const outgoingPickValue = picks.reduce((sum, pick) => sum + pickTradeValue(pick), 0);
    const outgoingValue = outgoingPlayerValue + outgoingPickValue;
    const assetCount = players.length + picks.length;
    const evidenceScore = EVIDENCE[target.evidence]?.score ?? 25;
    const position = target.position || objective.position;
    const peers = positionPlayers(position);
    const peerOvrs = peers.map((row) => numberOrNull(row.data?.overall_rating)).filter((value) => value !== null);
    const peerAverage = peerOvrs.length ? peerOvrs.reduce((sum, value) => sum + value, 0) / peerOvrs.length : 60;
    const peerBest = peerOvrs.length ? Math.max(...peerOvrs) : 60;
    const targetOvr = target.overall_rating ?? 60;
    const depthNeed = Math.max(0, 4 - peers.length);
    const fitScore = round(48 + (targetOvr - peerAverage) * 2.6 + depthNeed * 6 + (targetOvr > peerBest ? 8 : 0));

    const outgoingCap = players.reduce((sum, row) => sum + (numberOrNull(row.data?.cap_hit_2026_millions) ?? 0), 0);
    const incomingCap = target.cap_hit_2026_millions;
    const netCap = incomingCap === null ? null : incomingCap - outgoingCap;
    const flexibility = numberOrNull(state.franchise?.state?.resources?.cap?.practical_flexibility_millions);
    let capScore = 50;
    if (netCap !== null && flexibility !== null) {
      capScore = netCap <= 0 ? 95 : netCap <= flexibility ? 72 + Math.min(20, (flexibility - netCap) * 3) : 42 - (netCap - flexibility) * 7;
    } else if (incomingCap !== null && objective.maxCap !== null) {
      capScore = incomingCap <= objective.maxCap ? 82 : 45 - (incomingCap - objective.maxCap) * 7;
    }
    capScore = round(capScore);

    const ratio = targetValue && outgoingValue ? outgoingValue / targetValue : null;
    const balancePenalty = ratio === null ? 55 : Math.abs(Math.log(Math.max(ratio, 0.05))) * 66;
    const complexityPenalty = Math.max(0, assetCount - 3) * 5;
    const realismScore = round(100 - balancePenalty - complexityPenalty - Math.max(0, 55 - evidenceScore) * 0.22);

    const age = target.age;
    const ageShortTerm = age === null ? 0 : age <= 29 ? 8 : age <= 31 ? 2 : -7;
    const shortTermScore = round(52 + (targetOvr - peerAverage) * 3 + ageShortTerm + (ROLE_TIERS[target.tier]?.bonus ?? 0) * 0.35);

    const targetTrait = TRAIT_BONUS[normalizeTrait(target.development_trait)] ?? 0;
    const ageLongTerm = age === null ? 0 : age <= 23 ? 22 : age <= 26 ? 15 : age <= 29 ? 7 : age <= 31 ? -2 : -12;
    const years = target.contract_years_remaining ?? 1;
    const futurePickCost = picks.reduce((sum, pick) => sum + pickTradeValue(pick), 0);
    const youngPlayerCost = players.reduce((sum, row) => sum + ((numberOrNull(row.data?.age) ?? 99) <= 25 ? playerTradeValue(row) * 0.28 : 0), 0);
    const longTermScore = round(48 + ageLongTerm + targetTrait * 0.8 + Math.min(years, 5) * 3 - futurePickCost * 0.38 - youngPlayerCost * 0.26);

    let balanceLabel = "Incomplete";
    let balanceKind = "warn";
    let balanceText = "Add a target OVR and at least one outgoing asset.";
    if (ratio !== null) {
      if (ratio < 0.82) {
        balanceLabel = "Light offer";
        balanceKind = "bad";
        balanceText = "The selected Archers package is materially below the target-value estimate.";
      } else if (ratio <= 1.18) {
        balanceLabel = "Negotiating range";
        balanceKind = "good";
        balanceText = "The selected values sit inside the workbench's broad negotiating range.";
      } else {
        balanceLabel = "Archers premium";
        balanceKind = "warn";
        balanceText = "St. Louis is paying above the target-value estimate.";
      }
    }

    const warnings = [];
    if (!target.name || !target.team) warnings.push("Target identity or current team is incomplete.");
    if (target.evidence !== "VERIFIED") warnings.push("Target availability and asking price are not authoritative.");
    if (picks.some((pick) => ["PROVISIONAL", "CONDITIONAL"].includes(normalizeKey(pick.status)))) warnings.push("The package includes a provisional or conditional draft asset.");
    if (incomingCap === null) warnings.push("Incoming cap commitment is unknown.");
    if (flexibility === null) warnings.push("Practical cap flexibility is unavailable, so cap feasibility is approximate.");
    if (assetCount > 4) warnings.push("Large packages receive a realism penalty because multi-asset deals are harder to execute.");

    return {
      target,
      objective,
      players,
      picks,
      targetValue,
      outgoingValue,
      outgoingPlayerValue,
      outgoingPickValue,
      outgoingCap,
      incomingCap,
      netCap,
      flexibility,
      ratio,
      assetCount,
      peers,
      peerAverage,
      peerBest,
      fitScore,
      realismScore,
      capScore,
      shortTermScore,
      longTermScore,
      evidenceScore,
      balanceLabel,
      balanceKind,
      balanceText,
      warnings
    };
  }

  function scoreClass(score) {
    if (score >= 75) return "good";
    if (score >= 50) return "warn";
    return "bad";
  }

  function metricHtml(label, score, note) {
    return `<div class="fo-trade-score ${scoreClass(score)}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(score)}</strong><small>${escapeHtml(note)}</small></div>`;
  }

  function renderEvaluation() {
    const target = document.getElementById("fo-trade-evaluation");
    const status = document.getElementById("fo-trade-source");
    if (!target || !status) return;
    const evaluation = buildEvaluation();
    const hasMinimum = evaluation.target.overall_rating !== null && evaluation.assetCount > 0;

    status.className = `pill ${hasMinimum ? "good" : "warn"}`;
    status.textContent = hasMinimum ? "Read-only evaluation ready" : "Read-only • awaiting package";

    const playerList = evaluation.players.map((row) => `${row.data?.player_name ?? row.resource_id} (${row.data?.position_code ?? "—"})`).join(", ") || "None";
    const pickList = evaluation.picks.map(pickLabel).join(", ") || "None";
    const ratioText = evaluation.ratio === null ? "—" : `${evaluation.outgoingValue.toFixed(1)} / ${evaluation.targetValue.toFixed(1)}`;
    const netCapText = evaluation.netCap === null ? "Unknown" : `${evaluation.netCap > 0 ? "+" : ""}${formatMillions(evaluation.netCap)}`;
    const needText = evaluation.peers.length
      ? `${evaluation.peers.length} active ${positionGroup(evaluation.target.position || evaluation.objective.position)} players • avg ${evaluation.peerAverage.toFixed(1)} • best ${evaluation.peerBest}`
      : `No active ${positionGroup(evaluation.target.position || evaluation.objective.position) || "matching"} profiles found`;

    target.innerHTML = `
      <div class="fo-trade-balance-card ${evaluation.balanceKind}">
        <div><span>Package balance</span><strong>${escapeHtml(evaluation.balanceLabel)}</strong></div>
        <div class="fo-trade-balance-value"><span>Outgoing / target value</span><strong>${escapeHtml(ratioText)}</strong></div>
        <p>${escapeHtml(evaluation.balanceText)}</p>
      </div>
      <div class="fo-trade-score-grid">
        ${metricHtml("Roster Fit", evaluation.fitScore, needText)}
        ${metricHtml("Trade Realism", evaluation.realismScore, "Value balance, evidence and package complexity")}
        ${metricHtml("Cap Feasibility", evaluation.capScore, `Net 2026 cap: ${netCapText}`)}
        ${metricHtml("Short-Term Impact", evaluation.shortTermScore, "Target OVR versus current position room")}
        ${metricHtml("Long-Term Value", evaluation.longTermScore, "Age, trait, control and outgoing future assets")}
        ${metricHtml("Evidence Confidence", evaluation.evidenceScore, EVIDENCE[evaluation.target.evidence]?.label ?? "Manual idea")}
      </div>
      <div class="fo-trade-evaluation-details">
        <div><span>Outgoing players</span><strong>${escapeHtml(playerList)}</strong></div>
        <div><span>Outgoing picks</span><strong>${escapeHtml(pickList)}</strong></div>
        <div><span>Outgoing player cap</span><strong>${escapeHtml(formatMillions(evaluation.outgoingCap))}</strong></div>
        <div><span>Current practical flexibility</span><strong>${escapeHtml(formatMillions(evaluation.flexibility))}</strong></div>
      </div>
      ${evaluation.warnings.length ? `<div class="fo-trade-warnings"><strong>Evidence boundaries</strong><ul>${evaluation.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></div>` : ""}`;
  }

  function playerLabel(row) {
    const data = row.data ?? {};
    return `${data.player_name ?? row.resource_id} • ${data.position_code ?? data.position ?? "—"} • ${data.overall_rating ?? "—"} OVR`;
  }

  function pickLabel(pick) {
    const origin = pick.original_team ? ` from ${pick.original_team}` : "";
    return `${pick.year} Round ${pick.round}${origin} (${normalizeKey(pick.status).replaceAll("_", " ")})`;
  }

  function renderPlayers() {
    const target = document.getElementById("fo-trade-player-assets");
    const summary = document.getElementById("fo-trade-player-summary");
    if (!target || !summary) return;
    const query = state.playerSearch.trim().toLowerCase();
    const rows = [...state.players]
      .sort((a, b) => (a.data?.roster_status === "ACTIVE_ROSTER" ? 0 : 1) - (b.data?.roster_status === "ACTIVE_ROSTER" ? 0 : 1)
        || (numberOrNull(b.data?.overall_rating) ?? 0) - (numberOrNull(a.data?.overall_rating) ?? 0)
        || String(a.data?.player_name ?? a.resource_id).localeCompare(String(b.data?.player_name ?? b.resource_id)))
      .filter((row) => !query || `${row.data?.player_name ?? ""} ${row.data?.position_code ?? ""} ${row.data?.role ?? ""}`.toLowerCase().includes(query));

    summary.textContent = `${state.selectedPlayers.size} selected • ${state.players.length} verified profiles`;
    target.innerHTML = rows.map((row) => {
      const data = row.data ?? {};
      const checked = state.selectedPlayers.has(row.resource_id);
      return `<div class="fo-trade-asset-row${checked ? " selected" : ""}">
        <label>
          <input type="checkbox" data-trade-player-id="${escapeHtml(row.resource_id)}" ${checked ? "checked" : ""}>
          <span class="fo-trade-asset-main"><strong>${escapeHtml(data.player_name ?? row.resource_id)}</strong><small>${escapeHtml(data.position_code ?? data.position ?? "—")} • ${escapeHtml(data.role ?? "Role unavailable")}</small></span>
          <span class="fo-trade-asset-meta"><strong>${escapeHtml(data.overall_rating ?? "—")}</strong><small>${escapeHtml(formatMillions(data.cap_hit_2026_millions))}</small></span>
        </label>
        <button type="button" class="fo-trade-profile roster-player-row" data-resource-id="${escapeHtml(row.resource_id)}">Profile</button>
      </div>`;
    }).join("") || '<div class="empty">No verified players match this search.</div>';

    target.querySelectorAll("[data-trade-player-id]").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.selectedPlayers.add(checkbox.dataset.tradePlayerId);
        else state.selectedPlayers.delete(checkbox.dataset.tradePlayerId);
        renderPlayers();
        renderEvaluation();
      });
    });
  }

  function renderPicks() {
    const target = document.getElementById("fo-trade-pick-assets");
    const summary = document.getElementById("fo-trade-pick-summary");
    if (!target || !summary) return;
    summary.textContent = `${state.selectedPicks.size} selected • ${state.picks.length} live assets`;
    target.innerHTML = state.picks.map((pick) => {
      const checked = state.selectedPicks.has(pick.identity);
      const status = normalizeKey(pick.status);
      const conditional = status === "PROVISIONAL" || status === "CONDITIONAL";
      return `<label class="fo-trade-asset-row fo-trade-pick-row${checked ? " selected" : ""}">
        <input type="checkbox" data-trade-pick-id="${escapeHtml(pick.identity)}" ${checked ? "checked" : ""}>
        <span class="fo-trade-pick-round"><strong>R${escapeHtml(pick.round)}</strong><small>${escapeHtml(pick.year)}</small></span>
        <span class="fo-trade-asset-main"><strong>${escapeHtml(pick.original_team ?? "Origin unavailable")}</strong><small>${escapeHtml(pick.asset_type ?? "Draft asset")}${pick.upgrade_round ? ` • can become R${escapeHtml(pick.upgrade_round)}` : ""}</small></span>
        <span class="pill ${conditional ? "warn" : "good"}">${escapeHtml(status.replaceAll("_", " "))}</span>
      </label>`;
    }).join("") || '<div class="empty">No live draft-capital assets are available to the workbench.</div>';

    target.querySelectorAll("[data-trade-pick-id]").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.selectedPicks.add(checkbox.dataset.tradePickId);
        else state.selectedPicks.delete(checkbox.dataset.tradePickId);
        renderPicks();
        renderEvaluation();
      });
    });
  }

  function scenarioFromEvaluation(evaluation) {
    return {
      id: `trade-${Date.now()}`,
      createdAt: new Date().toISOString(),
      title: `${evaluation.target.team || "Unknown team"} • ${evaluation.target.name || "Unnamed target"}`,
      objective: evaluation.objective,
      target: evaluation.target,
      outgoingPlayers: evaluation.players.map((row) => ({
        resource_id: row.resource_id,
        name: row.data?.player_name ?? row.resource_id,
        position: row.data?.position_code ?? row.data?.position ?? null,
        overall: numberOrNull(row.data?.overall_rating),
        cap: numberOrNull(row.data?.cap_hit_2026_millions)
      })),
      outgoingPicks: evaluation.picks.map((pick) => ({ ...pick })),
      metrics: {
        fit: evaluation.fitScore,
        realism: evaluation.realismScore,
        cap: evaluation.capScore,
        shortTerm: evaluation.shortTermScore,
        longTerm: evaluation.longTermScore,
        evidence: evaluation.evidenceScore,
        balance: evaluation.balanceLabel,
        outgoingValue: Number(evaluation.outgoingValue.toFixed(1)),
        targetValue: evaluation.targetValue === null ? null : Number(evaluation.targetValue.toFixed(1)),
        netCap: evaluation.netCap
      },
      warnings: evaluation.warnings
    };
  }

  function renderScenarios() {
    const target = document.getElementById("fo-trade-scenarios");
    if (!target) return;
    target.innerHTML = state.scenarios.map((scenario, index) => `
      <article class="fo-trade-scenario">
        <div class="fo-trade-scenario-head">
          <div><span>Scenario ${index + 1}</span><h3>${escapeHtml(scenario.title)}</h3></div>
          <button type="button" data-remove-trade-scenario="${escapeHtml(scenario.id)}">Remove</button>
        </div>
        <div class="fo-trade-scenario-package">
          <div><span>Archers send</span><strong>${escapeHtml([
            ...scenario.outgoingPlayers.map((player) => player.name),
            ...scenario.outgoingPicks.map(pickLabel)
          ].join(" • ") || "Nothing selected")}</strong></div>
          <div><span>Archers receive</span><strong>${escapeHtml(`${scenario.target.name || "Unnamed target"} • ${scenario.target.position || "—"} • ${scenario.target.overall_rating ?? "—"} OVR`)}</strong></div>
        </div>
        <div class="fo-trade-scenario-metrics">
          <span>Fit <strong>${escapeHtml(scenario.metrics.fit)}</strong></span>
          <span>Realism <strong>${escapeHtml(scenario.metrics.realism)}</strong></span>
          <span>Cap <strong>${escapeHtml(scenario.metrics.cap)}</strong></span>
          <span>Long term <strong>${escapeHtml(scenario.metrics.longTerm)}</strong></span>
        </div>
        <span class="pill ${scenario.metrics.balance === "Negotiating range" ? "good" : "warn"}">${escapeHtml(scenario.metrics.balance)}</span>
      </article>`).join("") || '<div class="empty">Save up to three packages to compare them side by side.</div>';

    target.querySelectorAll("[data-remove-trade-scenario]").forEach((button) => {
      button.addEventListener("click", () => {
        state.scenarios = state.scenarios.filter((scenario) => scenario.id !== button.dataset.removeTradeScenario);
        saveScenarioStorage();
        renderScenarios();
        setMessage("Comparison scenario removed.", "good");
      });
    });
  }

  function buildStaffPrompt(evaluation) {
    const target = evaluation.target;
    const objective = evaluation.objective;
    const players = evaluation.players.map((row) => `- ${playerLabel(row)} • resource_id: ${row.resource_id}`).join("\n") || "- None";
    const picks = evaluation.picks.map((pick) => `- ${pickLabel(pick)} • asset identity: ${pick.identity}`).join("\n") || "- None";
    const warnings = evaluation.warnings.map((warning) => `- ${warning}`).join("\n") || "- None recorded by the workbench";
    return `TRADE SCENARIO STAFF REVIEW\n\nDo not write or modify anything.\n\nRead the current authoritative franchise, roster, contract, cap, draft-capital, transaction, decision, and league context required to evaluate this scenario. Verify every external fact before treating it as true. Do not establish a trade, negotiation, offer, or target availability as canon.\n\nOBJECTIVE\n- Position: ${objective.position || "Not specified"}\n- Desired role: ${objective.role || "Not specified"}\n- Timeline: ${objective.timeline || "Not specified"}\n- Maximum incoming 2026 cap: ${objective.maxCap === null ? "Not specified" : formatMillions(objective.maxCap)}\n\nPROPOSED TARGET\n- Player: ${target.name || "Unnamed"}\n- Current team: ${target.team || "Unknown"}\n- Position: ${target.position || "Unknown"}\n- OVR: ${target.overall_rating ?? "Unknown"}\n- Age: ${target.age ?? "Unknown"}\n- Development: ${target.development_trait || "Unknown"}\n- 2026 cap hit: ${target.cap_hit_2026_millions === null ? "Unknown" : formatMillions(target.cap_hit_2026_millions)}\n- Contract years remaining: ${target.contract_years_remaining ?? "Unknown"}\n- Evidence level: ${EVIDENCE[target.evidence]?.label ?? target.evidence}\n- Asking-price note: ${target.askingPrice || "None"}\n\nARCHERS OUTGOING PLAYERS\n${players}\n\nARCHERS OUTGOING DRAFT ASSETS\n${picks}\n\nWORKBENCH HEURISTICS\n- Roster fit: ${evaluation.fitScore}/100\n- Trade realism: ${evaluation.realismScore}/100\n- Cap feasibility: ${evaluation.capScore}/100\n- Short-term impact: ${evaluation.shortTermScore}/100\n- Long-term value: ${evaluation.longTermScore}/100\n- Evidence confidence: ${evaluation.evidenceScore}/100\n- Package balance: ${evaluation.balanceLabel}\n\nEVIDENCE BOUNDARIES\n${warnings}\n\nReturn the responsible staff's analysis with real tradeoffs. Confirm what is verified, unknown, or unsupported. Stop for Kevin Dorey's decision before any outreach, offer, negotiation, transaction, or canon write.`;
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function setMessage(message, kind = "warn") {
    const target = document.getElementById("fo-trade-message");
    if (!target) return;
    target.className = `fo-trade-message ${kind}`;
    target.textContent = message;
  }

  function bindFormEvents() {
    document.querySelectorAll("#fo-trade-center input, #fo-trade-center select, #fo-trade-center textarea").forEach((control) => {
      if (control.id === "fo-trade-player-search") return;
      control.addEventListener("input", renderEvaluation);
      control.addEventListener("change", renderEvaluation);
    });

    document.getElementById("fo-trade-player-search")?.addEventListener("input", (event) => {
      state.playerSearch = event.target.value;
      renderPlayers();
    });

    document.getElementById("fo-trade-clear")?.addEventListener("click", () => {
      state.selectedPlayers.clear();
      state.selectedPicks.clear();
      document.querySelectorAll("#fo-trade-center input:not([type=checkbox]), #fo-trade-center textarea").forEach((control) => { control.value = ""; });
      document.getElementById("fo-trade-objective-position").value = "";
      document.getElementById("fo-trade-objective-role").value = "STARTER";
      document.getElementById("fo-trade-objective-timeline").value = "BALANCED";
      document.getElementById("fo-trade-target-position").value = "";
      document.getElementById("fo-trade-target-tier").value = "STARTER";
      document.getElementById("fo-trade-target-evidence").value = "MANUAL";
      document.getElementById("fo-trade-target-trait").value = "NORMAL";
      renderPlayers();
      renderPicks();
      renderEvaluation();
      setMessage("Workbench cleared. No franchise data was changed.", "good");
    });

    document.getElementById("fo-trade-save")?.addEventListener("click", () => {
      const evaluation = buildEvaluation();
      if (evaluation.target.overall_rating === null || evaluation.assetCount === 0) {
        setMessage("Add a target OVR and at least one outgoing asset before saving a comparison.", "bad");
        return;
      }
      if (state.scenarios.length >= MAX_SCENARIOS) {
        setMessage("The comparison board already holds three scenarios. Remove one before saving another.", "bad");
        return;
      }
      state.scenarios.push(scenarioFromEvaluation(evaluation));
      saveScenarioStorage();
      renderScenarios();
      setMessage("Scenario saved locally for comparison. No Supabase write occurred.", "good");
    });

    document.getElementById("fo-trade-copy")?.addEventListener("click", async () => {
      const evaluation = buildEvaluation();
      if (!evaluation.target.name || evaluation.target.overall_rating === null || evaluation.assetCount === 0) {
        setMessage("Complete the target name, target OVR, and outgoing package before preparing staff review.", "bad");
        return;
      }
      try {
        await copyText(buildStaffPrompt(evaluation));
        setMessage("Staff-review prompt copied. Paste it into Draft a Dynasty when you are ready.", "good");
      } catch (error) {
        setMessage(`The prompt could not be copied: ${error?.message ?? error}`, "bad");
      }
    });
  }

  function ensureMarkup(attempt = 0) {
    const frontOffice = document.getElementById("frontoffice");
    if (!frontOffice) {
      if (attempt < 80) setTimeout(() => ensureMarkup(attempt + 1), 50);
      return false;
    }
    if (document.getElementById("fo-trade-center")) return true;

    const draftSection = document.getElementById("fo-draft-capital");
    const transactionSection = document.getElementById("fo-transaction-center");
    const layout = frontOffice.querySelector(".fo-layout");
    const section = document.createElement("section");
    section.id = "fo-trade-center";
    section.className = "panel fo-trade-center";
    section.innerHTML = `
      <div class="section-head fo-trade-heading">
        <div>
          <h2>Trade Center</h2>
          <p>Build and compare proposed packages using verified Archers assets. External targets remain hypothetical until separately verified.</p>
        </div>
        <span id="fo-trade-source" class="pill warn">Read-only • loading assets</span>
      </div>
      <div id="fo-trade-collapsible-body" class="fo-section-body">
        <div class="fo-trade-safety-note"><strong>Planning surface only.</strong> This workbench never contacts another team, creates canon, or writes to Supabase.</div>
        <div class="fo-trade-config-grid">
          <section class="fo-trade-subpanel">
            <div class="fo-trade-subhead"><span>1</span><div><h3>Trade Objective</h3><p>Describe what St. Louis is trying to solve.</p></div></div>
            <div class="fo-trade-form-grid">
              <label>Need position<select id="fo-trade-objective-position"><option value="">Select position</option>${POSITIONS.map((position) => `<option value="${position}">${position}</option>`).join("")}</select></label>
              <label>Desired role<select id="fo-trade-objective-role"><option value="DEPTH">Depth</option><option value="ROTATION">Rotation</option><option value="STARTER" selected>Starter</option><option value="PREMIUM">Premium</option></select></label>
              <label>Timeline<select id="fo-trade-objective-timeline"><option value="WIN_NOW">Win now</option><option value="BALANCED" selected>Balanced</option><option value="FUTURE">Future value</option></select></label>
              <label>Maximum incoming 2026 cap<input id="fo-trade-objective-cap" type="number" min="0" step="0.1" placeholder="Millions"></label>
            </div>
          </section>
          <section class="fo-trade-subpanel">
            <div class="fo-trade-subhead"><span>2</span><div><h3>Incoming Target</h3><p>Enter a candidate without treating the entry as verified canon.</p></div></div>
            <div class="fo-trade-form-grid">
              <label>Player name<input id="fo-trade-target-name" type="text" placeholder="Target player"></label>
              <label>Current team<input id="fo-trade-target-team" type="text" placeholder="Team"></label>
              <label>Position<select id="fo-trade-target-position"><option value="">Select position</option>${POSITIONS.map((position) => `<option value="${position}">${position}</option>`).join("")}</select></label>
              <label>OVR<input id="fo-trade-target-ovr" type="number" min="40" max="99" step="1" placeholder="Overall"></label>
              <label>Age<input id="fo-trade-target-age" type="number" min="18" max="45" step="1" placeholder="Age"></label>
              <label>Development<select id="fo-trade-target-trait"><option value="NORMAL">Normal</option><option value="HIDDEN">Hidden</option><option value="STAR">Star</option><option value="SUPERSTAR">Superstar</option><option value="XFACTOR">X-Factor</option></select></label>
              <label>2026 cap hit<input id="fo-trade-target-cap" type="number" min="0" step="0.1" placeholder="Millions"></label>
              <label>Contract years<input id="fo-trade-target-years" type="number" min="0" max="8" step="1" placeholder="Years"></label>
              <label>Target tier<select id="fo-trade-target-tier"><option value="DEPTH">Depth</option><option value="ROTATION">Rotation</option><option value="STARTER" selected>Starter</option><option value="PREMIUM">Premium</option></select></label>
              <label>Evidence<select id="fo-trade-target-evidence"><option value="MANUAL">Manual idea</option><option value="PUBLIC_REPORT">Public report</option><option value="STAFF_SCOUTED">Staff scouted</option><option value="TEAM_CONTACT">Team contact</option><option value="VERIFIED">Verified market entry</option></select></label>
              <label class="fo-trade-wide">Asking-price or availability note<textarea id="fo-trade-target-ask" rows="3" placeholder="What would make the other team listen?"></textarea></label>
            </div>
          </section>
        </div>
        <section class="fo-trade-subpanel fo-trade-assets-panel">
          <div class="fo-trade-subhead"><span>3</span><div><h3>Archers Outgoing Package</h3><p>Select only assets returned by the current console-visible ledgers.</p></div></div>
          <div class="fo-trade-assets-grid">
            <div>
              <div class="fo-trade-asset-head"><div><h4>Players</h4><span id="fo-trade-player-summary">Loading verified profiles…</span></div><input id="fo-trade-player-search" type="search" placeholder="Search players"></div>
              <div id="fo-trade-player-assets" class="fo-trade-asset-list"><div class="empty">Loading roster assets…</div></div>
            </div>
            <div>
              <div class="fo-trade-asset-head"><div><h4>Draft Assets</h4><span id="fo-trade-pick-summary">Loading live picks…</span></div></div>
              <div id="fo-trade-pick-assets" class="fo-trade-asset-list"><div class="empty">Loading draft capital…</div></div>
            </div>
          </div>
        </section>
        <section class="fo-trade-subpanel">
          <div class="fo-trade-subhead"><span>4</span><div><h3>Package Evaluation</h3><p>Transparent heuristic, not a prediction of acceptance.</p></div></div>
          <div id="fo-trade-evaluation"><div class="empty">Add a target and outgoing assets to evaluate the package.</div></div>
          <div class="fo-trade-actions">
            <button id="fo-trade-save" type="button">Save for Comparison</button>
            <button id="fo-trade-copy" class="primary" type="button">Copy Staff Review Prompt</button>
            <button id="fo-trade-clear" type="button">Clear Workbench</button>
          </div>
          <p id="fo-trade-message" class="fo-trade-message">No franchise data has been changed.</p>
        </section>
        <section class="fo-trade-subpanel">
          <div class="fo-trade-subhead"><span>5</span><div><h3>Scenario Comparison</h3><p>Stored only in this browser. Maximum three.</p></div></div>
          <div id="fo-trade-scenarios" class="fo-trade-scenarios"><div class="empty">Save up to three packages to compare them side by side.</div></div>
        </section>
      </div>`;

    if (transactionSection) transactionSection.parentNode.insertBefore(section, transactionSection);
    else if (draftSection?.nextSibling) draftSection.parentNode.insertBefore(section, draftSection.nextSibling);
    else if (draftSection) draftSection.parentNode.append(section);
    else frontOffice.insertBefore(section, layout ?? null);

    bindFormEvents();
    renderScenarios();
    renderEvaluation();
    return true;
  }

  function normalizePick(raw, year, index) {
    const roundValue = numberOrNull(raw?.round ?? raw?.draft_round ?? raw?.pick_round ?? raw?.round_number);
    if (roundValue === null) return null;
    const pickYear = numberOrNull(raw?.year ?? raw?.draft_year ?? raw?.pick_year ?? year);
    if (pickYear === null) return null;
    const origin = raw?.original_team ?? raw?.origin_team ?? raw?.from_team ?? raw?.source_team ?? raw?.team ?? null;
    const status = normalizeKey(raw?.status ?? raw?.asset_status ?? raw?.pick_status ?? "CONFIRMED");
    const identity = String(raw?.pick_id ?? raw?.asset_id ?? raw?.selection_id ?? raw?.id ?? `${pickYear}-${roundValue}-${origin ?? "unknown"}-${index}`);
    return {
      identity,
      year: pickYear,
      round: roundValue,
      original_team: origin,
      status,
      asset_type: normalizeKey(raw?.asset_type ?? raw?.pick_type ?? (raw?.native ? "NATIVE" : "ACQUIRED")),
      upgrade_round: numberOrNull(raw?.upgrade_round ?? raw?.upgrade_to_round),
      note: raw?.note ?? raw?.summary ?? "",
      condition: raw?.condition ?? raw?.condition_text ?? ""
    };
  }

  function extractPicks(data) {
    const years = Array.isArray(data?.years) ? data.years : Array.isArray(data?.draft_years) ? data.draft_years : [];
    if (years.length) {
      return years.flatMap((entry) => (Array.isArray(entry?.picks) ? entry.picks : [])
        .map((pick, index) => normalizePick(pick, entry?.year, index))
        .filter(Boolean));
    }

    const picks = [];
    const visited = new Set();
    function walk(node, path = "root", depth = 0) {
      if (depth > 8 || node == null || typeof node !== "object" || visited.has(node)) return;
      visited.add(node);
      if (Array.isArray(node)) {
        const yearMatch = path.match(/20\d{2}/);
        node.forEach((item, index) => {
          const normalized = normalizePick(item, yearMatch ? Number(yearMatch[0]) : data?.current_draft_year, index);
          if (normalized) picks.push(normalized);
          walk(item, `${path}[${index}]`, depth + 1);
        });
        return;
      }
      Object.entries(node).forEach(([key, value]) => walk(value, `${path}.${key}`, depth + 1));
    }
    walk(data);
    const unique = new Map();
    picks.forEach((pick) => unique.set(pick.identity, pick));
    return [...unique.values()];
  }

  async function loadData() {
    ensureMarkup();
    const [franchiseResult, playersResult, draftResult] = await Promise.all([
      tradeClient.from("archers_franchise_state").select("version, state, updated_at").eq("id", FRANCHISE_ID).single(),
      tradeClient.from("archers_resources").select("resource_id, version, data, updated_at").eq("franchise_id", FRANCHISE_ID).eq("resource_type", "player").eq("status", "ACTIVE").eq("visibility", "CONSOLE").order("resource_id"),
      tradeClient.from("archers_resources").select("resource_id, version, data, updated_at").eq("franchise_id", FRANCHISE_ID).eq("resource_type", DRAFT_RESOURCE_TYPE).eq("resource_id", DRAFT_RESOURCE_ID).eq("status", "ACTIVE").eq("visibility", "CONSOLE").maybeSingle()
    ]);

    if (franchiseResult.error) throw franchiseResult.error;
    if (playersResult.error) throw playersResult.error;
    if (draftResult.error) throw draftResult.error;

    state.franchise = franchiseResult.data;
    state.players = playersResult.data ?? [];
    state.currentDraftYear = numberOrNull(draftResult.data?.data?.current_draft_year);
    state.picks = extractPicks(draftResult.data?.data ?? {})
      .sort((a, b) => a.year - b.year || a.round - b.round || String(a.original_team ?? "").localeCompare(String(b.original_team ?? "")));

    renderPlayers();
    renderPicks();
    renderEvaluation();
    const status = document.getElementById("fo-trade-source");
    if (status) status.title = `State v${franchiseResult.data.version} • ${state.players.length} players • ${state.picks.length} draft assets`;
  }

  function showError(error) {
    ensureMarkup();
    const source = document.getElementById("fo-trade-source");
    const evaluation = document.getElementById("fo-trade-evaluation");
    if (source) {
      source.className = "pill bad";
      source.textContent = "Trade assets unavailable";
    }
    if (evaluation) evaluation.innerHTML = `<div class="empty">The Trade Center could not load authoritative Archers assets: ${escapeHtml(error?.message ?? error)}</div>`;
  }

  window.addEventListener("DOMContentLoaded", () => {
    ensureMarkup();
    loadData().catch(showError);

    tradeClient.channel("archers-trade-center-v1")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "archers_franchise_state", filter: `id=eq.${FRANCHISE_ID}` }, () => loadData().catch(showError))
      .on("postgres_changes", { event: "*", schema: "public", table: "archers_resources", filter: `franchise_id=eq.${FRANCHISE_ID}` }, () => loadData().catch(showError))
      .subscribe();
  });
})();
