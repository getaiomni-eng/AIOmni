#!/usr/bin/env python3
"""
Fix duplicate rendering in Rankings tab prospects mode.

Bug: the outer ternary treats anything-that's-not-'mine' as community mode,
so the community ScrollView renders even when mode === 'prospects'. Then
the separate `{mode === 'prospects' && ...}` block renders on top of it.
Two stacked views, both visible, both scrolling.

Fix: make the ternary specifically guard the community branch with
`mode === 'community'`. For prospects mode, neither the mine FlatList nor
the community ScrollView renders — only the dedicated prospects block does.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/fix_prospects_duplicate.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "app" / "(tabs)" / "rankings.tsx"

# The outer ternary is structured as:
#   {mine && myRanks.length > 0 ? ( ...FlatList ) : ( ...community ScrollView )}
# We change that to:
#   {mine && myRanks.length > 0 ? (
#      ...FlatList
#   ) : mode === 'community' ? (
#      ...community ScrollView
#   ) : null}
#
# Anchor on the `) : (` boundary plus its surrounding lines so we have a
# unique match. After the patch runs, those characters become `) : mode ===
# 'community' ? (` which no longer matches the OLD.
OLD = """        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SP[3], paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
            <Header />"""

NEW = """        ) : mode === 'community' ? (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SP[3], paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
            <Header />"""


# Second patch: close out the ternary with `: null)` instead of `)`
# immediately before the prospects block.
OLD2 = """            ))}
          </ScrollView>
        )}


        {mode === 'prospects' && ("""

NEW2 = """            ))}
          </ScrollView>
        ) : null}


        {mode === 'prospects' && ("""


def main():
    if not TARGET.exists():
        print(f"ERROR: {TARGET} not found")
        sys.exit(1)

    content = TARGET.read_text()
    applied = 0

    # Patch 1
    count1 = content.count(OLD)
    if count1 == 1:
        content = content.replace(OLD, NEW)
        applied += 1
        print("  [APPLIED]  guard community branch with mode === 'community'")
    elif count1 == 0 and "mode === 'community' ? (" in content:
        print("  [ALREADY]  guard community branch")
    else:
        print(f"  [MISSING]  community branch guard (expected 1, got {count1})")
        sys.exit(2)

    # Patch 2
    count2 = content.count(OLD2)
    if count2 == 1:
        content = content.replace(OLD2, NEW2)
        applied += 1
        print("  [APPLIED]  close ternary with null fallback")
    elif count2 == 0 and ": null}" in content and "{mode === 'prospects' && (" in content:
        print("  [ALREADY]  ternary null fallback")
    else:
        print(f"  [MISSING]  ternary close (expected 1, got {count2})")
        sys.exit(2)

    if applied == 0:
        print("\nNo changes needed.")
        return

    TARGET.write_text(content)
    print(f"\n✓ Patched {TARGET.name} ({applied} changes)")


if __name__ == "__main__":
    print("=" * 60)
    print("Fix: prospects-vs-community duplicate rendering")
    print("=" * 60)
    print()
    main()
    print()
    print("Verify:")
    print("  npx tsc --noEmit")
    print("  Reload → tap PROSPECTS → should show ONLY the prospects view,")
    print("    no community rankings showing through beneath.")
