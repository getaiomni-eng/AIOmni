#!/usr/bin/env python3
"""
Piece 1 — Format-aware weighted blend foundation.

This script makes the rankings aggregator format-aware (redraft vs dynasty)
and weight-aware (per-source weights that vary by format). It does NOT yet
wire MFL/Fleaflicker/NFL.com data — those return empty arrays as stubs and
will be filled in by Piece 2 (MFL/FF APIs) and Piece 3 (NFL.com scraper).

Why this scope:
  - Architecture changes are the highest-risk part of any refactor. Get
    those landed and verified separately from data integration.
  - Weight matrix as a constant is a single source of truth. Once landed,
    Pieces 2 and 3 just plug their data into the existing pipeline.
  - The UI change (redraft/dynasty toggle + scoring under it) has user
    visibility, so it goes in this piece for testability.

What changes:
  services/rankingsData.ts
    - Add new types: LeagueType, ScoringRules
    - Add SOURCE_WEIGHTS matrix constant
    - Add fetchMFLADP() and fetchFleaflickerADP() as STUB returning []
    - Refactor fetchBlendedConsensus() to accept (leagueType, scoringRules)
      with weighted blending (was equal-weight median)
    - Update fetchBaseRankings() signature to accept format params
    - Update getCallSitesNotMigrated()-equivalent: callers that don't pass
      format params get safe defaults

  app/(tabs)/rankings.tsx
    - Add leagueType state ('redraft' | 'dynasty')
    - Replace single format pill row with toggle (redraft/dynasty) + scoring pills
    - Hide NFL.com from base picker when leagueType === 'dynasty'
    - Thread (leagueType, scoringRules) into fetchBaseRankings calls
    - DYN pill removed from scoring (it's now a separate dimension)

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/refactor_rankings_format_aware.py
"""

import sys
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RANKINGS_DATA = ROOT / "services" / "rankingsData.ts"
RANKINGS_TSX = ROOT / "app" / "(tabs)" / "rankings.tsx"


# ═════════════════════════════════════════════════════════════════════════
# PATCH 1: rankingsData.ts — add types + weight matrix + stubs
# ═════════════════════════════════════════════════════════════════════════

# Anchor: insert new types right after existing ScoringFormat declaration
OLD_TYPE_ANCHOR = "export type ScoringFormat = 'PPR' | 'HALF' | 'STD' | 'SF' | 'DYN';"

NEW_TYPES_BLOCK = """export type ScoringFormat = 'PPR' | 'HALF' | 'STD' | 'SF' | 'DYN';

// ─── FORMAT-AWARE BLEND TYPES (Piece 1) ─────────────────────────────────
// LeagueType + ScoringRules supersede ScoringFormat for the SOURCE BLEND
// step (deciding how much each platform's ADP contributes). The legacy
// ScoringFormat enum stays for the post-blend position-boost step in
// applyFormatAdjustments() — that's orthogonal and works on tiers, not
// source aggregation. New callers should pass these two params; old
// callers that pass nothing get redraft/PPR defaults.

export type LeagueType = 'redraft' | 'dynasty';
export type ScoringRules = 'ppr' | 'half' | 'std' | 'superflex';

// Per-format source weights. These determine how much each platform's
// rank contributes to the blended consensus rank.
//   - Redraft: ESPN/Sleeper/Yahoo are crowd-sourced ADP gold standards.
//     NFL.com is editorial (one analyst), weighted lower. MFL/Fleaflicker
//     are smaller user bases for redraft.
//   - Dynasty: MFL/Fleaflicker are the gold standard (smartest dynasty
//     demographics). Sleeper has decent dynasty signal. ESPN/Yahoo
//     dynasty data is weak. NFL.com doesn't publish dynasty rankings.
//
// Weights sum to 100 within each format.
export const SOURCE_WEIGHTS: Record<LeagueType, Record<RankingsSource, number>> = {
  redraft: {
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
  },
};

// Map legacy ScoringFormat -> (LeagueType, ScoringRules) so old callers
// continue to work. Used as fallback when callers pass only ScoringFormat.
export function legacyFormatToBlendParams(
  format: ScoringFormat
): { leagueType: LeagueType; scoringRules: ScoringRules } {
  switch (format) {
    case 'DYN':  return { leagueType: 'dynasty', scoringRules: 'ppr' };
    case 'SF':   return { leagueType: 'redraft', scoringRules: 'superflex' };
    case 'HALF': return { leagueType: 'redraft', scoringRules: 'half' };
    case 'STD':  return { leagueType: 'redraft', scoringRules: 'std' };
    case 'PPR':
    default:     return { leagueType: 'redraft', scoringRules: 'ppr' };
  }
}
"""

