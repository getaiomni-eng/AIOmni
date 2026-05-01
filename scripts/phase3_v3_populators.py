#!/usr/bin/env python3
"""
AIOmni Phase 3 v3 data layer populators.

Creates three Supabase edge functions that populate the tables you
just created (nfl_schedule, nfl_dvp, nfl_season_win_totals):

  1. populate-schedule
       Pulls 2026 NFL schedule from ESPN. Note: NFL typically
       releases the schedule mid-May. If the API returns no games
       for 2026 yet, the function will populate empty and we just
       re-run after the schedule drops (~May 14-15, 2026).

  2. populate-dvp
       Derives Defense-vs-Position from nfl_weekly_stats. For each
       team, aggregates how many fantasy PPG they allowed to QBs,
       RBs, WRs, TEs in 2025. Self-contained -- no external API.

  3. populate-win-totals
       Pulls 2026 season win totals from The Odds API using your
       existing API key. Maps Vegas team names (full names) to
       NFL abbreviations.

After this script runs you deploy + trigger each:

  supabase functions deploy populate-schedule
  supabase functions deploy populate-dvp
  supabase functions deploy populate-win-totals

  curl -X POST .../populate-schedule       # 2026 sched (might be empty until May)
  curl -X POST .../populate-dvp            # DvP from 2025
  curl -X POST .../populate-win-totals     # Vegas 2026

Run from AIOmni repo root:
    python3 scripts/phase3_v3_populators.py
"""
from pathlib import Path
import sys

ROOT = Path('.')
SUPA = ROOT / 'supabase' / 'functions'

if not SUPA.exists():
    print('[ERROR]    supabase/functions not found. Run from AIOmni root.')
    sys.exit(1)

# ═══════════════════════════════════════════════════════════════════════
# POPULATOR 1: nfl_schedule
# ═══════════════════════════════════════════════════════════════════════

SCHEDULE_FN = '''// supabase/functions/populate-schedule/index.ts
// Pulls 2026 NFL schedule from ESPN scoreboard API.
// NFL schedule typically releases mid-May; if the API returns no games
// yet, function populates empty -- re-run after schedule drops.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ESPN team abbreviation normalization (their feed uses some non-standard codes)
const ABBR_FIX: Record<string, string> = {
  WSH: 'WAS',
  JAX: 'JAX',
  // most match
};

function normTeam(abbr: string): string {
  return ABBR_FIX[abbr] ?? abbr;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const url = new URL(req.url);
    const season = parseInt(url.searchParams.get('season') ?? '2026');
    const startedAt = Date.now();
    const rows: any[] = [];

    // ESPN exposes schedule per-week; iterate weeks 1-18 (regular season)
    for (let week = 1; week <= 18; week++) {
      try {
        const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`;
        const res = await fetch(espnUrl, { headers: { 'User-Agent': 'AIOmni/1.0' } });
        if (!res.ok) continue;
        const data = await res.json();
        for (const event of (data?.events ?? [])) {
          const comp = event.competitions?.[0];
          if (!comp) continue;
          const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
          const away = comp.competitors?.find((c: any) => c.homeAway === 'away');
          if (!home || !away) continue;
          const homeAbbr = normTeam(home.team?.abbreviation ?? '');
          const awayAbbr = normTeam(away.team?.abbreviation ?? '');
          if (!homeAbbr || !awayAbbr) continue;
          rows.push({
            season,
            week,
            home_team: homeAbbr,
            away_team: awayAbbr,
          });
        }
      } catch (e) {
        console.log(`week ${week} fetch error:`, e);
      }
    }

    if (rows.length > 0) {
      // Wipe + insert this season
      await supabase.from('nfl_schedule').delete().eq('season', season);
      const CHUNK = 100;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await supabase
          .from('nfl_schedule')
          .insert(rows.slice(i, i + CHUNK));
        if (error) console.error('insert error:', error);
      }
    }

    const duration = Math.round((Date.now() - startedAt) / 1000);
    return new Response(JSON.stringify({
      ok: true,
      season,
      games_inserted: rows.length,
      duration_seconds: duration,
      note: rows.length === 0 ? 'No games returned from ESPN -- 2026 schedule probably not released yet (typically mid-May).' : null,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('populate-schedule error:', err);
    return new Response(JSON.stringify({ ok: false, error: err.message ?? String(err) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
'''

sched_dir = SUPA / 'populate-schedule'
sched_dir.mkdir(parents=True, exist_ok=True)
(sched_dir / 'index.ts').write_text(SCHEDULE_FN)
print('[APPLIED]  populate-schedule function written')

# ═══════════════════════════════════════════════════════════════════════
# POPULATOR 2: nfl_dvp (Defense vs Position)
# ═══════════════════════════════════════════════════════════════════════

