#!/usr/bin/env python3
"""
Phase A: Wire AIOmni Formula (v2.5.2 algorithmic engine) to the app.

Two AIOmni sources will appear in the picker after this runs:
  - AIOmni Formula  (proprietary algorithmic engine, reads nfl_proprietary_rankings)
  - AIOmni Pulse    (community blend, reads via fetchBlendedConsensus)

Three files touched:
  1. services/rankingsData.ts -- add 'aiomni_formula' source + fetcher
  2. services/rankings/aiomniEngineBridge.ts -- add getFormulaRankings()
  3. app/(tabs)/rankings.tsx -- add Formula to BASE_SOURCES, rename Pulse

Run from AIOmni repo root:
    python3 scripts/phase_a_aiomni_formula.py
"""
from pathlib import Path
import sys

ROOT = Path('.')
DATA = ROOT / 'services' / 'rankingsData.ts'
BRIDGE = ROOT / 'services' / 'rankings' / 'aiomniEngineBridge.ts'
TSX = ROOT / 'app' / '(tabs)' / 'rankings.tsx'

for f in [DATA, BRIDGE, TSX]:
    if not f.exists():
        print(f'[ERROR]    {f} not found')
        sys.exit(1)

applied = []
warnings = []

# ═══════════════════════════════════════════════════════════════════
# PATCH 1: services/rankingsData.ts
# ═══════════════════════════════════════════════════════════════════

s1 = DATA.read_text()
orig1 = s1

old1a = "export type RankingsSource = 'sleeper' | 'espn' | 'yahoo' | 'mfl' | 'fleaflicker' | 'fantasypros' | 'nfl' | 'aiomni';"
new1a = "export type RankingsSource = 'sleeper' | 'espn' | 'yahoo' | 'mfl' | 'fleaflicker' | 'fantasypros' | 'nfl' | 'aiomni' | 'aiomni_formula';"

if old1a in s1:
    s1 = s1.replace(old1a, new1a)
    applied.append("rankingsData.ts: added 'aiomni_formula' to RankingsSource type")
else:
    warnings.append("RankingsSource type not found")

old1b = """  redraft: {
    sleeper: 24,
    espn: 24,
    yahoo: 24,
    nfl: 12,
    mfl: 8,
    fleaflicker: 8,
    fantasypros: 0,    // not implemented; reserved
    aiomni: 0,         // synthesized output, not a source input
  },
  dynasty: {
    sleeper: 20,
    espn: 12.5,
    yahoo: 12.5,
    nfl: 0,            // NFL.com doesn't publish dynasty rankings
    mfl: 30,
    fleaflicker: 25,
    fantasypros: 0,
    aiomni: 0,
  },"""

new1b = """  redraft: {
    sleeper: 24,
    espn: 24,
    yahoo: 24,
    nfl: 12,
    mfl: 8,
    fleaflicker: 8,
    fantasypros: 0,    // not implemented; reserved
    aiomni: 0,         // Pulse blend output, not a source input
    aiomni_formula: 0, // proprietary algorithmic engine, never blended
  },
  dynasty: {
    sleeper: 20,
    espn: 12.5,
    yahoo: 12.5,
    nfl: 0,            // NFL.com doesn't publish dynasty rankings
    mfl: 30,
    fleaflicker: 25,
    fantasypros: 0,
    aiomni: 0,
    aiomni_formula: 0,
  },"""

if old1b in s1:
    s1 = s1.replace(old1b, new1b)
    applied.append("rankingsData.ts: added aiomni_formula to SOURCE_WEIGHTS")
else:
    warnings.append("SOURCE_WEIGHTS structure not matched")