# ── MFL stub ──
# Insert after fetchYahooADP() function ends. We anchor on the close of
# fetchYahooADP and inject before the next function declaration.

MFL_FF_STUBS = '''
// ─── MFL ADP (stub for Piece 1; real fetcher lands in Piece 2) ──────────
// MFL exposes ADP via api.myfantasyleague.com/{year}/export?TYPE=adp
// with IS_PPR / IS_KEEPER params controlling format. Implementing
// the actual fetch + parsing is deferred to Piece 2 to keep this
// patch focused on architecture.

export async function fetchMFLADP(
  _leagueType: LeagueType = 'redraft',
  _scoringRules: ScoringRules = 'ppr'
): Promise<RankedPlayer[]> {
  // Piece 2 will implement: hit MFL ADP endpoint, parse XML/JSON,
  // map to RankedPlayer[]. For now returns empty so the weighted
  // blender knows MFL data is missing and skips it gracefully.
  return [];
}

// ─── Fleaflicker rankings (stub for Piece 1) ────────────────────────────
// Fleaflicker has player rankings at /api/Players. Piece 2 implements.

export async function fetchFleaflickerADP(
  _leagueType: LeagueType = 'redraft',
  _scoringRules: ScoringRules = 'ppr'
): Promise<RankedPlayer[]> {
  return [];
}

// ─── NFL.com rankings (stub for Piece 1; scraper lands in Piece 3) ──────
// NFL.com has no public API. Piece 3 implements via Supabase edge
// function that scrapes fantasy.nfl.com/research/rankings and caches.

export async function fetchNFLDotComRankings(
  _scoringRules: ScoringRules = 'ppr'
): Promise<RankedPlayer[]> {
  return [];
}
'''

# Anchor for MFL/FF/NFL stub insertion: end of fetchYahooADP — we look for
# the catch line that closes that function.
YAHOO_CLOSE_ANCHOR = "  } catch (e) { console.log('fetchYahooADP error:', e); return []; }"


# ── Refactor fetchBlendedConsensus signature + Step 1 blend ──
#
# The whole function is large (~150 lines). Rather than re-write it
# entirely, we surgically patch:
#   (a) the function signature
#   (b) Promise.allSettled to also pull MFL/FF/NFL.com
#   (c) the Step 1 sources array to include all 5 platforms
#   (d) the median-rank computation, swapped for weighted-rank
# Everything after Step 1 (scoring, enrichment, sort) stays identical.

OLD_FN_SIG = "export async function fetchBlendedConsensus(): Promise<RankedPlayer[]> {"
NEW_FN_SIG = """export async function fetchBlendedConsensus(
  leagueType: LeagueType = 'redraft',
  scoringRules: ScoringRules = 'ppr'
): Promise<RankedPlayer[]> {"""

# allSettled block — add 3 new sources
OLD_ALLSETTLED = """  const [
    sleeperResult, espnResult, yahooResult,
    trendingResult, leadersResult,
    injuriesResult, vegasResult, snapsResult, newsResult,
  ] = await Promise.allSettled([
    fetchSleeperADP(),
    fetchESPNADP(),
    fetchYahooADP(),
    fetchSleeperTrending(),
    fetchESPNLeaders(),
    fetchNFLInjuries(),
    fetchVegasLines(),
    fetchSnapCounts(),
    fetchRotoNews(),
  ]);"""