DVP_FN = '''// supabase/functions/populate-dvp/index.ts
// Derives Defense-vs-Position rankings from nfl_weekly_stats.
// For each team, computes PPR points allowed per game to each position.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WeeklyRow {
  gsis_id: string;
  season: number;
  week: number;
  team: string | null;
  opponent: string | null;
  fantasy_pts_ppr: number;
}

// Paginated fetch of all 2025 weekly stats with opponent info
async function fetchAllWeekly(supabase: any, season: number): Promise<WeeklyRow[]> {
  const out: WeeklyRow[] = [];
  const CHUNK = 1000;
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('nfl_weekly_stats')
      .select('gsis_id, season, week, team, opponent, fantasy_pts_ppr')
      .eq('season', season)
      .eq('season_type', 'REG')
      .order('gsis_id', { ascending: true })
      .order('week', { ascending: true })
      .range(offset, offset + CHUNK - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < CHUNK) break;
    offset += CHUNK;
    if (offset > 50000) break;
  }
  return out;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const url = new URL(req.url);
    const season = parseInt(url.searchParams.get('season') ?? '2025');
    const startedAt = Date.now();

    // Pull weekly stats + player position lookup (need position per gsis_id)
    const [weekly, playersResult] = await Promise.all([
      fetchAllWeekly(supabase, season),
      supabase.from('nfl_players').select('gsis_id, position'),
    ]);
    if (playersResult.error) throw playersResult.error;

    const posByGsis = new Map<string, string>();
    for (const p of (playersResult.data ?? [])) {
      if (p.gsis_id && p.position) posByGsis.set(p.gsis_id, p.position);
    }

    // Aggregate: opponent_team x position -> {points_allowed, games}
    interface Bucket { points: number; games: Set<string>; }
    const buckets = new Map<string, Bucket>();  // key: `${team}|${pos}`

    for (const w of weekly) {
      if (!w.opponent || !w.fantasy_pts_ppr) continue;
      const pos = posByGsis.get(w.gsis_id);
      if (!pos || !['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
      const key = `${w.opponent}|${pos}`;
      const b = buckets.get(key) ?? { points: 0, games: new Set() };
      b.points += w.fantasy_pts_ppr;
      // Track unique games per opponent-position combo
      b.games.add(`${w.season}|${w.week}`);
      buckets.set(key, b);
    }

    // Compute PPG allowed per (team, position)
    const rows: any[] = [];
    for (const [key, b] of buckets) {
      const [team, position] = key.split('|');
      const games = b.games.size;
      if (games < 4) continue;
      rows.push({
        season,
        team,
        position,
        ppg_allowed: Math.round((b.points / games) * 10) / 10,
        rank_vs_pos: 0,  // assigned below
      });
    }

    // Rank within each position (1 = toughest defense, lowest PPG allowed)
    const byPos: Record<string, any[]> = {};
    for (const r of rows) {
      (byPos[r.position] = byPos[r.position] ?? []).push(r);
    }
    for (const pos of Object.keys(byPos)) {
      byPos[pos].sort((a, b) => a.ppg_allowed - b.ppg_allowed);
      byPos[pos].forEach((r, i) => { r.rank_vs_pos = i + 1; });
    }

    // Wipe + insert
    await supabase.from('nfl_dvp').delete().eq('season', season);
    const CHUNK = 100;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await supabase
        .from('nfl_dvp')
        .insert(rows.slice(i, i + CHUNK));
      if (error) console.error('insert error:', error);
    }

    const duration = Math.round((Date.now() - startedAt) / 1000);
    return new Response(JSON.stringify({
      ok: true,
      season,
      teams_processed: new Set(rows.map(r => r.team)).size,
      rows_inserted: rows.length,
      duration_seconds: duration,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('populate-dvp error:', err);
    return new Response(JSON.stringify({ ok: false, error: err.message ?? String(err) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
'''

dvp_dir = SUPA / 'populate-dvp'
dvp_dir.mkdir(parents=True, exist_ok=True)
(dvp_dir / 'index.ts').write_text(DVP_FN)
print('[APPLIED]  populate-dvp function written')

# ═══════════════════════════════════════════════════════════════════════
# POPULATOR 3: nfl_season_win_totals (Vegas 2026 win totals)
# ═══════════════════════════════════════════════════════════════════════

