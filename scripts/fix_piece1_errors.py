#!/usr/bin/env python3
"""
Fix Piece 1 errors.

Three bugs from the previous patch:
  1. RankingsSource type doesn't include 'mfl' or 'fleaflicker'.
  2. Stub functions (fetchMFLADP, fetchFleaflickerADP, fetchNFLDotComRankings)
     got injected between fetchYahooADP's catch line and its outer closing
     brace — leaving a stray `}` that breaks the next function's structure.
  3. The blend's median + sorted variables were used downstream (line 768
     for spread calc, line 787 for adp display string) but I removed them
     when I switched to weighted average.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/fix_piece1_errors.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "services" / "rankingsData.ts"


# ── FIX 1: Extend RankingsSource type ───────────────────────────────────────
OLD_TYPE = "export type RankingsSource = 'sleeper' | 'espn' | 'yahoo' | 'fantasypros' | 'nfl' | 'aiomni';"
NEW_TYPE = "export type RankingsSource = 'sleeper' | 'espn' | 'yahoo' | 'mfl' | 'fleaflicker' | 'fantasypros' | 'nfl' | 'aiomni';"


# ── FIX 2: Move stubs out of fetchYahooADP scope ────────────────────────────
# Current broken structure:
#   } catch (e) { console.log('fetchYahooADP error:', e); return []; }
#
#   // MFL stub
#   export async function fetchMFLADP(...) { ... }
#
#   // FF stub
#   export async function fetchFleaflickerADP(...) { ... }
#
#   // NFL stub
#   export async function fetchNFLDotComRankings(...) { ... }
#
#   }  ← THIS is the stray brace; it was the close of fetchYahooADP's outer function
#
# Fix: remove the stray `}` AND keep the stubs as top-level. Easiest:
# locate the stray block, delete it, then re-insert stubs AFTER the
# fetchYahooADP function fully closes (after the OUTER `}`).

OLD_BROKEN_BLOCK = """  } catch (e) { console.log('fetchYahooADP error:', e); return []; }

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

}

// ─── NFL INJURIES ───────────────────────────────────────────"""

NEW_FIXED_BLOCK = """  } catch (e) { console.log('fetchYahooADP error:', e); return []; }
}

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

// ─── NFL INJURIES ───────────────────────────────────────────"""


# ── FIX 3a: Restore `spread` calc downstream ────────────────────────────────
# The original code did `sorted.length > 1 ? sorted[last] - sorted[0] : 0`.
# That measured rank disagreement between sources (max - min rank).
# Without `sorted`, we need an equivalent. Since we no longer track
# individual ranks per player, we approximate: spread is always 0 when
# we only have weightedSum. To keep trend logic working, just use 0.

OLD_SPREAD = "    const spread = sorted.length > 1 ? sorted[sorted.length - 1] - sorted[0] : 0;"
NEW_SPREAD = """    // We no longer track per-source ranks individually after the weighted
    // blend, so spread defaults to 0 (will be replaced with a proper
    // disagreement metric when Piece 2 ships per-source rank tracking).
    const spread = 0;"""


# ── FIX 3b: Replace `median.toFixed(1)` with `blendedRank.toFixed(1)` ───────
# adp display string was using median; should now use blendedRank which
# is in scope inside the same loop body.

OLD_ADP = "      rank: 0, adp: median.toFixed(1), trend, trendVal: p.sourceCount, tier: 0,"
NEW_ADP = "      rank: 0, adp: blendedRank.toFixed(1), trend, trendVal: p.sourceCount, tier: 0,"


def main():
    print("=" * 64)
    print("Fix Piece 1 errors")
    print("=" * 64)
    print()

    if not TARGET.exists():
        print(f"ERROR: {TARGET} not found")
        sys.exit(1)

    s = TARGET.read_text()

    # Idempotency
    if "'mfl' | 'fleaflicker' | 'fantasypros'" in s and "spread = 0" in s and "blendedRank.toFixed" in s:
        print("  [ALREADY]  all three fixes already applied")
        return

    # FIX 1: extend RankingsSource type
    if OLD_TYPE in s:
        s = s.replace(OLD_TYPE, NEW_TYPE)
        print("  [APPLIED]  extended RankingsSource type with 'mfl' | 'fleaflicker'")
    elif NEW_TYPE in s:
        print("  [ALREADY]  RankingsSource already extended")
    else:
        print("  [MISSING]  RankingsSource type definition not found")
        sys.exit(2)

    # FIX 2: fix stub function placement (move outer brace before stubs)
    if OLD_BROKEN_BLOCK in s:
        s = s.replace(OLD_BROKEN_BLOCK, NEW_FIXED_BLOCK)
        print("  [APPLIED]  moved stubs to top-level scope (fixed stray brace)")
    elif NEW_FIXED_BLOCK in s:
        print("  [ALREADY]  stubs already at top-level scope")
    else:
        print("  [MISSING]  could not locate broken stub block")
        sys.exit(2)

    # FIX 3a: spread calc
    if OLD_SPREAD in s:
        s = s.replace(OLD_SPREAD, NEW_SPREAD)
        print("  [APPLIED]  spread calc no longer references removed `sorted`")
    elif "const spread = 0;" in s:
        print("  [ALREADY]  spread calc already fixed")
    else:
        print("  [MISSING]  could not locate spread calc")
        sys.exit(2)

    # FIX 3b: adp display
    if OLD_ADP in s:
        s = s.replace(OLD_ADP, NEW_ADP)
        print("  [APPLIED]  adp string uses blendedRank instead of removed `median`")
    elif "adp: blendedRank.toFixed(1)" in s:
        print("  [ALREADY]  adp display already fixed")
    else:
        print("  [MISSING]  could not locate adp display line")
        sys.exit(2)

    TARGET.write_text(s)
    print()
    print(f"  ✓ {TARGET.name} updated")
    print()
    print("Next:")
    print("  npx tsc --noEmit")


if __name__ == "__main__":
    main()
