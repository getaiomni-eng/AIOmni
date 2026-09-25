// supabase/functions/player-status-sync/index.ts
//
// Mirrors Sleeper's injury and depth-chart state into Postgres so neither has
// to be re-fetched, and so depth charts finally have a history.
//
// WHY THIS EXISTS. None of this was stored. Answering "who is hurt" or "who is
// the TE2" meant pulling Sleeper's 5 MB player blob in a throwaway script, and
// correcting a wrong injury status meant editing a map in weekly-board and
// redeploying. Both are now a SQL query and a SQL insert.
//
// AND IT UNBLOCKS THE DEPTH MULTIPLIER. The engine's depth-chart block says
// "Disabled in backtest (depth chart not historical)", so its coefficients have
// never been measured -- and they are wrong by a wide margin. A team's TE2
// scores 44% of its TE1 in real 2025 production; the engine charges 0.98.
// Sleeper serves only the current depth chart with no history endpoint, so the
// weekly archive here is the only route to ever testing that number.
//
// TWO WRITES, TWO PURPOSES. nfl_player_status is upserted every run and is
// always current. nfl_player_status_weekly is written ONCE per week and never
// updated, so post-game news cannot rewrite what we knew before kickoff --
// the same rule ranking_snapshots follows, and for the same reason.
//
// IDS. Only 19% of rostered skill players carry a gsis_id in Sleeper's feed
// (Dalton Kincaid has none), so sleeper_id is the key and gsis_id is resolved
// by name+position against nfl_players. Position is part of that key because
// same-name collisions across positions are real and a name-only join has
// already put a linebacker's "Out" on Justin Jefferson.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SLEEPER = 'https://api.sleeper.app/v1/players/nfl';
const POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K']);

const norm = (s: unknown) =>
  String(s ?? '').toLowerCase().replace(/[.'’]/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '').replace(/\s+/g, ' ').trim();
const isSynth = (id: string) => /^\d{4}_pick_\d+$/.test(id);

async function sb(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', ...(init.headers ?? {}),
    },
  });
}

async function chunked(path: string, rows: any[], prefer: string) {
  let written = 0;
  for (let i = 0; i < rows.length; i += 250) {
    const slice = rows.slice(i, i + 250);
    const r = await sb(path, {
      method: 'POST', headers: { Prefer: prefer }, body: JSON.stringify(slice),
    });
    if (!r.ok) console.log('[status-sync] write failed:', r.status, (await r.text()).slice(0, 200));
    else written += slice.length;
  }
  return written;
}

Deno.serve(async (req) => {
  const started = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const season: number = Number(body?.season) || 2026;
    const week: number   = Number(body?.week)   || 0;

    const res = await fetch(SLEEPER);
    if (!res.ok) throw new Error(`sleeper ${res.status}`);
    const all = await res.json();

    // name+position -> gsis_id, preferring a real id over a synthetic draft pick.
    const idByKey = new Map<string, string>();
    for (let off = 0; off < 8000; off += 1000) {
      const r = await sb(`nfl_players?select=gsis_id,full_name,position&limit=1000&offset=${off}`);
      if (!r.ok) break;
      const page = await r.json();
      if (!Array.isArray(page) || page.length === 0) break;
      for (const p of page) {
        if (!p?.full_name || !p?.gsis_id || !p?.position) continue;
        const k = `${norm(p.full_name)}|${p.position}`;
        const prev = idByKey.get(k);
        if (!prev || (isSynth(prev) && !isSynth(p.gsis_id))) idByKey.set(k, p.gsis_id);
      }
      if (page.length < 1000) break;
    }

    // Rostered skill players only. Free agents have no depth chart and their
    // injury status is not a fantasy decision anyone is making.
    const current: any[] = [];
    let mapped = 0;
    for (const sid of Object.keys(all)) {
      const p = all[sid];
      if (!p?.position || !POSITIONS.has(p.position) || !p.team || !p.full_name) continue;
      // Sleeper pads some gsis ids with a leading space (" 00-0035229" for
      // Hockenson); 53 of 825 rows on 2026-09-24. Untrimmed, every exact-id
      // join silently misses the player.
      const gsis = String(p.gsis_id ?? '').trim() || idByKey.get(`${norm(p.full_name)}|${p.position}`) || null;
      if (gsis) mapped++;
      current.push({
        sleeper_id: String(sid), gsis_id: gsis,
        player_name: p.full_name, position: p.position, team: p.team,
        status: p.status ?? null,
        injury_status: p.injury_status ?? null,
        injury_body_part: p.injury_body_part ?? null,
        injury_notes: p.injury_notes ?? null,
        practice_participation: p.practice_participation ?? null,
        practice_description: p.practice_description ?? null,
        depth_chart_order: typeof p.depth_chart_order === 'number' ? p.depth_chart_order : null,
        depth_chart_position: p.depth_chart_position ?? null,
        active: p.active ?? null,
        years_exp: typeof p.years_exp === 'number' ? p.years_exp : null,
        updated_at: new Date().toISOString(),
      });
    }
    if (current.length === 0) throw new Error('sleeper returned no rostered skill players');

    const currentWritten = await chunked(
      'nfl_player_status?on_conflict=sleeper_id', current,
      'resolution=merge-duplicates,return=minimal');

    // Weekly archive: first capture of the week is the record.
    let weeklyWritten = 0;
    let weeklySkipped: string | null = null;
    if (week > 0) {
      const existing = await sb(
        `nfl_player_status_weekly?season=eq.${season}&week=eq.${week}&select=sleeper_id&limit=1`)
        .then(r => r.ok ? r.json() : []).catch(() => []);
      if (Array.isArray(existing) && existing.length > 0 && body?.force !== true) {
        weeklySkipped = 'already captured';
      } else {
        weeklyWritten = await chunked(
          'nfl_player_status_weekly?on_conflict=season,week,sleeper_id',
          current.map(c => ({
            season, week, sleeper_id: c.sleeper_id, gsis_id: c.gsis_id,
            player_name: c.player_name, position: c.position, team: c.team,
            status: c.status, injury_status: c.injury_status,
            injury_body_part: c.injury_body_part,
            practice_participation: c.practice_participation,
            depth_chart_order: c.depth_chart_order,
            depth_chart_position: c.depth_chart_position,
          })),
          'resolution=merge-duplicates,return=minimal');
      }
    }

    return new Response(JSON.stringify({
      ok: true, season, week,
      players: current.length, gsis_mapped: mapped,
      injured: current.filter(c => c.injury_status).length,
      with_depth: current.filter(c => c.depth_chart_order != null).length,
      current_written: currentWritten,
      weekly_written: weeklyWritten, weekly_skipped: weeklySkipped,
      duration_seconds: Math.round((Date.now() - started) / 1000),
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
