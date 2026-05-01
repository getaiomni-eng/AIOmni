#!/usr/bin/env python3
"""
AIOmni: expose MFL + KeepTradeCut as visible base rankings sources.

After Phase 2, MFL + KTC are powering the dynasty blend internally but
they're not in the BASE_SOURCES picker, so users can't select them
directly. This patch:

  1. Adds 'mfl' and 'fleaflicker' (= KTC under the hood) entries to
     the BASE_SOURCES array in app/(tabs)/rankings.tsx so they appear
     in the "CHOOSE YOUR BASE RANKINGS" modal.

  2. Adds case handlers for 'mfl' and 'fleaflicker' in fetchBaseRankings
     in services/rankingsData.ts so picking them dispatches to the new
     proxy fetchers instead of falling through to the Sleeper default.

The RankingsSource union type already includes 'mfl' and 'fleaflicker'
from Phase 1, so no type changes needed.

Run from AIOmni repo root:
    python3 scripts/expose_mfl_ktc_sources.py
"""
from pathlib import Path
import sys

ROOT = Path('.')
TSX  = ROOT / 'app' / '(tabs)' / 'rankings.tsx'
DATA = ROOT / 'services' / 'rankingsData.ts'

for p in (TSX, DATA):
    if not p.exists():
        print(f'[ERROR]    {p} not found.')
        print('           Run from AIOmni repo root.')
        sys.exit(1)

applied = []

# ═══════════════════════════════════════════════════════════════════════
# PATCH 1: Add MFL + KTC to BASE_SOURCES in rankings.tsx
# ═══════════════════════════════════════════════════════════════════════

s = TSX.read_text()
orig = s

old_sources = """const BASE_SOURCES: { key: RankingsSource; label: string; sub: string; color: string }[] = [
  { key: 'aiomni', label: 'AIOmni AI Rankings', sub: 'AI-synthesized from all sources', color: '#6eeb83' },
  { key: 'sleeper', label: 'Sleeper ADP', sub: 'Based on Sleeper draft data', color: '#00FFF9' },
  { key: 'espn', label: 'ESPN ADP', sub: 'Based on ESPN draft data', color: '#e52534' },
  { key: 'yahoo', label: 'Yahoo ADP', sub: 'Requires Yahoo connection', color: '#7c3aed' },
  { key: 'nfl', label: 'NFL.com', sub: 'Official NFL rankings', color: palette.aqua },
];"""

new_sources = """const BASE_SOURCES: { key: RankingsSource; label: string; sub: string; color: string }[] = [
  { key: 'aiomni', label: 'AIOmni AI Rankings', sub: 'AI-synthesized from all sources', color: '#6eeb83' },
  { key: 'sleeper', label: 'Sleeper ADP', sub: 'Based on Sleeper draft data', color: '#00FFF9' },
  { key: 'espn', label: 'ESPN ADP', sub: 'Based on ESPN draft data', color: '#e52534' },
  { key: 'yahoo', label: 'Yahoo ADP', sub: 'Requires Yahoo connection', color: '#7c3aed' },
  { key: 'mfl', label: 'MFL ADP', sub: 'MyFantasyLeague consensus', color: '#f59e0b' },
  { key: 'fleaflicker', label: 'KeepTradeCut', sub: 'Dynasty community gold standard', color: '#ec4899' },
  { key: 'nfl', label: 'NFL.com', sub: 'Official NFL rankings', color: palette.aqua },
];"""

if old_sources in s:
    s = s.replace(old_sources, new_sources)
    applied.append('rankings.tsx: added MFL + KeepTradeCut to BASE_SOURCES')

if s != orig:
    TSX.write_text(s)

# ═══════════════════════════════════════════════════════════════════════
# PATCH 2: Add case handlers in fetchBaseRankings
# ═══════════════════════════════════════════════════════════════════════

s = DATA.read_text()
orig = s

old_dispatcher = """export async function fetchBaseRankings(
  source: RankingsSource,
  leagueType: LeagueType = 'redraft',
  scoringRules: ScoringRules = 'ppr',
): Promise<RankedPlayer[]> {
  switch (source) {
    case 'sleeper':     return fetchSleeperADP();
    case 'espn':        return fetchESPNADP();
    case 'yahoo':       return fetchYahooADP();
    case 'fantasypros': return fetchBlendedConsensus(leagueType, scoringRules);
    case 'nfl':         return fetchBlendedConsensus(leagueType, scoringRules);
    case 'aiomni':      return fetchBlendedConsensus(leagueType, scoringRules);
    default:            return fetchSleeperADP();
  }
}"""

new_dispatcher = """export async function fetchBaseRankings(
  source: RankingsSource,
  leagueType: LeagueType = 'redraft',
  scoringRules: ScoringRules = 'ppr',
): Promise<RankedPlayer[]> {
  switch (source) {
    case 'sleeper':     return fetchSleeperADP();
    case 'espn':        return fetchESPNADP();
    case 'yahoo':       return fetchYahooADP();
    case 'mfl':         return fetchMFLADP(leagueType, scoringRules);
    case 'fleaflicker': return fetchFleaflickerADP(leagueType, scoringRules);
    case 'fantasypros': return fetchBlendedConsensus(leagueType, scoringRules);
    case 'nfl':         return fetchBlendedConsensus(leagueType, scoringRules);
    case 'aiomni':      return fetchBlendedConsensus(leagueType, scoringRules);
    default:            return fetchSleeperADP();
  }
}"""

if old_dispatcher in s:
    s = s.replace(old_dispatcher, new_dispatcher)
    applied.append('rankingsData.ts: fetchBaseRankings dispatches to MFL + Fleaflicker')

if s != orig:
    DATA.write_text(s)

# ═══════════════════════════════════════════════════════════════════════

if applied:
    for a in applied:
        print(f'[APPLIED]  {a}')
    print(f'\\nDone. {len(applied)} change(s).')
    print('Next: npx tsc --noEmit')
else:
    print('[SKIP]     no changes (already patched?)')