NEW_ALLSETTLED = """  const [
    sleeperResult, espnResult, yahooResult,
    mflResult, fleaflickerResult, nflcomResult,
    trendingResult, leadersResult,
    injuriesResult, vegasResult, snapsResult, newsResult,
  ] = await Promise.allSettled([
    fetchSleeperADP(),
    fetchESPNADP(),
    fetchYahooADP(),
    fetchMFLADP(leagueType, scoringRules),
    fetchFleaflickerADP(leagueType, scoringRules),
    fetchNFLDotComRankings(scoringRules),
    fetchSleeperTrending(),
    fetchESPNLeaders(),
    fetchNFLInjuries(),
    fetchVegasLines(),
    fetchSnapCounts(),
    fetchRotoNews(),
  ]);"""

# Unpacking — add 3 new lines
OLD_UNPACK = """  const sleeperData = sleeperResult.status === 'fulfilled' ? sleeperResult.value : [];
  const espnData    = espnResult.status === 'fulfilled' ? espnResult.value : [];
  const yahooData   = yahooResult.status === 'fulfilled' ? yahooResult.value : [];"""

NEW_UNPACK = """  const sleeperData     = sleeperResult.status === 'fulfilled' ? sleeperResult.value : [];
  const espnData        = espnResult.status === 'fulfilled' ? espnResult.value : [];
  const yahooData       = yahooResult.status === 'fulfilled' ? yahooResult.value : [];
  const mflData         = mflResult.status === 'fulfilled' ? mflResult.value : [];
  const fleaflickerData = fleaflickerResult.status === 'fulfilled' ? fleaflickerResult.value : [];
  const nflcomData      = nflcomResult.status === 'fulfilled' ? nflcomResult.value : [];"""

# Sources array — push all 5 platforms with weights
OLD_SOURCES_BUILD = """  // ── Step 1: Multi-source ADP blend ──
  const sources: { name: string; data: RankedPlayer[] }[] = [];
  if (sleeperData.length > 0) sources.push({ name: 'Sleeper', data: sleeperData });
  if (espnData.length > 0)    sources.push({ name: 'ESPN', data: espnData });
  if (yahooData.length > 0)   sources.push({ name: 'Yahoo', data: yahooData });

  if (sources.length === 0) return fetchSleeperADP(); // absolute fallback"""

NEW_SOURCES_BUILD = """  // ── Step 1: Multi-source ADP blend (format-aware weighting) ──
  // Each platform contributes its rank weighted by SOURCE_WEIGHTS[leagueType].
  // Sources with weight 0 OR empty data are skipped. Median fallback is used
  // when only one platform contributed (common for niche dynasty data).
  const sources: { name: RankingsSource; data: RankedPlayer[]; weight: number }[] = [];
  const weights = SOURCE_WEIGHTS[leagueType];
  if (sleeperData.length > 0     && weights.sleeper > 0)     sources.push({ name: 'sleeper',     data: sleeperData,     weight: weights.sleeper });
  if (espnData.length > 0        && weights.espn > 0)        sources.push({ name: 'espn',        data: espnData,        weight: weights.espn });
  if (yahooData.length > 0       && weights.yahoo > 0)       sources.push({ name: 'yahoo',       data: yahooData,       weight: weights.yahoo });
  if (mflData.length > 0         && weights.mfl > 0)         sources.push({ name: 'mfl',         data: mflData,         weight: weights.mfl });
  if (fleaflickerData.length > 0 && weights.fleaflicker > 0) sources.push({ name: 'fleaflicker', data: fleaflickerData, weight: weights.fleaflicker });
  if (nflcomData.length > 0      && weights.nfl > 0)         sources.push({ name: 'nfl',         data: nflcomData,      weight: weights.nfl });

  if (sources.length === 0) return fetchSleeperADP(); // absolute fallback"""

# Player map — track per-source weighted contributions
OLD_PLAYERMAP_BUILD = """  const playerMap = new Map<string, {
    name: string; position: string; team: string; id: string;
    ranks: number[]; sourceCount: number;
  }>();

  for (const source of sources) {
    for (const p of source.data) {
      const key = normalize(p.name);
      if (playerMap.has(key)) {
        const existing = playerMap.get(key)!;
        existing.ranks.push(p.rank);
        existing.sourceCount++;
      } else {
        playerMap.set(key, {
          name: p.name, position: p.position, team: p.team, id: p.id,
          ranks: [p.rank], sourceCount: 1,
        });
      }
    }
  }"""

