import { createClient } from "npm:@supabase/supabase-js@2";

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(
  value: unknown,
  fieldName: string,
): { value?: Record<string, unknown>; error?: Response } {
  if (isPlainObject(value)) return { value };
  if (typeof value !== "string" || value.trim().length === 0) {
    return {
      error: jsonResponse(
        { error: `${fieldName} must be a non-empty JSON-object string` },
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

async function readFranchiseState(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase
    .from("archers_franchise_state")
    .select("id, version, state, source_checkpoint_id, seal_status, updated_at")
    .eq("id", "stl-2026")
    .single();
  if (error) throw error;
  return data;
}

async function readRecentEvents(
  supabase: ReturnType<typeof createClient>,
  limit = 20,
) {
  const { data, error } = await supabase
    .from("archers_canon_events")
    .select("event_id, state_version, event_type, summary, exact_kevin_text, source_label, payload, created_at")
    .eq("franchise_id", "stl-2026")
    .order("event_id", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw error;
  return data ?? [];
}

async function readSnapshot(supabase: ReturnType<typeof createClient>) {
  const [state, events, teamsResult, standingsResult, metadataResult, scheduleResult, liveResult] =
    await Promise.all([
      readFranchiseState(supabase),
      readRecentEvents(supabase, 20),
      supabase
        .from("cff_teams")
        .select("team_id, team_name, city, nickname, conference, division, alignment_status, is_archers, active, version, updated_at")
        .eq("active", true)
        .order("team_name"),
      supabase.from("cff_standings").select("*").eq("season", 2026),
      supabase.from("cff_league_metadata").select("*").eq("season", 2026).maybeSingle(),
      supabase.from("archers_schedule").select("*").eq("season", 2026).order("week"),
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

async function readLeague(
  supabase: ReturnType<typeof createClient>,
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
  supabase: ReturnType<typeof createClient>,
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

async function readResources(
  supabase: ReturnType<typeof createClient>,
  resourceType: string | null,
  resourceId: string | null,
  includeArchived: boolean,
) {
  let query = supabase
    .from("archers_resources")
    .select("*")
    .eq("franchise_id", "stl-2026")
    .order("resource_type")
    .order("resource_id");
  if (resourceType) query = query.eq("resource_type", resourceType);
  if (resourceId) query = query.eq("resource_id", resourceId);
  if (!includeArchived) query = query.eq("status", "ACTIVE");
  const { data, error } = await query;
  if (error) throw error;
  return { resources: data ?? [] };
}

async function readAudit(
  supabase: ReturnType<typeof createClient>,
  limit: number,
) {
  const { data, error } = await supabase
    .from("archers_operation_log")
    .select("operation_id, idempotency_key, operation, resource_type, resource_id, expected_version, summary, source_label, state_version, status, created_at")
    .order("operation_id", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
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
        if (scope === "league") {
          const season = Number(url.searchParams.get("season") ?? "2026");
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
          return jsonResponse(
            await readResources(
              supabase,
              url.searchParams.get("resource_type"),
              url.searchParams.get("resource_id"),
              url.searchParams.get("include_archived") === "true",
            ),
          );
        }
        if (scope === "audit") {
          return jsonResponse(await readAudit(supabase, Number(url.searchParams.get("limit") ?? "30")));
        }
        if (scope === "capabilities") {
          return jsonResponse({
            backend_version: "3.0",
            read_scopes: ["snapshot", "league", "game", "resources", "audit", "capabilities"],
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
        let payload: Record<string, unknown>;
        if (!operation && (body.patch_json !== undefined || body.patch !== undefined)) {
          operation = "patch_franchise_state";
          const parsedPatch = parseJsonObject(body.patch ?? body.patch_json, "patch_json");
          if (parsedPatch.error) return parsedPatch.error;
          payload = { patch: parsedPatch.value };
        } else {
          const parsedPayload = parseJsonObject(body.payload ?? body.payload_json ?? {}, "payload_json");
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