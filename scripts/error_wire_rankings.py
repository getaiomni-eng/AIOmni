#!/usr/bin/env python3
"""
Error handling wire-up for rankings.tsx community mode.

Changes:
  1. Import PlatformErrorCard + classifyPlatformError
  2. Add communityError state
  3. Rewrite loadCommunityRankings to capture errors
  4. Render error card in community ScrollView

Requires PlatformErrorCard.tsx already in app/components/.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/error_wire_rankings.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "app" / "(tabs)" / "rankings.tsx"

REPLACEMENTS = [
    # ── 1. Import PlatformErrorCard ─────────────────────────────────────────
    # Anchor on the existing heat imports + following useHeatAccess for idempotency.
    (
        "add PlatformErrorCard imports",
        "import { useHeatAccess, HeatAccess } from '../hooks/useHeatAccess';\n\n"
        "type Format",
        "import { useHeatAccess, HeatAccess } from '../hooks/useHeatAccess';\n"
        "import { PlatformErrorCard, classifyPlatformError } from '../components/PlatformErrorCard';\n\n"
        "type Format",
    ),

    # ── 2. Add communityError state ─────────────────────────────────────────
    # Anchor on [overrides...setOverrides] line which is uniquely stable
    # after Hour 2 overrides landed.
    (
        "add communityError state",
        "  const [overrides, setOverrides] = useState<Map<string, number>>(new Map());\n"
        "  const heatAccess = useHeatAccess();",
        "  const [overrides, setOverrides] = useState<Map<string, number>>(new Map());\n"
        "  const [communityError, setCommunityError] = useState<any>(null);\n"
        "  const heatAccess = useHeatAccess();",
    ),

    # ── 3. Rewrite loadCommunityRankings to capture error ──────────────────
    (
        "rewrite loadCommunityRankings",
        "  const loadCommunityRankings = async () => {\n"
        "    setLoading(true);\n"
        "    try {\n"
        "      const data = await getEngineRankings(format);\n"
        "      if (data.length > 0) setCommunityData(await mergeHeat(data));\n"
        "    } catch (e) {\n"
        "      console.log('getEngineRankings error:', e);\n"
        "    } finally {\n"
        "      setLoading(false);\n"
        "    }\n"
        "  };",

        "  const loadCommunityRankings = async () => {\n"
        "    setLoading(true);\n"
        "    setCommunityError(null);\n"
        "    try {\n"
        "      const data = await getEngineRankings(format);\n"
        "      if (data.length > 0) setCommunityData(await mergeHeat(data));\n"
        "    } catch (e) {\n"
        "      console.log('getEngineRankings error:', e);\n"
        "      setCommunityError(e);\n"
        "    } finally {\n"
        "      setLoading(false);\n"
        "    }\n"
        "  };",
    ),

    # ── 4. Render error card in the community ScrollView ──────────────────
    # After Hour's-prospects-fix, community branch is:
    #   ) : mode === 'community' ? (
    #     <ScrollView ...>
    #       <Header />
    #       {!loading && grouped.map(...)}
    # We insert the error card right after <Header /> so it's the first
    # thing users see if data failed to load.
    (
        "render communityError card",
        "        ) : mode === 'community' ? (\n"
        "          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SP[3], paddingBottom: 100 }} showsVerticalScrollIndicator={false}>\n"
        "            <Header />\n"
        "            {!loading && grouped.map",

        "        ) : mode === 'community' ? (\n"
        "          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SP[3], paddingBottom: 100 }} showsVerticalScrollIndicator={false}>\n"
        "            <Header />\n"
        "            {communityError ? (() => {\n"
        "              const c = classifyPlatformError(communityError);\n"
        "              return (\n"
        "                <PlatformErrorCard\n"
        "                  kind={c.kind}\n"
        "                  message={c.message}\n"
        "                  onRetry={loadCommunityRankings}\n"
        "                />\n"
        "              );\n"
        "            })() : null}\n"
        "            {!loading && grouped.map",
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
    print("Error handling wire-up — rankings.tsx")
    print("=" * 60)
    print()
    patch_file()
    print()
    print("Final step: npx tsc --noEmit")
