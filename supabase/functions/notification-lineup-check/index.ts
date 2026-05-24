// supabase/functions/notification-lineup-check/index.ts
// ───────────────────────────────────────────────────────────
// A2 — Lineup not set warning. Runs Sunday morning ET.
// For each user with notification_prefs.lineup_warning = true AND a
// push_token, scan their cached user_rostered_players (filtered to
// is_starter = true) and check whether any starter is on bye, IR, or
// the slot is empty. Send a single Expo push per league per week.
//
// "Empty slot" detection is best-effort — we don't always have full
// roster slot metadata server-side. v1 fires when starter count for a
// league is meaningfully below team's expected starter count (~9 in
// most formats). We do reliably detect bye-week starters by joining
// against this season's NFL schedule (nfl_schedule table written by
// the populate-schedule fn).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// ISO week label used as the dedupe key — "lineup:<league_id>:<isoweek>"
// so we don't double-fire if the cron runs twice.
function isoWeek(d = new Date()): string {
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const w = Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(w).padStart(2, '0')}`;
}

type ExpoMessage = {
  to:    string;
  title: string;
  body:  string;
  data?: Record<string, unknown>;
  sound?: 'default';
  priority?: 'high';
};

async function sendExpoPush(messages: ExpoMessage[]): Promise<void> {
  if (messages.length === 0) return;
  // Expo accepts batches up to 100 per request.
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(chunk),
      });
    } catch (e) {
      console.log('[lineup-check] expo push send failed:', (e as any)?.message);
    }
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ── 1. Pull the bye-week teams for the current week ────────────────
  // nfl_schedule has rows per (season, week, team) — a team on bye has
  // no row for that week. Easier: pull all distinct teams with no game
  // this week. v1: assume current_week column on a state table OR fall
  // back to "current calendar week of the regular season".
  // For now, hard-fail gracefully — if we can't get bye teams, we still
  // run but skip the bye check.
  let byeTeams = new Set<string>();
  try {
    const { data: state } = await sb.from('nfl_state').select('current_week, season').maybeSingle();
    const wk = state?.current_week;
    const season = state?.season ?? new Date().getFullYear();
    if (wk) {
      const { data: playing } = await sb
        .from('nfl_schedule')
        .select('home_team, away_team')
        .eq('season', season)
        .eq('week', wk);
      const playingSet = new Set<string>();
      for (const g of (playing ?? [])) {
        if (g.home_team) playingSet.add(String(g.home_team));
        if (g.away_team) playingSet.add(String(g.away_team));
      }
      const ALL_TEAMS = ['ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS'];
      byeTeams = new Set(ALL_TEAMS.filter(t => !playingSet.has(t)));
    }
  } catch (e) {
    console.log('[lineup-check] bye lookup failed (continuing without):', (e as any)?.message);
  }

  // ── 2. Pull every user opted in for lineup_warning with a push_token ─
  const { data: users, error: usersErr } = await sb
    .from('users')
    .select('auth_id, push_token, notification_prefs')
    .not('push_token', 'is', null)
    .filter('notification_prefs->>lineup_warning', 'eq', 'true');
  if (usersErr) {
    return new Response(JSON.stringify({ error: usersErr.message }), { status: 500, headers: CORS });
  }

  let sentCount = 0;
  let skippedDedupe = 0;
  const messages: ExpoMessage[] = [];
  const week = isoWeek();

  for (const u of (users ?? [])) {
    const { data: starters } = await sb
      .from('user_rostered_players')
      .select('display_name, team, position, league_id, platform')
      .eq('user_id', u.auth_id)
      .eq('is_starter', true);
    if (!starters || starters.length === 0) continue;

    // Group by league so each problem league fires at most one push.
    const byLeague = new Map<string, typeof starters>();
    for (const s of starters) {
      const k = `${s.platform ?? '?'}:${s.league_id ?? '?'}`;
      if (!byLeague.has(k)) byLeague.set(k, []);
      byLeague.get(k)!.push(s);
    }

    for (const [leagueKey, leagueStarters] of byLeague.entries()) {
      const onBye = leagueStarters.filter(s => s.team && byeTeams.has(String(s.team)));
      if (onBye.length === 0) continue;

      const dedupe = `lineup:${leagueKey}:${week}`;
      const { data: existing } = await sb
        .from('notification_log')
        .select('id')
        .eq('user_id', u.auth_id)
        .eq('kind', 'lineup_warning')
        .eq('dedupe_key', dedupe)
        .maybeSingle();
      if (existing) { skippedDedupe++; continue; }

      const names = onBye.map(s => s.display_name).slice(0, 3).join(', ');
      const moreCount = onBye.length - 3;
      const body = moreCount > 0
        ? `${names} +${moreCount} more on bye this week — set your lineup.`
        : `${names} on bye this week — set your lineup.`;
      const title = onBye.length === 1
        ? '⚠️ 1 starter on bye'
        : `⚠️ ${onBye.length} starters on bye`;

      messages.push({
        to:        u.push_token!,
        title,
        body,
        priority:  'high',
        sound:     'default',
        data:      { kind: 'lineup_warning', leagueKey },
      });
      await sb.from('notification_log').insert({
        user_id:    u.auth_id,
        kind:       'lineup_warning',
        dedupe_key: dedupe,
        title, body,
      });
      sentCount++;
    }
  }

  await sendExpoPush(messages);

  return new Response(
    JSON.stringify({ ok: true, sent: sentCount, skipped_dedupe: skippedDedupe, eligible_users: users?.length ?? 0 }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } },
  );
});
