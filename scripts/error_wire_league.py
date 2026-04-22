#!/usr/bin/env python3
"""
Error handling wire-up for league.tsx.

Changes:
  1. Import PlatformErrorCard + classifyPlatformError
  2. Add rosterError + waiverError state
  3. Rewrite fetchRoster catch block to store error
  4. Rewrite fetchWaivers catch block to store error
  5. Render PlatformErrorCard at the top of the roster tab
  6. Render PlatformErrorCard at the top of the waivers tab

Requires PlatformErrorCard.tsx already dropped in app/components/.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/error_wire_league.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "app" / "(tabs)" / "league.tsx"

REPLACEMENTS = [
    # ── 1. Import PlatformErrorCard ─────────────────────────────────────────
    # Anchor on the existing HeatIcon imports that were added in the Heat
    # wire-up session so we have a stable anchor and ensure idempotency.
    (
        "add PlatformErrorCard imports",
        "import { useHeatAccess } from '../hooks/useHeatAccess';\n"
        "import { getMyYahooTeam,",
        "import { useHeatAccess } from '../hooks/useHeatAccess';\n"
        "import { PlatformErrorCard, classifyPlatformError } from '../components/PlatformErrorCard';\n"
        "import { getMyYahooTeam,",
    ),

    # ── 2. Add rosterError + waiverError state ─────────────────────────────
    # Anchor on the heat state lines so idempotency is preserved — the NEW
    # content includes "heatUpgradeVisible" which won't re-match OLD.
    (
        "add error state",
        "  const [sortByHeat, setSortByHeat] = useState(false);\n"
        "  const [heatUpgradeVisible, setHeatUpgradeVisible] = useState(false);\n\n"
        "  const PLATFORM_COLOR",
        "  const [sortByHeat, setSortByHeat] = useState(false);\n"
        "  const [heatUpgradeVisible, setHeatUpgradeVisible] = useState(false);\n"
        "  const [rosterError, setRosterError] = useState<any>(null);\n"
        "  const [waiverError, setWaiverError] = useState<any>(null);\n\n"
        "  const PLATFORM_COLOR",
    ),

    # ── 3. Rewrite fetchRoster to capture error ─────────────────────────────
    (
        "rewrite fetchRoster catch",
        "  const fetchRoster = async () => {\n"
        "    try {\n"
        "      setLoading(true);\n"
        "      if      (platformStr === 'espn')  await fetchESPNRoster();\n"
        "      else if (platformStr === 'yahoo') await fetchYahooRoster();\n"
        "      else                              await fetchSleeperRoster();\n"
        "    } catch (err) { console.error('fetchRoster:', err); }\n"
        "    finally { setLoading(false); }\n"
        "  };",

        "  const fetchRoster = async () => {\n"
        "    try {\n"
        "      setLoading(true);\n"
        "      setRosterError(null);\n"
        "      if      (platformStr === 'espn')  await fetchESPNRoster();\n"
        "      else if (platformStr === 'yahoo') await fetchYahooRoster();\n"
        "      else                              await fetchSleeperRoster();\n"
        "    } catch (err) {\n"
        "      console.error('fetchRoster:', err);\n"
        "      setRosterError(err);\n"
        "    }\n"
        "    finally { setLoading(false); }\n"
        "  };",
    ),

    # ── 4. Rewrite fetchWaivers catch block ─────────────────────────────────
    # The setWaiverLoading(true) at the top and the catch+finally at the end.
    # We wrap the whole existing try body with error clearing.
    (
        "rewrite fetchWaivers start",
        "  const fetchWaivers = async () => {\n"
        "    setWaiverLoading(true);\n"
        "    try {\n"
        "      if (platformStr === 'sleeper') {",
        "  const fetchWaivers = async () => {\n"
        "    setWaiverLoading(true);\n"
        "    setWaiverError(null);\n"
        "    try {\n"
        "      if (platformStr === 'sleeper') {",
    ),

    (
        "rewrite fetchWaivers catch",
        "      }\n"
        "    } catch (err) { console.error(err); }\n"
        "    finally { setWaiverLoading(false); }",
        "      }\n"
        "    } catch (err) {\n"
        "      console.error(err);\n"
        "      setWaiverError(err);\n"
        "    }\n"
        "    finally { setWaiverLoading(false); }",
    ),

    # ── 5. Render error card inside Roster tab ──────────────────────────────
    # Anchor on the sectionHeader for STARTERS which opens the roster content.
    (
        "render rosterError card",
        "      ) : activeTab === 'roster' ? (\n"
        "        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false}>\n"
        "          <View style={styles.sectionHeader}>\n"
        "            <View style={styles.sectionAccent} />\n"
        "            <Text style={styles.sectionLabel}>STARTERS</Text>",
        "      ) : activeTab === 'roster' ? (\n"
        "        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false}>\n"
        "          {rosterError ? (() => {\n"
        "            const c = classifyPlatformError(rosterError);\n"
        "            return (\n"
        "              <PlatformErrorCard\n"
        "                kind={c.kind}\n"
        "                platform={c.platform ?? (platformStr as any)}\n"
        "                message={c.message}\n"
        "                onRetry={fetchRoster}\n"
        "              />\n"
        "            );\n"
        "          })() : null}\n"
        "          <View style={styles.sectionHeader}>\n"
        "            <View style={styles.sectionAccent} />\n"
        "            <Text style={styles.sectionLabel}>STARTERS</Text>",
    ),

    # ── 6. Render error card inside Waivers tab ─────────────────────────────
    # Anchor on the waivers ScrollView that opens. The filteredWaivers map
    # is the next key marker after the error card insertion point.
    (
        "render waiverError card",
        "            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false}>\n"
        "              {filteredWaivers.map((p, i) => renderPlayer(p, true, i))}",
        "            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false}>\n"
        "              {waiverError ? (() => {\n"
        "                const c = classifyPlatformError(waiverError);\n"
        "                return (\n"
        "                  <PlatformErrorCard\n"
        "                    kind={c.kind}\n"
        "                    platform={c.platform ?? (platformStr as any)}\n"
        "                    message={c.message}\n"
        "                    onRetry={fetchWaivers}\n"
        "                  />\n"
        "                );\n"
        "              })() : null}\n"
        "              {filteredWaivers.map((p, i) => renderPlayer(p, true, i))}",
    ),
]


def patch_file():
    if not TARGET.exists():
        print(f"ERROR: {TARGET} not found")
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
            failed.append(f"{desc} ({count} matches)")
            print(f"  [AMBIG]    {desc} ({count} matches)")

    if failed:
        print("\nWARNING: did not apply cleanly. File NOT modified.")
        for f in failed:
            print(f"  - {f}")
        sys.exit(2)

    if content == original:
        print("\nNo changes.")
        return

    TARGET.write_text(content)
    print(f"\n✓ Patched {TARGET.name} ({applied} applied, {skipped} already)")


if __name__ == "__main__":
    print("=" * 60)
    print("Error handling wire-up — league.tsx")
    print("=" * 60)
    print()
    patch_file()
    print()
    print("Next: python3 scripts/error_wire_rankings.py")
