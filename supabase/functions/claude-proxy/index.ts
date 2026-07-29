// supabase/functions/claude-proxy/index.ts
// ───────────────────────────────────────────────────────────────────────
// Authenticated proxy to Anthropic's Messages API with per-user quota
// enforcement. Hardened 2026-05-26 to close three classes of abuse:
//
//  1. Anonymous unlimited spend
//     Old code only enforced limits inside `if (userId)`. Anyone with the
//     public anon key (visible in the client bundle) could hit this proxy
//     forever. Now: every request MUST be authenticated. Anon-only calls
//     are rejected 401.
//
//  2. CORS wide open
//     Was `Access-Control-Allow-Origin: *`. Now restricted to the iOS
//     app origin set ("null" for native fetches), the marketing site,
//     and localhost for dev. Reject everything else.
//
//  3. Tier table out of sync with client
//     Was {free:25, rankings:0, pro:75, premium:125, dynasty_elite:999}.
//     Rankings users would have been instant-429ed once IAP unlocked.
//     Now matches the client-side LIMITS in services/promptQuota.ts:
//     {free:10, rankings:25, pro:50} (legacy tier names still recognized
//     so existing rows don't break).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_KEY        = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ANON_KEY    = Deno.env.get("SUPABASE_ANON_KEY");

// Aligned with client-side LIMITS in services/promptQuota.ts. Legacy
// tier names ('premium', 'dynasty_elite') retained for any pre-Option-D
// rows in public.users so those users aren't suddenly blocked.
const TIER_LIMITS: Record<string, number> = {
  free:           10,
  rankings:       25,
  pro:            50,
  premium:        50,    // legacy alias for pro
  dynasty_elite:  50,    // legacy alias for pro
};

// Origins allowed to call the proxy. Native fetches from iOS arrive
// without a real origin header (or with "null"); the React Native fetch
// implementation also sometimes sends "file://" or nothing at all.
// Browser-based traffic must match the explicit allowlist.
const ALLOWED_ORIGINS = new Set<string>([
  "https://www.getaiomni.com",
  "https://getaiomni.com",
  "http://localhost:3000",
  "http://localhost:8081",   // expo dev
]);

function corsHeaders(origin: string | null): Record<string, string> {
  // Native (origin === null or empty) gets a permissive but non-* header
  // so the response can be read. Browsers only get an explicit match.
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

function getNextSundayNoon(): string {
  const now = new Date();
  const day = now.getDay();
  const daysUntil = day === 0 ? 7 : 7 - day;
  const next = new Date(now);
  next.setDate(now.getDate() + daysUntil);
  next.setHours(12, 0, 0, 0);
  return next.toISOString();
}

function jsonError(status: number, message: string, origin: string | null) {
  return new Response(
    JSON.stringify({ error: { message } }),
    { status, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } },
  );
}

// Per-IP rate limit — backed by public.proxy_rate_limit + the
// proxy_rate_limit_bump RPC. Default 60 req/min/IP. Returns true when
// the request should be allowed, false when over cap.
const RATE_LIMIT_PER_MIN = 60;
async function checkRateLimit(sb: any, scope: string, ip: string): Promise<boolean> {
  if (!ip || ip === 'unknown') return true; // can't enforce without IP
  try {
    const { data } = await sb.rpc('proxy_rate_limit_bump', { p_scope: scope, p_ip: ip });
    const count = Number(data ?? 0);
    return count <= RATE_LIMIT_PER_MIN;
  } catch {
    return true; // fail-open on rate-limit infrastructure issues
  }
}
function getRequestIp(req: Request): string {
  // Supabase fronts edge functions with a CDN that sets these headers.
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('cf-connecting-ip')
      ?? req.headers.get('x-real-ip')
      ?? 'unknown';
}

// Fire-and-forget audit-log writer. Failures here must NEVER block the
// caller — the security log is a best-effort signal, not a hard control.
async function logSecurityEvent(
  sb: any,
  kind: 'auth_fail' | 'rate_limit' | 'unauthorized',
  userId: string | null,
  ip: string,
  scope: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    await sb.rpc('log_security_event', {
      p_kind: kind, p_user: userId, p_ip: ip, p_scope: scope, p_detail: detail,
    });
  } catch {}
}

serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return jsonError(405, "Method not allowed", origin);
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");

    // Reject if no Authorization header at all, OR if it's just the anon
    // key with no user JWT. Every call must come from a signed-in user.
    if (!token || token === SUPABASE_ANON_KEY) {
      return jsonError(401, "Authentication required", origin);
    }

    const sb = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);

    // Per-IP throttle BEFORE auth lookup — stops a flood of bad tokens
    // from spamming Supabase Auth.
    const ip = getRequestIp(req);
    if (!(await checkRateLimit(sb, 'claude-proxy', ip))) {
      logSecurityEvent(sb, 'rate_limit', null, ip, 'claude-proxy', {});
      return jsonError(429, "Too many requests", origin);
    }

    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !user) {
      logSecurityEvent(sb, 'auth_fail', null, ip, 'claude-proxy', { reason: authErr?.message ?? 'no_user' });
      return jsonError(401, "Invalid or expired session", origin);
    }

    const userId = user.id;
    let tier = "free";
    const { data: userData } = await sb
      .from("users")
      .select("tier")
      .eq("auth_id", userId)
      .maybeSingle();
    if (userData?.tier) tier = userData.tier;

    const limit = TIER_LIMITS[tier] ?? TIER_LIMITS.free;

    // Per-user rate enforcement (skip only for tiers explicitly unlimited;
    // currently none, but keeping the guard).
    if (limit < 999) {
      const { data: usage } = await sb
        .from("prompt_usage")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      const now = new Date();
      if (usage) {
        const resetAt = new Date(usage.reset_at);
        let currentCount = usage.prompts_used;
        if (now >= resetAt) {
          currentCount = 0;
          await sb
            .from("prompt_usage")
            .update({ prompts_used: 0, reset_at: getNextSundayNoon() })
            .eq("user_id", userId);
        }
        if (currentCount >= limit) {
          return jsonError(429, "Weekly prompt limit reached", origin);
        }
        await sb
          .from("prompt_usage")
          .update({ prompts_used: currentCount + 1 })
          .eq("user_id", userId);
      } else {
        await sb.from("prompt_usage").insert({
          user_id:      userId,
          prompts_used: 1,
          reset_at:     getNextSundayNoon(),
        });
      }
    }

    const body = await req.json();
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         ANTHROPIC_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    const data = await anthropicRes.json();
    return new Response(JSON.stringify(data), {
      status: anthropicRes.status,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  } catch (e) {
    return jsonError(500, (e as any)?.message || "Proxy error", origin);
  }
});
