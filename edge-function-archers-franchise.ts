import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-archers-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parsePatch(body: Record<string, unknown>):
  | { patch: Record<string, unknown>; error?: never }
  | { patch?: never; error: Response } {
  // Backward compatibility for direct callers that still send a JSON object.
  if (isPlainObject(body.patch)) {
    return { patch: body.patch };
  }

  // Custom GPT Actions expose arbitrary nested objects unreliably. Transport the
  // same minimal nested delta as a JSON string, then validate it server-side.
  if (typeof body.patch_json !== "string" || body.patch_json.trim().length === 0) {
    return {
      error: jsonResponse(
        { error: "patch_json must be a non-empty string containing one JSON object" },
        400,
      ),
    };
  }

  try {
    const decoded = JSON.parse(body.patch_json);
    if (!isPlainObject(decoded)) {
      return {
        error: jsonResponse(
          { error: "patch_json must decode to one JSON object" },
          400,
        ),
      };
    }

    return { patch: decoded };
  } catch (error) {
    return {
      error: jsonResponse(
        {
          error: "patch_json is not valid JSON",
          details: error instanceof Error ? error.message : null,
        },
        400,
      ),
    };
  }
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const expectedActionKey = Deno.env.get("ARCHERS_ACTION_KEY");
    if (!expectedActionKey) {
      return jsonResponse({ error: "Server is missing ARCHERS_ACTION_KEY" }, 500);
    }

    const suppliedActionKey = req.headers.get("x-archers-key");
    if (suppliedActionKey !== expectedActionKey) {
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

    if (req.method === "GET") {
      const { data: stateRow, error: stateError } = await supabase
        .from("archers_franchise_state")
        .select("id, version, state, source_checkpoint_id, seal_status, updated_at")
        .eq("id", "stl-2026")
        .single();

      if (stateError) return errorResponse(stateError, "Franchise-state read failed");

      const { data: events, error: eventError } = await supabase
        .from("archers_canon_events")
        .select("event_id, state_version, event_type, summary, exact_kevin_text, source_label, created_at")
        .eq("franchise_id", "stl-2026")
        .order("event_id", { ascending: false })
        .limit(12);

      if (eventError) return errorResponse(eventError, "Canon-event read failed");

      return jsonResponse({
        ...stateRow,
        recent_events: events ?? [],
      });
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => null);

      if (!isPlainObject(body)) {
        return jsonResponse({ error: "Request body must be a JSON object" }, 400);
      }

      const eventType = body.event_type;
      const summary = body.summary;
      const exactKevinText = body.exact_kevin_text ?? null;
      const sourceLabel = body.source_label ?? "LIVE_SESSION_LOG";

      if (typeof eventType !== "string" || eventType.trim().length === 0) {
        return jsonResponse({ error: "event_type must be a non-empty string" }, 400);
      }

      if (typeof summary !== "string" || summary.trim().length === 0) {
        return jsonResponse({ error: "summary must be a non-empty string" }, 400);
      }

      const parsedPatch = parsePatch(body);
      if (parsedPatch.error) return parsedPatch.error;

      if (exactKevinText !== null && typeof exactKevinText !== "string") {
        return jsonResponse({ error: "exact_kevin_text must be a string or null" }, 400);
      }

      if (typeof sourceLabel !== "string" || sourceLabel.trim().length === 0) {
        return jsonResponse({ error: "source_label must be a non-empty string" }, 400);
      }

      const { data, error } = await supabase.rpc("apply_archers_state_update", {
        p_patch: parsedPatch.patch,
        p_event_type: eventType,
        p_summary: summary,
        p_exact_kevin_text: exactKevinText,
        p_source_label: sourceLabel,
      });

      if (error) return errorResponse(error, "Franchise-state update failed");

      const result = Array.isArray(data) ? data[0] : data;
      if (!result) {
        return jsonResponse({ error: "Update completed without a returned state" }, 500);
      }

      return jsonResponse({
        id: "stl-2026",
        ...result,
      });
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  },
};