// supabase/functions/notification-heat-alerts/index.ts
// ───────────────────────────────────────────────────────────
// A3 — Pulse alerts. Hourly cron.
// Fetches Sleeper trending adds (the primary velocity signal the Heat
// engine weights at 50%). Any player with ≥SCORCHING_THRESHOLD adds in
// the last 48h is "scorching." For each user with pulse_alerts=true who
// has a scorching player on their roster, fire a push.
//
// Dedupe key bucket: per-player per-WEEK (7-day epoch bucket). The old
// per-DAY bucket re-sent the IDENTICAL alert every day a player stayed
// trending — offseason trending barely churns, so users got the same
// pushes daily ("same notifications every time"). The initial spike IS
// the news; one alert per player per week is the signal without the
// spam.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const EXPO_PUSH_URL    = 'https://exp.host/--/api/v2/push/send';
const SLEEPER_TRENDING = 'https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=48&limit=50';

// Mirrors heatData.ts velocity tiering: 5000+ adds/48h is the "hot" cliff,
// 10000+ is "scorching." Pulse alert fires at 5000+ — that's the threshold
// where the player is moving fast enough that you should know about it.
const ALERT_THRESHOLD = 5000;

function normalize(name: string): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/, '')
    .replace(/[^a-z]/g, '');
}

// 7-day epoch bucket for the dedupe key — one alert per player per week.
function weekBucket(d = new Date()): string {
  return `w${Math.floor(d.getTime() / 86400000 / 7)}`;
}

type ExpoMessage = {
  to:    string;
  title: string;
  body:  string;
  data?: Record<string, unknown>;
  sound?: 'default';
};

async function sendExpoPush(messages: ExpoMessage[]): Promise<void> {
  if (messages.length === 0) return;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(chunk),
      });
    } catch (e) {
      console.log('[heat-alerts] expo push send failed:', (e as any)?.message);
    }
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // 1. Fetch Sleeper trending adds. Returns [{ player_id, count }, …].
  let trending: { player_id: string; count: number }[] = [];
  try {
    const res = await fetch(SLEEPER_TRENDING);
    trending = await res.json();
    if (!Array.isArray(trending)) trending = [];
  } catch (e) {
    return new Response(JSON.stringify({ error: 'sleeper trending fetch failed' }), { status: 500, headers: CORS });
  }
  const hot = trending.filter(t => t.count >= ALERT_THRESHOLD);
  if (hot.length === 0) {
    return new Response(JSON.stringify({ ok: true, hot_players: 0 }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // 2. Join sleeper_id → name via nfl_players (populated by nflverse-daily-sync).
  const sleeperIds = hot.map(h => h.player_id);
  const { data: playerRows } = await sb
    .from('nfl_players')
    .select('sleeper_id, full_name, position, team')
    .in('sleeper_id', sleeperIds);
  const sleeperToPlayer = new Map<string, any>();
  for (const p of (playerRows ?? [])) {
    if (p.sleeper_id) sleeperToPlayer.set(String(p.sleeper_id), p);
  }

  // 3. Compose hot-player records with normalized names for the join.
  const hotPlayers = hot.map(h => {
    const p = sleeperToPlayer.get(h.player_id);
    if (!p?.full_name) return null;
    return {
      sleeperId:  h.player_id,
      adds:       h.count,
      displayName: p.full_name,
      normalized:  normalize(p.full_name),
      position:   p.position,
      team:       p.team,
    };
  }).filter(Boolean) as Array<{ sleeperId: string; adds: number; displayName: string; normalized: string; position?: string; team?: string }>;
  if (hotPlayers.length === 0) {
    return new Response(JSON.stringify({ ok: true, hot_players: 0, reason: 'no name joins' }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // 4. Find users who have any hot player rostered AND have pulse_alerts opted in.
  const hotNames = hotPlayers.map(h => h.normalized);
  const { data: matches, error } = await sb
    .from('user_rostered_players')
    .select('user_id, normalized_name, display_name, league_id, platform, users:user_id(push_token, notification_prefs)')
    .in('normalized_name', hotNames);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS });
  }

  // 5. Pre-fetch existing dedupe keys per (user, sleeper_id, week).
  const day = weekBucket();
  const userIds = Array.from(new Set((matches ?? []).map(m => m.user_id)));
  const dedupeKeys = hotPlayers.map(h => `heat:${h.sleeperId}:${day}`);
  const dedupeSet = new Set<string>();
  if (userIds.length > 0) {
    const { data: existing } = await sb
      .from('notification_log')
      .select('user_id, dedupe_key')
      .in('user_id', userIds)
      .eq('kind', 'pulse_alert')
      .in('dedupe_key', dedupeKeys);
    for (const e of (existing ?? [])) dedupeSet.add(`${e.user_id}|${e.dedupe_key}`);
  }

  // Index hot players by normalized name for O(1) join.
  const hotByName = new Map<string, typeof hotPlayers[number]>();
  for (const h of hotPlayers) hotByName.set(h.normalized, h);

  // 6. Build push messages — de-dupe within this run too so the same
  // hot player on multiple leagues only fires one push per user.
  const messages: ExpoMessage[] = [];
  const logRows: any[] = [];
  const sentThisRun = new Set<string>();

  for (const match of (matches ?? [])) {
    const userRow = (match as any).users;
    const pushToken = userRow?.push_token;
    if (!pushToken) continue;
    const prefs = userRow?.notification_prefs ?? {};
    if (prefs.pulse_alerts === false) continue;

    const hot = hotByName.get(match.normalized_name);
    if (!hot) continue;

    const dedupe = `heat:${hot.sleeperId}:${day}`;
    const seenKey = `${match.user_id}|${dedupe}`;
    if (dedupeSet.has(seenKey) || sentThisRun.has(seenKey)) continue;
    sentThisRun.add(seenKey);

    const addsStr = hot.adds >= 10000
      ? `${(hot.adds / 1000).toFixed(1)}k`
      : hot.adds.toString();
    const body = `${hot.displayName}${hot.team ? ` (${hot.team})` : ''} — ${addsStr} adds in the last 48h.`;

    messages.push({
      to:        pushToken,
      title:     hot.adds >= 10000 ? `🔥 ${hot.displayName} scorching` : `🔥 ${hot.displayName} trending`,
      body,
      sound:     'default',
      data:      {
        kind:        'pulse_alert',
        sleeper_id:  hot.sleeperId,
        player:      hot.displayName,
        league_id:   match.league_id,
        platform:    match.platform,
      },
    });
    logRows.push({
      user_id:    match.user_id,
      kind:       'pulse_alert',
      dedupe_key: dedupe,
      title:      hot.displayName,
      body,
    });
  }

  if (logRows.length > 0) {
    await sb.from('notification_log').insert(logRows);
  }
  await sendExpoPush(messages);

  return new Response(
    JSON.stringify({
      ok:           true,
      hot_players:  hotPlayers.length,
      matched_rows: matches?.length ?? 0,
      pushes_sent:  messages.length,
    }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } },
  );
});
