// supabase/functions/nflverse-daily-sync/index.ts
// ───────────────────────────────────────────────────────────
// Pulls canonical NFL player data from nflverse GitHub releases.
// Runs daily (via pg_cron) to keep rosters, injury status, and
// cross-platform IDs fresh.
//
// Data sources (all free, all public):
//   - rosters.csv        → current rosters with status, team, jersey
//   - ff_playerids.csv   → joins gsis_id ↔ sleeper/espn/yahoo IDs
//
// Can be invoked manually:
//   curl -X POST https://khoruzvsprxyocisuhet.supabase.co/functions/v1/nflverse-daily-sync \
//        -H "Authorization: Bearer $SERVICE_ROLE_KEY"

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE  = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CURRENT_SEASON = new Date().getFullYear();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// nflverse publishes current-season data at stable GitHub release URLs
const NFLVERSE_ROSTERS = `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${CURRENT_SEASON}.csv`;
const NFLVERSE_ROSTERS_LAST_YEAR = `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${CURRENT_SEASON - 1}.csv`;
// DynastyProcess maintains the cross-platform ID map (sleeper/espn/yahoo → gsis)
const NFLVERSE_PLAYER_IDS = 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv';

// ─── CSV PARSER ─────────────────────────────────────────────
// Minimal RFC-4180 parser (handles quoted fields with embedded commas/newlines)
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
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
  const text = await res.text();
  return parseCSV(text);
}

// ─── COERCE HELPERS ─────────────────────────────────────────
const s = (v: string | undefined): string | null => (v && v !== 'NA' && v !== '') ? v : null;
const n = (v: string | undefined): number | null => {
  if (!v || v === 'NA' || v === '') return null;
  const parsed = parseFloat(v);
  return isNaN(parsed) ? null : parsed;
};
const i = (v: string | undefined): number | null => {
  const val = n(v);
  return val !== null ? Math.round(val) : null;
};
const b = (v: string | undefined): boolean => v === 'TRUE' || v === 'true' || v === '1';

// Calculate age from birth date
function calcAge(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const bd = new Date(birthDate);
  if (isNaN(bd.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - bd.getFullYear();
  const m = now.getMonth() - bd.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < bd.getDate())) age--;
  return age;
}

// Map nflverse status codes to our is_active/is_retired flags
function parseStatus(status: string | null): { is_active: boolean; is_retired: boolean } {
  if (!status) return { is_active: false, is_retired: false };
  const upper = status.toUpperCase();
  // ACT = active on roster, DEV = practice squad, RES = reserve (IR/PUP/etc), CUT = released
  if (upper === 'ACT' || upper === 'DEV') return { is_active: true, is_retired: false };
  if (upper === 'RET' || upper === 'RETIRED') return { is_active: false, is_retired: true };
  return { is_active: false, is_retired: false }; // IR, PUP, SUS, CUT, TRD all treated as inactive
}

// ─── MAIN SYNC ──────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const startedAt = Date.now();
    const stats = { rosters: 0, ids_joined: 0, inserted: 0, updated: 0, errors: [] as string[] };

    // ── 1. Fetch rosters — try current season first, fall back to last year ──
    let rosters: Record<string, string>[] = [];
    try {
      rosters = await fetchCSV(NFLVERSE_ROSTERS);
    } catch (e) {
      console.log('Current season rosters not available yet, using last year:', e);
      rosters = await fetchCSV(NFLVERSE_ROSTERS_LAST_YEAR);
    }
    stats.rosters = rosters.length;
    console.log(`Fetched ${rosters.length} roster rows`);

    // ── 2. Fetch cross-platform ID map ──
    const playerIds = await fetchCSV(NFLVERSE_PLAYER_IDS);
    stats.ids_joined = playerIds.length;
    console.log(`Fetched ${playerIds.length} player ID mappings`);

    // Build lookup: gsis_id → platform IDs
    const idMap = new Map<string, Record<string, string>>();
    for (const row of playerIds) {
      const gsis = row.gsis_id;
      if (gsis) idMap.set(gsis, row);
    }

    // ── 3. Merge rosters with platform IDs ──
    const players = rosters.map(r => {
      const gsis = r.gsis_id;
      const ids = gsis ? idMap.get(gsis) ?? {} : {};
      const statusInfo = parseStatus(s(r.status));

      return {
        gsis_id:        s(gsis),
        pfr_id:         s(r.pfr_id),
        first_name:     s(r.first_name) ?? '',
        last_name:      s(r.last_name) ?? '',
        full_name:      s(r.full_name) ?? `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim(),
        display_name:   s(r.football_name) ?? s(r.full_name),
        position:       s(r.position),
        position_group: s(r.depth_chart_position),
        team:           s(r.team),
        jersey_number:  i(r.jersey_number),
        height:         s(r.height),
        weight:         i(r.weight),
        age:            calcAge(s(r.birth_date)) ?? i(r.age),
        birth_date:     s(r.birth_date),
        years_exp:      i(r.years_exp),
        rookie_year:    i(r.rookie_year),
        college:        s(r.college),
        draft_year:     i(r.entry_year),
        draft_round: i(r.draft_round),
        draft_pick: i(r.draft_pick),
        draft_team:     s(r.draft_club),
        status:         s(r.status),
        status_desc:    s(r.status_description_abbr),
        is_active:      statusInfo.is_active,
        is_retired:     statusInfo.is_retired,
        sleeper_id:     s(ids.sleeper_id),
        espn_id:        s(ids.espn_id),
        yahoo_id:       s(ids.yahoo_id),
        fantasypros_id: s(ids.fantasypros_id),
        rotowire_id:    s(ids.rotowire_id),
        sportradar_id:  s(ids.sportradar_id),
        last_synced_at: new Date().toISOString(),
      };
    }).filter(p => p.gsis_id && p.full_name);

    console.log(`Prepared ${players.length} player records for upsert`);

    // ── 4. Upsert in chunks of 500 (Supabase request size limit) ──
    const CHUNK = 500;
    for (let c = 0; c < players.length; c += CHUNK) {
      const batch = players.slice(c, c + CHUNK);
      const { error } = await supabase
        .from('nfl_players')
        .upsert(batch, { onConflict: 'gsis_id', ignoreDuplicates: false });

      if (error) {
        console.error(`Upsert batch ${c}-${c+CHUNK} failed:`, error);
        stats.errors.push(`Chunk ${c}: ${error.message}`);
      } else {
        stats.inserted += batch.length;
      }
    }

    // ── 5. Mark players NOT in current roster as retired/inactive ──
    // Anyone in our table whose gsis_id didn't appear in today's roster fetch
    // AND who hasn't been synced today = likely off-roster.
    const currentIds = players.map(p => p.gsis_id).filter(Boolean);
    const todayISO = new Date(Date.now() - 2 * 3600 * 1000).toISOString(); // 2hr grace
    const { error: markErr } = await supabase
      .from('nfl_players')
      .update({ is_active: false })
      .lt('last_synced_at', todayISO)
      .eq('is_retired', false);
    if (markErr) stats.errors.push(`Mark-inactive: ${markErr.message}`);

    const duration = Math.round((Date.now() - startedAt) / 1000);
    console.log(`Sync complete in ${duration}s. Stats:`, stats);

    return new Response(JSON.stringify({
      ok: true,
      duration_seconds: duration,
      stats,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('Sync error:', err);
    return new Response(JSON.stringify({
      ok: false,
      error: err.message ?? String(err),
    }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
