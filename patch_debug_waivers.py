#!/usr/bin/env python3
"""
AIOmni — add diagnostic logging to getAvailablePlayers.

Adds console.log statements at the key decision points:
  1. Did the code path actually run? (isDynasty + activeIds size)
  2. How many candidates are we ending up with?
  3. How many of those are rookies?
  4. What are the top 15 by score?

Look for "[AIOMNI_DEBUG_v3]" in the Metro terminal output.

This patch is REVERSIBLE — the debug lines are clearly marked so we can
strip them out later with a simple grep.

Run: python3 patch_debug_waivers.py
"""

import sys, os

FILE = 'services/platform/sleeper.ts'

def main():
    if not os.path.exists(FILE):
        print(f"✗ File not found: {FILE}")
        sys.exit(1)

    with open(FILE, 'r') as f:
        src = f.read()

    # Find the candidates.sort line - that's where we'll inject diagnostics
    old = """    candidates.sort((a, b) => b.score - a.score);"""

    new = """    // [AIOMNI_DEBUG_v3] BEGIN
    console.log('[AIOMNI_DEBUG_v3] league:', league.name, 'isDynasty:', isDynasty);
    console.log('[AIOMNI_DEBUG_v3] rostered:', rostered.size, 'activeIds:', activeIds.size, 'trending.adds:', trending.adds.size);
    const _rookieCandidates = candidates.filter(c => {
      const p = c.raw;
      return (p.years_exp === 0 || p.years_exp == null) && p.search_rank == null;
    });
    console.log('[AIOMNI_DEBUG_v3] candidates total:', candidates.length, 'rookies in candidates:', _rookieCandidates.length);
    console.log('[AIOMNI_DEBUG_v3] sample rookies:', _rookieCandidates.slice(0, 5).map(c => `${c.raw.full_name} score=${c.score}`).join(' | '));
    // [AIOMNI_DEBUG_v3] END
    candidates.sort((a, b) => b.score - a.score);
    // [AIOMNI_DEBUG_v3] post-sort top 15:
    console.log('[AIOMNI_DEBUG_v3] TOP 15:', candidates.slice(0, 15).map(c => `${c.raw.full_name}(${c.raw.position},sr=${c.raw.search_rank},score=${c.score})`).join(' | '));"""

    if old not in src:
        print(f"✗ Couldn't find candidates.sort line in {FILE}")
        sys.exit(1)

    if src.count(old) > 1:
        print(f"✗ Ambiguous match")
        sys.exit(1)

    src = src.replace(old, new)

    with open(FILE, 'w') as f:
        f.write(src)

    print("✓ Added diagnostic logging to sleeper.ts")
    print()
    print("Next steps:")
    print("  1. Full Metro restart with cache clear:")
    print("     pkill -f 'expo start' ; cd /Users/patrickmeyer/AIOmni && rm -rf node_modules/.cache .expo && npx expo start --go -c")
    print("  2. Open app, navigate to Armchair → Waivers")
    print("  3. Copy the [AIOMNI_DEBUG_v3] lines from the Metro terminal and paste them back")

if __name__ == '__main__':
    main()
