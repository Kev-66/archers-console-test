import { createClient } from "npm:@supabase/supabase-js@2";

const FRANCHISE_ID = "stl-2026";
const DEFAULT_SEASON = 2026;
const BACKEND_VERSION = "3.2.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-archers-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const WRITE_OPERATIONS = new Set([
  "patch_franchise_state",
  "update_decision",
  "upsert_resource",
  "bulk_upsert_resources",
  "archive_resource",
  "upsert_team",
  "upsert_game",
  "bulk_upsert_games",
  "upsert_schedule",
  "start_game",
  "update_live_game",
  "record_drive",
  "record_game_event",
  "upsert_team_stats",
  "upsert_player_stats",
  "finalize_game",
  "create_snapshot",
]);

const SOURCE_LABELS = new Set([
  "USER_EXPLICIT",
  "LIVE_SESSION_LOG",
  "CHECKPOINT",
  "CORRECTION",
  "SYSTEM",
]);

type SupabaseClient = ReturnType<typeof createClient>;
type JsonObject = Record<string, unknown>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(error: unknown, fallback: string, status = 500): Response {
  if (error && typeof error === "object") {
    const details = error as Record<string, unknown>;
    return jsonResponse(
      {
        error: details.message ?? fallback,
        code: details.code ?? null,
        details: details.details ?? null,
        hint: details.hint ?? null,
      },
      status,
    );
  }

  return jsonResponse(
    { error: error instanceof Error ? error.message : fallback },
    status,
  );
}

function getAdminKey(): string | undefined {
  const currentKeys = Deno.env.get("SUPABASE_SECRET_KEYS");

  if (currentKeys) {
    try {
      const parsed = JSON.parse(currentKeys) as Record<string, string>;
      const firstKey = Object.values(parsed)[0];

      if (parsed.default || firstKey) {
        return parsed.default ?? firstKey;
      }
    } catch {
      // Fall through to the legacy service-role key.
    }
  }

  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
}

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(
  value: unknown,
  fieldName: string,
): { value?: JsonObject; error?: Response } {
  if (isPlainObject(value)) {
    return { value };
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return {
      error: jsonResponse(
        { error: `${fieldName} must be a JSON object` },
        400,
      ),
    };
  }

  try {
    const decoded = JSON.parse(value);

    if (!isPlainObject(decoded)) {
      return {
        error: jsonResponse(
          { error: `${fieldName} must decode to one JSON object` },
          400,
        ),
      };
    }

    return { value: decoded };
  } catch (error) {
    return {
      error: jsonResponse(
        {
          error: `${fieldName} is not valid JSON`,
          details: error instanceof Error ? error.message : null,
        },
        400,
      ),
    };
  }
}

function nonNegativeIntegerOrNull(
  value: unknown,
  fieldName: string,
): number | null | Response {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    return jsonResponse(
      { error: `${fieldName} must be a non-negative integer or null` },
      400,
    );
  }

  return parsed;
}

function boundedInteger(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, minimum), maximum);
}

function csvValues(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function safeStatePaths(value: string | null): string[] | Response {
  const paths = csvValues(value);
  const selected = paths.length
    ? paths
    : [
      "timeline",
      "open_decisions",
      "opponent",
      "medical",
      "roster.week_three_protections_status",
      "roster.protections",
      "roster.elevations",
      "canon.evidence_boundaries",
    ];

  if (selected.length > 20) {
    return jsonResponse(
      { error: "fields may contain at most 20 state paths" },
      400,
    );
  }

  for (const path of selected) {
    const valid = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){0,7}$/.test(path);

    if (path.length > 160 || !valid) {
      return jsonResponse(
        { error: `Unsupported state path: ${path}` },
        400,
      );
    }
  }

  return selected;
}

function getPath(root: unknown, path: string): unknown {
  let current = root;

  for (const segment of path.split(".")) {
    if (!isPlainObject(current) || !(segment in current)) {
      return null;
    }

    current = current[segment];
  }

  return current;
}

function compactRoster(state: JsonObject): JsonObject {
  const roster = isPlainObject(state.roster) ? state.roster : {};
  const keys = [
    "active_count",
    "active_roster_count",
    "practice_squad_count",
    "organizational_player_count",
    "week_three_protections_status",
    "protections",
    "elevations",
    "elevation_status",
  ];

  const result: JsonObject = {};

  for (const key of keys) {
    if (roster[key] !== undefined) {
      result[key] = roster[key];
    }
  }

  return result;
}

