#!/usr/bin/env python3
"""
Tier source depends on position filter.

When position === 'ALL', use global-rank tier (elite = top 6 overall).
When position is set (QB/RB/WR/TE/K), use engine's per-position tier
so top players at that position group correctly under Tier 1.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/hour1_positional_tier_switch.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "app" / "(tabs)" / "rankings.tsx"

REPLACEMENTS = [
    (
        "grouping — use positional tier when filtering by position",
        """  const grouped: { tier: number; players: RankedPlayer[] }[] = [];
  let lastTier = -1;
  filtered.forEach((p, i) => {
    if (p.tier !== lastTier) { grouped.push({ tier: p.tier, players: [] }); lastTier = p.tier; }
    grouped[grouped.length - 1].players.push({ ...p, rank: i + 1 });
  });""",
        """  // When position === 'ALL', use the global-rank tier (elite = top 6).
  // When filtering by position, use the engine's per-position tier so the
  // top N players at that position group under Tier 1.
  const grouped: { tier: number; players: RankedPlayer[] }[] = [];
  let lastTier = -1;
  filtered.forEach((p, i) => {
    const t = position === 'ALL' ? p.tier : ((p as any).positionalTier ?? p.tier);
    if (t !== lastTier) { grouped.push({ tier: t, players: [] }); lastTier = t; }
    grouped[grouped.length - 1].players.push({ ...p, rank: i + 1 });
  });""",
    ),
]


def patch_file():
    if not TARGET.exists():
        print(f"ERROR: {TARGET} not found.")
        sys.exit(1)

    original = TARGET.read_text()
    content = original
    applied = 0
    skipped = 0
    failed = []

    for desc, old, new in REPLACEMENTS:
        count = content.count(old)
        if count == 1:
            content = content.replace(old, new)
            applied += 1
            print(f"  [APPLIED]  {desc}")
        elif count == 0:
            if new.strip() == "":
                skipped += 1
                print(f"  [ALREADY]  {desc}")
            else:
                fingerprint = new.strip()[:60]
                if fingerprint in content:
                    skipped += 1
                    print(f"  [ALREADY]  {desc}")
                else:
                    failed.append(desc)
                    print(f"  [MISSING]  {desc}")
        else:
            failed.append(f"{desc} (appears {count} times)")
            print(f"  [AMBIG]    {desc} — appears {count} times")

    if failed:
        print()
        print("WARNING: Did not apply cleanly. File NOT modified.")
        for f in failed:
            print(f"  - {f}")
        sys.exit(2)

    if content == original:
        print(f"\nNo changes needed ({skipped} already patched).")
        return

    TARGET.write_text(content)
    print(f"\n✓ Patched {TARGET}  ({applied} applied, {skipped} already)")


if __name__ == "__main__":
    print("=" * 60)
    print("AIOmni — Positional Tier Switch")
    print("=" * 60)
    print()
    patch_file()
    print()
    print("Reload Expo:")
    print("  ALL filter  → TIER 1 spans top 6 overall (Chase, Bijan, ...)")
    print("  QB filter   → TIER 1 spans top QBs (Allen, Lamar, Hurts...)")
    print("  RB filter   → TIER 1 spans top RBs (Bijan, Saquon, Gibbs...)")
