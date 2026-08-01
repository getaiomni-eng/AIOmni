// supabase/functions/populate-win-totals/index.ts
// Pulls 2026 NFL season win totals from The Odds API.
// Maps Vegas team full names to NFL abbreviations.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Env-only. The old hardcoded fallback put a real API key in the repo —
// rotate it at the-odds-api.com and set: supabase secrets set ODDS_API_KEY=…
const ODDS_API_KEY = Deno.env.get('ODDS_API_KEY');
if (!ODDS_API_KEY) throw new Error('ODDS_API_KEY secret not set');

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
