// supabase/functions/delete-account/index.ts
// ───────────────────────────────────────────────────────────────────────
// Account deletion endpoint. Apple App Store guideline 5.1.1(v) (in
// force since June 2022) requires any app that lets users create an
// account to also let them delete it from inside the app. GDPR/CCPA
// also require this for users in their jurisdictions.
//
// Hard delete: removes the user's row from public.users and every
// dependent row across the schema, then removes the auth.users record
// via the admin API. Idempotent — calling twice is fine (second call
// is a no-op).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ANON_KEY    = Deno.env.get("SUPABASE_ANON_KEY");

const ALLOWED_ORIGINS = new Set<string>([
  "https://www.getaiomni.com",
  "https://getaiomni.com",
  "https://app.getaiomni.com",   // web app
  "http://localhost:3000",
  "http://localhost:8081",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = !origin || origin === "null" || ALLOWED_ORIGINS.has(origin)
    ? (origin ?? "null")
    : "https://www.getaiomni.com";
  return {
    "Access-Control-Allow-Origin":  allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(status: number, body: unknown, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST")    return json(405, { error: { message: "Method not allowed" } }, origin);

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token || token === SUPABASE_ANON_KEY) {
      return json(401, { error: { message: "Authentication required" } }, origin);
    }

    const sb = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !user) {
      return json(401, { error: { message: "Invalid or expired session" } }, origin);
    }

    const uid = user.id;

    // Drop dependent rows. RLS-via-service-role bypass is intentional —
    // these tables all reference auth_id / user_id with ON DELETE CASCADE
    // where defined, but we run explicit deletes too so this still works
    // if the FK cascades were never declared.
    const tables = [
      "memories",
      "prompt_usage",
      "user_rostered_players",
      "notification_log",
      // Add more app-owned tables here as they're introduced.
    ];
    for (const t of tables) {
      try {
        await sb.from(t).delete().eq("user_id", uid);
      } catch (e) {
        // Some tables key on auth_id instead of user_id; try that too.
        try {
          await sb.from(t).delete().eq("auth_id", uid);
        } catch {}
      }
    }
    // public.users — the canonical row keyed by auth_id
    try { await sb.from("users").delete().eq("auth_id", uid); } catch {}

    // Finally, drop the auth record. Requires service-role key.
    const { error: delErr } = await sb.auth.admin.deleteUser(uid);
    if (delErr) {
      return json(500, {
        error: { message: "Auth deletion failed: " + delErr.message },
      }, origin);
    }

    return json(200, { ok: true }, origin);
  } catch (e) {
    return json(500, { error: { message: (e as any)?.message || "Delete failed" } }, origin);
  }
});