formula_fetcher = '''// ─── AIOmni Formula (proprietary algorithmic engine) ─────────
// Reads from nfl_proprietary_rankings table, populated by the
// supabase/functions/aiomni-rankings-engine edge function (v2.5.2+).
// This is the pure stats-based projection -- separate from Pulse.

const PROPRIETARY_RANKINGS_URL =
  'https://khoruzvsprxyocisuhet.supabase.co/rest/v1/nfl_proprietary_rankings';

export async function fetchAIOmniFormula(
  format: ScoringFormat = 'PPR',
): Promise<RankedPlayer[]> {
  try {
    const url = `${PROPRIETARY_RANKINGS_URL}?format=eq.${format}&select=rank,gsis_id,name,position,team,score,tier,pos_rank,method&order=rank`;
    const res = await fetch(url, {
      headers: {
        'apikey': PHASE2_ANON,
        'Authorization': `Bearer ${PHASE2_ANON}`,
      },
    });
    if (!res.ok) {
      console.log('fetchAIOmniFormula HTTP', res.status);
      return [];
    }
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((r: any, i: number): RankedPlayer => ({
      id: r.gsis_id ?? String(i),
      name: r.name ?? 'Unknown',
      position: r.position ?? 'FLEX',
      team: r.team ?? '\u2014',
      rank: r.rank ?? (i + 1),
      adp: String(r.rank ?? (i + 1)),
      trend: 'flat' as const,
      trendVal: 0,
      tier: r.tier ?? assignTier(r.rank ?? (i + 1)),
      method: r.method ?? null,
    }) as any);
  } catch (e) {
    console.log('fetchAIOmniFormula error:', e);
    return [];
  }
}

'''

dispatcher_marker = "// \u2500\u2500\u2500 SOURCE DISPATCHER \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"
if dispatcher_marker in s1:
    s1 = s1.replace(dispatcher_marker, formula_fetcher + dispatcher_marker, 1)
    applied.append("rankingsData.ts: added fetchAIOmniFormula() before dispatcher")
else:
    warnings.append("SOURCE DISPATCHER marker not found")

old1d = """  switch (source) {
    case 'sleeper':     return fetchSleeperADP();
    case 'espn':        return fetchESPNADP();
    case 'yahoo':       return fetchYahooADP();
    case 'mfl':         return fetchMFLADP(leagueType, scoringRules);
    // KeepTradeCut source removed -- using Yahoo + Sleeper + MFL instead
    case 'fantasypros': return fetchBlendedConsensus(leagueType, scoringRules);
    case 'nfl':         return fetchBlendedConsensus(leagueType, scoringRules);
    case 'aiomni':      return fetchBlendedConsensus(leagueType, scoringRules);
    default:            return fetchSleeperADP();
  }"""

new1d = """  switch (source) {
    case 'sleeper':         return fetchSleeperADP();
    case 'espn':            return fetchESPNADP();
    case 'yahoo':           return fetchYahooADP();
    case 'mfl':             return fetchMFLADP(leagueType, scoringRules);
    // KeepTradeCut source removed -- using Yahoo + Sleeper + MFL instead
    case 'fantasypros':     return fetchBlendedConsensus(leagueType, scoringRules);
    case 'nfl':             return fetchBlendedConsensus(leagueType, scoringRules);
    case 'aiomni':          return fetchBlendedConsensus(leagueType, scoringRules);
    case 'aiomni_formula':  return fetchAIOmniFormula();
    default:                return fetchSleeperADP();
  }"""

if old1d in s1:
    s1 = s1.replace(old1d, new1d)
    applied.append("rankingsData.ts: added aiomni_formula dispatcher case")
else:
    warnings.append("fetchBaseRankings dispatcher not matched")

if s1 != orig1:
    DATA.write_text(s1)

# ═══════════════════════════════════════════════════════════════════
# PATCH 2: aiomniEngineBridge.ts
# ═══════════════════════════════════════════════════════════════════

s2 = BRIDGE.read_text()
orig2 = s2

