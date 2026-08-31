// supabase/functions/player-lookup/index.ts
// Returns compiled player intelligence for AI Coach prompt injection

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { players, position, team } = await req.json();

    // player_profiles holds one row per player per season. Without this the
    // query mixes seasons and returns the same player twice, so resolve the
    // newest season present and pin the lookup to it.
    const { data: latest } = await supabase
      .from('player_profiles')
      .select('season')
      .order('season', { ascending: false })
      .limit(1)
      .maybeSingle();
    const season: number | null = latest?.season ?? null;

    let query = supabase
      .from('player_profiles')
      .select('*')
      .order('total_points', { ascending: false });

    if (season !== null) query = query.eq('season', season);

    // Look up specific players by name
    if (players && players.length > 0) {
      // Search by name fragments
      const nameFilters = players.map((n: string) =>
        `name.ilike.%${n}%`
      ).join(',');
      query = query.or(nameFilters);
    }

    // Filter by position
    if (position) {
      query = query.eq('position', position.toUpperCase());
    }

    // Filter by team
    if (team) {
      query = query.eq('team', team.toUpperCase());
    }

    // Limit results
    query = query.limit(players?.length > 0 ? 20 : 50);

    const { data, error } = await query;
    if (error) throw error;

    // Format as readable AI prompt context
    const formatted = formatForPrompt(data || [], season);

    return new Response(
      JSON.stringify({ players: data, formatted }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});

function formatForPrompt(players: any[], season: number | null): string {
  if (!players.length) return '';

  const lines = players.map(p => {
    const pos = p.position;
    let statLine = '';

    if (pos === 'QB') {
      statLine = `${p.passing_yards} pass yds, ${p.passing_tds} TDs, ${p.interceptions} INTs`;
    } else if (pos === 'RB') {
      statLine = `${p.carries} car/${p.rush_yards} rush yds/${p.rush_tds} TDs, ${p.targets} tgts/${p.receptions} rec/${p.rec_yards} rec yds`;
    } else if (pos === 'WR' || pos === 'TE') {
      statLine = `${p.targets} tgts/${p.receptions} rec/${p.rec_yards} yds/${p.rec_tds} TDs, ${p.target_share}% target share`;
    }

    const snap  = p.snap_pct ? `, ${p.snap_pct}% snaps` : '';
    const dynVal = p.dynasty_value ? `, Dynasty Value: ${p.dynasty_value}/100` : '';

    const age = p.age ? `, Age ${p.age}` : '';
    return `${p.name} (${p.position}, ${p.team}${age}): ${p.games} games, ${p.total_points} PPR pts — ${statLine}${snap}${dynVal}`;
  });

  const label = season ? `${season} season` : 'season unknown';
  return `\nPLAYER INTELLIGENCE (${players.length} players, ${label}):\n${lines.join('\n')}`;
}
