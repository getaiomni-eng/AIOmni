// One-off backfill: nfl_players is sourced from nflverse ROSTERS, which carry no
// draft capital. nflverse publishes draft picks separately (draft_picks.csv).
// Many players (esp. 2023-2025 rookies) have draft_round/draft_pick = NULL, which
// silently zeroes the engine's rookie draft-capital boost (and made the backtest
// project Ashton Jeanty — the #6 pick — at RB78). This fills the gaps from the
// canonical nflverse draft_picks dataset, matched by gsis_id, without touching
// any other columns.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DRAFT_URL = 'https://github.com/nflverse/nflverse-data/releases/download/draft_picks/draft_picks.csv';

serve(async () => {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 1. Load draft picks (1+ recent years) → gsis_id → {round, pick}
    const csv = await (await fetch(DRAFT_URL)).text();
    const lines = csv.split('\n');
    const hdr = lines[0].split(',');
    const iS = hdr.indexOf('season'), iR = hdr.indexOf('round'), iP = hdr.indexOf('pick'), iG = hdr.indexOf('gsis_id');
    const picks: Record<string, { round: number; pick: number }> = {};
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(',');
      const gid = c[iG];
      const season = parseInt(c[iS]);
      const round = parseInt(c[iR]);
      const pick = parseInt(c[iP]);
      if (!gid || !round || !(season >= 2018)) continue;
      picks[gid] = { round, pick: pick || (round * 32 - 16) };
    }

    // 2. Find nfl_players with NULL draft_round (the gaps) — recent draft years
    const gaps: { gsis_id: string }[] = [];
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('nfl_players')
        .select('gsis_id')
        .is('draft_round', null)
        .gte('draft_year', 2018)
        .range(from, from + 999);
      if (error) throw error;
      if (!data || !data.length) break;
      gaps.push(...data);
      if (data.length < 1000) break;
      from += 1000;
    }

    // 3. Build update rows for the matched gaps, upsert in chunks (only these
    // columns → ON CONFLICT updates draft_round/pick, leaves everything else).
    const rows = gaps
      .filter(g => picks[g.gsis_id])
      .map(g => ({ gsis_id: g.gsis_id, draft_round: picks[g.gsis_id].round, draft_pick: picks[g.gsis_id].pick }));

    let updated = 0;
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK);
      const { error } = await supabase.from('nfl_players').upsert(batch, { onConflict: 'gsis_id' });
      if (error) throw error;
      updated += batch.length;
    }

    return new Response(JSON.stringify({
      ok: true,
      draftPicksLoaded: Object.keys(picks).length,
      nullDraftPlayers: gaps.length,
      backfilled: updated,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
