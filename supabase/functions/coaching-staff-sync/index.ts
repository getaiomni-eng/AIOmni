// supabase/functions/coaching-staff-sync/index.ts
// ───────────────────────────────────────────────────────────
// Daily sync of NFL head coaches per team from ESPN's core API.
// Iterates 32 teams, fetches the team's HC for the given season,
// writes to nfl_coaching_staff. Detects new hires by comparing
// current season HC vs previous season HC for each team.
//
// Note: ESPN core only exposes head coaches, not OCs/DCs. For OC/DC
// changes you still need manual updates to COACHING_CHANGES_2026's
// `desc` field. But HCs are the most volatile/impactful piece.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ESPN team ID → our canonical 3-letter abbr
const ESPN_TEAM_ID_TO_ABBR: Record<string, string> = {
  '22': 'ARI', '1': 'ATL', '33': 'BAL', '2': 'BUF', '29': 'CAR',
  '3': 'CHI', '4': 'CIN', '5': 'CLE', '6': 'DAL', '7': 'DEN',
  '8': 'DET', '9': 'GB',  '34': 'HOU', '11': 'IND', '30': 'JAX',
  '12': 'KC', '13': 'LV', '24': 'LAC', '14': 'LAR', '15': 'MIA',
  '16': 'MIN', '17': 'NE', '18': 'NO', '19': 'NYG', '20': 'NYJ',
  '21': 'PHI', '23': 'PIT', '25': 'SF', '26': 'SEA', '27': 'TB',
  '10': 'TEN', '28': 'WAS',
};

async function fetchJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: { 'User-Agent': 'AIOmni/1.0' } });
  if (!r.ok) throw new Error(`fetch ${url} ${r.status}`);
  return r.json();
}

async function fetchTeamHc(teamId: string, season: number): Promise<{
  name: string; espnId: string;
} | null> {
  const list = await fetchJson(
    `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/teams/${teamId}/coaches`
  );
  const ref = list.items?.[0]?.$ref;
  if (!ref) return null;
  const coach = await fetchJson(ref);
  return {
    name: `${coach.firstName ?? ''} ${coach.lastName ?? ''}`.trim(),
    espnId: String(coach.id ?? ''),
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const started = Date.now();
    const url = new URL(req.url);
    const season = Number(url.searchParams.get('season') ?? '2026');
    const prevSeason = season - 1;

    // ESPN's historical coach data is broken (returns current HC for all
    // past seasons too). Detect changes by diffing against our previous DB
    // state — store every sync; if HC espnId differs from last sync, flag.
    const { data: existing, error: exErr } = await supabase
      .from('nfl_coaching_staff')
      .select('team, hc_espn_id, hc_name')
      .eq('season', season);
    if (exErr) throw exErr;
    const existingByTeam = new Map<string, { hc_espn_id: string; hc_name: string }>();
    for (const r of (existing ?? [])) {
      existingByTeam.set(r.team, { hc_espn_id: r.hc_espn_id ?? '', hc_name: r.hc_name ?? '' });
    }

    const rows: Array<{
      team: string; season: number; hc_name: string; hc_espn_id: string;
      hc_first_year_with_team: boolean; last_synced_at: string;
    }> = [];
    const newHires: Array<{ team: string; hc: string; prev_hc: string }> = [];
    const failures: string[] = [];

    for (const [teamId, abbr] of Object.entries(ESPN_TEAM_ID_TO_ABBR)) {
      try {
        const cur = await fetchTeamHc(teamId, season);
        if (!cur) {
          failures.push(`${abbr} (${teamId}): no current HC`);
          continue;
        }
        const prevRecord = existingByTeam.get(abbr);
        const newHire = !!(prevRecord && prevRecord.hc_espn_id && prevRecord.hc_espn_id !== cur.espnId);
        if (newHire) {
          newHires.push({
            team: abbr,
            hc: cur.name,
            prev_hc: prevRecord?.hc_name ?? '(unknown)',
          });
        }
        rows.push({
          team: abbr,
          season,
          hc_name: cur.name,
          hc_espn_id: cur.espnId,
          // Preserve flag from prior record unless we detected a change now
          hc_first_year_with_team: newHire || (prevRecord ? false : true),
          last_synced_at: new Date().toISOString(),
        });
      } catch (e) {
        failures.push(`${abbr} (${teamId}): ${(e as Error).message}`);
      }
    }

    const { error: upErr } = await supabase
      .from('nfl_coaching_staff')
      .upsert(rows, { onConflict: 'team,season' });
    if (upErr) throw upErr;

    return new Response(JSON.stringify({
      ok: true,
      duration_seconds: Math.round((Date.now() - started) / 1000),
      season,
      total_teams: rows.length,
      new_hires_count: newHires.length,
      new_hires: newHires,
      failures,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('coaching-staff-sync error:', err);
    return new Response(JSON.stringify({ ok: false, error: err.message ?? String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
