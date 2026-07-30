import { createClient } from "npm:@supabase/supabase-js@2";

const FRANCHISE_ID = "stl-2026";
const DEFAULT_SEASON = 2026;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-archers-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const WRITE_OPERATIONS = new Set([
  "patch_franchise_state",
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
      if (parsed.default || firstKey) return parsed.default ?? firstKey;
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
  if (isPlainObject(value)) return { value };
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
        error: jsonResponse({ error: `${fieldName} must decode to one JSON object` }, 400),
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

function integerOrNull(value: unknown): number | null | Response {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return jsonResponse({ error: "expected_version must be a non-negative integer or null" }, 400);
  }
  return parsed;
}

function boundedInteger(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function csvValues(value: string | null): string[] {
  if (!value) return [];
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
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
    return jsonResponse({ error: "fields may contain at most 20 state paths" }, 400);
  }
  for (const path of selected) {
    if (path.length > 160 || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){0,7}$/.test(path)) {
      return jsonResponse({ error: `Unsupported state path: ${path}` }, 400);
    }
  }
  return selected;
}

function getPath(root: unknown, path: string): unknown {
  let current = root;
  for (const segment of path.split(".")) {
    if (!isPlainObject(current) || !(segment in current)) return null;
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
    if (roster[key] !== undefined) result[key] = roster[key];
  }
  return result;
}

async function readFranchiseState(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("archers_franchise_state")
    .select("id, version, state, source_checkpoint_id, seal_status, updated_at")
    .eq("id", FRANCHISE_ID)
    .single();
  if (error) throw error;
  return data;
}

