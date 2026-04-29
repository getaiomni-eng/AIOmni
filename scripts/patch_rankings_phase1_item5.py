#!/usr/bin/env python3
"""
AIOmni Phase 1 Item 5 — wire leagueType through the engine bridge.

Updates three files so the user's redraft/dynasty selection actually
flows into the blended-consensus call (which in Piece 1 was added but
nothing was passing the param through). Without this patch, picking
'dynasty' in the UI changed the toggle visually but rankings were
still being computed with redraft source weights.

Files modified:
  1. services/rankingsData.ts
       - fetchBaseRankings now accepts (leagueType, scoringRules)
         and passes them to fetchBlendedConsensus for aiomni/nfl/
         fantasypros sources.

  2. services/rankings/aiomniEngineBridge.ts
       - LeagueType + ScoringRules imported from rankingsData
       - uiFormatToConfig accepts leagueType (dynasty -> DYNASTY_PPR preset)
       - new uiFormatToScoringRules helper
       - applyEngineToRankings accepts leagueType
       - CacheEntry now keyed on (format, leagueType)
       - getEngineRankings(format, leagueType, force?)
       - getEngineRankingsForSource(source, format, leagueType?)

  3. app/(tabs)/rankings.tsx
       - useEffect dep array includes leagueType (re-fetch on change)
       - All 5 engine call sites pass leagueType through

Run from AIOmni repo root:
    python3 scripts/patch_rankings_phase1_item5.py

Idempotent. Safe to re-run.
"""
from pathlib import Path
import sys

ROOT   = Path('.')
DATA   = ROOT / 'services' / 'rankingsData.ts'
BRIDGE = ROOT / 'services' / 'rankings' / 'aiomniEngineBridge.ts'
TSX    = ROOT / 'app' / '(tabs)' / 'rankings.tsx'

for p in (DATA, BRIDGE, TSX):
    if not p.exists():
        print(f'[ERROR]    {p} not found.')
        print('           Run from AIOmni repo root:')
        print('             cd ~/AIOmni && python3 scripts/patch_rankings_phase1_item5.py')
        sys.exit(1)

applied_total = []

# ═══════════════════════════════════════════════════════════════════════
# PATCH 1: services/rankingsData.ts -- fetchBaseRankings accepts format
# ═══════════════════════════════════════════════════════════════════════

s = DATA.read_text()
orig = s

old_dispatcher = """export async function fetchBaseRankings(source: RankingsSource): Promise<RankedPlayer[]> {
  switch (source) {
    case 'sleeper':     return fetchSleeperADP();
    case 'espn':        return fetchESPNADP();
    case 'yahoo':       return fetchYahooADP();
    case 'fantasypros': return fetchBlendedConsensus();
    case 'nfl':         return fetchBlendedConsensus();
    case 'aiomni':      return fetchBlendedConsensus();
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
    case 'fantasypros': return fetchBlendedConsensus(leagueType, scoringRules);
    case 'nfl':         return fetchBlendedConsensus(leagueType, scoringRules);
    case 'aiomni':      return fetchBlendedConsensus(leagueType, scoringRules);
    default:            return fetchSleeperADP();
  }
}"""

if old_dispatcher in s:
    s = s.replace(old_dispatcher, new_dispatcher)
    applied_total.append('rankingsData.ts: fetchBaseRankings accepts leagueType + scoringRules')

if s != orig:
    DATA.write_text(s)

# ═══════════════════════════════════════════════════════════════════════
# PATCH 2: services/rankings/aiomniEngineBridge.ts
# ═══════════════════════════════════════════════════════════════════════

s = BRIDGE.read_text()
orig = s

# 2a -- imports
old_import = """import {
  fetchBlendedConsensus,
  fetchBaseRankings,
  RankedPlayer as UIRankedPlayer,
  RankingsSource,
  ScoringFormat as UIFormat,
} from '../rankingsData';"""

new_import = """import {
  fetchBlendedConsensus,
  fetchBaseRankings,
  RankedPlayer as UIRankedPlayer,
  RankingsSource,
  ScoringFormat as UIFormat,
  LeagueType,
  ScoringRules,
} from '../rankingsData';"""

if old_import in s:
    s = s.replace(old_import, new_import)
    applied_total.append('Bridge: imported LeagueType + ScoringRules')