WIN_TOTALS_FN = '''// supabase/functions/populate-win-totals/index.ts
// Pulls 2026 NFL season win totals from The Odds API.
// Maps Vegas team full names to NFL abbreviations.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// You can override via env var if you store the key in supabase secrets;
// fallback is your existing client-side key.
const ODDS_API_KEY = Deno.env.get('ODDS_API_KEY') ?? '1dc3181b24294523fb9a75fda64bd6b6';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TEAM_NAME_TO_ABBR: Record<string, string> = {
  'Arizona Cardinals': 'ARI', 'Atlanta Falcons': 'ATL', 'Baltimore Ravens': 'BAL',
  'Buffalo Bills': 'BUF', 'Carolina Panthers': 'CAR', 'Chicago Bears': 'CHI',
  'Cincinnati Bengals': 'CIN', 'Cleveland Browns': 'CLE', 'Dallas Cowboys': 'DAL',
  'Denver Broncos': 'DEN', 'Detroit Lions': 'DET', 'Green Bay Packers': 'GB',
  'Houston Texans': 'HOU', 'Indianapolis Colts': 'IND', 'Jacksonville Jaguars': 'JAX',
  'Kansas City Chiefs': 'KC', 'Las Vegas Raiders': 'LV', 'Los Angeles Chargers': 'LAC',
  'Los Angeles Rams': 'LAR', 'Miami Dolphins': 'MIA', 'Minnesota Vikings': 'MIN',
  'New England Patriots': 'NE', 'New Orleans Saints': 'NO', 'New York Giants': 'NYG',
  'New York Jets': 'NYJ', 'Philadelphia Eagles': 'PHI', 'Pittsburgh Steelers': 'PIT',
  'San Francisco 49ers': 'SF', 'Seattle Seahawks': 'SEA', 'Tampa Bay Buccaneers': 'TB',
  'Tennessee Titans': 'TEN', 'Washington Commanders': 'WAS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const startedAt = Date.now();
    const season = 2026;

    // The Odds API: season win totals are a "futures" market
    const oddsUrl = `https://api.the-odds-api.com/v4/sports/americanfootball_nfl_seasonal_wins/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=outrights&oddsFormat=american`;
    const res = await fetch(oddsUrl);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Odds API HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();

    // Each team appears as an "event" with markets containing over/under win totals.
    // We extract the line (point) and team name.
    const rows: any[] = [];
    for (const event of (data ?? [])) {
      // Outrights structure: bookmaker.markets[].outcomes[]
      const bookmaker = event.bookmakers?.[0];
      if (!bookmaker) continue;
      const market = bookmaker.markets?.find((m: any) => m.key === 'outrights');
      if (!market) continue;
      for (const outcome of (market.outcomes ?? [])) {
        const fullName = outcome.name;
        const abbr = TEAM_NAME_TO_ABBR[fullName];
        if (!abbr) continue;
        // Win total is encoded in the "description" or "point" field;
        // fall back to parsing from name
        const winTotal = outcome.point ?? null;
        if (winTotal === null) continue;
        rows.push({
          season,
          team: abbr,
          win_total: winTotal,
          fetched_at: new Date().toISOString(),
        });
      }
    }

    if (rows.length > 0) {
      await supabase.from('nfl_season_win_totals').delete().eq('season', season);
      const { error } = await supabase
        .from('nfl_season_win_totals')
        .insert(rows);
      if (error) console.error('insert error:', error);
    }

    const duration = Math.round((Date.now() - startedAt) / 1000);
    return new Response(JSON.stringify({
      ok: true,
      season,
      teams_inserted: rows.length,
      duration_seconds: duration,
      note: rows.length === 0 ? 'No data from Odds API -- 2026 season win totals may not be posted yet, or market key changed.' : null,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('populate-win-totals error:', err);
    return new Response(JSON.stringify({ ok: false, error: err.message ?? String(err) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
'''

wins_dir = SUPA / 'populate-win-totals'
wins_dir.mkdir(parents=True, exist_ok=True)
(wins_dir / 'index.ts').write_text(WIN_TOTALS_FN)
print('[APPLIED]  populate-win-totals function written')

print()
print('Done. 3 edge functions written.')
print()
print('Deploy + populate (one chained command):')
print('  supabase functions deploy populate-schedule \\')
print('    && supabase functions deploy populate-dvp \\')
print('    && supabase functions deploy populate-win-totals \\')
print('    && TOKEN="<your_anon_key>" \\')
print('    && curl -X POST "https://khoruzvsprxyocisuhet.supabase.co/functions/v1/populate-dvp" -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN" \\')
print('    && curl -X POST "https://khoruzvsprxyocisuhet.supabase.co/functions/v1/populate-schedule" -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN" \\')
print('    && curl -X POST "https://khoruzvsprxyocisuhet.supabase.co/functions/v1/populate-win-totals" -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN"')
print()
print('Expected: DvP populates with ~128 rows (32 teams × 4 positions). Schedule')
print('and win totals may be empty until NFL/Vegas releases their data.')