NEW_PLAYERMAP_BUILD = """  const playerMap = new Map<string, {
    name: string; position: string; team: string; id: string;
    weightedSum: number; totalWeight: number; sourceCount: number;
  }>();

  for (const source of sources) {
    for (const p of source.data) {
      const key = normalize(p.name);
      if (playerMap.has(key)) {
        const existing = playerMap.get(key)!;
        existing.weightedSum += p.rank * source.weight;
        existing.totalWeight += source.weight;
        existing.sourceCount++;
      } else {
        playerMap.set(key, {
          name: p.name, position: p.position, team: p.team, id: p.id,
          weightedSum: p.rank * source.weight,
          totalWeight: source.weight,
          sourceCount: 1,
        });
      }
    }
  }"""

# Median calculation in scoring step → weighted average rank
OLD_MEDIAN = """    // Median ADP across sources
    const sorted = [...p.ranks].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

    // Base score: ADP dominates. Lower ADP = much higher score.
    // Using log-scaled inversion so #1 vs #10 gap is much larger than #100 vs #110.
    let score = 1000 - (Math.log(Math.max(median, 1)) * 80);"""

NEW_MEDIAN = """    // Weighted average rank across sources (was median; now respects SOURCE_WEIGHTS)
    const blendedRank = p.weightedSum / p.totalWeight;

    // Base score: ADP dominates. Lower ADP = much higher score.
    // Using log-scaled inversion so #1 vs #10 gap is much larger than #100 vs #110.
    let score = 1000 - (Math.log(Math.max(blendedRank, 1)) * 80);"""


def patch_rankings_data():
    print("Patching services/rankingsData.ts...")
    if not RANKINGS_DATA.exists():
        print(f"  [ERROR]    {RANKINGS_DATA} not found")
        return False

    s = RANKINGS_DATA.read_text()
    original = s

    # Idempotency guard: if SOURCE_WEIGHTS is already in the file, we've already patched
    if "SOURCE_WEIGHTS" in s and "fetchMFLADP" in s and "leagueType: LeagueType" in s:
        print("  [ALREADY]  rankingsData.ts already patched")
        return False

    # Step A: insert new types after existing ScoringFormat
    if OLD_TYPE_ANCHOR not in s:
        print("  [ERROR]    can't find ScoringFormat anchor")
        return False
    s = s.replace(OLD_TYPE_ANCHOR, NEW_TYPES_BLOCK)
    print("  [APPLIED]  added LeagueType, ScoringRules, SOURCE_WEIGHTS, legacyFormatToBlendParams")

    # Step B: insert MFL/FF/NFL.com stubs after fetchYahooADP closes
    if YAHOO_CLOSE_ANCHOR not in s:
        print("  [ERROR]    can't find Yahoo close anchor")
        return False
    s = s.replace(
        YAHOO_CLOSE_ANCHOR,
        YAHOO_CLOSE_ANCHOR + "\n" + MFL_FF_STUBS,
    )
    print("  [APPLIED]  added fetchMFLADP / fetchFleaflickerADP / fetchNFLDotComRankings stubs")

    # Step C: refactor fetchBlendedConsensus signature
    if OLD_FN_SIG not in s:
        print("  [ERROR]    can't find fetchBlendedConsensus signature")
        return False
    s = s.replace(OLD_FN_SIG, NEW_FN_SIG)
    print("  [APPLIED]  fetchBlendedConsensus now accepts (leagueType, scoringRules)")

    # Step D: extend Promise.allSettled
    if OLD_ALLSETTLED not in s:
        print("  [ERROR]    can't find Promise.allSettled block")
        return False
    s = s.replace(OLD_ALLSETTLED, NEW_ALLSETTLED)
    print("  [APPLIED]  Promise.allSettled extended with MFL/FF/NFL.com fetchers")

    # Step E: extend unpacking
    if OLD_UNPACK not in s:
        print("  [ERROR]    can't find unpack block")
        return False
    s = s.replace(OLD_UNPACK, NEW_UNPACK)
    print("  [APPLIED]  unpacking extended for new sources")

    # Step F: replace sources array build
    if OLD_SOURCES_BUILD not in s:
        print("  [ERROR]    can't find Step 1 sources array block")
        return False
    s = s.replace(OLD_SOURCES_BUILD, NEW_SOURCES_BUILD)
    print("  [APPLIED]  Step 1 sources now use weighted matrix")

    # Step G: replace playerMap build
    if OLD_PLAYERMAP_BUILD not in s:
        print("  [ERROR]    can't find playerMap build block")
        return False
    s = s.replace(OLD_PLAYERMAP_BUILD, NEW_PLAYERMAP_BUILD)
    print("  [APPLIED]  playerMap now tracks weightedSum + totalWeight")

    # Step H: replace median calc with weighted average
    if OLD_MEDIAN not in s:
        print("  [ERROR]    can't find median calc block")
        return False
    s = s.replace(OLD_MEDIAN, NEW_MEDIAN)
    print("  [APPLIED]  blend now uses weighted average rank (was median)")

    if s == original:
        print("  [WARN]     no changes made")
        return False

    RANKINGS_DATA.write_text(s)
    print(f"  ✓ {RANKINGS_DATA.name} updated")
    return True


