#!/usr/bin/env python3
"""
AIOmni — surgical rookie fix for app/(tabs)/league.tsx

Changes one line in fetchWaivers():
  Before: p.search_rank && p.search_rank < 1000
  After:  (p.search_rank == null || p.search_rank < 1000)

Rationale: 2026 incoming rookies have search_rank=null in Sleeper's DB.
The old check falsey-rejected them because `null && anything === false`.
The new check allows nulls through (rookies) while still capping at 1000
for veterans (so retired randos stay out).

Run from project root: python3 patch_real_waivers.py
"""

import sys, os

FILE = 'app/(tabs)/league.tsx'

def main():
    if not os.path.exists(FILE):
        print(f"✗ File not found: {FILE}")
        sys.exit(1)

    with open(FILE, 'r') as f:
        src = f.read()

    old = "p.search_rank && p.search_rank < 1000 &&"
    new = "(p.search_rank == null || p.search_rank < 1000) &&"

    if old not in src:
        print(f"✗ Filter line not found — may already be patched or file changed")
        sys.exit(1)

    count = src.count(old)
    if count > 1:
        print(f"✗ Ambiguous ({count} matches) — refusing to patch")
        sys.exit(1)

    src = src.replace(old, new)

    with open(FILE, 'w') as f:
        f.write(src)

    print("✓ Patched app/(tabs)/league.tsx")
    print("  Rookies with null search_rank now pass the waiver eligibility check")
    print()
    print("Next: in Metro terminal, press r to reload")
    print("Then: open Armchair → Waivers — rookies should appear")

if __name__ == '__main__':
    main()
