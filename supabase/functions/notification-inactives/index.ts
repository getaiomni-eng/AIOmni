// supabase/functions/notification-inactives/index.ts
// ───────────────────────────────────────────────────────────
// "Your starter is OUT" push. NFL inactives drop ~90 minutes before
// kickoff, and a starter you cannot swap in time is the single most
// expensive thing that happens to a fantasy team in a given week.
//
// notification-lineup-check already warns about BYE weeks on Sunday
// morning, but nothing watches injury designations, so a player ruled out
// at 11:30am went unannounced. This fills that gap.
//
// Source is Sleeper's player DB, the same feed weekly-board reads. That
// choice is deliberate: ESPN's injury endpoint 403s from Supabase's
// datacenter IPs (works from a laptop, silently reports zero from an edge
// function), which is how an earlier version of the weekly board shipped
// with injuries quietly disabled.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Designations that mean "this player is not playing, or probably is not".
// Mirrors weekly-board's ROSTER_OUT + WEEK_OUT so the board and the alert
// never disagree about who is startable.
const OUT_STATUSES = new Set([
  'Out', 'Doubtful',
  'IR', 'PUP', 'Sus', 'NA', 'DNR', 'COV', 'Injured Reserve',
]);

// Exact mirror of services/util/normalizeName.ts. It must stay a mirror:
// user_rostered_players.normalized_name is written by the CLIENT with that
// function, and any divergence here silently matches nothing. Implemented
// without regex for the same reason the client version is — keeping the two
// literally identical is worth more than brevity.
const SUFFIXES_SPACE = [
  ' jr', ' sr', ' ii', ' iii', ' iv', ' v',
  ' jr.', ' sr.', ' ii.', ' iii.', ' iv.', ' v.',
];
function normalizePlayerName(name: string | null | undefined): string {
  let s = (name ?? '').toLowerCase().trim();
  for (const suf of SUFFIXES_SPACE) {
    if (s.endsWith(suf)) { s = s.slice(0, -suf.length).trim(); break; }
  }
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 97 && c <= 122) out += s[i];
  }
  return out;
}

type ExpoMessage = { to: string; title: string; body: string; sound: 'default'; data?: any };

async function sendExpo(messages: ExpoMessage[]): Promise<void> {
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(chunk),
      });
    } catch (e) {
      console.error('expo push failed', (e as any)?.message);
    }
  }
}

