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

Deno.serve(async (req: Request) => {
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
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Supabase server credentials are unavailable" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  try {
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("archers_test_state")
        .select("id, version, message, note, sent_at, updated_at")
        .eq("id", "archers-test")
        .single();

      if (error) throw error;
      return jsonResponse(data);
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => null);
      const message = body?.message;

      if (typeof message !== "string" || message.trim().length === 0) {
        return jsonResponse({ error: "message must be a non-empty string" }, 400);
      }

      const { data: current, error: readError } = await supabase
        .from("archers_test_state")
        .select("version")
        .eq("id", "archers-test")
        .single();

      if (readError) throw readError;

      const { data: updated, error: updateError } = await supabase
        .from("archers_test_state")
        .update({
          version: current.version + 1,
          message,
          note: "Written by the custom GPT through the Archers Edge Function",
          sent_at: new Date().toISOString(),
        })
        .eq("id", "archers-test")
        .select("id, version, message, note, sent_at, updated_at")
        .single();

      if (updateError) throw updateError;
      return jsonResponse(updated);
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: message }, 500);
  }
});