async function readRecentEvents(
  supabase: SupabaseClient,
  limit = 20,
  eventType: string | null = null,
  afterEventId: number | null = null,
) {
  let query = supabase
    .from("archers_canon_events")
    .select("event_id, state_version, event_type, summary, exact_kevin_text, source_label, payload, created_at")
    .eq("franchise_id", FRANCHISE_ID)
    .order("event_id", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (eventType) query = query.eq("event_type", eventType);
  if (afterEventId !== null) query = query.gt("event_id", afterEventId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

async function readSnapshot(supabase: SupabaseClient) {
  const [state, events, teamsResult, standingsResult, metadataResult, scheduleResult, liveResult] =
    await Promise.all([
      readFranchiseState(supabase),
      readRecentEvents(supabase, 20),
      supabase
        .from("cff_teams")
        .select("team_id, team_name, city, nickname, conference, division, alignment_status, is_archers, active, version, updated_at")
        .eq("active", true)
        .order("team_name"),
      supabase.from("cff_standings").select("*").eq("season", DEFAULT_SEASON),
      supabase.from("cff_league_metadata").select("*").eq("season", DEFAULT_SEASON).maybeSingle(),
      supabase.from("archers_schedule").select("*").eq("season", DEFAULT_SEASON).order("week"),
      supabase
        .from("cff_live_games")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  for (const result of [teamsResult, standingsResult, metadataResult, scheduleResult, liveResult]) {
    if (result.error) throw result.error;
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
  const timeline = isPlainObject(state.timeline) ? state.timeline : state.timeline ?? null;
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
      exact_continuation_point: getPath(state, "timeline.exact_continuation_point") ?? state.exact_continuation_point ?? null,
      current_position: getPath(state, "timeline.current_position") ?? state.current_position ?? null,
      week: getPath(state, "timeline.week") ?? state.week ?? null,
      day: getPath(state, "timeline.day") ?? state.day ?? null,
    },
    open_decisions: Array.isArray(state.open_decisions) ? state.open_decisions : [],
    opponent: state.opponent ?? null,
    medical: Array.isArray(state.medical) ? state.medical : [],
    roster: compactRoster(state),
    cap: isPlainObject(resources.cap) ? resources.cap : resources.cap ?? null,
    evidence_boundaries: Array.isArray(canon.evidence_boundaries) ? canon.evidence_boundaries : [],
    available_state_sections: Object.keys(state).sort(),
  };
}

async function readStateFields(supabase: SupabaseClient, paths: string[]) {
  const row = await readFranchiseState(supabase);
  const state = isPlainObject(row.state) ? row.state : {};
  const fields: JsonObject = {};
  for (const path of paths) fields[path] = getPath(state, path);
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
  const gamesQuery = supabase
    .from("cff_games")
    .select("*")
    .eq("season", season)
    .order("week")
    .order("game_id");
  if (week !== null) gamesQuery.eq("week", week);

  const [teams, games, standings, metadata, schedule] = await Promise.all([
    supabase.from("cff_teams").select("*").eq("active", true).order("team_name"),
    gamesQuery,
    supabase.from("cff_standings").select("*").eq("season", season),
    supabase.from("cff_league_metadata").select("*").eq("season", season).maybeSingle(),
    supabase.from("archers_schedule").select("*").eq("season", season).order("week"),
  ]);
  for (const result of [teams, games, standings, metadata, schedule]) {
    if (result.error) throw result.error;
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
  const [official, live, drives, events, teamStats, playerStats] = await Promise.all([
    supabase.from("cff_games").select("*").eq("game_id", gameId).maybeSingle(),
    supabase.from("cff_live_games").select("*").eq("game_id", gameId).maybeSingle(),
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
    supabase.from("cff_game_team_stats").select("*").eq("game_id", gameId),
    supabase
      .from("cff_game_player_stats")
      .select("*")
      .eq("game_id", gameId)
      .order("team_id")
      .order("player_name"),
  ]);
  for (const result of [official, live, drives, events, teamStats, playerStats]) {
    if (result.error) throw result.error;
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
  const selectFields = options.includeData
    ? "franchise_id, resource_type, resource_id, season, status, visibility, version, source_label, data, created_at, updated_at"
    : "franchise_id, resource_type, resource_id, season, status, visibility, version, source_label, created_at, updated_at";

  let query = supabase
    .from("archers_resources")
    .select(selectFields, { count: "exact" })
    .eq("franchise_id", FRANCHISE_ID)
    .order("resource_type")
    .order("resource_id")
    .range(options.offset, options.offset + options.limit - 1);

  if (options.resourceType) query = query.eq("resource_type", options.resourceType);
  if (options.resourceId) query = query.eq("resource_id", options.resourceId);
  if (options.status) query = query.eq("status", options.status);
  else if (!options.includeArchived) query = query.eq("status", "ACTIVE");
  if (options.visibility) query = query.eq("visibility", options.visibility);
  if (options.season !== null) query = query.eq("season", options.season);

  const { data, error, count } = await query;
  if (error) throw error;
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
  let query = supabase
    .from("archers_resources")
    .select("resource_type, resource_id, season, status, visibility, version, source_label, updated_at")
    .eq("franchise_id", FRANCHISE_ID)
    .order("resource_type")
    .order("resource_id");
  if (!includeArchived) query = query.eq("status", "ACTIVE");
  if (visibility) query = query.eq("visibility", visibility);

  const { data, error } = await query;
  if (error) throw error;
  const items = data ?? [];
  const grouped = new Map<string, { count: number; max_version: number; active: number; archived: number }>();
  for (const item of items) {
    const type = String(item.resource_type ?? "unknown");
    const current = grouped.get(type) ?? { count: 0, max_version: 0, active: 0, archived: 0 };
    current.count += 1;
    current.max_version = Math.max(current.max_version, Number(item.version) || 0);
    if (item.status === "ACTIVE") current.active += 1;
    else current.archived += 1;
    grouped.set(type, current);
  }

  return {
    total_resources: items.length,
    by_resource_type: Object.fromEntries([...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))),
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
    .select("operation_id, idempotency_key, operation, resource_type, resource_id, expected_version, summary, source_label, state_version, status, created_at")
    .order("operation_id", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (resourceType) query = query.eq("resource_type", resourceType);
  if (resourceId) query = query.eq("resource_id", resourceId);
  if (operation) query = query.eq("operation", operation);
  if (afterOperationId !== null) query = query.gt("operation_id", afterOperationId);
  const { data, error } = await query;
  if (error) throw error;
  return { operations: data ?? [] };
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const expectedActionKey = Deno.env.get("ARCHERS_ACTION_KEY");
    if (!expectedActionKey) return jsonResponse({ error: "Server is missing ARCHERS_ACTION_KEY" }, 500);
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
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    try {
      if (req.method === "GET") {
        const url = new URL(req.url);
        const scope = (url.searchParams.get("scope") ?? "snapshot").toLowerCase();

        if (scope === "snapshot") return jsonResponse(await readSnapshot(supabase));
        if (scope === "core_state") return jsonResponse(await readCoreState(supabase));
        if (scope === "state_fields") {
          const paths = safeStatePaths(url.searchParams.get("fields"));
          if (paths instanceof Response) return paths;
          return jsonResponse(await readStateFields(supabase, paths));
        }
        if (scope === "league") {
          const season = Number(url.searchParams.get("season") ?? String(DEFAULT_SEASON));
          const weekRaw = url.searchParams.get("week");
          const week = weekRaw ? Number(weekRaw) : null;
          if (!Number.isInteger(season) || (week !== null && !Number.isInteger(week))) {
            return jsonResponse({ error: "season and week must be integers" }, 400);
          }
          return jsonResponse(await readLeague(supabase, season, week));
        }
        if (scope === "game") {
          const gameId = url.searchParams.get("game_id");
          if (!gameId) return jsonResponse({ error: "game_id is required for game scope" }, 400);
          return jsonResponse(await readGame(supabase, gameId));
        }
        if (scope === "resources") {
          const seasonRaw = url.searchParams.get("season");
          const season = seasonRaw === null || seasonRaw === "" ? null : Number(seasonRaw);
          if (season !== null && !Number.isInteger(season)) {
            return jsonResponse({ error: "season must be an integer" }, 400);
          }
          return jsonResponse(
            await readResources(supabase, {
              resourceType: url.searchParams.get("resource_type"),
              resourceId: url.searchParams.get("resource_id"),
              includeArchived: url.searchParams.get("include_archived") === "true",
              status: url.searchParams.get("status"),
              visibility: url.searchParams.get("visibility"),
              season,
              includeData: url.searchParams.get("include_data") !== "false",
              limit: boundedInteger(url.searchParams.get("limit"), 25, 1, 100),
              offset: boundedInteger(url.searchParams.get("offset"), 0, 0, 100000),
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
          const afterEventRaw = url.searchParams.get("after_event_id");
          const afterEventId = afterEventRaw ? Number(afterEventRaw) : null;
          if (afterEventId !== null && !Number.isInteger(afterEventId)) {
            return jsonResponse({ error: "after_event_id must be an integer" }, 400);
          }
          return jsonResponse({
            events: await readRecentEvents(
              supabase,
              boundedInteger(url.searchParams.get("limit"), 30, 1, 100),
              url.searchParams.get("event_type"),
              afterEventId,
            ),
          });
        }
        if (scope === "audit") {
          const afterOperationRaw = url.searchParams.get("after_operation_id");
          const afterOperationId = afterOperationRaw ? Number(afterOperationRaw) : null;
          if (afterOperationId !== null && !Number.isInteger(afterOperationId)) {
            return jsonResponse({ error: "after_operation_id must be an integer" }, 400);
          }
          return jsonResponse(
            await readAudit(
              supabase,
              boundedInteger(url.searchParams.get("limit"), 30, 1, 100),
              url.searchParams.get("resource_type"),
              url.searchParams.get("resource_id"),
              url.searchParams.get("operation"),
              afterOperationId,
            ),
          );
        }
        if (scope === "capabilities") {
          return jsonResponse({
            backend_version: "3.1",
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
              "capabilities",
            ],
            resource_read_features: [
              "SERVER_SIDE_FILTERS",
              "PAGINATION",
              "OPTIONAL_DATA_OMISSION",
              "RESOURCE_INDEX",
            ],
            state_read_features: [
              "COMPACT_CORE_STATE",
              "SELECTED_STATE_PATHS",
            ],
            write_operations: [...WRITE_OPERATIONS],
            source_labels: [...SOURCE_LABELS],
            safeguards: [
              "EXPECTED_VERSION",
              "EXPECTED_STATE_VERSION",
              "IDEMPOTENCY",
              "AUDIT_LOG",
              "SOFT_ARCHIVE",
              "NO_ARBITRARY_SQL",
              "ATOMIC_FINALIZATION",
              "KEVIN_IDENTITY_GUARDRAILS",
            ],
          });
        }
        return jsonResponse({ error: `Unsupported read scope: ${scope}` }, 400);
      }

      if (req.method === "POST") {
        const body = await req.json().catch(() => null);
        if (!isPlainObject(body)) {
          return jsonResponse({ error: "Request body must be a JSON object" }, 400);
        }

        // Backward compatibility with the Phase One Action body.
        let operation = typeof body.operation === "string" ? body.operation.trim().toLowerCase() : "";
        let payload: JsonObject;
        if (!operation && (body.patch_json !== undefined || body.patch !== undefined)) {
          operation = "patch_franchise_state";
          const parsedPatch = parseJsonObject(body.patch ?? body.patch_json, "patch");
          if (parsedPatch.error) return parsedPatch.error;
          payload = { patch: parsedPatch.value };
        } else {
          const parsedPayload = parseJsonObject(body.payload ?? body.payload_json ?? {}, "payload");
          if (parsedPayload.error) return parsedPayload.error;
          payload = parsedPayload.value ?? {};
        }

        if (!WRITE_OPERATIONS.has(operation)) {
          return jsonResponse({ error: `Unsupported operation: ${operation || "missing"}` }, 400);
        }

        const summary = body.summary;
        if (typeof summary !== "string" || summary.trim().length === 0) {
          return jsonResponse({ error: "summary must be a non-empty string" }, 400);
        }

        const sourceLabel = typeof body.source_label === "string"
          ? body.source_label
          : "LIVE_SESSION_LOG";
        if (!SOURCE_LABELS.has(sourceLabel)) {
          return jsonResponse({ error: `Unsupported source_label: ${sourceLabel}` }, 400);
        }

        const exactKevinText = body.exact_kevin_text ?? null;
        if (exactKevinText !== null && typeof exactKevinText !== "string") {
          return jsonResponse({ error: "exact_kevin_text must be a string or null" }, 400);
        }

        const expectedVersion = integerOrNull(body.expected_version);
        if (expectedVersion instanceof Response) return expectedVersion;

        const idempotencyKey = typeof body.idempotency_key === "string" && body.idempotency_key.trim()
          ? body.idempotency_key.trim()
          : `legacy-${crypto.randomUUID()}`;

        if (body.dry_run === true) {
          const currentState = await readFranchiseState(supabase);
          return jsonResponse({
            dry_run: true,
            operation,
            resource_type: body.resource_type ?? null,
            resource_id: body.resource_id ?? null,
            expected_version: expectedVersion,
            idempotency_key: idempotencyKey,
            source_label: sourceLabel,
            summary: summary.trim(),
            payload,
            current_state_version: currentState.version,
            note: "No database write was performed. Consequential execution requires a new call with dry_run false.",
          });
        }

        const { data, error } = await supabase.rpc("archers_execute_operation", {
          p_operation: operation,
          p_resource_type: typeof body.resource_type === "string" ? body.resource_type : null,
          p_resource_id: typeof body.resource_id === "string" ? body.resource_id : null,
          p_payload: payload,
          p_expected_version: expectedVersion,
          p_idempotency_key: idempotencyKey,
          p_summary: summary.trim(),
          p_source_label: sourceLabel,
          p_exact_kevin_text: exactKevinText,
        });

        if (error) return errorResponse(error, "Unified operation failed", 409);
        return jsonResponse(data);
      }

      return jsonResponse({ error: "Method not allowed" }, 405);
    } catch (error) {
      return errorResponse(error, "Archers operations request failed");
    }
  },
};