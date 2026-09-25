// supabase/functions/social-publisher/index.ts
//
// Publishes the day's automated social posts once their veto window has
// passed.
//
// WHY THIS EXISTS. The owner wants every network that CAN be automated to
// post by itself, with a chance to stop it: scripts/social/generate.ts queues
// the day's posts in public.social_posts with publish_at = now + 3h (90 min on
// Sundays), and the /rank Posts tab can Hold any of them. This function is
// the other half: every 10 minutes (pg_cron) it publishes whatever is still
// queued and due.
//
//   auto   bluesky, x, facebook, instagram, threads -> published for real
//   semi   youtube -> uploaded PRIVATE; the owner taps Public in YouTube Studio
//   manual tiktok, reddit -> never touched here (copy-paste on the Posts tab)
//
// SAFETY.
//   * Kill switch: app_settings.social_autopost must be 'on'.
//   * A row is claimed with a conditional PATCH (queued -> publishing), so two
//     overlapping runs cannot publish the same row.
//   * A network whose secrets are not set is marked 'skipped' with the exact
//     secret names missing, so a partial setup works network by network.
//   * Failures retry up to 3 times, 15 minutes apart, then stay 'failed' with
//     the platform's error text for the Posts tab.
//   * Once a main post is live, a failed thread reply is recorded in
//     extra.thread_error instead of failing the row (a retry would double-post).
//
// Body: {} (cron) | { id } (publish that queued row now) | { dry_run: true }
//
// Secrets (supabase secrets set ...), per network, all optional:
//   BLUESKY_HANDLE, BLUESKY_APP_PASSWORD, [BLUESKY_SERVICE]
//   X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET
//   META_PAGE_ID, META_PAGE_TOKEN, [META_GRAPH_VERSION]
//   IG_USER_ID, and IG_TOKEN (Instagram Login) or META_PAGE_TOKEN (Facebook Login)
//   THREADS_USER_ID, THREADS_TOKEN (then rotated in app_settings.threads_token)
//   YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN

import type { Ctx, Db } from './ctx.ts';
import { runPublisher } from './core.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

async function sb(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', ...(init.headers ?? {}),
    },
  });
}

const db: Db = {
  async select(query) {
    const r = await sb(query);
    if (!r.ok) throw new Error(`select ${query.split('?')[0]} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return await r.json();
  },
  async patch(filter, body) {
    const r = await sb(filter, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`patch ${filter.split('?')[0]} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return await r.json();
  },
  async getSetting(key) {
    const r = await sb(`app_settings?select=value&key=eq.${encodeURIComponent(key)}`);
    if (!r.ok) return null;
    const rows = await r.json();
    return rows[0]?.value ?? null;
  },
  async setSetting(key, value) {
    const r = await sb('app_settings?on_conflict=key', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) throw new Error(`app_settings ${key} ${r.status}`);
  },
};

const ctx: Ctx = {
  fetch: (input, init) => fetch(input, init),
  env: (k) => Deno.env.get(k),
  db,
  sleep: (ms) => new Promise(res => setTimeout(res, ms)),
  now: () => Date.now(),
  log: (...a) => console.log(...a),
};

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const id = Number(body?.id) || undefined;
    const result = await runPublisher(ctx, { id, dryRun: body?.dry_run === true });
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
