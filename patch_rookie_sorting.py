#!/usr/bin/env python3
"""
AIOmni — fix rookie sorting in dynasty waivers.

Diagnosis: 2026 incoming rookies have search_rank=null in Sleeper's player DB.
My getAvailablePlayers scorer was assigning them 99999 as a fallback, which
dropped them to the very bottom of the candidate list — below 150+ backup
veterans — so they never made the display limit.

Fix: Give rookies (years_exp=0, null search_rank) a neutral score of 500 so
they sort alongside waiver-tier veterans instead of being buried.

Run from project root: python3 patch_rookie_sorting.py
"""

import sys, os

FILE = 'services/platform/sleeper.ts'

def main():
    if not os.path.exists(FILE):
        print(f"✗ File not found: {FILE}")
        sys.exit(1)

    with open(FILE, 'r') as f:
        src = f.read()

    old = """    for (const [pid, p] of Object.entries(playersDB)) {
      if (!isEligible(pid, p)) continue;
      const adds = trending.adds.get(pid) ?? 0;
      const searchRank = p.search_rank ?? 99999;
      const score = adds * 10 - searchRank;
      candidates.push({ id: pid, raw: p, score });
    }"""

    new = """    for (const [pid, p] of Object.entries(playersDB)) {
      if (!isEligible(pid, p)) continue;
      const adds = trending.adds.get(pid) ?? 0;
      // Rookies/prospects have search_rank=null in Sleeper's DB until they're
      // drafted. Give them a waiver-tier default (500) so they compete fairly
      // with veterans instead of being dumped to the bottom.
      const isRookie = (p.years_exp === 0 || p.years_exp === undefined || p.years_exp === null)
                    && (p.search_rank === null || p.search_rank === undefined);
      const searchRank = p.search_rank ?? (isRookie ? 500 : 99999);
      const score = adds * 10 - searchRank;
      candidates.push({ id: pid, raw: p, score });
    }"""

    if old not in src:
        print(f"✗ Scorer block not found in {FILE}")
        print(f"  The patch may already be applied, or the file was modified.")
        sys.exit(1)

    if src.count(old) > 1:
        print(f"✗ Ambiguous match — refusing to patch")
        sys.exit(1)

    src = src.replace(old, new)

    with open(FILE, 'w') as f:
        f.write(src)

    print("✓ Patched services/platform/sleeper.ts")
    print("  Rookies with null search_rank now sort into waiver-tier range")
    print()
    print("Next: npx tsc --noEmit")
    print("Then: reload Expo, open Armchair → Waivers")
    print("      Expect: Fernando Mendoza, Jeremiyah Love, Carnell Tate etc. now visible")

if __name__ == '__main__':
    main()
