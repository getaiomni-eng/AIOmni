#!/usr/bin/env python3
"""
Export tier helpers from the bridge so rankings.tsx can reuse them.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/hour1_export_tier_helpers.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "services" / "rankings" / "aiomniEngineBridge.ts"

REPLACEMENTS = [
    # Anchor on preceding newline so the OLD pattern no longer matches after
    # patching (prevents substring match turning 'export' into 'export export').
    (
        "export assignGlobalTier",
        "\nfunction assignGlobalTier(rank: number): number {",
        "\nexport function assignGlobalTier(rank: number): number {",
    ),
    (
        "export assignPositionalTier",
        "\nfunction assignPositionalTier(posRank: number): number {",
        "\nexport function assignPositionalTier(posRank: number): number {",
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
        print("\nWARNING: File NOT modified.")
        for f in failed:
            print(f"  - {f}")
        sys.exit(2)

    if content == original:
        print(f"\nNo changes needed ({skipped} already exported).")
        return

    TARGET.write_text(content)
    print(f"\n✓ Patched {TARGET}  ({applied} applied, {skipped} already)")


if __name__ == "__main__":
    print("=" * 60)
    print("AIOmni — Export Tier Helpers from Bridge")
    print("=" * 60)
    print()
    patch_file()