formula_bridge_func = '''

// ─── AIOmni Formula (proprietary algorithmic engine) ────────────────────────
// Reads directly from nfl_proprietary_rankings table. Bypasses the consensus
// blend AND the rankAIOmni() in-process engine. Pure v2.5.2+ algorithmic.

export async function getFormulaRankings(
  format: UIFormat,
  leagueType: LeagueType = 'redraft',
): Promise<UIRankedPlayer[]> {
  try {
    const { fetchAIOmniFormula } = await import('../rankingsData');
    const raw = await fetchAIOmniFormula(format);
    return raw.map((p, i) => ({
      ...p,
      rank: p.rank ?? (i + 1),
      tier: p.tier ?? assignGlobalTier(p.rank ?? (i + 1)),
      positionalTier: assignPositionalTier(p.rank ?? (i + 1)),
      algorithmicTier: p.tier,
    } as any));
  } catch (e) {
    console.log('getFormulaRankings error:', e);
    return [];
  }
}
'''

marker2 = "export { AIOMNI_ALGORITHM_VERSION };"
if marker2 in s2:
    s2 = s2.replace(marker2, formula_bridge_func + '\n' + marker2)
    applied.append("aiomniEngineBridge.ts: added getFormulaRankings()")
else:
    warnings.append("AIOMNI_ALGORITHM_VERSION export marker not found")

if s2 != orig2:
    BRIDGE.write_text(s2)

# ═══════════════════════════════════════════════════════════════════
# PATCH 3: rankings.tsx
# ═══════════════════════════════════════════════════════════════════

s3 = TSX.read_text()
orig3 = s3

old3 = """const BASE_SOURCES: { key: RankingsSource; label: string; sub: string; color: string }[] = [
  { key: 'aiomni', label: 'AIOmni AI Rankings', sub: 'AI-synthesized from all sources', color: '#6eeb83' },
  { key: 'sleeper', label: 'Sleeper ADP', sub: 'Based on Sleeper draft data', color: '#00FFF9' },
  { key: 'espn', label: 'ESPN ADP', sub: 'Based on ESPN draft data', color: '#e52534' },
  { key: 'yahoo', label: 'Yahoo ADP', sub: 'Requires Yahoo connection', color: '#7c3aed' },
  { key: 'mfl', label: 'MFL ADP', sub: 'MyFantasyLeague consensus', color: '#f59e0b' },
  { key: 'nfl', label: 'NFL.com', sub: 'Official NFL rankings', color: palette.aqua },
];"""

new3 = """const BASE_SOURCES: { key: RankingsSource; label: string; sub: string; color: string }[] = [
  { key: 'aiomni_formula', label: 'AIOmni Formula', sub: 'Proprietary algorithmic engine', color: '#D4FF00' },
  { key: 'aiomni', label: 'AIOmni Pulse', sub: 'AI-blended community sources', color: '#6eeb83' },
  { key: 'sleeper', label: 'Sleeper ADP', sub: 'Based on Sleeper draft data', color: '#00FFF9' },
  { key: 'espn', label: 'ESPN ADP', sub: 'Based on ESPN draft data', color: '#e52534' },
  { key: 'yahoo', label: 'Yahoo ADP', sub: 'Yahoo official rankings', color: '#7c3aed' },
  { key: 'mfl', label: 'MFL ADP', sub: 'MyFantasyLeague consensus', color: '#f59e0b' },
  { key: 'nfl', label: 'NFL.com', sub: 'Official NFL rankings', color: palette.aqua },
];"""

if old3 in s3:
    s3 = s3.replace(old3, new3)
    applied.append("rankings.tsx: BASE_SOURCES updated with Formula + Pulse rename")
else:
    warnings.append("BASE_SOURCES not matched")

if s3 != orig3:
    TSX.write_text(s3)

# Summary
print()
print("=" * 60)
for a in applied:
    print(f"[APPLIED]  {a}")
for w in warnings:
    print(f"[WARN]     {w}")
print("=" * 60)
print()

if applied and not warnings:
    print("All 5 changes applied cleanly.")
    print()
    print("Verify + ship:")
    print("  npx tsc --noEmit")
    print('  git add -A && git commit -m "Phase A: AIOmni Formula source + Pulse rename"')
    print("  git push origin main")
    print("  npx expo start --clear")
elif applied:
    print(f"{len(applied)} of 5 applied. Manual review for warnings.")
else:
    print("Nothing applied -- file structure may have changed.")
