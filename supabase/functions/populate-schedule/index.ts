// supabase/functions/populate-schedule/index.ts
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

    let insertErrors: string[] = [];
    if (rows.length > 0) {
      // Wipe + insert this season
      await supabase.from('nfl_schedule').delete().eq('season', season);
      const CHUNK = 100;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await supabase
          .from('nfl_schedule')
          .insert(rows.slice(i, i + CHUNK));
        if (error) {
          console.error('insert error:', error);
          insertErrors.push(error.message ?? String(error));
        }
      }
    }

    // Verify: count actual rows in DB after insert (service-role bypasses RLS)
    const { count: dbCount, error: countErr } = await supabase
      .from('nfl_schedule')
      .select('*', { count: 'exact', head: true })
      .eq('season', season);

    const duration = Math.round((Date.now() - startedAt) / 1000);
    return new Response(JSON.stringify({
      ok: true,
      season,
      rows_attempted: rows.length,
      db_rows_after: dbCount,
      insert_errors: insertErrors,
      count_error: countErr?.message ?? null,
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
