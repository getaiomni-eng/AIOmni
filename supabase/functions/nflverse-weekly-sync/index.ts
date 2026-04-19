import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let i = 0, field = '', row: string[] = [], inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i+1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQuotes = false; i++; continue; }
      field += c; i++;
    } else {
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1)
    .filter(r => r.length === headers.length && r.some(v => v.length > 0))
    .map(r => Object.fromEntries(headers.map((h, idx) => [h, r[idx]])));
}

async function fetchCSV(url: string): Promise<Record<string, string>[]> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
  return parseCSV(await res.text());
}

const s = (v: string | undefined): string | null => (v && v !== 'NA' && v !== '') ? v : null;
const num = (v: string | undefined): number | null => {
  if (!v || v === 'NA' || v === '') return null;
  const p = parseFloat(v);
  return isNaN(p) ? null : p;
};
const int = (v: string | undefined): number => {
  const val = num(v);
  return val !== null ? Math.round(val) : 0;
};

// Field accessor with fallback: try new name, fall back to old name
const field = (r: Record<string, string>, ...names: string[]): string | undefined => {
  for (const n of names) {
    if (r[n] !== undefined && r[n] !== '') return r[n];
  }
  return undefined;
};

function calcFantasyPoints(r: Record<string, string>) {
  const passYds = Number(field(r, 'passing_yards')) || 0;
  const passTds = Number(field(r, 'passing_tds')) || 0;
  const ints    = Number(field(r, 'passing_interceptions', 'interceptions')) || 0;
  const rushYds = Number(field(r, 'rushing_yards')) || 0;
  const rushTds = Number(field(r, 'rushing_tds')) || 0;
  const rushFum = Number(field(r, 'rushing_fumbles_lost')) || 0;
  const recs    = Number(field(r, 'receptions')) || 0;
  const recYds  = Number(field(r, 'receiving_yards')) || 0;
  const recTds  = Number(field(r, 'receiving_tds')) || 0;
  const recFum  = Number(field(r, 'receiving_fumbles_lost')) || 0;
  const pass2pt = Number(field(r, 'passing_2pt_conversions')) || 0;
  const rush2pt = Number(field(r, 'rushing_2pt_conversions')) || 0;
  const rec2pt  = Number(field(r, 'receiving_2pt_conversions')) || 0;
  const ret_tds = Number(field(r, 'special_teams_tds')) || 0;

  const std =
    (passYds / 25) + (passTds * 4) + (ints * -2) +
    (rushYds / 10) + (rushTds * 6) + (rushFum * -2) +
    (recYds / 10) + (recTds * 6) + (recFum * -2) +
    (pass2pt * 2) + (rush2pt * 2) + (rec2pt * 2) + (ret_tds * 6);

  return {
    fantasy_pts_std:  Math.round(std * 10) / 10,
    fantasy_pts_half: Math.round((std + recs * 0.5) * 10) / 10,
    fantasy_pts_ppr:  Math.round((std + recs) * 10) / 10,
  };
}

// Season-specific URL resolver. 2014-2024 live under player_stats tag with old schema.
// 2025+ lives under stats_player tag with v2 schema.
function urlsForSeason(season: number): string[] {
  if (season >= 2025) {
    return [
      `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`,
    ];
  }
  return [
    `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_${season}.csv`,
    `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`,
  ];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const url = new URL(req.url);
    const latestOnly = url.searchParams.get('latest') === 'true';
    const seasonsParam = url.searchParams.get('seasons');

    const currentYear = new Date().getFullYear();
    const seasons = seasonsParam
      ? seasonsParam.split(',').map(s => parseInt(s.trim()))
      : latestOnly ? [currentYear - 1] : [2024, 2025];

    const startedAt = Date.now();
    const stats = { seasons_processed: seasons, rows_fetched: 0, rows_inserted: 0, errors: [] as string[] };

    for (const season of seasons) {
      const candidates = urlsForSeason(season);
      let rows: Record<string, string>[] = [];
      let workingUrl = '';

      for (const tryUrl of candidates) {
        try {
          console.log(`Trying ${tryUrl}`);
          rows = await fetchCSV(tryUrl);
          if (rows.length > 0) {
            workingUrl = tryUrl;
            console.log(`SUCCESS: ${tryUrl} (${rows.length} rows)`);
            break;
          }
        } catch (e: any) {
          console.log(`  miss: ${e.message}`);
        }
      }

      if (!workingUrl) {
        stats.errors.push(`${season}: no working URL`);
        continue;
      }

      stats.rows_fetched += rows.length;

      const records = rows
        .filter(r => field(r, 'player_id') && field(r, 'season_type') && field(r, 'week'))
        .map(r => {
          const pts = calcFantasyPoints(r);
          return {
            gsis_id:        s(field(r, 'player_id')),
            season:         int(field(r, 'season')),
            week:           int(field(r, 'week')),
            season_type:    s(field(r, 'season_type')) ?? 'REG',
            team:           s(field(r, 'team', 'recent_team')),
            opponent:       s(field(r, 'opponent_team', 'opponent')),

            completions:   int(field(r, 'completions')),
            attempts:      int(field(r, 'attempts')),
            passing_yards: int(field(r, 'passing_yards')),
            passing_tds:   int(field(r, 'passing_tds')),
            interceptions: int(field(r, 'passing_interceptions', 'interceptions')),
            sacks:         num(field(r, 'sacks_suffered', 'sacks')),
            passing_epa:   num(field(r, 'passing_epa')),

            carries:       int(field(r, 'carries')),
            rushing_yards: int(field(r, 'rushing_yards')),
            rushing_tds:   int(field(r, 'rushing_tds')),
            rushing_fumbles_lost: int(field(r, 'rushing_fumbles_lost')),
            rushing_epa:   num(field(r, 'rushing_epa')),

            targets:         int(field(r, 'targets')),
            receptions:      int(field(r, 'receptions')),
            receiving_yards: int(field(r, 'receiving_yards')),
            receiving_tds:   int(field(r, 'receiving_tds')),
            receiving_fumbles_lost: int(field(r, 'receiving_fumbles_lost')),
            receiving_air_yards:  int(field(r, 'receiving_air_yards')),
            receiving_yards_after_catch: int(field(r, 'receiving_yards_after_catch')),
            receiving_first_downs: int(field(r, 'receiving_first_downs')),
            receiving_epa:   num(field(r, 'receiving_epa')),
            target_share:    num(field(r, 'target_share')),
            air_yards_share: num(field(r, 'air_yards_share')),
            wopr:            num(field(r, 'wopr')),

            ...pts,
          };
        })
        .filter(rec => rec.gsis_id);

      const CHUNK = 500;
      for (let c = 0; c < records.length; c += CHUNK) {
        const batch = records.slice(c, c + CHUNK);
        const { error } = await supabase
          .from('nfl_weekly_stats')
          .upsert(batch, { onConflict: 'gsis_id,season,week,season_type' });

        if (error) {
          console.error(`Season ${season} batch ${c}:`, error);
          stats.errors.push(`${season} chunk ${c}: ${error.message}`);
        } else {
          stats.rows_inserted += batch.length;
        }
      }
    }

    const duration = Math.round((Date.now() - startedAt) / 1000);
    console.log(`Weekly sync complete in ${duration}s`, stats);

    return new Response(JSON.stringify({
      ok: true,
      duration_seconds: duration,
      stats,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('Weekly sync error:', err);
    return new Response(JSON.stringify({
      ok: false,
      error: err.message ?? String(err),
    }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