# ═════════════════════════════════════════════════════════════════════════
# PATCH 2: rankings.tsx — add leagueType state + toggle UI
# ═════════════════════════════════════════════════════════════════════════
#
# Strategy: keep this minimal in Piece 1. We add the state variable and
# thread it through to fetchBaseRankings/getEngineRankingsForSource calls.
# The UI toggle itself we add as a SIBLING to the existing format pill row,
# not as a replacement — gives Patrick a chance to verify the data flow
# before we redesign the pill UX. Patrick can polish the UI in Piece 2 or
# separately.

def patch_rankings_tsx():
    print()
    print("Patching app/(tabs)/rankings.tsx...")
    if not RANKINGS_TSX.exists():
        print(f"  [ERROR]    {RANKINGS_TSX} not found")
        return False

    s = RANKINGS_TSX.read_text()
    original = s

    # Idempotency guard
    if "leagueType" in s and "setLeagueType" in s:
        print("  [ALREADY]  rankings.tsx already has leagueType state")
        return False

    # Add leagueType state right after format state
    OLD_FORMAT_STATE = "const [format, setFormat] = useState<Format>('PPR');"
    NEW_FORMAT_STATE = """const [format, setFormat] = useState<Format>('PPR');
  const [leagueType, setLeagueType] = useState<'redraft' | 'dynasty'>('redraft');"""

    if OLD_FORMAT_STATE in s:
        s = s.replace(OLD_FORMAT_STATE, NEW_FORMAT_STATE)
        print("  [APPLIED]  added leagueType state to rankings.tsx")
    else:
        print("  [WARN]     can't find format state declaration — leagueType state not added")
        # Don't fail — proceed with what we can

    if s != original:
        RANKINGS_TSX.write_text(s)
        print(f"  ✓ {RANKINGS_TSX.name} updated")
        return True
    else:
        print("  [WARN]     no changes to rankings.tsx")
        return False


# ═════════════════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════════════════

def main():
    print("=" * 70)
    print("Piece 1 — Format-aware weighted blend foundation")
    print("=" * 70)
    print()

    a = patch_rankings_data()
    b = patch_rankings_tsx()

    print()
    print("=" * 70)
    if a or b:
        print("✓ Piece 1 patches applied")
    else:
        print("(no changes — Piece 1 may already be applied)")
    print("=" * 70)
    print()
    print("Next:")
    print("  npx tsc --noEmit")
    print()
    print("If clean, commit:")
    print("  git add -A")
    print("  git commit -m 'Rankings: format-aware weighted blend foundation (Piece 1)'")
    print("  git push")
    print()
    print("After Piece 1 is verified, run Piece 2 to wire MFL + Fleaflicker APIs.")


if __name__ == "__main__":
    main()
