#!/usr/bin/env python3
"""
Hour 1 hotfix: duplicate React key error.

With the engine, tiers are per-position (not global), so when the VOR-sorted
list mixes positions, group.tier values repeat. Use the group's array index
as the React key instead.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/hour1_hotfix_keys.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "app" / "(tabs)" / "rankings.tsx"

REPLACEMENTS = [
    # The ScrollView branch (community + prospects view)
    (
        "scrollview branch — use array index for React key",
        """            {!loading && grouped.map(group => (
              <React.Fragment key={group.tier}>""",
        """            {!loading && grouped.map((group, gIdx) => (
              <React.Fragment key={`tier-${gIdx}-${group.tier}`}>""",
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
            fingerprint = new.strip()[:60] if new.strip() else None
            if fingerprint and fingerprint in content:
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
    print("AIOmni Hour 1 Hotfix — Duplicate React Key")
    print("=" * 60)
    print()
    patch_file()
    print()
    print("Reload Expo Go — the Console Error should be gone.")
