#!/usr/bin/env python3
"""
Switch "THE" color on TheOLogo wordmarks from amber (#ffb800) to brand-white
(#f0f4f5) — matches the AIOmniWordmark convention where "AI" and "MNI" are
cream-white and only the Spectrum C carries color.

Leaves ApertureO in the ASK THE O button alone — its color="#000" is correct
on the amber button background.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/hour3_the_o_white.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "app" / "(tabs)" / "draft.tsx"

# Two distinct tag patterns — the 22pt one hits twice (header + modal),
# and str.replace handles both in one pass.
REPLACEMENTS = [
    (
        'hero title: amber → white',
        '<TheOLogo fontSize={36} color="#ffb800" />',
        '<TheOLogo fontSize={36} color="#f0f4f5" />',
        1,  # expected count
    ),
    (
        'header + modal title: amber → white',
        '<TheOLogo fontSize={22} color="#ffb800" />',
        '<TheOLogo fontSize={22} color="#f0f4f5" />',
        2,  # expected count
    ),
]


def main():
    if not TARGET.exists():
        print(f"ERROR: {TARGET} not found.")
        sys.exit(1)

    original = TARGET.read_text()
    content = original
    total_applied = 0

    for desc, old, new, expected in REPLACEMENTS:
        count = content.count(old)
        if count == expected:
            content = content.replace(old, new)
            total_applied += count
            print(f"  [APPLIED × {count}]  {desc}")
        elif count == 0:
            # Already done?
            already = content.count(new)
            if already == expected:
                print(f"  [ALREADY]       {desc}")
            else:
                print(f"  [MISSING]       {desc}")
                print(f"                  Expected {expected} matches, found 0 old / {already} new")
                sys.exit(2)
        else:
            print(f"  [COUNT ERROR]   {desc}: expected {expected}, found {count}")
            sys.exit(2)

    if content == original:
        print("\nNo changes needed.")
        return

    TARGET.write_text(content)
    print(f"\n✓ {total_applied} tag(s) updated in {TARGET.name}")


if __name__ == "__main__":
    print("=" * 60)
    print("THE O wordmarks: amber → brand-white")
    print("=" * 60)
    print()
    main()
