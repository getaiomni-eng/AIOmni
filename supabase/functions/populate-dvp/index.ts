// supabase/functions/populate-dvp/index.ts
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
