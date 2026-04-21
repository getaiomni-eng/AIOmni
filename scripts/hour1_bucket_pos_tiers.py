#!/usr/bin/env python3
"""
Bridge patch: fixed-bucket positional tiers.

Engine gap-detection produces singleton top tiers for positions with
skewed VOR distributions (QB most notably). Replace per-position tier
output with fixed bucket breakpoints based on position rank. Same
predictable-sizing approach as the global tier buckets.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/hour1_bucket_pos_tiers.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "services" / "rankings" / "aiomniEngineBridge.ts"

REPLACEMENTS = [
    # 1. Add assignPositionalTier helper next to assignGlobalTier.
    #    OLD anchors on the closing brace + the next comment block so that
    #    after patching (which inserts assignPositionalTier in between), the
    #    original OLD text no longer matches — script is idempotent.
    (
        "add assignPositionalTier helper",
        """function assignGlobalTier(rank: number): number {
  if (rank <= 6)  return 1;
  if (rank <= 15) return 2;
  if (rank <= 30) return 3;
  if (rank <= 60) return 4;
  return 5;
}

// ─── UI RankedPlayer → engine InputPlayer ───────────────────────────────────""",
        """function assignGlobalTier(rank: number): number {
  if (rank <= 6)  return 1;
  if (rank <= 15) return 2;
  if (rank <= 30) return 3;
  if (rank <= 60) return 4;
  return 5;
}

// Per-position tier buckets. Engine's gap-detection clustering can produce
// singleton top tiers when one position has concentrated elite talent (Allen,
// Lamar, Hurts each sit in their own VOR gap). Fixed buckets based on posRank
// give predictable tier sizes regardless of VOR distribution:
//   Tier 1  posRank 1–3     Elite at position
//   Tier 2  posRank 4–8     Blue chip
//   Tier 3  posRank 9–15    Starter
//   Tier 4  posRank 16–30   Flex / bench depth
//   Tier 5  posRank 31+     Upside / dart throws
function assignPositionalTier(posRank: number): number {
  if (posRank <= 3)  return 1;
  if (posRank <= 8)  return 2;
  if (posRank <= 15) return 3;
  if (posRank <= 30) return 4;
  return 5;
}

// ─── UI RankedPlayer → engine InputPlayer ───────────────────────────────────""",
    ),

    # 2. Use assignPositionalTier in toUIPlayer, preserve engine's algorithmic tier
    (
        "toUIPlayer — use bucket-based positional tier",
        """    // Extend UIRankedPlayer with the engine's per-position tier for any
    // feature that needs it. Not in the UI RankedPlayer interface yet —
    // callers can cast or access via (player as any).positionalTier.
    ...(enginePlayer.tier !== undefined ? { positionalTier: enginePlayer.tier } : {}),
  };
}""",
        """    // positionalTier = bucket-based tier for UI display (predictable sizes).
    // algorithmicTier = engine's natural-cliff tier (for trade/draft analysis).
    // Neither is in the UI RankedPlayer interface yet — access via cast.
    positionalTier: assignPositionalTier(enginePlayer.posRank),
    algorithmicTier: enginePlayer.tier,
  } as any;
}""",
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
    print("AIOmni — Fixed-Bucket Positional Tiers")
    print("=" * 60)
    print()
    patch_file()
    print()
    print("Reload Expo, toggle to QB/RB/WR filter.")
    print("Tier 1 should now hold 3 players, Tier 2 should hold 5, etc.")
