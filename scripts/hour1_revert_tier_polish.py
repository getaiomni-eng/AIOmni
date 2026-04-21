#!/usr/bin/env python3
"""
Revert the per-position tier grouping/label polish.

With global-rank tiers coming from the updated bridge, tiers are monotonic
and position-split grouping creates no new value. Back to tier-only grouping
with the plain TIER_NAMES[tier] label.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/hour1_revert_tier_polish.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "app" / "(tabs)" / "rankings.tsx"

REPLACEMENTS = [
    # 1. Revert grouping — back to tier-only split
    (
        "revert grouping to tier-only",
        """  const grouped: { tier: number; position: string; players: RankedPlayer[] }[] = [];
  let lastTier = -1;
  let lastPos = '';
  filtered.forEach((p, i) => {
    if (p.tier !== lastTier || p.position !== lastPos) {
      grouped.push({ tier: p.tier, position: p.position, players: [] });
      lastTier = p.tier;
      lastPos = p.position;
    }
    grouped[grouped.length - 1].players.push({ ...p, rank: i + 1 });
  });""",
        """  const grouped: { tier: number; players: RankedPlayer[] }[] = [];
  let lastTier = -1;
  filtered.forEach((p, i) => {
    if (p.tier !== lastTier) { grouped.push({ tier: p.tier, players: [] }); lastTier = p.tier; }
    grouped[grouped.length - 1].players.push({ ...p, rank: i + 1 });
  });""",
    ),

    # 2. Revert divider label — drop position prefix
    (
        "revert tier divider label",
        "                  <Text style={s.tierLabel}>{group.position} · {TIER_NAMES[group.tier]}</Text>",
        "                  <Text style={s.tierLabel}>{TIER_NAMES[group.tier]}</Text>",
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
        print(f"\nNo changes needed ({skipped} already reverted).")
        return

    TARGET.write_text(content)
    print(f"\n✓ Patched {TARGET}  ({applied} applied, {skipped} already)")


if __name__ == "__main__":
    print("=" * 60)
    print("AIOmni — Revert Tier Polish (global tiers from bridge)")
    print("=" * 60)
    print()
    patch_file()
    print()
    print("Reload Expo. Tiers should now span contiguous rank blocks:")
    print("  TIER 1 — ELITE      (ranks 1–6)")
    print("  TIER 2 — BLUE CHIP  (ranks 7–15)")
    print("  TIER 3 — STARTER    (ranks 16–30)")
    print("  TIER 4 — FLEX PLAY  (ranks 31–60)")
    print("  TIER 5 — UPSIDE     (61+)")
