// supabase/functions/external-api-proxy/index.ts
// ───────────────────────────────────────────────────────────────────────
// Auth-gated proxy for third-party APIs whose keys we don't want shipped
// in the client bundle. Replaces the previous pattern of hardcoded
// ODDS_API_KEY / WEATHER_API_KEY / CFBD_API_KEY in services/liveData.ts
// (anyone with the IPA could extract those and burn quota on our dime).
//
// Routes by ?service= param. Each route has a strict allowlist of
// upstream URL prefixes so callers can't pivot the proxy at arbitrary
// third-party endpoints.
//
// Auth: requires a valid Supabase user JWT (same as claude-proxy).
// Anyone can't just guess the URL and burn upstream quota.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ANON_KEY    = Deno.env.get("SUPABASE_ANON_KEY");

// Upstream credentials — set via `supabase secrets set` on the project.
const ODDS_API_KEY    = Deno.env.get("ODDS_API_KEY");
const WEATHER_API_KEY = Deno.env.get("WEATHER_API_KEY");
const CFBD_API_KEY    = Deno.env.get("CFBD_API_KEY");

const ALLOWED_ORIGINS = new Set<string>([
  "https://www.getaiomni.com",
  "https://getaiomni.com",
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

function jsonError(status: number, message: string, origin: string | null) {
  return new Response(
    JSON.stringify({ error: { message } }),
    { status, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } },
  );
}

// Per-IP rate limit (60 req/min/IP) backed by public.proxy_rate_limit.
// Higher cap because these endpoints fan out many small calls per
// user session (e.g., weather lookups per outdoor team).
const RATE_LIMIT_PER_MIN = 120;
async function checkRateLimit(sb: any, scope: string, ip: string): Promise<boolean> {
  if (!ip || ip === 'unknown') return true;
  try {
    const { data } = await sb.rpc('proxy_rate_limit_bump', { p_scope: scope, p_ip: ip });
    return Number(data ?? 0) <= RATE_LIMIT_PER_MIN;
  } catch {
    return true;
  }
}
function getRequestIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('cf-connecting-ip')
      ?? req.headers.get('x-real-ip')
      ?? 'unknown';
}

async function logSecurityEvent(
  sb: any, kind: string, userId: string | null, ip: string, detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    await sb.rpc('log_security_event', {
      p_kind: kind, p_user: userId, p_ip: ip, p_scope: 'external-api-proxy', p_detail: detail,
    });
  } catch {}
}

// Service routers. Each takes the incoming URL's query params, builds
// the upstream URL with the secret injected, and returns the upstream
// response unchanged. Restricting input to a small set of forwarded
// params per service stops SSRF + parameter injection.
type ServiceRoute = (url: URL) => string | null;

const ROUTES: Record<string, ServiceRoute> = {
  // Odds API — spreads + totals only. The API only exposes NFL data
  // for this app, so the path is fixed; we just append the key.
  odds: (_url) => {
    if (!ODDS_API_KEY) return null;
    return `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=spreads,totals&oddsFormat=american`;
  },

  // OpenWeather — only forward lat/lon, never an arbitrary location
  // string. Limits SSRF impact: caller can only ask about geographic
  // coordinates, not e.g. internal IPs via a hostname.
  weather: (url) => {
    if (!WEATHER_API_KEY) return null;
    const lat = url.searchParams.get("lat");
    const lon = url.searchParams.get("lon");
    if (!lat || !lon) return null;
    const latN = Number(lat), lonN = Number(lon);
    if (!Number.isFinite(latN) || !Number.isFinite(lonN)) return null;
    if (latN < -90 || latN > 90 || lonN < -180 || lonN > 180) return null;
    return `https://api.openweathermap.org/data/2.5/weather?lat=${latN}&lon=${lonN}&appid=${WEATHER_API_KEY}&units=imperial`;
  },

  // College Football Data — forward only known-safe endpoints. CFBD has
  // many paths; allowlist what we actually use.
  cfbd: (url) => {
    if (!CFBD_API_KEY) return null;
    const path = url.searchParams.get("path");
    if (!path) return null;
    // Allow only paths we currently use in liveData.ts. Extend as needed.
    const ALLOWED_PATHS = [
      "/recruiting/players",
      "/recruiting/teams",
      "/teams",
      "/games",
      "/draft/prospects",
      "/stats/player/season",
    ];
    if (!ALLOWED_PATHS.some(p => path === p || path.startsWith(p + "?"))) return null;
    return `https://api.collegefootballdata.com${path}`;
  },
};

serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (req.method !== "GET") {
    return jsonError(405, "Method not allowed", origin);
  }

  try {
    // Auth — same pattern as claude-proxy. Anonymous calls rejected so
    // an attacker can't drain upstream quota with just the public anon key.
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token || token === SUPABASE_ANON_KEY) {
      return jsonError(401, "Authentication required", origin);
    }
    const sb = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
    const ip = getRequestIp(req);
    if (!(await checkRateLimit(sb, 'external-api-proxy', ip))) {
      logSecurityEvent(sb, 'rate_limit', null, ip);
      return jsonError(429, "Too many requests", origin);
    }
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !user) {
      logSecurityEvent(sb, 'auth_fail', null, ip, { reason: authErr?.message ?? 'no_user' });
      return jsonError(401, "Invalid or expired session", origin);
    }

    const url = new URL(req.url);
    const service = url.searchParams.get("service");
    if (!service || !ROUTES[service]) {
      return jsonError(400, "Unknown service", origin);
    }

    const upstreamUrl = ROUTES[service](url);
    if (!upstreamUrl) {
      return jsonError(400, "Invalid request", origin);
    }

    // CFBD requires Bearer auth, others use query-string keys.
    const upstreamHeaders: Record<string, string> = {};
    if (service === "cfbd") {
      upstreamHeaders.Authorization = `Bearer ${CFBD_API_KEY}`;
    }

    const upstreamRes = await fetch(upstreamUrl, { headers: upstreamHeaders });
    const body = await upstreamRes.text();

    return new Response(body, {
      status: upstreamRes.status,
      headers: {
        ...corsHeaders(origin),
        "Content-Type": upstreamRes.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch (e) {
    return jsonError(500, (e as any)?.message || "Proxy error", origin);
  }
});
