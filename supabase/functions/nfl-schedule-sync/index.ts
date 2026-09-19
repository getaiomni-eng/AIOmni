// supabase/functions/nfl-schedule-sync/index.ts
//
// Keeps public.nfl_schedule in step with nflverse, and is the ONLY writer of
// kickoff_at.
//
// Until now nothing wrote nfl_schedule at all -- five functions read it and it
// was populated by hand. It also had no kickoff time, which is why the weekly
// board could only ask OpenWeatherMap for CURRENT conditions at board time:
// there was nothing to aim a forecast at. A Thursday-morning observation was
// being applied to a Sunday afternoon game.
//
// Source is the same nflverse release the weekly stats pipeline already
// depends on, so this adds no new upstream.
//
// TIMEZONE: nflverse publishes gameday + gametime as EASTERN WALL CLOCK.
// September 13:00 ET is 17:00Z; December 13:00 ET is 18:00Z. Converting on
// write and storing an absolute instant means no reader has to know that.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FEED = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';

/**
 * Eastern wall clock -> absolute UTC instant, DST-correct.
 *
 * Reads the offset FROM the zone at that instant rather than hardcoding -4/-5,
 * so the November changeover needs no special case. Verified against four
 * dates spanning the boundary, including 2026-11-01.
 */
function etToUtc(day: string, time: string): string | null {
  if (!day || !time) return null;
  const naive = new Date(`${day}T${time}:00Z`);
  if (isNaN(naive.getTime())) return null;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p: Record<string, string> = Object.fromEntries(
    fmt.formatToParts(naive).map(x => [x.type, x.value]));
  const asET = Date.UTC(+p.year, +p.month - 1, +p.day, +(p.hour === '24' ? 0 : p.hour), +p.minute);
  return new Date(naive.getTime() - (asET - naive.getTime())).toISOString();
}

/**
 * nflverse team codes -> the codes the rest of this project uses.
 *
 * nflverse calls the Rams "LA"; everything here (nfl_players, the boards, the
 * adapters) says "LAR". Syncing without this silently created a SECOND row for
 * every Rams home game -- nine of them -- sitting alongside the real ones with
 * no kickoff time. Historical relocations are included so a backfill of an
 * older season lands on the same codes rather than inventing OAK and SD.
 */
const TEAM_ALIAS: Record<string, string> = {
  LA: 'LAR', STL: 'LAR', SD: 'LAC', OAK: 'LV', WSH: 'WAS',
};
const team = (t: string) => TEAM_ALIAS[t] ?? t;

/** Minimal CSV split that respects quoted fields. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

Deno.serve(async (req) => {
  const started = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const season: number = Number(body?.season) || new Date().getUTCFullYear();

    const res = await fetch(FEED);
    if (!res.ok) throw new Error(`nflverse feed ${res.status}`);
    const text = await res.text();
    const lines = text.split('\n').filter(l => l.trim());
    const head = splitCsv(lines[0]);
    const col = (n: string) => head.indexOf(n);
    const [cSeason, cWeek, cDay, cTime, cAway, cHome, cType] =
      ['season', 'week', 'gameday', 'gametime', 'away_team', 'home_team', 'game_type'].map(col);
    if ([cSeason, cWeek, cDay, cTime, cAway, cHome].some(i => i < 0)) {
      throw new Error('nflverse schema changed: a required column is missing');
    }

    const rows: any[] = [];
    let noTime = 0;
    for (const line of lines.slice(1)) {
      const r = splitCsv(line);
      if (Number(r[cSeason]) !== season) continue;
      // Regular season only. Preseason weeks reuse week numbers 1-4 and would
      // collide with the real week 1-4 on any (season, week, teams) read.
      if (cType >= 0 && r[cType] && r[cType] !== 'REG') continue;
      const kickoff = etToUtc(r[cDay], r[cTime]);
      if (!kickoff) noTime++;
      rows.push({
        season, week: Number(r[cWeek]),
        home_team: team(r[cHome]), away_team: team(r[cAway]),
        kickoff_at: kickoff,
      });
    }
    if (rows.length === 0) throw new Error(`no ${season} regular-season rows in feed`);

    // Upsert on the real PK (season, week, home_team) -- a team hosts at most
    // one game a week, so away_team is not part of it. No delete pass: a game
    // vanishing from the
    // feed is far more likely to be an upstream hiccup than a cancelled game,
    // and wiping the schedule would silently blank the board's matchup column.
    let written = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const r = await fetch(`${SUPABASE_URL}/rest/v1/nfl_schedule?on_conflict=season,week,home_team`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(chunk),
      });
      if (!r.ok) console.log('[schedule-sync] upsert failed:', r.status, (await r.text()).slice(0, 200));
      else written += chunk.length;
    }

    return new Response(JSON.stringify({
      ok: true, season, games: rows.length, written, missing_kickoff: noTime,
      duration_seconds: Math.round((Date.now() - started) / 1000),
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
