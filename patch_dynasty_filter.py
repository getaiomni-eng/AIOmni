#!/usr/bin/env python3
"""
AIOmni — tighten dynasty waiver eligibility filter.

Problem: Ben Roethlisberger (and other retired players) were appearing in
dynasty waiver lists because Sleeper's player DB still flags many retired
players as active=true.

Fix: For dynasty leagues, require the player to EITHER be on the canonical
active NFL roster list (activeIds from nfl_players Supabase table) OR be
a genuine rookie (years_exp 0 or undefined, age <= 24).

Run from project root: python3 patch_dynasty_filter.py
"""

import sys, os

FILE = 'services/platform/sleeper.ts'

def main():
    if not os.path.exists(FILE):
        print(f"✗ File not found: {FILE}")
        sys.exit(1)

    with open(FILE, 'r') as f:
        src = f.read()

    old = """      if (isDynasty) {
        if (p.active === false) return false;
        if (p.search_rank && p.search_rank >= 9999999) return false;
        return true;
      }"""

    new = """      if (isDynasty) {
        if (p.active === false) return false;
        if (p.search_rank && p.search_rank >= 9999999) return false;
        // Must be on canonical active NFL list OR a genuine rookie/prospect.
        // Sleeper's `active` flag is unreliable — retired players like Big Ben
        // still show active=true, so we cross-check against the real NFL roster.
        if (activeIds.size > 0) {
          if (activeIds.has(pid)) return true;
          // Not on active list — only allow if clearly a rookie or prospect
          const isRookie = (p.years_exp === 0 || p.years_exp === undefined || p.years_exp === null)
                        && (p.age === undefined || p.age === null || p.age <= 24);
          return isRookie;
        }
        return true;
      }"""

    if old not in src:
        print(f"✗ Expected block not found — sleeper.ts may have been modified")
        print(f"  Looking for the dynasty branch of isEligible()")
        sys.exit(1)

    count = src.count(old)
    if count > 1:
        print(f"✗ Ambiguous: block matches {count} places — refusing to patch")
        sys.exit(1)

    src = src.replace(old, new)

    with open(FILE, 'w') as f:
        f.write(src)

    print("✓ Patched services/platform/sleeper.ts")
    print("  Dynasty waivers now require active NFL roster OR genuine rookie status")
    print()
    print("Next: npx tsc --noEmit")
    print("Then: reload Expo, open Armchair → Waivers — no more Big Ben")

if __name__ == '__main__':
    main()
