#!/usr/bin/env python3
"""
Hour 1 polish: per-position tier labels.

The engine assigns tiers per-position, so a VOR-sorted list naturally mixes
positions within the same tier number. Splitting groups by (tier, position)
instead of just tier produces cleaner section dividers like
'WR · TIER 1 — ELITE' instead of three interleaved 'TIER 1 — ELITE' headers.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/hour1_polish_tier_labels.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "app" / "(tabs)" / "rankings.tsx"

REPLACEMENTS = [
    # 1. Update grouping logic to split on (tier, position) change
    (
        "grouping logic — split by tier AND position",
        """  const grouped: { tier: number; players: RankedPlayer[] }[] = [];
  let lastTier = -1;
  filtered.forEach((p, i) => {
    if (p.tier !== lastTier) { grouped.push({ tier: p.tier, players: [] }); lastTier = p.tier; }
    grouped[grouped.length - 1].players.push({ ...p, rank: i + 1 });
  });""",
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
    ),

    # 2. Update the divider label to prefix the position
    (
        "tier divider label — prepend position",
        "                  <Text style={s.tierLabel}>{TIER_NAMES[group.tier]}</Text>",
        "                  <Text style={s.tierLabel}>{group.position} · {TIER_NAMES[group.tier]}</Text>",
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
    print("AIOmni Hour 1 Polish — Per-Position Tier Labels")
    print("=" * 60)
    print()
    patch_file()
    print()
    print("Reload Expo Go — dividers now show 'WR · TIER 1 — ELITE' etc.")