function nflSeason(): number {
  const now = new Date();
  return now.getUTCMonth() + 1 >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

// ISO week number, used in the dedupe key so the alert resets weekly.
//
// Deliberately the CALENDAR week rather than the NFL week: it needs no
// schedule lookup, it cannot drift out of sync with a table, and it rolls
// over Monday 00:00 UTC — which is after Sunday night kickoff and before
// Monday night, so a Monday-night starter ruled out still gets his own
// alert. A season-scoped key would have been wrong: a player who is Out in
// week 3, plays weeks 4-8, then is Out again in week 9 must alert twice.
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Thursday of the current week decides the year the week belongs to.
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil((((t.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

serve(async (_req) => {
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ── 1. Who is ruled out, by name+position ────────────────────────────
  let players: Record<string, any>;
  try {
    const r = await fetch('https://api.sleeper.app/v1/players/nfl');
    if (!r.ok) throw new Error(`sleeper players ${r.status}`);
    players = await r.json();
  } catch (e) {
    // No feed, no alerts. Never guess at an injury.
    console.error('inactives: player feed unavailable', (e as any)?.message);
    return new Response(JSON.stringify({ ok: false, error: 'player feed unavailable' }),
      { status: 200, headers: CORS });
  }

  // Key on name+POSITION, and keep every candidate rather than the last
  // one seen. "Justin Jefferson" is two real people in this feed — a WR in
  // MIN and a LB in CLE — and collapsing them is how a linebacker once
  // ended up ranked as a WR2. An ambiguous match here would tell someone
  // their receiver is out because a defender with the same name is.
  const byNamePos = new Map<string, Array<{ team: string | null; status: string; full: string }>>();
  for (const id of Object.keys(players)) {
    const p = players[id];
    const status = p?.injury_status;
    if (!status || !OUT_STATUSES.has(status)) continue;
    const full = p?.full_name ?? [p?.first_name, p?.last_name].filter(Boolean).join(' ');
    const norm = normalizePlayerName(full);
    const pos = p?.position;
    if (!norm || !pos) continue;
    const key = `${norm}|${pos}`;
    if (!byNamePos.has(key)) byNamePos.set(key, []);
    byNamePos.get(key)!.push({ team: p?.team ?? null, status, full });
  }

  if (byNamePos.size === 0) {
    return new Response(JSON.stringify({ ok: true, out_players: 0, sent: 0 }), { headers: CORS });
  }

  // ── 2. Starters belonging to users who can actually receive a push ───
  const { data: rows, error } = await sb
    .from('user_rostered_players')
    .select('user_id, normalized_name, display_name, league_id, platform, position, team, users:user_id(push_token, notification_prefs)')
    .eq('is_starter', true);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS });
  }

  const season = nflSeason();
  const wk = isoWeek(new Date());
  const messages: ExpoMessage[] = [];
  const logRows: any[] = [];
  const sentThisRun = new Set<string>();
  let ambiguous = 0;

  for (const row of rows ?? []) {
    const u: any = (row as any).users;
    const token = u?.push_token;
    if (!token) continue;
    // lineup_warning covers "something is wrong with your lineup", which is
    // exactly what this is. Defaults to on when unset.
    if (u?.notification_prefs?.lineup_warning === false) continue;
    if (!row.position) continue;

    const cands = byNamePos.get(`${row.normalized_name}|${row.position}`);
    if (!cands || cands.length === 0) continue;

    // Same name AND same position: disambiguate on team where we can.
    //
    // user_rostered_players.team is NOT reliably an NFL abbreviation. Every
    // ESPN row holds a numeric proTeamId ("13" for LV, "17" for NE) and so
    // do some Sleeper rows, so comparing it against the feed's "LV" always
    // fails. A strict comparison therefore suppressed EVERY alert for ESPN
    // users -- 3 of 7 connected accounts -- silently and permanently.
    // Caught before launch by cross-referencing real starters: Brock Bowers
    // (roster team "13", feed "LV") was a correct match being thrown away.
    //
    // So team is used only when it actually looks like an abbreviation.
    // Falling back to name+position is safe here and measured, not assumed:
    // across the live feed, 398 ruled-out players produce 397 unique
    // name+position keys, and the single collision is Sleeper's own
    // "Duplicate Player" placeholder.
    const usableTeam = typeof row.team === 'string' && /^[A-Z]{2,4}$/.test(row.team)
      ? row.team : null;

    let match = cands[0];
    if (cands.length > 1) {
      // A genuine collision. Without a usable team there is no way to tell
      // the two apart, and a wrong alert tells someone to bench a healthy
      // starter -- strictly worse than staying quiet.
      const onTeam = usableTeam ? cands.filter(c => c.team === usableTeam) : [];
      if (onTeam.length !== 1) { ambiguous++; continue; }
      match = onTeam[0];
    } else if (usableTeam && match.team && match.team !== usableTeam) {
      // One candidate, and a trustworthy team that disagrees: stale roster
      // row or a different player. Not confident enough to wake someone up.
      ambiguous++;
      continue;
    }

    // One alert per player, per league, per week.
    const dedupe = `inactive:${row.league_id}:${row.normalized_name}:${season}w${wk}`;
    const seenKey = `${row.user_id}|${dedupe}`;
    if (sentThisRun.has(seenKey)) continue;
    sentThisRun.add(seenKey);

    const name = row.display_name || match.full;
    messages.push({
      to: token,
      title: match.status === 'Doubtful' ? `⚠️ ${name} is doubtful` : `🚨 ${name} is ${match.status}`,
      body: `${name} (${row.position}${match.team ? ' ' + match.team : ''}) is in your starting lineup. Swap him before kickoff.`,
      sound: 'default',
      data: { kind: 'inactive', league_id: row.league_id, player: row.display_name },
    });
    logRows.push({
      user_id: row.user_id,
      kind: 'inactive',
      dedupe_key: dedupe,
      title: `${name} is ${match.status}`,
      body: `Starting in ${row.platform ?? 'league'} ${row.league_id}`,
    });
  }

  if (messages.length === 0) {
    return new Response(JSON.stringify({ ok: true, out_players: byNamePos.size, sent: 0, ambiguous }),
      { headers: CORS });
  }

  // ── 3. Claim the dedupe rows BEFORE sending ─────────────────────────
  // notification_log has UNIQUE (user_id, kind, dedupe_key). Inserting
  // first and sending only what the insert accepted means a concurrent run
  // cannot double-notify. The reverse order — send, then log — double-sends
  // whenever the log write fails, and a duplicate "your guy is OUT" at
  // 11:45 on a Sunday is exactly the push that gets an app muted.
  const { data: claimed, error: logErr } = await sb
    .from('notification_log')
    .upsert(logRows, { onConflict: 'user_id,kind,dedupe_key', ignoreDuplicates: true })
    .select('user_id, dedupe_key');
  if (logErr) {
    return new Response(JSON.stringify({ error: logErr.message }), { status: 500, headers: CORS });
  }

  const claimedKeys = new Set((claimed ?? []).map((c: any) => `${c.user_id}|${c.dedupe_key}`));
  const toSend = messages.filter((_, i) =>
    claimedKeys.has(`${logRows[i].user_id}|${logRows[i].dedupe_key}`));

  await sendExpo(toSend);

  return new Response(JSON.stringify({
    ok: true,
    out_players: byNamePos.size,
    matched: messages.length,
    sent: toSend.length,
    ambiguous,
  }), { headers: CORS });
});