# 2b -- uiFormatToConfig accepts leagueType + new uiFormatToScoringRules helper
old_ufc = """export function uiFormatToConfig(format: UIFormat): LeagueConfig {
  switch (format) {
    case 'PPR':  return { ...LEAGUE_PRESETS.STANDARD_REDRAFT_PPR };
    case 'HALF': return { ...LEAGUE_PRESETS.STANDARD_REDRAFT_HALF };
    case 'STD':  return { ...LEAGUE_PRESETS.STANDARD_REDRAFT_STD };
    case 'SF':   return { ...LEAGUE_PRESETS.SUPERFLEX_PPR };
    case 'DYN':  return { ...LEAGUE_PRESETS.DYNASTY_PPR };
    default:     return { ...LEAGUE_PRESETS.STANDARD_REDRAFT_PPR };
  }
}"""

new_ufc = """export function uiFormatToConfig(
  format: UIFormat,
  leagueType: LeagueType = 'redraft',
): LeagueConfig {
  // Dynasty leagueType always routes through DYNASTY_PPR for now.
  // TODO: add DYNASTY_HALF / DYNASTY_STD / DYNASTY_SUPERFLEX presets to
  // aiomniEngine and select among them based on `format`.
  if (leagueType === 'dynasty') {
    return { ...LEAGUE_PRESETS.DYNASTY_PPR };
  }
  switch (format) {
    case 'PPR':  return { ...LEAGUE_PRESETS.STANDARD_REDRAFT_PPR };
    case 'HALF': return { ...LEAGUE_PRESETS.STANDARD_REDRAFT_HALF };
    case 'STD':  return { ...LEAGUE_PRESETS.STANDARD_REDRAFT_STD };
    case 'SF':   return { ...LEAGUE_PRESETS.SUPERFLEX_PPR };
    case 'DYN':  return { ...LEAGUE_PRESETS.DYNASTY_PPR };
    default:     return { ...LEAGUE_PRESETS.STANDARD_REDRAFT_PPR };
  }
}

// Map UI ScoringFormat -> rankingsData ScoringRules. (Two parallel type
// systems; this bridges them.) Legacy 'DYN' falls into 'ppr' because in
// the new model dynasty IS the leagueType, not the scoring rules.
function uiFormatToScoringRules(format: UIFormat): ScoringRules {
  switch (format) {
    case 'HALF': return 'half';
    case 'STD':  return 'std';
    case 'SF':   return 'superflex';
    case 'PPR':
    case 'DYN':
    default:     return 'ppr';
  }
}"""

if old_ufc in s:
    s = s.replace(old_ufc, new_ufc)
    applied_total.append('Bridge: uiFormatToConfig accepts leagueType + uiFormatToScoringRules added')

# 2c -- applyEngineToRankings accepts leagueType
old_apply = """export function applyEngineToRankings(
  source: UIRankedPlayer[],
  format: UIFormat,
): UIRankedPlayer[] {
  const config = uiFormatToConfig(format);"""

new_apply = """export function applyEngineToRankings(
  source: UIRankedPlayer[],
  format: UIFormat,
  leagueType: LeagueType = 'redraft',
): UIRankedPlayer[] {
  const config = uiFormatToConfig(format, leagueType);"""

if old_apply in s:
    s = s.replace(old_apply, new_apply)
    applied_total.append('Bridge: applyEngineToRankings accepts leagueType')

# 2d -- CacheEntry includes leagueType
old_cache_iface = """interface CacheEntry {
  format: UIFormat;
  data: UIRankedPlayer[];
  ts: number;
}"""

new_cache_iface = """interface CacheEntry {
  format: UIFormat;
  leagueType: LeagueType;
  data: UIRankedPlayer[];
  ts: number;
}"""

if old_cache_iface in s:
    s = s.replace(old_cache_iface, new_cache_iface)
    applied_total.append('Bridge: CacheEntry keyed on (format, leagueType)')

# 2e -- getEngineRankings new signature + threading
old_ger = """export async function getEngineRankings(
  format: UIFormat,
  force = false,
): Promise<UIRankedPlayer[]> {
  if (
    !force &&
    engineCache &&
    engineCache.format === format &&
    Date.now() - engineCache.ts < CACHE_TTL_MS
  ) {
    return engineCache.data;
  }

  try {
    const blended = await fetchBlendedConsensus();
    const data = applyEngineToRankings(blended, format);
    engineCache = { format, data, ts: Date.now() };
    return data;
  } catch (e) {
    console.log('getEngineRankings error:', e);
    return engineCache?.format === format ? engineCache.data : [];
  }
}"""

