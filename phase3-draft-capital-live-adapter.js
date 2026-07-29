(() => {
  const SUPABASE_URL = "https://oqbylwlkrabxvpdhugrf.supabase.co";
  const SUPABASE_KEY = "sb_publishable_z-EjW-S0x7GZH2VREEaXAw_NOOrbH-m";
  const FRANCHISE_ID = "stl-2026";

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const keyText = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const first = (object, keys) => keys.map((key) => object?.[key]).find((value) => value !== undefined && value !== null && value !== "");
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
  const status = (value) => String(value ?? "CONFIRMED").trim().toUpperCase().replaceAll(" ", "_");

  function yearFromPath(path) {
    const match = String(path).match(/(?:^|[^0-9])(20\d{2})(?:[^0-9]|$)/);
    return match ? Number(match[1]) : null;
  }

  function pathStatus(path) {
    const text = keyText(path);
    if (text.includes("provisional")) return "PROVISIONAL";
    if (text.includes("secured")) return "SECURED";
    if (text.includes("confirmed") || text.includes("full_board")) return "CONFIRMED";
    if (text.includes("conditional")) return "CONDITIONAL";
    return null;
  }

  function normalize(rawValue, context) {
    if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) return null;
    const nested = [rawValue.pick, rawValue.selection, rawValue.asset, rawValue.draft_pick]
      .find((value) => value && typeof value === "object" && !Array.isArray(value));
    const raw = nested ? { ...nested, ...rawValue } : rawValue;
    const round = number(first(raw, ["round", "base_round", "secured_round", "provisional_round", "current_round", "draft_round", "pick_round", "round_number"]));
    const upgradeRound = number(first(raw, ["upgrade_round", "upgrade_to_round", "upgraded_round", "potential_round", "ceiling_round", "best_round", "converts_to_round"]));
    const originalTeam = first(raw, ["original_team", "origin_team", "originating_team", "original_club", "originating_club", "from_team", "from_franchise", "source_team", "source_franchise", "original_team_name", "origin", "team", "club"]);
    const id = first(raw, ["pick_id", "asset_id", "selection_id", "draft_asset_id", "id"]);
    if (round === null && upgradeRound === null && !originalTeam && !id) return null;

    return {
      id: id ? String(id) : null,
      relatedId: String(first(raw, ["related_pick_id", "related_asset_id", "base_pick_id", "applies_to_asset_id", "pick_id", "asset_id"]) ?? "") || null,
      year: number(first(raw, ["year", "draft_year", "pick_year", "season"])) ?? context.year,
      round,
      upgrade_round: upgradeRound,
      original_team: originalTeam ? String(originalTeam) : null,
      status: status(first(raw, ["status", "asset_status", "pick_status", "selection_status", "conveyance_status"]) ?? context.status ?? "CONFIRMED"),
      asset_type: String(first(raw, ["asset_type", "pick_type", "selection_type", "acquisition_type", "asset_class"]) ?? (raw.native === true || raw.is_native === true ? "NATIVE" : "ACQUIRED")).toUpperCase(),
      note: String(first(raw, ["note", "summary", "description", "detail", "asset_note"]) ?? ""),
      progress: String(first(raw, ["progress", "progress_note", "current_progress", "condition_progress", "tracking", "tracking_note"]) ?? ""),
      condition: String(first(raw, ["condition", "condition_text", "upgrade_condition", "upgrade_trigger", "trigger", "conveyance_condition", "security_condition", "terms"]) ?? ""),
      upgradeOnly: keyText(context.path).includes("upgrade") && round === null && upgradeRound !== null
    };
  }

  function collect(data, currentYear) {
    const entries = [];
    const visited = new Set();
    function walk(node, path = "root", depth = 0) {
      if (depth > 8 || node == null || typeof node !== "object" || visited.has(node)) return;
      visited.add(node);
      if (Array.isArray(node)) {
        const text = keyText(path);
        const later = text.includes("later") || text.includes("secured") || text.includes("provisional") || text.includes("upgrade");
        const year = yearFromPath(path) ?? (later ? currentYear + 1 : currentYear);
        const defaultStatus = pathStatus(path);
        node.forEach((item, index) => {
          const normalized = normalize(item, { year, status: defaultStatus, path: `${path}[${index}]` });
          if (normalized) entries.push(normalized);
          walk(item, `${path}[${index}]`, depth + 1);
        });
        return;
      }
      Object.entries(node).forEach(([key, value]) => walk(value, `${path}.${key}`, depth + 1));
    }
    walk(data);
    return entries;
  }

  function legacyBoard(data) {
    const source = Array.isArray(data?.years) ? data.years : Array.isArray(data?.draft_years) ? data.draft_years : [];
    if (!source.length) return null;
    const years = source.map((entry) => ({
      year: number(entry?.year),
      picks: (Array.isArray(entry?.picks) ? entry.picks : []).map((pick) => normalize(pick, { year: number(entry?.year), path: "legacy" })).filter(Boolean)
    })).filter((entry) => entry.year !== null);
    return { currentYear: number(data?.current_draft_year) ?? years[0]?.year, years };
  }

  function mergeBoard(data) {
    const legacy = legacyBoard(data);
    if (legacy) return legacy;
    const currentYear = number(first(data, ["current_draft_year", "next_full_draft_year", "next_draft_year", "full_board_year"])) ?? 2027;
    const entries = collect(data, currentYear);
    const upgrades = entries.filter((entry) => entry.upgradeOnly);
    const picks = entries.filter((entry) => !entry.upgradeOnly && entry.round !== null);
    const map = new Map();

    picks.forEach((pick) => {
      const identity = pick.id ? `id:${pick.id}` : `${pick.year}:${pick.round}:${keyText(pick.original_team)}:${pick.status}`;
      const old = map.get(identity);
      map.set(identity, old ? {
        ...old,
        ...pick,
        note: pick.note || old.note,
        progress: pick.progress || old.progress,
        condition: pick.condition || old.condition,
        upgrade_round: pick.upgrade_round ?? old.upgrade_round
      } : { ...pick });
    });

    const unique = [...map.values()];
    upgrades.forEach((upgrade) => {
      const match = unique.find((pick) => upgrade.relatedId && [pick.id, pick.relatedId].filter(Boolean).includes(upgrade.relatedId))
        ?? unique.find((pick) => pick.year === upgrade.year && keyText(pick.original_team) && keyText(pick.original_team) === keyText(upgrade.original_team));
      if (!match) return;
      match.upgrade_round = upgrade.upgrade_round ?? match.upgrade_round;
      match.condition ||= upgrade.condition;
      match.progress ||= upgrade.progress;
      match.note ||= upgrade.note;
    });

    const groups = new Map();
    unique.forEach((pick) => {
      const year = pick.year ?? currentYear;
      if (!groups.has(year)) groups.set(year, []);
      groups.get(year).push(pick);
    });
    return {
      currentYear,
      years: [...groups.entries()].map(([year, yearPicks]) => ({ year: Number(year), picks: yearPicks })).sort((a, b) => a.year - b.year)
    };
  }

  function numericSummary(data, test) {
    let answer = null;
    const visited = new Set();
    function walk(node, path = "root", depth = 0) {
      if (answer !== null || depth > 8 || node == null) return;
      if (typeof node === "number" && Number.isFinite(node) && test(keyText(path))) {
        answer = node;
        return;
      }
      if (typeof node !== "object" || visited.has(node)) return;
      visited.add(node);
      if (Array.isArray(node)) node.forEach((value, index) => walk(value, `${path}[${index}]`, depth + 1));
      else Object.entries(node).forEach(([key, value]) => walk(value, `${path}.${key}`, depth + 1));
    }
    walk(data);
    return answer;
  }

  function counts(data, board) {
    const year = board.currentYear;
    const secured = numericSummary(data, (path) => path.includes(String(year + 1)) && path.includes("secured") && (path.includes("asset") || path.includes("pick")));
    const provisional = numericSummary(data, (path) => path.includes(String(year + 1)) && path.includes("provisional") && path.includes("pick"));
    return {
      current: numericSummary(data, (path) => path.includes(String(year)) && path.includes("confirmed") && path.includes("pick")),
      later: secured !== null && provisional !== null ? secured + provisional : null,
      provisional,
      upgrades: numericSummary(data, (path) => path.includes("upgrade") && (path.includes("path") || path.includes("active") || path.includes("unevaluable") || path.includes("count")))
    };
  }

  function statusClass(value) {
    const text = status(value);
    return ["PROVISIONAL", "CONDITIONAL", "PENDING", "UNEVALUABLE"].some((token) => text.includes(token)) ? "warn" : "good";
  }

  function statusLabel(value) {
    const text = status(value);
    return ({ CONFIRMED: "Confirmed", SECURED: "Secured", PROVISIONAL: "Provisional", CONDITIONAL: "Conditional" })[text] ?? text.replaceAll("_", " ");
  }

  function pickHtml(pick) {
    const upgrade = number(pick.upgrade_round);
    return `<article class="fo-draft-pick ${statusClass(pick.status)}">
      <div class="fo-draft-pick-top">
        <div class="fo-draft-round"><span>Round</span><strong>${pick.round ?? "—"}</strong></div>
        <div class="fo-draft-origin"><strong>${escapeHtml(pick.original_team ?? "Origin unavailable")}</strong><span>${pick.asset_type === "NATIVE" ? "Native" : "From"}${upgrade !== null ? ` • can become Round ${upgrade}` : ""}</span></div>
        <span class="pill ${statusClass(pick.status)}">${escapeHtml(statusLabel(pick.status))}</span>
      </div>
      ${pick.progress ? `<p class="fo-draft-progress"><strong>Progress:</strong> ${escapeHtml(pick.progress)}</p>` : ""}
      ${pick.condition ? `<p class="fo-draft-condition">${escapeHtml(pick.condition)}</p>` : ""}
      ${pick.note ? `<p class="fo-draft-condition">${escapeHtml(pick.note)}</p>` : ""}
    </article>`;
  }

  function yearHtml(entry, currentYear) {
    const current = entry.year === currentYear;
    const picks = [...entry.picks].sort((a, b) => (number(a.round) ?? 99) - (number(b.round) ?? 99) || String(a.original_team ?? "").localeCompare(String(b.original_team ?? "")));
    return `<section class="fo-draft-year">
      <div class="fo-draft-year-head"><div><h3>${entry.year} ${current ? "Draft Board" : "Transaction Assets"}</h3><p>${current ? "Complete owned-pick inventory" : "Only acquired, conditional, secured or provisional selections"}</p></div><strong>${picks.length} ${picks.length === 1 ? "pick" : "picks"}</strong></div>
      <div class="fo-draft-pick-grid">${picks.map(pickHtml).join("") || '<div class="empty">No displayed selections.</div>'}</div>
    </section>`;
  }

  function ruleText(value) {
    if (typeof value === "string") return value;
    const values = [];
    const walk = (node) => {
      if (typeof node === "string" && node.trim()) values.push(node.trim());
      else if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === "object") Object.values(node).forEach(walk);
    };
    walk(value);
    return values.join(" • ") || "Full next draft; later years show transaction-created assets only";
  }

  function render(data, version, updatedAt) {
    const board = mergeBoard(data);
    const source = document.getElementById("fo-draft-source");
    const metrics = document.getElementById("fo-draft-metrics");
    const years = document.getElementById("fo-draft-years");
    const rule = document.getElementById("fo-draft-rule");
    if (!source || !metrics || !years || !rule) return false;

    if (!board.years.length) {
      source.className = "pill bad";
      source.textContent = `Live resource v${version} • schema unsupported`;
      years.innerHTML = '<div class="empty">The live resource was found, but no displayable pick arrays were recognized.</div>';
      return true;
    }

    const summary = counts(data, board);
    const currentPicks = board.years.find((entry) => entry.year === board.currentYear)?.picks ?? [];
    const laterPicks = board.years.filter((entry) => entry.year > board.currentYear).flatMap((entry) => entry.picks);
    const all = board.years.flatMap((entry) => entry.picks);
    const provisional = all.filter((pick) => status(pick.status) === "PROVISIONAL").length;
    const upgrades = all.filter((pick) => number(pick.upgrade_round) !== null).length;

    metrics.innerHTML = `
      <div class="fo-draft-metric"><span>${board.currentYear} Picks</span><strong>${summary.current ?? currentPicks.length}</strong><small>Complete next-draft inventory</small></div>
      <div class="fo-draft-metric"><span>Later Trade Assets</span><strong>${summary.later ?? laterPicks.length}</strong><small>Native later-year picks hidden</small></div>
      <div class="fo-draft-metric"><span>Provisional</span><strong>${summary.provisional ?? provisional}</strong><small>Not yet fully secured</small></div>
      <div class="fo-draft-metric"><span>Upgrade Paths</span><strong>${summary.upgrades ?? upgrades}</strong><small>Selections that can improve</small></div>`;
    years.innerHTML = board.years.map((entry) => yearHtml(entry, board.currentYear)).join("");
    source.className = "pill good";
    source.textContent = `Live resource v${version}`;
    rule.textContent = `${ruleText(data.display_rule)} • ${data.source_note ?? (updatedAt ? `Updated ${new Date(updatedAt).toLocaleString()}` : "live resource")}`;
    return true;
  }

  async function load(attempt = 0) {
    const target = document.getElementById("fo-draft-capital");
    if (!target) {
      if (attempt < 80) setTimeout(() => load(attempt + 1).catch(showError), 50);
      return;
    }
    const { data, error } = await client.from("archers_resources")
      .select("version, data, updated_at")
      .eq("franchise_id", FRANCHISE_ID)
      .eq("resource_type", "draft_capital")
      .eq("resource_id", "draft-capital")
      .eq("status", "ACTIVE")
      .eq("visibility", "CONSOLE")
      .maybeSingle();
    if (error) throw error;
    if (data?.data) render(data.data, data.version, data.updated_at);
  }

  function showError(error) {
    const source = document.getElementById("fo-draft-source");
    const years = document.getElementById("fo-draft-years");
    if (source) { source.className = "pill bad"; source.textContent = "Live adapter unavailable"; }
    if (years) years.innerHTML = `<div class="empty">Draft Capital live adapter failed: ${escapeHtml(error?.message ?? error)}</div>`;
  }

  window.addEventListener("DOMContentLoaded", () => {
    load().catch(showError);
    client.channel("archers-draft-capital-live-adapter")
      .on("postgres_changes", { event: "*", schema: "public", table: "archers_resources", filter: `franchise_id=eq.${FRANCHISE_ID}` }, () => load().catch(showError))
      .subscribe();
  });
})();