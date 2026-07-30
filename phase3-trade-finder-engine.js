(() => {
  "use strict";

  const PICK_VALUES = Object.freeze({ 1: 45, 2: 28, 3: 18, 4: 11, 5: 7, 6: 4, 7: 2 });
  const TRAIT_BONUS = Object.freeze({ XFACTOR: 20, SUPERSTAR: 14, STAR: 8, HIDDEN: 6, NORMAL: 0 });
  const ROLE_RANK = Object.freeze({ DEPTH: 1, ROTATION: 2, STARTER: 3, PREMIUM: 4 });
  const AVAILABILITY_MULTIPLIER = Object.freeze({
    ACTIVELY_SHOPPED: 0.90,
    AVAILABLE: 0.98,
    LISTENING: 1.08,
    UNLIKELY: 1.24,
    UNAVAILABLE: Infinity,
    FRANCHISE_CORNERSTONE: Infinity
  });
  const EVIDENCE_SCORE = Object.freeze({
    MODEL_INFERENCE: 25,
    PUBLIC_REPORT: 45,
    STAFF_SCOUTED: 60,
    TEAM_CONTACT: 80,
    VERIFIED: 95
  });
  const TEAM_POSTURES = new Set(["BUYER", "SELLER", "HOLD", "HYBRID", "REBUILDER", "CONTENDER"]);
  const ACTIVE_MARKET_STATUSES = new Set(["ACTIVELY_SHOPPED", "AVAILABLE", "LISTENING", "UNLIKELY"]);

  const asArray = (value) => Array.isArray(value) ? value : value == null ? [] : [value];

  function numberOrNull(value) {
    if (value === "" || value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizeKey(value) {
    return String(value ?? "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function clamp(value, minimum = 0, maximum = 100) {
    return Math.max(minimum, Math.min(maximum, value));
  }

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

  function normalizeTrait(value) {
    const key = normalizeKey(value).replaceAll("_", "");
    if (key === "XFACTOR") return "XFACTOR";
    if (key === "SUPERSTAR") return "SUPERSTAR";
    if (key === "STAR") return "STAR";
    if (key === "HIDDEN") return "HIDDEN";
    return "NORMAL";
  }

  function normalizeRole(value, overall = null) {
    const key = normalizeKey(value);
    if (ROLE_RANK[key]) return key;
    const rating = numberOrNull(overall);
    if (rating === null) return "DEPTH";
    if (rating >= 88) return "PREMIUM";
    if (rating >= 78) return "STARTER";
    if (rating >= 69) return "ROTATION";
    return "DEPTH";
  }

  function roleMeets(candidateRole, requestedRole) {
    return (ROLE_RANK[normalizeRole(candidateRole)] ?? 0) >= (ROLE_RANK[normalizeRole(requestedRole)] ?? 0);
  }

  function playerTradeValue(player) {
    const overall = numberOrNull(player?.overall_rating ?? player?.overall) ?? 60;
    const age = numberOrNull(player?.age);
    const cap = numberOrNull(player?.cap_hit_2026_millions ?? player?.cap_hit ?? player?.cap) ?? 0;
    const years = numberOrNull(player?.contract_years_remaining ?? player?.years_remaining) ?? 1;
    const trait = TRAIT_BONUS[normalizeTrait(player?.development_trait)] ?? 0;
    const ageBonus = age === null ? 0 : age <= 23 ? 12 : age <= 26 ? 8 : age <= 29 ? 3 : age <= 31 ? -3 : -9;
    const rosterMultiplier = normalizeKey(player?.roster_status) === "PRACTICE_SQUAD" ? 0.38 : 1;
    return Math.max(1, ((overall - 55) * 1.45 + trait + ageBonus + Math.min(years, 5) * 1.4 - cap * 0.42) * rosterMultiplier);
  }

  function pickTradeValue(pick, currentDraftYear) {
    const round = numberOrNull(pick?.round);
    const base = PICK_VALUES[round] ?? 0;
    const year = numberOrNull(pick?.year) ?? currentDraftYear;
    const yearsOut = Math.max(0, year - currentDraftYear);
    const yearDiscount = Math.pow(0.86, yearsOut);
    const status = normalizeKey(pick?.status);
    const statusMultiplier = status === "CONFIRMED"
      ? 1
      : status === "SECURED"
        ? 0.9
        : status === "CONDITIONAL"
          ? 0.75
          : status === "PROVISIONAL"
            ? 0.62
            : 0.7;
    return Math.max(0.5, base * yearDiscount * statusMultiplier);
  }

  function normalizeTeamMarket(raw, fallbackId = "") {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const teamId = String(raw.team_id ?? raw.id ?? fallbackId).trim();
    if (!teamId) return null;
    const posture = normalizeKey(raw.posture ?? raw.market_posture ?? "HOLD");
    return {
      team_id: teamId,
      team_name: raw.team_name ?? raw.name ?? null,
      posture: TEAM_POSTURES.has(posture) ? posture : "HOLD",
      confidence: normalizeKey(raw.confidence ?? raw.evidence ?? "MODEL_INFERENCE"),
      buying_positions: asArray(raw.buying_positions ?? raw.needs ?? raw.position_needs).map(positionGroup).filter(Boolean),
      selling_positions: asArray(raw.selling_positions ?? raw.surpluses ?? raw.position_surpluses).map(positionGroup).filter(Boolean),
      preferred_assets: asArray(raw.preferred_assets ?? raw.asset_preferences).map(normalizeKey).filter(Boolean),
      avoided_assets: asArray(raw.avoided_assets ?? raw.asset_avoidance).map(normalizeKey).filter(Boolean),
      cap_pressure: normalizeKey(raw.cap_pressure ?? "NORMAL"),
      competitive_window: normalizeKey(raw.competitive_window ?? raw.window ?? ""),
      summary: String(raw.summary ?? raw.note ?? ""),
      as_of_week: numberOrNull(raw.as_of_week ?? raw.week),
      review_after_week: numberOrNull(raw.review_after_week ?? raw.expires_after_week),
      source: raw.source ?? null
    };
  }

  function normalizeTeamMarketCollection(data) {
    const result = [];
    const source = data?.teams ?? data?.entries ?? data?.market ?? data;
    if (Array.isArray(source)) {
      source.forEach((item) => {
        const normalized = normalizeTeamMarket(item);
        if (normalized) result.push(normalized);
      });
    } else if (source && typeof source === "object") {
      Object.entries(source).forEach(([teamId, item]) => {
        const normalized = normalizeTeamMarket(item, teamId);
        if (normalized) result.push(normalized);
      });
    }
    return result;
  }

  function normalizeLeaguePlayer(raw, fallbackId = "") {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const playerId = String(raw.player_id ?? raw.resource_id ?? raw.id ?? fallbackId).trim();
    const teamId = String(raw.team_id ?? raw.current_team_id ?? raw.team ?? "").trim();
    const name = String(raw.player_name ?? raw.name ?? "").trim();
    if (!playerId || !teamId || !name) return null;
    const overall = numberOrNull(raw.overall_rating ?? raw.overall);
    const position = positionGroup(raw.position_code ?? raw.position);
    return {
      player_id: playerId,
      team_id: teamId,
      team_name: raw.team_name ?? null,
      player_name: name,
      position,
      position_code: raw.position_code ?? raw.position ?? position,
      overall_rating: overall,
      age: numberOrNull(raw.age),
      development_trait: normalizeTrait(raw.development_trait),
      role: normalizeRole(raw.role, overall),
      cap_hit_2026_millions: numberOrNull(raw.cap_hit_2026_millions ?? raw.cap_hit ?? raw.cap),
      contract_years_remaining: numberOrNull(raw.contract_years_remaining ?? raw.years_remaining),
      roster_status: normalizeKey(raw.roster_status ?? "ACTIVE_ROSTER"),
      contract_summary: raw.contract_summary ?? null,
      football_notes: raw.football_notes ?? raw.summary ?? null,
      updated_week: numberOrNull(raw.updated_week ?? raw.as_of_week)
    };
  }

  function normalizeLeaguePlayerCollection(data) {
    const result = [];
    const source = data?.players ?? data?.entries ?? data?.index ?? data;
    if (Array.isArray(source)) {
      source.forEach((item) => {
        const normalized = normalizeLeaguePlayer(item);
        if (normalized) result.push(normalized);
      });
    } else if (source && typeof source === "object") {
      Object.entries(source).forEach(([playerId, item]) => {
        const normalized = normalizeLeaguePlayer(item, playerId);
        if (normalized) result.push(normalized);
      });
    }
    return result;
  }

  function normalizeTradeMarketEntry(raw, playerIndex = new Map(), fallbackId = "") {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const marketId = String(raw.market_id ?? raw.entry_id ?? raw.id ?? fallbackId).trim();
    const playerId = String(raw.player_id ?? raw.player?.player_id ?? raw.player?.id ?? "").trim();
    const indexed = playerId ? playerIndex.get(playerId) : null;
    const embedded = normalizeLeaguePlayer(raw.player ?? raw.player_snapshot ?? raw, playerId || fallbackId);
    const player = indexed ? { ...indexed, ...(embedded ?? {}) } : embedded;
    if (!marketId || !player) return null;

    const availability = normalizeKey(raw.availability ?? raw.market_status ?? raw.status ?? "LISTENING");
    return {
      market_id: marketId,
      player_id: player.player_id,
      team_id: String(raw.team_id ?? player.team_id).trim(),
      player: { ...player, team_id: String(raw.team_id ?? player.team_id).trim() },
      availability,
      evidence: normalizeKey(raw.evidence ?? raw.confidence ?? "MODEL_INFERENCE"),
      asking_multiplier: numberOrNull(raw.asking_multiplier),
      asking_price: String(raw.asking_price ?? raw.asking_price_note ?? raw.note ?? ""),
      movable_reason: String(raw.movable_reason ?? raw.why_available ?? ""),
      constraints: asArray(raw.constraints).map(String),
      desired_assets: asArray(raw.desired_assets ?? raw.preferred_assets).map(normalizeKey).filter(Boolean),
      rejected_assets: asArray(raw.rejected_assets ?? raw.avoided_assets).map(normalizeKey).filter(Boolean),
      as_of_week: numberOrNull(raw.as_of_week ?? raw.week),
      review_after_week: numberOrNull(raw.review_after_week ?? raw.expires_after_week),
      source: raw.source ?? null
    };
  }

  function normalizeTradeMarketCollection(data, leaguePlayers = []) {
    const index = new Map(leaguePlayers.map((player) => [player.player_id, player]));
    const result = [];
    const source = data?.entries ?? data?.players ?? data?.market ?? data;
    if (Array.isArray(source)) {
      source.forEach((item) => {
        const normalized = normalizeTradeMarketEntry(item, index);
        if (normalized) result.push(normalized);
      });
    } else if (source && typeof source === "object") {
      Object.entries(source).forEach(([entryId, item]) => {
        const normalized = normalizeTradeMarketEntry(item, index, entryId);
        if (normalized) result.push(normalized);
      });
    }
    return result;
  }

  function isStale(record, currentWeek) {
    const reviewWeek = numberOrNull(record?.review_after_week);
    return reviewWeek !== null && currentWeek !== null && currentWeek > reviewWeek;
  }

  function marketEligibility(entry, teamState, objective, currentWeek) {
    const availability = normalizeKey(entry?.availability);
    if (!ACTIVE_MARKET_STATUSES.has(availability)) {
      return { eligible: false, tier: "NO_MARKET", reason: "Player is not on the current active trade market." };
    }
    if (isStale(entry, currentWeek) || isStale(teamState, currentWeek)) {
      return { eligible: false, tier: "STALE", reason: "Market evidence is past its review window." };
    }

    const playerPosition = positionGroup(entry.player?.position);
    const requestedPosition = positionGroup(objective?.position);
    if (requestedPosition && playerPosition !== requestedPosition) {
      return { eligible: false, tier: "POSITION", reason: "Position does not match the search." };
    }
    if (!roleMeets(entry.player?.role, objective?.role)) {
      return { eligible: false, tier: "ROLE", reason: "Player does not meet the requested role." };
    }
    if (objective?.team_id && objective.team_id !== "ALL" && entry.team_id !== objective.team_id) {
      return { eligible: false, tier: "TEAM", reason: "Team filter excluded the player." };
    }

    const posture = normalizeKey(teamState?.posture ?? "HOLD");
    const buying = new Set(asArray(teamState?.buying_positions).map(positionGroup));
    const selling = new Set(asArray(teamState?.selling_positions).map(positionGroup));
    const explicitlyMovable = ["ACTIVELY_SHOPPED", "AVAILABLE"].includes(availability);
    const listening = availability === "LISTENING";
    const unlikely = availability === "UNLIKELY";

    if ((posture === "BUYER" || posture === "CONTENDER") && buying.has(playerPosition) && !explicitlyMovable) {
      return {
        eligible: false,
        tier: "NO_MARKET",
        reason: "The team is buying at this position and has not made the player explicitly available."
      };
    }

    if (listening && !explicitlyMovable) {
      const teamCanListen = ["SELLER", "REBUILDER", "HYBRID"].includes(posture) || selling.has(playerPosition);
      if (!teamCanListen) {
        return {
          eligible: false,
          tier: "NO_MARKET",
          reason: "The club has no current market reason to move this player."
        };
      }
    }

    if (unlikely) {
      return {
        eligible: true,
        tier: "EXPENSIVE",
        reason: entry.movable_reason || "The team is not shopping the player but may listen to a substantial offer."
      };
    }

    return {
      eligible: true,
      tier: explicitlyMovable ? "CREDIBLE" : "POSSIBLE",
      reason: entry.movable_reason || "The player has a current market entry supported by the team posture."
    };
  }

  function assetKind(asset) {
    return asset?.kind === "PICK" ? "PICK" : "PLAYER";
  }

  function assetPreferenceTokens(asset) {
    if (assetKind(asset) === "PICK") {
      const tokens = ["PICKS", "DRAFT_CAPITAL", `ROUND_${asset.round}`];
      if (["PROVISIONAL", "CONDITIONAL"].includes(normalizeKey(asset.status))) tokens.push("CONDITIONAL_ASSETS");
      return tokens;
    }

    const tokens = ["PLAYERS"];
    const age = numberOrNull(asset.age);
    const role = normalizeRole(asset.role, asset.overall_rating);
    if (age !== null && age <= 25) tokens.push("YOUNG_PLAYERS");
    if (["STARTER", "PREMIUM"].includes(role)) tokens.push("IMMEDIATE_STARTERS");
    if ((numberOrNull(asset.cap_hit_2026_millions) ?? 99) <= 2.5) tokens.push("LOW_COST_PLAYERS");
    tokens.push(`POSITION_${positionGroup(asset.position)}`);
    return tokens;
  }

  function utilityForTeam(asset, teamState, marketEntry) {
    const preferred = new Set([
      ...asArray(teamState?.preferred_assets).map(normalizeKey),
      ...asArray(marketEntry?.desired_assets).map(normalizeKey)
    ]);
    const avoided = new Set([
      ...asArray(teamState?.avoided_assets).map(normalizeKey),
      ...asArray(marketEntry?.rejected_assets).map(normalizeKey)
    ]);
    const needs = new Set(asArray(teamState?.buying_positions).map(positionGroup));
    const posture = normalizeKey(teamState?.posture ?? "HOLD");

    let multiplier = 1;
    const tokens = assetPreferenceTokens(asset);
    if (tokens.some((token) => preferred.has(token))) multiplier += 0.18;
    if (tokens.some((token) => avoided.has(token))) multiplier -= 0.28;

    if (assetKind(asset) === "PICK") {
      if (["SELLER", "REBUILDER"].includes(posture)) multiplier += 0.14;
      if (["BUYER", "CONTENDER"].includes(posture)) multiplier -= 0.08;
    } else {
      const position = positionGroup(asset.position);
      if (needs.has(position)) multiplier += 0.22;
      if (["BUYER", "CONTENDER"].includes(posture) && ["STARTER", "PREMIUM"].includes(normalizeRole(asset.role, asset.overall_rating))) {
        multiplier += 0.12;
      }
      if (normalizeKey(teamState?.cap_pressure) === "HIGH") {
        const cap = numberOrNull(asset.cap_hit_2026_millions);
        if (cap !== null && cap <= 2.5) multiplier += 0.10;
        if (cap !== null && cap >= 8) multiplier -= 0.18;
      }
    }

    return Math.max(0.35, multiplier);
  }

  function normalizeArchersAsset(raw, currentDraftYear) {
    const kind = raw?.kind === "PICK" ? "PICK" : "PLAYER";
    const policy = normalizeKey(raw?.policy ?? "CONSIDER");
    if (kind === "PICK") {
      const round = numberOrNull(raw.round);
      const year = numberOrNull(raw.year) ?? currentDraftYear;
      return {
        ...raw,
        kind,
        identity: String(raw.identity ?? raw.asset_id ?? `${year}-${round}-${raw.original_team ?? "unknown"}`),
        year,
        round,
        status: normalizeKey(raw.status ?? "CONFIRMED"),
        policy: ["AVAILABLE", "CONSIDER", "UNTOUCHABLE"].includes(policy) ? policy : "CONSIDER",
        base_value: pickTradeValue(raw, currentDraftYear)
      };
    }

    const player = raw?.data && typeof raw.data === "object" ? raw.data : raw;
    return {
      ...player,
      kind,
      identity: String(raw.identity ?? raw.resource_id ?? player.resource_id ?? player.player_id ?? player.player_name),
      resource_id: raw.resource_id ?? player.resource_id ?? null,
      player_name: player.player_name ?? player.name ?? raw.resource_id ?? "Player",
      position: positionGroup(player.position_code ?? player.position),
      position_code: player.position_code ?? player.position ?? null,
      overall_rating: numberOrNull(player.overall_rating),
      age: numberOrNull(player.age),
      development_trait: normalizeTrait(player.development_trait),
      role: normalizeRole(player.role, player.overall_rating),
      cap_hit_2026_millions: numberOrNull(player.cap_hit_2026_millions),
      roster_status: normalizeKey(player.roster_status ?? "ACTIVE_ROSTER"),
      policy: ["AVAILABLE", "CONSIDER", "UNTOUCHABLE"].includes(policy) ? policy : "CONSIDER",
      base_value: playerTradeValue(player)
    };
  }

  function buildAssetPool(rawAssets, currentDraftYear, teamState, marketEntry, options = {}) {
    const protectFirsts = options.protect_first_rounders === true;
    const preference = normalizeKey(options.package_preference ?? "BALANCED");
    const pool = rawAssets
      .map((asset) => normalizeArchersAsset(asset, currentDraftYear))
      .filter((asset) => asset.policy !== "UNTOUCHABLE")
      .filter((asset) => !(protectFirsts && asset.kind === "PICK" && asset.round === 1))
      .map((asset) => {
        const teamUtility = utilityForTeam(asset, teamState, marketEntry);
        let preferenceMultiplier = 1;
        if (preference === "PICKS_FIRST") preferenceMultiplier = asset.kind === "PICK" ? 1.12 : 0.92;
        if (preference === "PLAYERS_FIRST") preferenceMultiplier = asset.kind === "PLAYER" ? 1.12 : 0.92;
        const policyMultiplier = asset.policy === "AVAILABLE" ? 1.05 : 0.94;
        const utility = asset.base_value * teamUtility * preferenceMultiplier * policyMultiplier;
        const archersCost = asset.base_value * (asset.policy === "AVAILABLE" ? 0.96 : 1.12);
        return { ...asset, utility, archers_cost: archersCost };
      })
      .sort((a, b) => (b.utility / b.archers_cost) - (a.utility / a.archers_cost));

    const players = pool.filter((asset) => asset.kind === "PLAYER").slice(0, 10);
    const picks = pool.filter((asset) => asset.kind === "PICK").slice(0, 10);
    return [...players, ...picks]
      .sort((a, b) => (b.utility / b.archers_cost) - (a.utility / a.archers_cost))
      .slice(0, 18);
  }

  function targetMarketValue(entry, teamState) {
    const base = playerTradeValue(entry.player);
    const availability = normalizeKey(entry.availability);
    const marketMultiplier = numberOrNull(entry.asking_multiplier) ?? AVAILABILITY_MULTIPLIER[availability] ?? 1.08;
    const posture = normalizeKey(teamState?.posture ?? "HOLD");
    const sellingPositions = new Set(asArray(teamState?.selling_positions).map(positionGroup));
    let postureMultiplier = 1;
    if (["SELLER", "REBUILDER"].includes(posture)) postureMultiplier -= 0.04;
    if (["BUYER", "CONTENDER"].includes(posture)) postureMultiplier += 0.08;
    if (sellingPositions.has(positionGroup(entry.player?.position))) postureMultiplier -= 0.04;
    return Math.max(1, base * marketMultiplier * postureMultiplier);
  }

  function enumerateSubsets(pool, maxAssets) {
    const subsets = [];
    const walk = (start, chosen) => {
      if (chosen.length > 0) subsets.push([...chosen]);
      if (chosen.length >= maxAssets) return;
      for (let index = start; index < pool.length; index += 1) {
        chosen.push(pool[index]);
        walk(index + 1, chosen);
        chosen.pop();
      }
    };
    walk(0, []);
    return subsets;
  }

  function packageSummary(subset, targetValue) {
    const utility = subset.reduce((sum, asset) => sum + asset.utility, 0);
    const archersCost = subset.reduce((sum, asset) => sum + asset.archers_cost, 0);
    const outgoingCap = subset
      .filter((asset) => asset.kind === "PLAYER")
      .reduce((sum, asset) => sum + (numberOrNull(asset.cap_hit_2026_millions) ?? 0), 0);
    return {
      assets: subset,
      utility,
      archers_cost: archersCost,
      ratio: targetValue > 0 ? utility / targetValue : 0,
      outgoing_cap: outgoingCap,
      asset_count: subset.length
    };
  }

  function choosePackage(subsets, targetValue, strategy, eligibilityTier) {
    const targets = {
      VALUE: { preferred: 0.92, minimum: 0.82, maximum: 1.08 },
      BALANCED: { preferred: 1.02, minimum: 0.90, maximum: 1.18 },
      STRONG: { preferred: 1.14, minimum: 1.02, maximum: 1.34 }
    };
    const rule = targets[strategy] ?? targets.BALANCED;
    const requiredMinimum = eligibilityTier === "EXPENSIVE" ? Math.max(rule.minimum, 1.12) : rule.minimum;
    const candidates = subsets
      .map((subset) => packageSummary(subset, targetValue))
      .filter((summary) => summary.ratio >= requiredMinimum)
      .map((summary) => {
        const rangePenalty = summary.ratio > rule.maximum ? (summary.ratio - rule.maximum) * 120 : 0;
        const closenessPenalty = Math.abs(summary.ratio - rule.preferred) * 100;
        const complexityPenalty = Math.max(0, summary.asset_count - 2) * 7;
        const considerPenalty = summary.assets.filter((asset) => asset.policy === "CONSIDER").length * 3;
        const premiumPenalty = summary.archers_cost * 0.06;
        return {
          ...summary,
          score: 100 - closenessPenalty - rangePenalty - complexityPenalty - considerPenalty - premiumPenalty,
          strategy
        };
      })
      .sort((a, b) => b.score - a.score || a.archers_cost - b.archers_cost || a.asset_count - b.asset_count);
    return candidates[0] ?? null;
  }

  function confidenceScore(entry, teamState) {
    const entryScore = EVIDENCE_SCORE[normalizeKey(entry?.evidence)] ?? 25;
    const teamScore = EVIDENCE_SCORE[normalizeKey(teamState?.confidence)] ?? 25;
    return Math.round(entryScore * 0.7 + teamScore * 0.3);
  }

  function fitScore(player, archersPlayers) {
    const position = positionGroup(player?.position);
    const peers = archersPlayers.filter((asset) =>
      normalizeKey(asset?.roster_status ?? asset?.data?.roster_status) === "ACTIVE_ROSTER"
      && positionGroup(asset?.position ?? asset?.position_code ?? asset?.data?.position_code ?? asset?.data?.position) === position
    );
    const ratings = peers
      .map((asset) => numberOrNull(asset?.overall_rating ?? asset?.data?.overall_rating))
      .filter((value) => value !== null);
    const average = ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : 60;
    const best = ratings.length ? Math.max(...ratings) : 60;
    const target = numberOrNull(player?.overall_rating) ?? 60;
    const depthNeed = Math.max(0, 4 - peers.length);
    return Math.round(clamp(48 + (target - average) * 2.6 + depthNeed * 6 + (target > best ? 8 : 0)));
  }

  function capResult(entry, packageData, practicalFlexibility) {
    const incoming = numberOrNull(entry?.player?.cap_hit_2026_millions);
    if (incoming === null) return { label: "Unknown", kind: "warn", net_cap: null };
    const net = incoming - packageData.outgoing_cap;
    const flexibility = numberOrNull(practicalFlexibility);
    if (net <= 0) return { label: "Works", kind: "good", net_cap: net };
    if (flexibility === null) return { label: "Unknown", kind: "warn", net_cap: net };
    if (net <= flexibility * 0.75) return { label: "Works", kind: "good", net_cap: net };
    if (net <= flexibility) return { label: "Tight", kind: "warn", net_cap: net };
    return { label: "Does not work", kind: "bad", net_cap: net };
  }

  function costLabel(packageData) {
    if (packageData.archers_cost < 24) return "Low";
    if (packageData.archers_cost < 48) return "Moderate";
    if (packageData.archers_cost < 78) return "High";
    return "Premium";
  }

  function packageReason(packageData, teamState) {
    const hasPicks = packageData.assets.some((asset) => asset.kind === "PICK");
    const hasPlayers = packageData.assets.some((asset) => asset.kind === "PLAYER");
    const posture = normalizeKey(teamState?.posture ?? "HOLD");
    if (hasPicks && ["SELLER", "REBUILDER"].includes(posture)) return "The package supplies future draft value to a selling club.";
    if (hasPlayers && ["BUYER", "CONTENDER"].includes(posture)) return "The package supplies immediate roster help to a buying club.";
    if (hasPicks && hasPlayers) return "The package blends immediate help with future value.";
    if (hasPicks) return "The package is built around draft capital.";
    return "The package is built around current players who match the other team’s priorities.";
  }

  function findOffers({
    objective,
    teams = [],
    teamMarkets = [],
    tradeMarket = [],
    leaguePlayers = [],
    archersAssets = [],
    archersPlayers = [],
    currentDraftYear,
    currentWeek = null,
    practicalFlexibility = null,
    options = {}
  }) {
    const teamById = new Map(teams.map((team) => [String(team.team_id), team]));
    const marketByTeam = new Map(teamMarkets.map((team) => [String(team.team_id), team]));
    const maxAssets = Math.max(1, Math.min(4, numberOrNull(options.max_assets) ?? 3));
    const results = [];
    const rejected = [];

    for (const entry of tradeMarket) {
      const teamState = marketByTeam.get(entry.team_id) ?? normalizeTeamMarket({ team_id: entry.team_id, posture: "HOLD" });
      const eligibility = marketEligibility(entry, teamState, objective, currentWeek);
      if (!eligibility.eligible) {
        rejected.push({ entry, eligibility });
        continue;
      }

      const pool = buildAssetPool(archersAssets, currentDraftYear, teamState, entry, options);
      if (!pool.length) {
        rejected.push({ entry, eligibility: { eligible: false, tier: "NO_PACKAGE", reason: "No tradeable Archers assets remain under the current asset policy." } });
        continue;
      }

      const targetValue = targetMarketValue(entry, teamState);
      const subsets = enumerateSubsets(pool, maxAssets);
      const packages = {
        VALUE: choosePackage(subsets, targetValue, "VALUE", eligibility.tier),
        BALANCED: choosePackage(subsets, targetValue, "BALANCED", eligibility.tier),
        STRONG: choosePackage(subsets, targetValue, "STRONG", eligibility.tier)
      };
      const primary = packages.BALANCED ?? packages.STRONG ?? packages.VALUE;
      if (!primary) {
        rejected.push({ entry, eligibility: { eligible: false, tier: "NO_PACKAGE", reason: "No credible package fits the current Archers asset policy." } });
        continue;
      }

      const team = teamById.get(entry.team_id) ?? {};
      const confidence = confidenceScore(entry, teamState);
      const fit = fitScore(entry.player, archersPlayers);
      const cap = capResult(entry, primary, practicalFlexibility);
      const tier = eligibility.tier === "EXPENSIVE" ? "EXPENSIVE" : confidence >= 60 ? "CREDIBLE" : "POSSIBLE";

      results.push({
        offer_id: `${entry.market_id}:${primary.strategy}`,
        market_id: entry.market_id,
        team_id: entry.team_id,
        team_name: team.team_name ?? team.name ?? entry.player.team_name ?? entry.team_id,
        team_posture: teamState.posture,
        team_market: teamState,
        entry,
        player: entry.player,
        eligibility,
        tier,
        packages,
        primary,
        fit_score: fit,
        cost_label: costLabel(primary),
        cap,
        confidence_score: confidence,
        confidence_label: confidence >= 80 ? "Verified" : confidence >= 60 ? "Strong" : confidence >= 40 ? "Possible" : "Speculative",
        why_movable: eligibility.reason,
        why_team_listens: packageReason(primary, teamState)
      });
    }

    results.sort((a, b) => {
      const tierRank = { CREDIBLE: 0, POSSIBLE: 1, EXPENSIVE: 2 };
      return (tierRank[a.tier] ?? 9) - (tierRank[b.tier] ?? 9)
        || b.fit_score - a.fit_score
        || b.confidence_score - a.confidence_score
        || a.primary.archers_cost - b.primary.archers_cost;
    });

    const matchingPlayers = leaguePlayers.filter((player) =>
      player.team_id !== "stl-2026"
      && (!objective.position || positionGroup(player.position) === positionGroup(objective.position))
      && roleMeets(player.role, objective.role)
      && (!objective.team_id || objective.team_id === "ALL" || player.team_id === objective.team_id)
    );
    const activePlayerIds = new Set(tradeMarket.filter((entry) => ACTIVE_MARKET_STATUSES.has(normalizeKey(entry.availability))).map((entry) => entry.player_id));
    const noMarketCount = matchingPlayers.filter((player) => !activePlayerIds.has(player.player_id)).length;

    return {
      offers: results,
      rejected,
      no_market_count: noMarketCount,
      matching_player_count: matchingPlayers.length,
      active_market_count: tradeMarket.length
    };
  }

  const api = {
    PICK_VALUES,
    TRAIT_BONUS,
    ROLE_RANK,
    EVIDENCE_SCORE,
    numberOrNull,
    normalizeKey,
    positionGroup,
    normalizeTrait,
    normalizeRole,
    roleMeets,
    playerTradeValue,
    pickTradeValue,
    normalizeTeamMarket,
    normalizeTeamMarketCollection,
    normalizeLeaguePlayer,
    normalizeLeaguePlayerCollection,
    normalizeTradeMarketEntry,
    normalizeTradeMarketCollection,
    isStale,
    marketEligibility,
    normalizeArchersAsset,
    buildAssetPool,
    targetMarketValue,
    enumerateSubsets,
    choosePackage,
    confidenceScore,
    fitScore,
    capResult,
    findOffers
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalThis.ArchersTradeFinderEngine = api;
})();