new_ger = """export async function getEngineRankings(
  format: UIFormat,
  leagueType: LeagueType = 'redraft',
  force = false,
): Promise<UIRankedPlayer[]> {
  if (
    !force &&
    engineCache &&
    engineCache.format === format &&
    engineCache.leagueType === leagueType &&
    Date.now() - engineCache.ts < CACHE_TTL_MS
  ) {
    return engineCache.data;
  }

  try {
    const scoringRules = uiFormatToScoringRules(format);
    const blended = await fetchBlendedConsensus(leagueType, scoringRules);
    const data = applyEngineToRankings(blended, format, leagueType);
    engineCache = { format, leagueType, data, ts: Date.now() };
    return data;
  } catch (e) {
    console.log('getEngineRankings error:', e);
    return engineCache?.format === format && engineCache?.leagueType === leagueType
      ? engineCache.data
      : [];
  }
}"""

if old_ger in s:
    s = s.replace(old_ger, new_ger)
    applied_total.append('Bridge: getEngineRankings threads leagueType through')

# 2f -- getEngineRankingsForSource new signature + threading
old_gers = """export async function getEngineRankingsForSource(
  source: RankingsSource,
  format: UIFormat,
): Promise<UIRankedPlayer[]> {
  try {
    const raw = await fetchBaseRankings(source);
    return applyEngineToRankings(raw, format);
  } catch (e) {
    console.log('getEngineRankingsForSource error:', e);
    return [];
  }
}"""

new_gers = """export async function getEngineRankingsForSource(
  source: RankingsSource,
  format: UIFormat,
  leagueType: LeagueType = 'redraft',
): Promise<UIRankedPlayer[]> {
  try {
    const scoringRules = uiFormatToScoringRules(format);
    const raw = await fetchBaseRankings(source, leagueType, scoringRules);
    return applyEngineToRankings(raw, format, leagueType);
  } catch (e) {
    console.log('getEngineRankingsForSource error:', e);
    return [];
  }
}"""

if old_gers in s:
    s = s.replace(old_gers, new_gers)
    applied_total.append('Bridge: getEngineRankingsForSource threads leagueType through')

if s != orig:
    BRIDGE.write_text(s)

# ═══════════════════════════════════════════════════════════════════════
# PATCH 3: app/(tabs)/rankings.tsx -- call sites + useEffect dep
# ═══════════════════════════════════════════════════════════════════════

s = TSX.read_text()
orig = s

# 3a -- useEffect dep array
old_useeffect = """  useEffect(() => {
    loadSavedState();
    loadCommunityRankings();
    loadLeagues();
  }, [format]);"""

new_useeffect = """  useEffect(() => {
    loadSavedState();
    loadCommunityRankings();
    loadLeagues();
  }, [format, leagueType]);"""

if old_useeffect in s:
    s = s.replace(old_useeffect, new_useeffect)
    applied_total.append('rankings.tsx: useEffect re-runs when leagueType changes')

# 3b -- loadCommunityRankings call site
old_lcr = "      const data = await getEngineRankings(format);"
new_lcr = "      const data = await getEngineRankings(format, leagueType);"

if old_lcr in s:
    s = s.replace(old_lcr, new_lcr)
    applied_total.append('rankings.tsx: loadCommunityRankings passes leagueType')

# 3c -- handleLeagueChange + loadSavedState (both `const live = await getEngineRankings(format);`)
old_simple = "const live = await getEngineRankings(format);"
new_simple = "const live = await getEngineRankings(format, leagueType);"

count = s.count(old_simple)
if count > 0:
    s = s.replace(old_simple, new_simple)
    applied_total.append(f'rankings.tsx: {count} simple getEngineRankings call(s) pass leagueType')

# 3d -- resetToConsensus (uses force=true variant)
old_reset = "const live = await getEngineRankings(format, true);"
new_reset = "const live = await getEngineRankings(format, leagueType, true);"

if old_reset in s:
    s = s.replace(old_reset, new_reset)
    applied_total.append('rankings.tsx: resetToConsensus passes leagueType')

# 3e -- handleSelectBase (uses getEngineRankingsForSource)
old_grfs = "const rankings = await getEngineRankingsForSource(source, format);"
new_grfs = "const rankings = await getEngineRankingsForSource(source, format, leagueType);"

if old_grfs in s:
    s = s.replace(old_grfs, new_grfs)
    applied_total.append('rankings.tsx: handleSelectBase passes leagueType')

if s != orig:
    TSX.write_text(s)

# ═══════════════════════════════════════════════════════════════════════
# REPORT
# ═══════════════════════════════════════════════════════════════════════

if applied_total:
    for a in applied_total:
        print(f'[APPLIED]  {a}')
    print(f'\nDone. {len(applied_total)} change(s).')
    print('Next: npx tsc --noEmit')
else:
    print('[SKIP]     no changes (already patched?)')
