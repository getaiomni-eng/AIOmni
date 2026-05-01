#!/usr/bin/env python3
"""
AIOmni Phase 3 Chunk 3.1 hotfix.

Bug: engine returned 0 rows for every format despite 19,399 rows of
2025 stats in the table. Root cause: PostgREST default row limit is
1000. The engine\\'s .select() on nfl_weekly_stats was returning only
the first 1000 rows out of 19,399. Players whose weekly rows fell
outside that slice had games_played < 4 and were skipped, leaving
zero scorable players.

Fix: paginate the weekly stats fetch in 1000-row chunks. Same pattern
nflPlayers.ts already uses for getAllActivePlayers.

Also: emit per-step diagnostic stats so future failures surface.

Run from AIOmni repo root:
    python3 scripts/phase3_chunk1_hotfix.py
"""
from pathlib import Path
import sys

ROOT = Path('.')
ENGINE = ROOT / 'supabase' / 'functions' / 'aiomni-rankings-engine' / 'index.ts'

if not ENGINE.exists():
    print(f'[ERROR]    {ENGINE} not found.')
    sys.exit(1)

s = ENGINE.read_text()
orig = s

# ── Replace the simple weekly stats fetch with a paginated version ──

old_fetch = """  // 2. Pull 2025 weekly stats (full season + playoffs)
  const { data: weekly2025, error: wErr } = await supabase
    .from('nfl_weekly_stats')
    .select(`gsis_id, week, team, ${ptsCol}, targets, carries`)
    .eq('season', 2025)
    .eq('season_type', 'REG');
  if (wErr) throw wErr;"""

new_fetch = """  // 2. Pull 2025 weekly stats (full season + playoffs).
  // PostgREST defaults to 1000-row max -- we have ~19k rows for 2025.
  // Paginate in chunks of 1000 to get the full set.
  const weekly2025: any[] = [];
  const CHUNK = 1000;
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('nfl_weekly_stats')
      .select(`gsis_id, week, team, ${ptsCol}, targets, carries`)
      .eq('season', 2025)
      .eq('season_type', 'REG')
      .order('gsis_id', { ascending: true })
      .order('week', { ascending: true })
      .range(offset, offset + CHUNK - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    weekly2025.push(...data);
    if (data.length < CHUNK) break;
    offset += CHUNK;
    if (offset > 50000) break; // safety net against runaway loop
  }"""

if old_fetch in s:
    s = s.replace(old_fetch, new_fetch)
    print('[APPLIED]  paginated 2025 weekly stats fetch (was capped at 1000 rows)')
else:
    print('[ERROR]    could not locate old fetch block in engine')
    sys.exit(1)

# ── Add diagnostic stats to the response ──
# After the stats build, add per-format row count + baseline pool size
# so we can see exactly where the pipeline drops players.

old_stats_init = """    const formats: Format[] = ['PPR', 'HALF', 'STD', 'SF', 'DYN'];
    const stats: any = { formats: {}, errors: [] };"""

new_stats_init = """    const formats: Format[] = ['PPR', 'HALF', 'STD', 'SF', 'DYN'];
    const stats: any = { formats: {}, diagnostics: {}, errors: [] };"""

if old_stats_init in s:
    s = s.replace(old_stats_init, new_stats_init)
    print('[APPLIED]  added diagnostics container to response')

# Inject diagnostic emission inside buildFormat. Add a return-shape
# extension by exposing a signal once per format run. Simplest: write
# directly to stats from the serve handler via a shared closure.
# To avoid restructuring, we instead emit console.log lines that can
# be inspected via supabase functions logs.

# Find the place where we sort scored and add log lines just before that.
old_sort_marker = """  // 6. Sort by score, apply FLOOR PROTECTION pass
  scored.sort((a, b) => b.score - a.score);"""

new_sort_marker = """  // Diagnostic: log pool sizes per format so empty results have a
  // breadcrumb trail in supabase functions logs.
  console.log(`[${format}] active players: ${players?.length ?? 0}`);
  console.log(`[${format}] weekly rows fetched: ${(weekly2025 ?? []).length}`);
  console.log(`[${format}] baseline players (>=4 games): ${baselineMap.size}`);
  console.log(`[${format}] scored players before sort: ${scored.length}`);

  // 6. Sort by score, apply FLOOR PROTECTION pass
  scored.sort((a, b) => b.score - a.score);"""

if old_sort_marker in s:
    s = s.replace(old_sort_marker, new_sort_marker)
    print('[APPLIED]  added per-format diagnostic logs (visible in supabase functions logs)')

if s != orig:
    ENGINE.write_text(s)
    print()
    print('Done. Redeploy + retrigger:')
    print('  supabase functions deploy aiomni-rankings-engine')
    print('  curl -X POST "https://khoruzvsprxyocisuhet.supabase.co/functions/v1/aiomni-rankings-engine" \\')
    print('       -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN"')
    print()
    print('Expected: ~30-60s runtime (was 2s), counts of ~250 per format.')
    print('If still 0, check logs:')
    print('  supabase functions logs aiomni-rankings-engine --tail 100')
else:
    print('[SKIP]     no changes (already patched?)')
