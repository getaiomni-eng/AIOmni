#!/usr/bin/env python3
"""
Rename the bottom-nav "Draft" tab label to "The O".

The internal route name stays as "draft" (file path app/(tabs)/draft.tsx
doesn't change, and the TabIcon lookup key stays "draft"). Only the
user-visible label changes.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/hour3_tab_label.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "app" / "(tabs)" / "_layout.tsx"

# Anchor on the draft tab block so we don't accidentally rename anything else
# with the string "Draft" — e.g., the "Trade" tab if it had a similar pattern.
OLD = """      <Tabs.Screen
        name="draft"
        options={{
          title: 'Draft',"""

NEW = """      <Tabs.Screen
        name="draft"
        options={{
          title: 'The O',"""


def main():
    if not TARGET.exists():
        print(f"ERROR: {TARGET} not found.")
        sys.exit(1)

    content = TARGET.read_text()
    count = content.count(OLD)

    if count == 1:
        TARGET.write_text(content.replace(OLD, NEW))
        print(f"✓ Renamed 'Draft' → 'The O' in {TARGET.name}")
    elif count == 0 and NEW in content:
        print("Already renamed.")
    elif count == 0:
        print(f"ERROR: couldn't find the draft tab block in {TARGET.name}.")
        sys.exit(2)
    else:
        print(f"ERROR: found {count} matches; expected exactly 1.")
        sys.exit(2)


if __name__ == "__main__":
    main()
