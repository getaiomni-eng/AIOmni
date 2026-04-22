#!/usr/bin/env python3
"""
Heat wire-up for Waivers (league.tsx).

Changes:
  1. Imports HeatIcon, computeHeatBatch, getHeatSignalsMap, useHeatAccess
  2. Adds heatAccess + sortByHeat state inside LeagueScreen component
  3. Merges heat signals into Sleeper waiver fetch (ESPN/Yahoo stays as-is;
     their percentOwned gets picked up later via platform services)
  4. Adds HeatIcon to renderPlayer (left of AI tag) with tier gating
  5. Adds "SORT: 🔥 HEAT" chip above waiver list (Pro-only; triggers
     upgrade modal for lower tiers)
  6. Applies heat sort to filteredWaivers when active

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/heat_wire_waivers.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "app" / "(tabs)" / "league.tsx"

REPLACEMENTS = [
    # ── 1. Imports ──────────────────────────────────────────────────────────
    # Anchor includes following import so OLD doesn't re-match after patch.
    (
        "add heat imports",
        "import PlayerCardModal from '../components/PlayerCardModal';\nimport { getMyYahooTeam",
        "import PlayerCardModal from '../components/PlayerCardModal';\n"
        "import { HeatIcon } from '../components/HeatIcon';\n"
        "import { computeHeatBatch } from '../../services/heat';\n"
        "import { getHeatSignalsMap } from '../../services/heatData';\n"
        "import { useHeatAccess } from '../hooks/useHeatAccess';\n"
        "import { getMyYahooTeam",
    ),

    # ── 2. Add heatAccess + sortByHeat + upgrade modal state ───────────────
    # Include the blank line above PLATFORM_COLOR in the anchor so our insertion
    # doesn't re-match the old pattern.
    (
        "add heat state",
        "  const [playersDb,          setPlayersDb]          = useState<any>({});\n\n"
        "  const PLATFORM_COLOR",
        "  const [playersDb,          setPlayersDb]          = useState<any>({});\n"
        "  const heatAccess = useHeatAccess();\n"
        "  const [sortByHeat, setSortByHeat] = useState(false);\n"
        "  const [heatUpgradeVisible, setHeatUpgradeVisible] = useState(false);\n\n"
        "  const PLATFORM_COLOR",
    ),

    # ── 3. Merge heat signals into Sleeper waiver fetch ────────────────────
    # The setWaiverPlayers call ends with `.map(...))` then `);`. Anchor on
    # the closing `);` that follows the .map line. Insert a follow-up heat
    # enrichment that updates state with heat signals attached.
    (
        "merge heat in Sleeper waiver fetch",
        "            .map((p: any) => ({ id: p.player_id, name: `${p.first_name} ${p.last_name}`, position: p.position, team: p.team, injuryStatus: p.injury_status, isStarter: false }))\n"
        "        );\n"
        "      } else if (platformStr === 'espn') {",
        "            .map((p: any) => ({ id: p.player_id, name: `${p.first_name} ${p.last_name}`, position: p.position, team: p.team, injuryStatus: p.injury_status, isStarter: false }))\n"
        "        );\n"
        "        // Attach Sleeper trending velocity → Heat score.\n"
        "        try {\n"
        "          const heatMap = await getHeatSignalsMap();\n"
        "          setWaiverPlayers(prev => computeHeatBatch(\n"
        "            prev.map(p => ({ ...p, heatSignals: heatMap.get(p.id) })) as any\n"
        "          ) as any);\n"
        "        } catch (e) { console.log('waiver heat merge:', e); }\n"
        "      } else if (platformStr === 'espn') {",
    ),

    # ── 4. Change filteredWaivers to apply heat sort when active ───────────
    (
        "apply heat sort in filteredWaivers",
        "  const filteredWaivers = waiverPlayers.filter(p => selectedPosition === 'ALL' || p.position === selectedPosition);",
        "  const filteredWaivers = (() => {\n"
        "    const base = waiverPlayers.filter(p => selectedPosition === 'ALL' || p.position === selectedPosition);\n"
        "    if (sortByHeat && heatAccess.canSortByHeat) {\n"
        "      return [...base].sort((a, b) => (((b as any).heatScore ?? 0) - ((a as any).heatScore ?? 0)));\n"
        "    }\n"
        "    return base;\n"
        "  })();",
    ),

    # ── 5. Inject HeatIcon render in renderPlayer (left of aiTag) ──────────
    # The renderPlayer function in the real file has a specific pattern —
    # anchor on the line above aiTag (progressTrack end) + aiTag itself.
    # After our insertion, aiTag still exists so OLD could match again, but
    # the HeatIcon block now precedes it. We use the "heatAccess.showIcon"
    # fingerprint in the [ALREADY] check below.
    (
        "add HeatIcon to renderPlayer",
        "          <View style={styles.progressTrack}>\n"
        "            <View style={[styles.progressFill, { width: `${Math.random() * 60 + 20}%`, backgroundColor: active ? posColor : DIM_BORDER }]} />\n"
        "          </View>\n"
        "        </View>\n"
        "        <View style={styles.aiTag}>\n"
        "          <Text style={styles.aiTagText}>AI</Text>\n"
        "        </View>\n"
        "      </TouchableOpacity>\n"
        "    );\n"
        "  };",
        "          <View style={styles.progressTrack}>\n"
        "            <View style={[styles.progressFill, { width: `${Math.random() * 60 + 20}%`, backgroundColor: active ? posColor : DIM_BORDER }]} />\n"
        "          </View>\n"
        "        </View>\n"
        "        {heatAccess.showIcon && (((player as any).heatScore ?? 0) >= heatAccess.iconThreshold) && (\n"
        "          <View style={{ marginRight: 6 }}>\n"
        "            <HeatIcon\n"
        "              score={(player as any).heatScore ?? 0}\n"
        "              direction={(player as any).heatDirection ?? 'flat'}\n"
        "              size={28}\n"
        "              showScore={heatAccess.showScore}\n"
        "              compact\n"
        "            />\n"
        "          </View>\n"
        "        )}\n"
        "        <View style={styles.aiTag}>\n"
        "          <Text style={styles.aiTagText}>AI</Text>\n"
        "        </View>\n"
        "      </TouchableOpacity>\n"
        "    );\n"
        "  };",
    ),

    # ── 6. Add "Sort by Heat" chip above waiver list ───────────────────────
    # Anchors on the POSITIONS.map pills scroll inside the waivers tab.
    (
        "add sort-by-heat chip",
        "          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={{ paddingHorizontal: 20 }}>\n"
        "            {POSITIONS.map(pos => (\n"
        "              <TouchableOpacity key={pos} style={[styles.filterBtn, selectedPosition === pos && { borderColor: C.blueDeep, backgroundColor: C.sageS }]} onPress={() => setSelectedPosition(pos)}>\n"
        "                <Text style={[styles.filterText, selectedPosition === pos && { color: C.blueDeep }]}>{pos}</Text>\n"
        "              </TouchableOpacity>\n"
        "            ))}\n"
        "          </ScrollView>",
        "          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={{ paddingHorizontal: 20 }}>\n"
        "            {POSITIONS.map(pos => (\n"
        "              <TouchableOpacity key={pos} style={[styles.filterBtn, selectedPosition === pos && { borderColor: C.blueDeep, backgroundColor: C.sageS }]} onPress={() => setSelectedPosition(pos)}>\n"
        "                <Text style={[styles.filterText, selectedPosition === pos && { color: C.blueDeep }]}>{pos}</Text>\n"
        "              </TouchableOpacity>\n"
        "            ))}\n"
        "            <TouchableOpacity\n"
        "              style={[styles.filterBtn, sortByHeat && heatAccess.canSortByHeat && { borderColor: '#ff5714', backgroundColor: 'rgba(255,87,20,0.12)' }]}\n"
        "              onPress={() => {\n"
        "                if (heatAccess.canSortByHeat) setSortByHeat(v => !v);\n"
        "                else setHeatUpgradeVisible(true);\n"
        "              }}\n"
        "            >\n"
        "              <Text style={[styles.filterText, sortByHeat && heatAccess.canSortByHeat && { color: '#ff5714' }]}>\n"
        "                {sortByHeat && heatAccess.canSortByHeat ? '🔥 HEAT' : 'SORT: HEAT'}\n"
        "              </Text>\n"
        "            </TouchableOpacity>\n"
        "          </ScrollView>",
    ),

    # ── 7. Add upgrade modal near end of component return (before final closing View) ──
    # Anchor on the closing </Modal> of the other-roster modal — inject right after.
    (
        "add heat upgrade modal",
        "            <TouchableOpacity style={[styles.gotItBtn, { backgroundColor: PLATFORM_COLOR }]} onPress={() => setRosterModalVisible(false)}>\n"
        "              <Text style={[styles.gotItText, { color: platformStr === 'sleeper' ? '#1a1a1a' : '#fff' }]}>CLOSE</Text>\n"
        "            </TouchableOpacity>\n"
        "          </View>\n"
        "        </View>\n"
        "      </Modal>\n"
        "    </View>\n"
        "  );\n"
        "}",
        "            <TouchableOpacity style={[styles.gotItBtn, { backgroundColor: PLATFORM_COLOR }]} onPress={() => setRosterModalVisible(false)}>\n"
        "              <Text style={[styles.gotItText, { color: platformStr === 'sleeper' ? '#1a1a1a' : '#fff' }]}>CLOSE</Text>\n"
        "            </TouchableOpacity>\n"
        "          </View>\n"
        "        </View>\n"
        "      </Modal>\n\n"
        "      {/* Heat sort upgrade modal — Pro tier only */}\n"
        "      <Modal visible={heatUpgradeVisible} transparent animationType=\"fade\" onRequestClose={() => setHeatUpgradeVisible(false)}>\n"
        "        <View style={styles.modalOverlay}>\n"
        "          <View style={[styles.modalCard, { minHeight: 240 }]}>\n"
        "            <View style={[styles.modalTopAccent, { backgroundColor: '#ff5714' }]} />\n"
        "            <Text style={[styles.modalPlayerName, { marginBottom: 12 }]}>🔥 SORT BY HEAT</Text>\n"
        "            <Text style={styles.adviceText}>\n"
        "              Heat sort is a Pro feature. Surface the fastest-rising waiver targets across all of fantasy — before your leaguemates see them.\n"
        "            </Text>\n"
        "            <TouchableOpacity style={[styles.gotItBtn, { backgroundColor: '#ff5714', marginBottom: 8 }]} onPress={() => { setHeatUpgradeVisible(false); router.push('/paywall' as any); }}>\n"
        "              <Text style={[styles.gotItText, { color: '#fff' }]}>UPGRADE TO PRO</Text>\n"
        "            </TouchableOpacity>\n"
        "            <TouchableOpacity style={[styles.gotItBtn, { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#1a3542' }]} onPress={() => setHeatUpgradeVisible(false)}>\n"
        "              <Text style={[styles.gotItText, { color: '#7a9eaa' }]}>NOT NOW</Text>\n"
        "            </TouchableOpacity>\n"
        "          </View>\n"
        "        </View>\n"
        "      </Modal>\n"
        "    </View>\n"
        "  );\n"
        "}",
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
            failed.append(f"{desc} (appears {count} times)")
            print(f"  [AMBIG]    {desc} ({count} matches)")

    if failed:
        print("\nWARNING: Did not apply cleanly. File NOT modified.")
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
    print("Heat wire-up — Waivers tab (league.tsx)")
    print("=" * 60)
    print()
    patch_file()
    print()
    print("Final step: npx tsc --noEmit")
