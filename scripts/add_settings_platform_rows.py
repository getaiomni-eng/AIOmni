#!/usr/bin/env python3
"""
Add MFL + Fleaflicker rows to Settings MY PLATFORMS card.

Matches the existing exact pattern (s.row, s.dot, s.rowLabel, s.rowValue,
palette.green for connected, palette.amber for "Connect →"). Also moves
the borderBottomWidth: 0 from Yahoo to the new last row (Fleaflicker)
so the dividers render correctly.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/add_settings_platform_rows.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "app" / "(tabs)" / "settings.tsx"

# Anchor: the closing of the Yahoo TouchableOpacity. We add MFL + Fleaflicker
# right after Yahoo's closing tag. We also need to remove the Yahoo
# borderBottomWidth:0 styling so it gets a divider, and put borderBottomWidth:0
# on Fleaflicker (the new last row).

# To do this safely in one pass, we look for two distinct fingerprints:

# 1. Change Yahoo's row style: drop the borderBottomWidth:0
OLD_YAHOO_OPEN = "<TouchableOpacity style={[s.row, { borderBottomWidth: 0 }]} onPress={yahooLinked ? handleDisconnectYahoo"
NEW_YAHOO_OPEN = "<TouchableOpacity style={s.row} onPress={yahooLinked ? handleDisconnectYahoo"

# 2. Find the closing of the Yahoo TouchableOpacity. The Yahoo block ends
#    with the rowValue Text and a closing </TouchableOpacity>. We anchor on
#    a unique substring within the Yahoo close.
YAHOO_CLOSE_ANCHOR = """              } catch (err: any) { Alert.alert('Yahoo Error', err.message || 'Failed to connect'); }"""

# What we insert after the Yahoo TouchableOpacity closes — the two new rows.
# Using exactly the same style names + color hex codes from your existing
# platform strip (mfl: chartreuse #e4ff1a, fleaflicker: aqua #1be7ff).

NEW_ROWS = """
          <TouchableOpacity style={s.row} onPress={mflLinked
            ? () => Alert.alert('MFL', 'Disconnect MFL?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Disconnect', style: 'destructive', onPress: async () => {
                  const { clearMflCredentials } = require('../../services/platform/mfl');
                  await clearMflCredentials();
                  setMflLinked(false);
                }},
              ])
            : () => router.push('/mfl-login' as any)}>
            <View style={[s.dot, { backgroundColor: '#e4ff1a' }]} />
            <Text style={s.rowLabel}>MFL</Text>
            <Text style={[s.rowValue, { color: mflLinked ? palette.green : palette.amber }]}>{mflLinked ? 'Connected' : 'Connect →'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.row, { borderBottomWidth: 0 }]} onPress={fleaflickerLinked
            ? () => Alert.alert('Fleaflicker', 'Disconnect Fleaflicker?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Disconnect', style: 'destructive', onPress: async () => {
                  const { clearFleaflickerCredentials } = require('../../services/platform/fleaflicker');
                  await clearFleaflickerCredentials();
                  setFleaflickerLinked(false);
                }},
              ])
            : () => router.push('/fleaflicker-login' as any)}>
            <View style={[s.dot, { backgroundColor: '#1be7ff' }]} />
            <Text style={s.rowLabel}>Fleaflicker</Text>
            <Text style={[s.rowValue, { color: fleaflickerLinked ? palette.green : palette.amber }]}>{fleaflickerLinked ? 'Connected' : 'Connect →'}</Text>
          </TouchableOpacity>"""


def main():
    if not TARGET.exists():
        print(f"ERROR: {TARGET} not found")
        sys.exit(1)

    s = TARGET.read_text()
    original = s

    if "MFL" in s and "Fleaflicker" in s and "mfl-login" in s:
        print("  [ALREADY]  MFL + Fleaflicker rows already in settings.tsx")
        return

    # Step 1: change Yahoo to no longer be the last row (remove borderBottomWidth:0)
    if OLD_YAHOO_OPEN in s:
        s = s.replace(OLD_YAHOO_OPEN, NEW_YAHOO_OPEN)
        print("  [APPLIED]  Yahoo row no longer marked as last (divider restored)")
    elif NEW_YAHOO_OPEN in s:
        print("  [ALREADY]  Yahoo row already updated")
    else:
        print("  [MISSING]  could not find Yahoo opening TouchableOpacity")
        sys.exit(2)

    # Step 2: find where Yahoo's TouchableOpacity ENDS and insert new rows after it.
    # Strategy: find the catch block that's INSIDE Yahoo's onPress, then walk
    # forward to find the closing </TouchableOpacity>. We anchor on the catch.
    if YAHOO_CLOSE_ANCHOR not in s:
        print("  [MISSING]  could not find Yahoo close anchor")
        sys.exit(2)

    catch_idx = s.index(YAHOO_CLOSE_ANCHOR)
    # From the catch line, find the next </TouchableOpacity>
    close_tag = "</TouchableOpacity>"
    close_idx = s.index(close_tag, catch_idx)
    insert_at = close_idx + len(close_tag)

    s = s[:insert_at] + NEW_ROWS + s[insert_at:]
    print("  [APPLIED]  inserted MFL + Fleaflicker rows after Yahoo")

    if s != original:
        TARGET.write_text(s)
        print(f"\n✓ {TARGET.name} updated")


if __name__ == "__main__":
    print("=" * 60)
    print("Add MFL + Fleaflicker rows to Settings UI")
    print("=" * 60)
    print()
    main()
    print()
    print("Next: npx tsc --noEmit")