async function readFranchiseState(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("archers_franchise_state")
    .select("id, version, state, source_checkpoint_id, seal_status, updated_at")
    .eq("id", FRANCHISE_ID)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/*
 * Compact by default.
 * Full canon-event payloads and exact Kevin text are deliberately excluded
 * so routine reads do not overflow the Custom GPT Action response limit.
 */
async function readRecentEvents(
  supabase: SupabaseClient,
  limit = 20,
  eventType: string | null = null,
  afterEventId: number | null = null,
) {
  let query = supabase
    .from("archers_canon_events")
    .select(
      "event_id, state_version, event_type, summary, source_label, created_at",
    )
    .eq("franchise_id", FRANCHISE_ID)
    .order("event_id", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));

  if (eventType) {
    query = query.eq("event_type", eventType);
  }

  if (afterEventId !== null) {
    query = query.gt("event_id", afterEventId);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data ?? [];
}

/*
 * Legacy full snapshot.
 * Retained for backward compatibility, but compact scopes should be preferred.
 */
async function readSnapshot(supabase: SupabaseClient) {
  const [
    state,
    events,
    teamsResult,
    standingsResult,
    metadataResult,
    scheduleResult,
    liveResult,
  ] = await Promise.all([
    readFranchiseState(supabase),
    readRecentEvents(supabase, 20),
    supabase
      .from("cff_teams")
      .select(
        "team_id, team_name, city, nickname, conference, division, alignment_status, is_archers, active, version, updated_at",
      )
      .eq("active", true)
      .order("team_name"),
    supabase
      .from("cff_standings")
      .select("*")
      .eq("season", DEFAULT_SEASON),
    supabase
      .from("cff_league_metadata")
      .select("*")
      .eq("season", DEFAULT_SEASON)
      .maybeSingle(),
    supabase
      .from("archers_schedule")
      .select("*")
      .eq("season", DEFAULT_SEASON)
      .order("week"),
    supabase
      .from("cff_live_games")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  for (
    const result of [
      teamsResult,
      standingsResult,
      metadataResult,
      scheduleResult,
      liveResult,
    ]
  ) {
    if (result.error) {
      throw result.error;
    }
  }

  return {
    ...state,
    recent_events: events,
    teams: teamsResult.data ?? [],
    standings: standingsResult.data ?? [],
    league_metadata: metadataResult.data ?? null,
    schedule: scheduleResult.data ?? [],
    current_live_game: liveResult.data ?? null,
  };
}

async function readCoreState(supabase: SupabaseClient) {
  const row = await readFranchiseState(supabase);
  const state = isPlainObject(row.state) ? row.state : {};
  const timeline = isPlainObject(state.timeline)
    ? state.timeline
    : state.timeline ?? null;
  const canon = isPlainObject(state.canon) ? state.canon : {};
  const resources = isPlainObject(state.resources) ? state.resources : {};

  return {
    id: row.id,
    version: row.version,
    source_checkpoint_id: row.source_checkpoint_id,
    seal_status: row.seal_status,
    updated_at: row.updated_at,
    timeline,
    continuation: {
      exact_continuation_point:
        getPath(state, "timeline.exact_continuation_point") ??
          state.exact_continuation_point ??
          null,
      current_position:
        getPath(state, "timeline.current_position") ??
          state.current_position ??
          null,
      week: getPath(state, "timeline.week") ?? state.week ?? null,
      day: getPath(state, "timeline.day") ?? state.day ?? null,
    },
    open_decisions: Array.isArray(state.open_decisions)
      ? state.open_decisions
      : [],
    opponent: state.opponent ?? null,
    medical: Array.isArray(state.medical) ? state.medical : [],
    roster: compactRoster(state),
    cap: isPlainObject(resources.cap)
      ? resources.cap
      : resources.cap ?? null,
    evidence_boundaries: Array.isArray(canon.evidence_boundaries)
      ? canon.evidence_boundaries
      : [],
    available_state_sections: Object.keys(state).sort(),
  };
}

async function readStateFields(
  supabase: SupabaseClient,
  paths: string[],
) {
  const row = await readFranchiseState(supabase);
  const state = isPlainObject(row.state) ? row.state : {};
  const fields: JsonObject = {};

  for (const path of paths) {
    fields[path] = getPath(state, path);
  }

  return {
    id: row.id,
    version: row.version,
    source_checkpoint_id: row.source_checkpoint_id,
    seal_status: row.seal_status,
    updated_at: row.updated_at,
    requested_fields: paths,
    fields,
  };
}

async function readLeague(
  supabase: SupabaseClient,
  season: number,
  week: number | null,
) {
  let gamesQuery = supabase
    .from("cff_games")
    .select("*")
    .eq("season", season)
    .order("week")
    .order("game_id");

  if (week !== null) {
    gamesQuery = gamesQuery.eq("week", week);
  }

  const [teams, games, standings, metadata, schedule] = await Promise.all([
    supabase
      .from("cff_teams")
      .select("*")
      .eq("active", true)
      .order("team_name"),
    gamesQuery,
    supabase
      .from("cff_standings")
      .select("*")
      .eq("season", season),
    supabase
      .from("cff_league_metadata")
      .select("*")
      .eq("season", season)
      .maybeSingle(),
    supabase
      .from("archers_schedule")
      .select("*")
      .eq("season", season)
      .order("week"),
  ]);

  for (const result of [teams, games, standings, metadata, schedule]) {
    if (result.error) {
      throw result.error;
    }
  }

  return {
    season,
    week,
    teams: teams.data ?? [],
    games: games.data ?? [],
    standings: standings.data ?? [],
    league_metadata: metadata.data ?? null,
    archers_schedule: schedule.data ?? [],
  };
}

async function readGame(
  supabase: SupabaseClient,
  gameId: string,
) {
  const [
    official,
    live,
    drives,
    events,
    teamStats,
    playerStats,
  ] = await Promise.all([
    supabase
      .from("cff_games")
      .select("*")
      .eq("game_id", gameId)
      .maybeSingle(),
    supabase
      .from("cff_live_games")
      .select("*")
      .eq("game_id", gameId)
      .maybeSingle(),
    supabase
      .from("cff_game_drives")
      .select("*")
      .eq("game_id", gameId)
      .order("drive_number"),
    supabase
      .from("cff_game_events")
      .select("*")
      .eq("game_id", gameId)
      .order("event_id"),
    supabase
      .from("cff_game_team_stats")
      .select("*")
      .eq("game_id", gameId),
    supabase
      .from("cff_game_player_stats")
      .select("*")
      .eq("game_id", gameId)
      .order("team_id")
      .order("player_name"),
  ]);

  for (
    const result of [
      official,
      live,
      drives,
      events,
      teamStats,
      playerStats,
    ]
  ) {
    if (result.error) {
      throw result.error;
    }
  }

  return {
    game_id: gameId,
    official_game: official.data ?? null,
    live_game: live.data ?? null,
    drives: drives.data ?? [],
    events: events.data ?? [],
    team_stats: teamStats.data ?? [],
    player_stats: playerStats.data ?? [],
  };
}

interface ResourceReadOptions {
  resourceType: string | null;
  resourceId: string | null;
  includeArchived: boolean;
  status: string | null;
  visibility: string | null;
  season: number | null;
  includeData: boolean;
  limit: number;
  offset: number;
}

async function readResources(
  supabase: SupabaseClient,
  options: ResourceReadOptions,
) {
  /*
   * source_label is intentionally absent.
   * The live archers_resources table does not contain that column.
   */
  const selectFields = options.includeData
    ? "franchise_id, resource_type, resource_id, season, status, visibility, version, data, created_at, updated_at"
    : "franchise_id, resource_type, resource_id, season, status, visibility, version, created_at, updated_at";

  let query = supabase
    .from("archers_resources")
    .select(selectFields, { count: "exact" })
    .eq("franchise_id", FRANCHISE_ID)
    .order("resource_type")
    .order("resource_id")
    .range(options.offset, options.offset + options.limit - 1);

  if (options.resourceType) {
    query = query.eq("resource_type", options.resourceType);
  }

  if (options.resourceId) {
    query = query.eq("resource_id", options.resourceId);
  }

  if (options.status) {
    query = query.eq("status", options.status);
  } else if (!options.includeArchived) {
    query = query.eq("status", "ACTIVE");
  }

  if (options.visibility) {
    query = query.eq("visibility", options.visibility);
  }

  if (options.season !== null) {
    query = query.eq("season", options.season);
  }

  const { data, error, count } = await query;

  if (error) {
    throw error;
  }

  const resources = data ?? [];
  const total = count ?? resources.length;
  const nextOffset = options.offset + resources.length;

  return {
    resources,
    pagination: {
      limit: options.limit,
      offset: options.offset,
      returned: resources.length,
      total,
      has_more: nextOffset < total,
      next_offset: nextOffset < total ? nextOffset : null,
    },
    data_included: options.includeData,
    filters: {
      resource_type: options.resourceType,
      resource_id: options.resourceId,
      include_archived: options.includeArchived,
      status: options.status,
      visibility: options.visibility,
      season: options.season,
    },
  };
}

async function readResourceIndex(
  supabase: SupabaseClient,
  includeArchived: boolean,
  visibility: string | null,
  includeItems: boolean,
) {
  /*
   * Metadata-only index. No resource data and no nonexistent source_label.
   */
  let query = supabase
    .from("archers_resources")
    .select(
      "resource_type, resource_id, season, status, visibility, version, updated_at",
    )
    .eq("franchise_id", FRANCHISE_ID)
    .order("resource_type")
    .order("resource_id");

  if (!includeArchived) {
    query = query.eq("status", "ACTIVE");
  }

  if (visibility) {
    query = query.eq("visibility", visibility);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const items = data ?? [];
  const grouped = new Map<
    string,
    {
      count: number;
      max_version: number;
      active: number;
      archived: number;
    }
  >();

  for (const item of items) {
    const type = String(item.resource_type ?? "unknown");
    const current = grouped.get(type) ?? {
      count: 0,
      max_version: 0,
      active: 0,
      archived: 0,
    };

    current.count += 1;
    current.max_version = Math.max(
      current.max_version,
      Number(item.version) || 0,
    );

    if (item.status === "ACTIVE") {
      current.active += 1;
    } else {
      current.archived += 1;
    }

    grouped.set(type, current);
  }

  return {
    total_resources: items.length,
    by_resource_type: Object.fromEntries(
      [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)),
    ),
    items: includeItems ? items : undefined,
    include_archived: includeArchived,
    visibility,
  };
}

async function readAudit(
  supabase: SupabaseClient,
  limit: number,
  resourceType: string | null,
  resourceId: string | null,
  operation: string | null,
  afterOperationId: number | null,
) {
  let query = supabase
    .from("archers_operation_log")
    .select(
      "operation_id, idempotency_key, operation, resource_type, resource_id, expected_version, summary, source_label, state_version, status, created_at",
    )
    .order("operation_id", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));

  if (resourceType) {
    query = query.eq("resource_type", resourceType);
  }

  if (resourceId) {
    query = query.eq("resource_id", resourceId);
  }

  if (operation) {
    query = query.eq("operation", operation);
  }

  if (afterOperationId !== null) {
    query = query.gt("operation_id", afterOperationId);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return { operations: data ?? [] };
}


const ACTIONABLE_DECISION_STATUSES = new Set([
  "OPEN",
  "READY_FOR_REVIEW",
  "AWAITING_KEVIN",
  "BLOCKED",
]);

const DECISION_PRIORITY_RANK: Record<string, number> = {
  URGENT: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};

interface ContextResourceRef {
  resource_type: string;
  resource_id: string;
}

function arrayValue(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function normalizedUpper(value: unknown, fallback = ""): string {
  return String(value ?? fallback).trim().toUpperCase().replaceAll(" ", "_");
}

function decisionEntries(data: unknown): JsonObject[] {
  if (!isPlainObject(data)) return [];
  const candidates = [data.decisions, data.items, data.queue];
  const entries = candidates.find(Array.isArray);
  return Array.isArray(entries) ? entries.filter(isPlainObject) : [];
}

function decisionIdentifier(decision: JsonObject, index = 0): string {
  return String(decision.decision_id ?? decision.id ?? `decision-${index + 1}`);
}

function decisionStatus(decision: JsonObject): string {
  return normalizedUpper(decision.status, "OPEN");
}

function decisionPriority(decision: JsonObject): string {
  return normalizedUpper(decision.priority, "NORMAL");
}

function decisionTitle(decision: JsonObject): string {
  return String(
    decision.title ??
      decision.decision ??
      decision.name ??
      decisionIdentifier(decision),
  );
}

function decisionSummary(decision: JsonObject): string {
  return String(
    decision.summary ??
      decision.note ??
      decision.description ??
      decision.decision_question ??
      decision.question ??
      "",
  );
}

function decisionSort(a: JsonObject, b: JsonObject): number {
  const priority = (DECISION_PRIORITY_RANK[decisionPriority(a)] ?? 9) -
    (DECISION_PRIORITY_RANK[decisionPriority(b)] ?? 9);
  if (priority !== 0) return priority;

  const aWeek = Number(a.due_week);
  const bWeek = Number(b.due_week);
  const safeAWeek = Number.isFinite(aWeek) ? aWeek : 999;
  const safeBWeek = Number.isFinite(bWeek) ? bWeek : 999;
  if (safeAWeek !== safeBWeek) return safeAWeek - safeBWeek;

  return decisionTitle(a).localeCompare(decisionTitle(b));
}

function isActionableDecision(decision: JsonObject): boolean {
  return ACTIONABLE_DECISION_STATUSES.has(decisionStatus(decision));
}

function normalizeContextResourceRef(value: unknown): ContextResourceRef | null {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || text.toLowerCase().startsWith("state:")) return null;
    const slash = text.indexOf("/");
    if (slash <= 0 || slash >= text.length - 1) return null;
    return {
      resource_type: text.slice(0, slash).trim(),
      resource_id: text.slice(slash + 1).trim(),
    };
  }

  if (!isPlainObject(value)) return null;
  const resourceType = value.resource_type ?? value.type;
  const resourceId = value.resource_id ?? value.id;
  if (typeof resourceType !== "string" || typeof resourceId !== "string") {
    return null;
  }
  if (!resourceType.trim() || !resourceId.trim()) return null;
  return {
    resource_type: resourceType.trim(),
    resource_id: resourceId.trim(),
  };
}

function decisionResourceRefs(decision: JsonObject): ContextResourceRef[] {
  const refs: ContextResourceRef[] = [];

  for (
    const playerId of arrayValue(
      decision.related_player_resource_ids ?? decision.player_resource_ids,
    )
  ) {
    if (typeof playerId === "string" && playerId.trim()) {
      refs.push({ resource_type: "player", resource_id: playerId.trim() });
    }
  }

  for (
    const value of arrayValue(
      decision.related_resource_refs ?? decision.resources,
    )
  ) {
    const ref = normalizeContextResourceRef(value);
    if (ref) refs.push(ref);
  }

  const unique = new Map<string, ContextResourceRef>();
  for (const ref of refs) {
    if (ref.resource_type === "decision_queue" && ref.resource_id === "decision-queue") {
      continue;
    }
    unique.set(`${ref.resource_type}/${ref.resource_id}`, ref);
  }
  return [...unique.values()].slice(0, 20);
}

function decisionStateRefs(decision: JsonObject): string[] {
  const result: string[] = [];
  for (
    const value of arrayValue(
      decision.related_resource_refs ?? decision.resources,
    )
  ) {
    if (typeof value === "string" && value.trim().toLowerCase().startsWith("state:")) {
      result.push(value.trim().slice(6));
    }
  }
  return [...new Set(result)].slice(0, 20);
}

function stateReferenceValue(state: JsonObject, reference: string): unknown {
  const [path, selector] = reference.split("/", 2);
  const value = getPath(state, path.replaceAll("/", "."));
  if (!selector) return value;

  if (Array.isArray(value)) {
    return value.find((item) => {
      if (!isPlainObject(item)) return false;
      return String(
        item.decision_id ?? item.id ?? item.key ?? item.resource_id ?? "",
      ) === selector;
    }) ?? null;
  }

  if (isPlainObject(value)) {
    return value[selector] ?? null;
  }

  return null;
}

async function readExactResource(
  supabase: SupabaseClient,
  ref: ContextResourceRef,
  includeArchived = false,
) {
  let query = supabase
    .from("archers_resources")
    .select(
      "franchise_id, resource_type, resource_id, season, status, visibility, version, data, created_at, updated_at",
    )
    .eq("franchise_id", FRANCHISE_ID)
    .eq("resource_type", ref.resource_type)
    .eq("resource_id", ref.resource_id);

  if (!includeArchived) {
    query = query.eq("status", "ACTIVE");
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ?? null;
}

function ledgerEntries(data: JsonObject): unknown[] {
  for (const key of ["transactions", "entries", "items", "ledger"]) {
    if (Array.isArray(data[key])) return data[key] as unknown[];
  }
  return [];
}

function relevanceText(value: unknown): string {
  try {
    return JSON.stringify(value).toLowerCase();
  } catch {
    return String(value ?? "").toLowerCase();
  }
}

function normalizedRelevanceTokens(values: unknown[]): string[] {
  const tokens = new Set<string>();
  for (const value of values) {
    const text = String(value ?? "").trim().toLowerCase();
    if (text.length < 3) continue;
    tokens.add(text);
    tokens.add(text.replaceAll("-", " "));
  }
  return [...tokens].filter((token) => token.length >= 3);
}

function matchesRelevance(value: unknown, tokens: string[]): boolean {
  if (!tokens.length) return false;
  const text = relevanceText(value);
  return tokens.some((token) => text.includes(token));
}

function compactTransactionLedger(
  data: JsonObject,
  tokens: string[],
  transactionLimit: number,
): JsonObject {
  const entries = ledgerEntries(data);
  const matching = entries.filter((entry) => matchesRelevance(entry, tokens));
  const metadata: JsonObject = {};

  for (
    const key of [
      "profile_schema_version",
      "ledger_id",
      "season",
      "status",
      "summary",
      "unresolved_items",
    ]
  ) {
    if (data[key] !== undefined) metadata[key] = data[key];
  }

  return {
    ...metadata,
    transaction_count_total: entries.length,
    transaction_count_matching: matching.length,
    transactions: matching.slice(0, transactionLimit),
    omitted_unrelated_transactions: Math.max(entries.length - matching.length, 0),
    filter_mode: "RELATED_DECISION_REFERENCES",
    filter_terms: tokens.slice(0, 30),
  };
}

function compactContextResource(
  row: Record<string, unknown>,
  tokens: string[],
  transactionLimit: number,
): JsonObject {
  const data = isPlainObject(row.data) ? row.data : {};
  const resourceType = String(row.resource_type ?? "");
  let compactData: unknown = data;
  let dataCompacted = false;

  if (resourceType === "transaction_ledger") {
    compactData = compactTransactionLedger(data, tokens, transactionLimit);
    dataCompacted = true;
  } else if (resourceType === "decision_queue") {
    compactData = null;
    dataCompacted = true;
  } else {
    const size = JSON.stringify(data).length;
    if (size > 16000) {
      const summary: JsonObject = {};
      for (
        const key of [
          "profile_schema_version",
          "summary",
          "status",
          "season",
          "unresolved_items",
        ]
      ) {
        if (data[key] !== undefined) summary[key] = data[key];
      }
      compactData = {
        ...summary,
        data_omitted_for_compactness: true,
        available_data_keys: Object.keys(data).sort(),
        original_json_bytes: size,
      };
      dataCompacted = true;
    }
  }

  return {
    resource_type: row.resource_type ?? null,
    resource_id: row.resource_id ?? null,
    season: row.season ?? null,
    status: row.status ?? null,
    visibility: row.visibility ?? null,
    version: row.version ?? null,
    updated_at: row.updated_at ?? null,
    data: compactData,
    data_compacted: dataCompacted,
  };
}

function historyTokens(
  decision: JsonObject,
  refs: ContextResourceRef[],
  resourceRows: Array<Record<string, unknown> | null>,
): string[] {
  const values: unknown[] = [
    decisionIdentifier(decision),
    decisionTitle(decision),
    ...refs.flatMap((ref) => [ref.resource_id, `${ref.resource_type}/${ref.resource_id}`]),
  ];

  for (const row of resourceRows) {
    if (!row || row.resource_type !== "player" || !isPlainObject(row.data)) continue;
    values.push(row.data.player_name, row.data.name);
  }

  return normalizedRelevanceTokens(values);
}

function relevantAuditRows(
  operations: unknown[],
  refs: ContextResourceRef[],
  tokens: string[],
  limit: number,
): unknown[] {
  const exactRefs = new Set(
    refs.map((ref) => `${ref.resource_type}/${ref.resource_id}`),
  );

  return operations.filter((item) => {
    if (!isPlainObject(item)) return false;
    const exact = `${String(item.resource_type ?? "")}/${String(item.resource_id ?? "")}`;
    return exactRefs.has(exact) || matchesRelevance(item.summary, tokens);
  }).slice(0, limit);
}

function unresolvedItemsFrom(value: unknown): unknown[] {
  if (!isPlainObject(value)) return [];
  const result: unknown[] = [];
  for (const key of ["unresolved_items", "unresolved_issues", "evidence_boundaries"]) {
    result.push(...arrayValue(value[key]));
  }
  if (isPlainObject(value.resolution)) {
    for (const key of ["unresolved_items", "unresolved_issues"]) {
      result.push(...arrayValue(value.resolution[key]));
    }
  }
  return result.filter((item) => item !== null && item !== undefined && item !== "");
}

async function readDecisionContext(
  supabase: SupabaseClient,
  requestedDecisionId: string | null,
  auditLimit: number,
  eventLimit: number,
  transactionLimit: number,
) {
  const [stateRow, queueRow] = await Promise.all([
    readFranchiseState(supabase),
    readExactResource(supabase, {
      resource_type: "decision_queue",
      resource_id: "decision-queue",
    }),
  ]);

  if (!queueRow || !isPlainObject(queueRow.data)) {
    throw new Error("The active Decision Queue resource is unavailable.");
  }

  const decisions = decisionEntries(queueRow.data);
  const actionable = decisions.filter(isActionableDecision).sort(decisionSort);
  const deferred = decisions.filter((decision) => decisionStatus(decision) === "DEFERRED");
  const selected = requestedDecisionId
    ? decisions.find((decision, index) => decisionIdentifier(decision, index) === requestedDecisionId) ?? null
    : actionable[0] ?? null;

  if (requestedDecisionId && !selected) {
    return {
      backend_version: BACKEND_VERSION,
      state_version: stateRow.version,
      decision_queue_version: queueRow.version,
      requested_decision_id: requestedDecisionId,
      error: "Requested decision was not found in the live Decision Queue.",
      actionable_decision_count: actionable.length,
      deferred_decision_count: deferred.length,
    };
  }

  if (!selected) {
    return {
      backend_version: BACKEND_VERSION,
      state_version: stateRow.version,
      decision_queue_version: queueRow.version,
      next_actionable_decision: null,
      actionable_decision_count: 0,
      deferred_decision_count: deferred.length,
      queue_counts: {
        total: decisions.length,
        actionable: 0,
        deferred: deferred.length,
        closed: decisions.length - deferred.length,
      },
      note: "No actionable non-deferred decision is currently recorded.",
    };
  }

  const refs = decisionResourceRefs(selected);
  const stateRefs = decisionStateRefs(selected);
  const [resourceRows, auditResult, recentEvents] = await Promise.all([
    Promise.all(refs.map((ref) => readExactResource(supabase, ref))),
    readAudit(supabase, 60, null, null, null, null),
    readRecentEvents(supabase, 60),
  ]);

  const tokens = historyTokens(selected, refs, resourceRows);
  const relatedResources = resourceRows
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .map((row) => compactContextResource(row, tokens, transactionLimit));
  const missingResources = refs.filter((_, index) => !resourceRows[index]);
  const state = isPlainObject(stateRow.state) ? stateRow.state : {};
  const selectedStateRefs: JsonObject = {};
  for (const ref of stateRefs) selectedStateRefs[ref] = stateReferenceValue(state, ref);

  const relevantAudit = relevantAuditRows(
    auditResult.operations,
    refs,
    tokens,
    auditLimit,
  );
  const relevantEvents = recentEvents
    .filter((event: unknown) => matchesRelevance(event, tokens))
    .slice(0, eventLimit);

  const expectedResources = relatedResources.map((resource) => ({
    resource_type: resource.resource_type,
    resource_id: resource.resource_id,
    version: resource.version,
    status: resource.status,
    visibility: resource.visibility,
  }));

  const result: JsonObject = {
    backend_version: BACKEND_VERSION,
    state_version: stateRow.version,
    state_updated_at: stateRow.updated_at,
    decision_queue_version: queueRow.version,
    decision_queue_updated_at: queueRow.updated_at,
    requested_decision_id: requestedDecisionId,
    next_actionable_decision: selected,
    decision_id: decisionIdentifier(selected),
    decision_status: decisionStatus(selected),
    decision_actionable: isActionableDecision(selected),
    queue_counts: {
      total: decisions.length,
      actionable: actionable.length,
      deferred: deferred.length,
      closed: decisions.length - actionable.length - deferred.length,
    },
    core_context: {
      timeline: state.timeline ?? null,
      opponent: state.opponent ?? null,
      medical: Array.isArray(state.medical) ? state.medical : [],
      roster: compactRoster(state),
      evidence_boundaries: Array.isArray(
          isPlainObject(state.canon) ? state.canon.evidence_boundaries : null,
        )
        ? (state.canon as JsonObject).evidence_boundaries
        : [],
    },
    state_references: selectedStateRefs,
    related_resources: relatedResources,
    missing_related_resources: missingResources,
    relevant_audit: relevantAudit,
    relevant_events: relevantEvents,
    write_preconditions: {
      expected_state_version: stateRow.version,
      expected_decision_queue_version: queueRow.version,
      expected_resource_versions: expectedResources,
    },
    compactness: {
      transaction_limit: transactionLimit,
      audit_limit: auditLimit,
      event_limit: eventLimit,
      full_snapshot_used: false,
      full_transaction_ledger_returned: false,
    },
  };

  result.response_json_bytes_estimate = JSON.stringify(result).length;
  return result;
}

async function readOperationLogRecord(
  supabase: SupabaseClient,
  operationId: number | null,
  idempotencyKey: string | null,
) {
  let query = supabase
    .from("archers_operation_log")
    .select(
      "operation_id, idempotency_key, operation, resource_type, resource_id, expected_version, summary, source_label, state_version, status, created_at",
      { count: "exact" },
    )
    .order("operation_id", { ascending: false });

  if (operationId !== null) query = query.eq("operation_id", operationId);
  else if (idempotencyKey) query = query.eq("idempotency_key", idempotencyKey);
  else throw new Error("operation_id or idempotency_key is required.");

  const { data, error, count } = await query.limit(10);
  if (error) throw error;
  return {
    operation: data?.[0] ?? null,
    matching_rows: count ?? data?.length ?? 0,
    rows: data ?? [],
  };
}

async function readCanonEventsForStateVersion(
  supabase: SupabaseClient,
  stateVersion: number,
  limit: number,
) {
  const { data, error } = await supabase
    .from("archers_canon_events")
    .select(
      "event_id, state_version, event_type, summary, source_label, created_at",
    )
    .eq("franchise_id", FRANCHISE_ID)
    .eq("state_version", stateVersion)
    .order("event_id", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

async function readOperationVerification(
  supabase: SupabaseClient,
  operationId: number | null,
  idempotencyKey: string | null,
  decisionId: string | null,
  fallbackResourceType: string | null,
  fallbackResourceId: string | null,
  eventLimit: number,
) {
  const operationResult = await readOperationLogRecord(
    supabase,
    operationId,
    idempotencyKey,
  );
  const operation = operationResult.operation;
  if (!operation || !isPlainObject(operation)) {
    return {
      backend_version: BACKEND_VERSION,
      operation_id: operationId,
      idempotency_key: idempotencyKey,
      verified: false,
      error: "No matching audit operation was found.",
    };
  }

  const resultingStateVersion = Number(operation.state_version);
  const targetRef = {
    resource_type: String(operation.resource_type ?? fallbackResourceType ?? ""),
    resource_id: String(operation.resource_id ?? fallbackResourceId ?? ""),
  };
  const hasTargetRef = Boolean(targetRef.resource_type && targetRef.resource_id);

  const idempotencyAudit = operation.idempotency_key
    ? await readOperationLogRecord(supabase, null, String(operation.idempotency_key))
    : operationResult;

  const [stateRow, queueRow, targetRow, canonEvents] = await Promise.all([
    readFranchiseState(supabase),
    readExactResource(supabase, {
      resource_type: "decision_queue",
      resource_id: "decision-queue",
    }, true),
    hasTargetRef ? readExactResource(supabase, targetRef, true) : Promise.resolve(null),
    Number.isInteger(resultingStateVersion)
      ? readCanonEventsForStateVersion(supabase, resultingStateVersion, eventLimit)
      : Promise.resolve([]),
  ]);

  const queueData = queueRow && isPlainObject(queueRow.data) ? queueRow.data : {};
  const decisions = decisionEntries(queueData);
  const selectedDecision = decisionId
    ? decisions.find((decision, index) => decisionIdentifier(decision, index) === decisionId) ?? null
    : null;
  const selectedRefs = selectedDecision ? decisionResourceRefs(selectedDecision) : [];
  const additionalRefs = selectedRefs.filter((ref) =>
    !(ref.resource_type === targetRef.resource_type && ref.resource_id === targetRef.resource_id)
  );
  const additionalRows = await Promise.all(
    additionalRefs.map((ref) => readExactResource(supabase, ref, true)),
  );

  const affectedResourceMap = new Map<string, JsonObject>();
  const addAffectedResource = (row: Record<string, unknown> | null) => {
    if (!row) return;
    const resourceType = String(row.resource_type ?? "");
    const resourceId = String(row.resource_id ?? "");
    if (!resourceType || !resourceId) return;

    affectedResourceMap.set(`${resourceType}/${resourceId}`, {
      resource_type: resourceType,
      resource_id: resourceId,
      version: row.version ?? null,
      status: row.status ?? null,
      visibility: row.visibility ?? null,
      updated_at: row.updated_at ?? null,
    });
  };

  addAffectedResource(targetRow);
  addAffectedResource(queueRow);
  for (const row of additionalRows) addAffectedResource(row);
  const affectedResources = [...affectedResourceMap.values()];

  const targetIsDecisionQueue =
    targetRef.resource_type === "decision_queue" &&
    targetRef.resource_id === "decision-queue";
  const targetUnresolved = targetIsDecisionQueue
    ? []
    : unresolvedItemsFrom(
      targetRow && isPlainObject(targetRow.data) ? targetRow.data : null,
    );
  const unresolved = [
    ...unresolvedItemsFrom(selectedDecision),
    ...targetUnresolved,
  ];
  const unresolvedIssuesEvaluation = targetIsDecisionQueue
    ? decisionId
      ? selectedDecision
        ? {
          mode: "DECISION_RECORD",
          decision_id_provided: true,
          decision_found: true,
          queue_wide_issues_included: false,
          note: "Only unresolved items attached to the requested decision were evaluated.",
        }
        : {
          mode: "DECISION_NOT_FOUND",
          decision_id_provided: true,
          decision_found: false,
          queue_wide_issues_included: false,
          note: "The requested decision was not found, so decision-specific unresolved items were not evaluated.",
        }
      : {
        mode: "NOT_EVALUATED_WITHOUT_DECISION_ID",
        decision_id_provided: false,
        decision_found: false,
        queue_wide_issues_included: false,
        note: "Decision-specific unresolved items require decision_id; queue-wide unresolved items were intentionally omitted.",
      }
    : {
      mode: decisionId ? "DECISION_AND_TARGET_RESOURCE" : "TARGET_RESOURCE",
      decision_id_provided: Boolean(decisionId),
      decision_found: Boolean(selectedDecision),
      queue_wide_issues_included: false,
      note: decisionId
        ? "Unresolved items were evaluated from the target resource and the requested decision when found."
        : "Unresolved items were evaluated from the target resource only.",
    };
  const operationStatus = normalizedUpper(operation.status);
  const replayDetected = idempotencyAudit.matching_rows > 1 || operationStatus.includes("REPLAY");
  const stateReached = Number.isInteger(resultingStateVersion)
    ? Number(stateRow.version) >= resultingStateVersion
    : false;

  const result: JsonObject = {
    backend_version: BACKEND_VERSION,
    verified: stateReached && canonEvents.length > 0,
    audit_operation: operation,
    operation_id: operation.operation_id ?? null,
    idempotency: {
      key: operation.idempotency_key ?? idempotencyKey,
      matching_operation_rows: idempotencyAudit.matching_rows,
      duplicate_operation_rows: idempotencyAudit.matching_rows > 1,
      idempotent_replay: replayDetected,
      detection_basis: replayDetected
        ? "AUDIT_STATUS_OR_DUPLICATE_ROWS"
        : "NO_REPLAY_EVIDENCE_IN_AUDIT_LOG",
    },
    state_versions: {
      previous: Number.isInteger(resultingStateVersion)
        ? Math.max(resultingStateVersion - 1, 0)
        : null,
      resulting: Number.isInteger(resultingStateVersion)
        ? resultingStateVersion
        : null,
      current: stateRow.version,
      current_at_or_after_result: stateReached,
      previous_version_basis: "GLOBAL_STATE_INCREMENTS_ON_SUCCESSFUL_OPERATION",
    },
    canon_events: canonEvents,
    canon_event_ids: canonEvents.map((event: Record<string, unknown>) => event.event_id),
    target_resource: targetRow
      ? {
        resource_type: targetRow.resource_type,
        resource_id: targetRow.resource_id,
        version: targetRow.version,
        status: targetRow.status,
        visibility: targetRow.visibility,
        updated_at: targetRow.updated_at,
      }
      : null,
    decision_queue: queueRow
      ? {
        version: queueRow.version,
        status: queueRow.status,
        visibility: queueRow.visibility,
        updated_at: queueRow.updated_at,
      }
      : null,
    decision_id: decisionId,
    decision_record: selectedDecision,
    affected_resource_versions: affectedResources,
    affected_resource_versions_deduplicated: true,
    unresolved_issues_evaluation: unresolvedIssuesEvaluation,
    unresolved_issues: [...new Set(unresolved.map((item) =>
      typeof item === "string" ? item : JSON.stringify(item)
    ))],
    verification_totals: {
      canon_events: canonEvents.length,
      affected_resources: affectedResources.length,
      decision_found: Boolean(selectedDecision),
      target_resource_found: Boolean(targetRow),
      decision_queue_found: Boolean(queueRow),
      duplicate_operation_rows: idempotencyAudit.matching_rows > 1 ? idempotencyAudit.matching_rows : 0,
    },
    response_limit_safe: true,
    full_snapshot_used: false,
  };

  result.response_json_bytes_estimate = JSON.stringify(result).length;
  return result;
}

function isMissingExtendedRpcSignature(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const details = error as Record<string, unknown>;
  const code = String(details.code ?? "");
  const message = String(details.message ?? "");

  return code === "PGRST202" ||
    /p_expected_state_version|could not find the function/i.test(message);
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const expectedActionKey = Deno.env.get("ARCHERS_ACTION_KEY");

    if (!expectedActionKey) {
      return jsonResponse(
        { error: "Server is missing ARCHERS_ACTION_KEY" },
        500,
      );
    }

    if (req.headers.get("x-archers-key") !== expectedActionKey) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const adminKey = getAdminKey();

    if (!supabaseUrl || !adminKey) {
      return jsonResponse(
        {
          error: "Supabase server credentials are unavailable",
          hasUrl: Boolean(supabaseUrl),
          hasAdminKey: Boolean(adminKey),
        },
        500,
      );
    }

    const supabase = createClient(supabaseUrl, adminKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    try {
      if (req.method === "GET") {
        const url = new URL(req.url);
        const scope = (
          url.searchParams.get("scope") ??
            "core_state"
        ).toLowerCase();

        if (scope === "snapshot") {
          return jsonResponse(await readSnapshot(supabase));
        }

        if (scope === "core_state") {
          return jsonResponse(await readCoreState(supabase));
        }

        if (scope === "state_fields") {
          const paths = safeStatePaths(url.searchParams.get("fields"));

          if (paths instanceof Response) {
            return paths;
          }

          return jsonResponse(
            await readStateFields(supabase, paths),
          );
        }

        if (scope === "league") {
          const season = Number(
            url.searchParams.get("season") ??
              String(DEFAULT_SEASON),
          );
          const weekRaw = url.searchParams.get("week");
          const week = weekRaw ? Number(weekRaw) : null;

          if (
            !Number.isInteger(season) ||
            (week !== null && !Number.isInteger(week))
          ) {
            return jsonResponse(
              { error: "season and week must be integers" },
              400,
            );
          }

          return jsonResponse(
            await readLeague(supabase, season, week),
          );
        }

        if (scope === "game") {
          const gameId = url.searchParams.get("game_id");

          if (!gameId) {
            return jsonResponse(
              { error: "game_id is required for game scope" },
              400,
            );
          }

          return jsonResponse(
            await readGame(supabase, gameId),
          );
        }

        if (scope === "resources") {
          const seasonRaw = url.searchParams.get("season");
          const season = seasonRaw === null || seasonRaw === ""
            ? null
            : Number(seasonRaw);

          if (season !== null && !Number.isInteger(season)) {
            return jsonResponse(
              { error: "season must be an integer" },
              400,
            );
          }

          return jsonResponse(
            await readResources(supabase, {
              resourceType: url.searchParams.get("resource_type"),
              resourceId: url.searchParams.get("resource_id"),
              includeArchived:
                url.searchParams.get("include_archived") === "true",
              status: url.searchParams.get("status"),
              visibility: url.searchParams.get("visibility"),
              season,
              includeData:
                url.searchParams.get("include_data") !== "false",
              limit: boundedInteger(
                url.searchParams.get("limit"),
                25,
                1,
                100,
              ),
              offset: boundedInteger(
                url.searchParams.get("offset"),
                0,
                0,
                100000,
              ),
            }),
          );
        }

        if (scope === "resource_index") {
          return jsonResponse(
            await readResourceIndex(
              supabase,
              url.searchParams.get("include_archived") === "true",
              url.searchParams.get("visibility"),
              url.searchParams.get("include_items") !== "false",
            ),
          );
        }

        if (scope === "events") {
          const afterEventRaw =
            url.searchParams.get("after_event_id");
          const afterEventId = afterEventRaw
            ? Number(afterEventRaw)
            : null;

          if (
            afterEventId !== null &&
            !Number.isInteger(afterEventId)
          ) {
            return jsonResponse(
              { error: "after_event_id must be an integer" },
              400,
            );
          }

          return jsonResponse({
            events: await readRecentEvents(
              supabase,
              boundedInteger(
                url.searchParams.get("limit"),
                20,
                1,
                100,
              ),
              url.searchParams.get("event_type"),
              afterEventId,
            ),
          });
        }

        if (scope === "audit") {
          const afterOperationRaw =
            url.searchParams.get("after_operation_id");
          const afterOperationId = afterOperationRaw
            ? Number(afterOperationRaw)
            : null;

          if (
            afterOperationId !== null &&
            !Number.isInteger(afterOperationId)
          ) {
            return jsonResponse(
              {
                error:
                  "after_operation_id must be an integer",
              },
              400,
            );
          }

          return jsonResponse(
            await readAudit(
              supabase,
              boundedInteger(
                url.searchParams.get("limit"),
                30,
                1,
                100,
              ),
              url.searchParams.get("resource_type"),
              url.searchParams.get("resource_id"),
              url.searchParams.get("operation"),
              afterOperationId,
            ),
          );
        }

        if (scope === "decision_context") {
          return jsonResponse(
            await readDecisionContext(
              supabase,
              url.searchParams.get("decision_id"),
              boundedInteger(url.searchParams.get("audit_limit"), 5, 0, 20),
              boundedInteger(url.searchParams.get("event_limit"), 5, 0, 20),
              boundedInteger(url.searchParams.get("transaction_limit"), 12, 0, 30),
            ),
          );
        }

        if (scope === "operation_verification") {
          const operationIdRaw = url.searchParams.get("operation_id");
          const operationId = operationIdRaw === null || operationIdRaw === ""
            ? null
            : Number(operationIdRaw);
          if (operationId !== null && (!Number.isInteger(operationId) || operationId < 0)) {
            return jsonResponse(
              { error: "operation_id must be a non-negative integer" },
              400,
            );
          }

          const idempotencyKey = url.searchParams.get("idempotency_key");
          if (operationId === null && !idempotencyKey) {
            return jsonResponse(
              { error: "operation_id or idempotency_key is required for operation_verification" },
              400,
            );
          }

          return jsonResponse(
            await readOperationVerification(
              supabase,
              operationId,
              idempotencyKey,
              url.searchParams.get("decision_id"),
              url.searchParams.get("resource_type"),
              url.searchParams.get("resource_id"),
              boundedInteger(url.searchParams.get("event_limit"), 5, 1, 20),
            ),
          );
        }

        if (scope === "capabilities") {
          return jsonResponse({
            backend_version: BACKEND_VERSION,
            read_scopes: [
              "snapshot",
              "core_state",
              "state_fields",
              "league",
              "game",
              "resources",
              "resource_index",
              "events",
              "audit",
              "decision_context",
              "operation_verification",
              "capabilities",
            ],
            resource_read_features: [
              "SERVER_SIDE_FILTERS",
              "PAGINATION",
              "OPTIONAL_DATA_OMISSION",
              "RESOURCE_INDEX",
              "VALID_RESOURCE_COLUMNS",
              "RELATED_TRANSACTION_FILTERING",
            ],
            event_read_features: [
              "COMPACT_EVENTS_BY_DEFAULT",
              "EVENT_TYPE_FILTER",
              "AFTER_EVENT_ID_FILTER",
            ],
            state_read_features: [
              "COMPACT_CORE_STATE",
              "SELECTED_STATE_PATHS",
              "NEXT_ACTIONABLE_EXCLUDES_DEFERRED",
            ],
            composite_read_features: [
              "DECISION_CONTEXT_BUNDLE",
              "OPERATION_VERIFICATION_BUNDLE",
              "THREE_CALL_DECISION_WORKFLOW",
              "UNIQUE_AFFECTED_RESOURCE_VERSIONS",
              "OPERATION_SCOPED_UNRESOLVED_ISSUES",
            ],
            write_features: [
              "ATOMIC_DECISION_UPDATE",
            ],
            write_operations: [...WRITE_OPERATIONS],
            source_labels: [...SOURCE_LABELS],
            safeguards: [
              "EXPECTED_VERSION",
              "EXPECTED_STATE_VERSION_WHEN_RPC_SUPPORTS_IT",
              "DECISION_IDENTITY_PRESERVATION",
              "IDEMPOTENCY",
              "AUDIT_LOG",
              "SOFT_ARCHIVE",
              "NO_ARBITRARY_SQL",
              "ATOMIC_FINALIZATION",
              "KEVIN_IDENTITY_GUARDRAILS",
            ],
          });
        }

        return jsonResponse(
          { error: `Unsupported read scope: ${scope}` },
          400,
        );
      }

      if (req.method === "POST") {
        const body = await req.json().catch(() => null);

        if (!isPlainObject(body)) {
          return jsonResponse(
            { error: "Request body must be a JSON object" },
            400,
          );
        }

        /*
         * Backward compatibility with the original patch operation.
         * All new calls should send payload as a native JSON object.
         */
        let operation = typeof body.operation === "string"
          ? body.operation.trim().toLowerCase()
          : "";

        let payload: JsonObject;

        if (
          !operation &&
          (body.patch_json !== undefined || body.patch !== undefined)
        ) {
          operation = "patch_franchise_state";

          const parsedPatch = parseJsonObject(
            body.patch ?? body.patch_json,
            "patch",
          );

          if (parsedPatch.error) {
            return parsedPatch.error;
          }

          payload = { patch: parsedPatch.value };
        } else {
          const parsedPayload = parseJsonObject(
            body.payload ?? body.payload_json ?? {},
            "payload",
          );

          if (parsedPayload.error) {
            return parsedPayload.error;
          }

          payload = parsedPayload.value ?? {};
        }

        if (!WRITE_OPERATIONS.has(operation)) {
          return jsonResponse(
            {
              error:
                `Unsupported operation: ${operation || "missing"}`,
            },
            400,
          );
        }

        const summary = body.summary;

        if (
          typeof summary !== "string" ||
          summary.trim().length === 0
        ) {
          return jsonResponse(
            { error: "summary must be a non-empty string" },
            400,
          );
        }

        const sourceLabel =
          typeof body.source_label === "string"
            ? body.source_label
            : "LIVE_SESSION_LOG";

        if (!SOURCE_LABELS.has(sourceLabel)) {
          return jsonResponse(
            {
              error:
                `Unsupported source_label: ${sourceLabel}`,
            },
            400,
          );
        }

        const exactKevinText = body.exact_kevin_text ?? null;

        if (
          exactKevinText !== null &&
          typeof exactKevinText !== "string"
        ) {
          return jsonResponse(
            {
              error:
                "exact_kevin_text must be a string or null",
            },
            400,
          );
        }

        const expectedVersion = nonNegativeIntegerOrNull(
          body.expected_version,
          "expected_version",
        );

        if (expectedVersion instanceof Response) {
          return expectedVersion;
        }

        const expectedStateVersion =
          nonNegativeIntegerOrNull(
            body.expected_state_version,
            "expected_state_version",
          );

        if (expectedStateVersion instanceof Response) {
          return expectedStateVersion;
        }

        const idempotencyKey =
          typeof body.idempotency_key === "string" &&
            body.idempotency_key.trim()
            ? body.idempotency_key.trim()
            : `legacy-${crypto.randomUUID()}`;


        if (operation === "update_decision") {
          const suppliedIdempotencyKey =
            typeof body.idempotency_key === "string" &&
              body.idempotency_key.trim().length > 0;

          if (!suppliedIdempotencyKey) {
            return jsonResponse(
              { error: "idempotency_key is required for update_decision" },
              400,
            );
          }

          const resourceType = typeof body.resource_type === "string"
            ? body.resource_type.trim().toLowerCase()
            : "";
          const resourceId = typeof body.resource_id === "string"
            ? body.resource_id.trim()
            : "";

          if (
            resourceType !== "decision_queue" ||
            resourceId !== "decision-queue"
          ) {
            return jsonResponse(
              {
                error:
                  "update_decision requires resource_type decision_queue and resource_id decision-queue",
              },
              400,
            );
          }

          if (expectedVersion === null) {
            return jsonResponse(
              { error: "expected_version is required for update_decision" },
              400,
            );
          }

          if (expectedStateVersion === null) {
            return jsonResponse(
              {
                error:
                  "expected_state_version is required for update_decision",
              },
              400,
            );
          }

          const decisionId = typeof payload.decision_id === "string"
            ? payload.decision_id.trim()
            : "";
          const changes = payload.changes;

          if (!decisionId) {
            return jsonResponse(
              { error: "payload.decision_id is required" },
              400,
            );
          }

          if (!isPlainObject(changes) || Object.keys(changes).length === 0) {
            return jsonResponse(
              {
                error:
                  "payload.changes must be a non-empty JSON object",
              },
              400,
            );
          }

          const { data, error } = await supabase.rpc(
            "archers_update_decision",
            {
              p_resource_type: "decision_queue",
              p_resource_id: "decision-queue",
              p_payload: payload,
              p_expected_version: expectedVersion,
              p_expected_state_version: expectedStateVersion,
              p_idempotency_key: idempotencyKey,
              p_summary: summary.trim(),
              p_source_label: sourceLabel,
              p_exact_kevin_text: exactKevinText,
              p_dry_run: body.dry_run === true,
            },
          );

          if (error) {
            return errorResponse(
              error,
              "Atomic decision update failed",
              409,
            );
          }

          return jsonResponse(data);
        }

        if (body.dry_run === true) {
          const currentState =
            await readFranchiseState(supabase);

          return jsonResponse({
            dry_run: true,
            operation,
            resource_type: body.resource_type ?? null,
            resource_id: body.resource_id ?? null,
            expected_version: expectedVersion,
            expected_state_version: expectedStateVersion,
            idempotency_key: idempotencyKey,
            source_label: sourceLabel,
            summary: summary.trim(),
            payload,
            current_state_version: currentState.version,
            note:
              "No database write was performed. Consequential execution requires a new call with dry_run false.",
          });
        }

        const baseRpcArgs = {
          p_operation: operation,
          p_resource_type:
            typeof body.resource_type === "string"
              ? body.resource_type
              : null,
          p_resource_id:
            typeof body.resource_id === "string"
              ? body.resource_id
              : null,
          p_payload: payload,
          p_expected_version: expectedVersion,
          p_idempotency_key: idempotencyKey,
          p_summary: summary.trim(),
          p_source_label: sourceLabel,
          p_exact_kevin_text: exactKevinText,
        };

        /*
         * Prefer an RPC signature that accepts expected state version.
         * Fall back to the existing legacy signature only when PostgREST
         * explicitly reports that the extended signature does not exist.
         */
        let { data, error } = await supabase.rpc(
          "archers_execute_operation",
          {
            ...baseRpcArgs,
            p_expected_state_version: expectedStateVersion,
          },
        );

        if (error && isMissingExtendedRpcSignature(error)) {
          ({ data, error } = await supabase.rpc(
            "archers_execute_operation",
            baseRpcArgs,
          ));
        }

        if (error) {
          return errorResponse(
            error,
            "Unified operation failed",
            409,
          );
        }

        return jsonResponse(data);
      }

      return jsonResponse(
        { error: "Method not allowed" },
        405,
      );
    } catch (error) {
      return errorResponse(
        error,
        "Archers operations request failed",
      );
    }
  },
};
