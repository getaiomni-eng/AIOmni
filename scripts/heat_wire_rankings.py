#!/usr/bin/env python3
"""
Heat wire-up for Rankings tab (rankings.tsx).

This script wires the full Heat feature into rankings.tsx:
  1. Imports HeatIcon, computeHeatBatch, getHeatSignalsMap, useHeatAccess
  2. Adds a `mergeHeat()` helper at the top of the file
  3. Adds `useHeatAccess()` inside the component, just above `myRanks` useMemo
  4. Passes `heatAccess` through to PlayerCard
  5. Wraps all 4 engine-fetch sites to merge heat signals:
       loadCommunityRankings, handleLeagueChange, loadSavedState, handleSelectBase
  6. Injects a HeatIcon render into PlayerCard's rightCol, below ADP/trend

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/heat_wire_rankings.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "app" / "(tabs)" / "rankings.tsx"

REPLACEMENTS = [
    # ── 1. Imports ──────────────────────────────────────────────────────────
    # Anchor on the last import in the header block. Following import is
    # PlayerCardModal — include it in the OLD so we can't accidentally re-match.
    (
        "add heat imports",
        "import PlayerCardModal from '../components/PlayerCardModal';\n\n"
        "type Format",
        "import PlayerCardModal from '../components/PlayerCardModal';\n"
        "import { HeatIcon } from '../components/HeatIcon';\n"
        "import { computeHeatBatch } from '../../services/heat';\n"
        "import { getHeatSignalsMap } from '../../services/heatData';\n"
        "import { useHeatAccess, HeatAccess } from '../hooks/useHeatAccess';\n\n"
        "type Format",
    ),

    # ── 2. Add mergeHeat helper above PlayerCard ────────────────────────────
    (
        "add mergeHeat helper",
        "function PlayerCard({ player, index, onChangeRank, onOpenCard }: {\n"
        "  player: RankedPlayer; index: number; onChangeRank?: (p: RankedPlayer) => void; onOpenCard?: (p: RankedPlayer) => void;\n"
        "}) {",
        "// ─── HEAT MERGE HELPER ─────────────────────────────────────────\n"
        "// Attach Sleeper trending velocity signals + computed Heat score\n"
        "// to each ranked player. Non-blocking: returns plain list on failure.\n"
        "async function mergeHeat<T extends { id: string }>(players: T[]): Promise<any[]> {\n"
        "  try {\n"
        "    const heatMap = await getHeatSignalsMap();\n"
        "    const withSignals = players.map(p => ({ ...p, heatSignals: heatMap.get(p.id) }));\n"
        "    return computeHeatBatch(withSignals as any);\n"
        "  } catch (e) {\n"
        "    console.log('mergeHeat error:', e);\n"
        "    return players;\n"
        "  }\n"
        "}\n\n"
        "function PlayerCard({ player, index, onChangeRank, onOpenCard, heatAccess }: {\n"
        "  player: RankedPlayer; index: number; onChangeRank?: (p: RankedPlayer) => void; onOpenCard?: (p: RankedPlayer) => void;\n"
        "  heatAccess?: HeatAccess;\n"
        "}) {",
    ),

    # ── 3. Inject HeatIcon render into PlayerCard's rightCol ────────────────
    # Anchor on the exact closing View tag of the rightCol + closing
    # TouchableOpacity. The heat badge sits just before rightCol closes.
    (
        "add HeatIcon to PlayerCard rightCol",
        "            <Text style={[s.trend, player.trend === 'up' && { color: palette.aqua }, player.trend === 'down' && { color: palette.flame }, player.trend === 'flat' && { color: dark.textMuted }]}>\n"
        "              {player.trend === 'up' ? `▲ ${player.trendVal}` : player.trend === 'down' ? `▼ ${player.trendVal}` : '—'}\n"
        "            </Text>\n"
        "          </>\n"
        "        )}\n"
        "      </View>\n"
        "    </TouchableOpacity>",
        "            <Text style={[s.trend, player.trend === 'up' && { color: palette.aqua }, player.trend === 'down' && { color: palette.flame }, player.trend === 'flat' && { color: dark.textMuted }]}>\n"
        "              {player.trend === 'up' ? `▲ ${player.trendVal}` : player.trend === 'down' ? `▼ ${player.trendVal}` : '—'}\n"
        "            </Text>\n"
        "          </>\n"
        "        )}\n"
        "        {heatAccess && ((player as any).heatScore ?? 0) >= heatAccess.iconThreshold && heatAccess.showIcon && (\n"
        "          <View style={{ marginTop: 4 }}>\n"
        "            <HeatIcon\n"
        "              score={(player as any).heatScore ?? 0}\n"
        "              direction={(player as any).heatDirection ?? 'flat'}\n"
        "              size={26}\n"
        "              showScore={heatAccess.showScore}\n"
        "              compact\n"
        "            />\n"
        "          </View>\n"
        "        )}\n"
        "      </View>\n"
        "    </TouchableOpacity>",
    ),

    # ── 4. Add heatAccess hook inside component body ────────────────────────
    (
        "add useHeatAccess hook",
        "  const [overrides, setOverrides] = useState<Map<string, number>>(new Map());\n"
        "  const myRanks = useMemo(",
        "  const [overrides, setOverrides] = useState<Map<string, number>>(new Map());\n"
        "  const heatAccess = useHeatAccess();\n"
        "  const myRanks = useMemo(",
    ),

    # ── 5. Wire heatAccess into renderRow's PlayerCard ──────────────────────
    (
        "pass heatAccess to renderRow PlayerCard",
        "      <PlayerCard\n"
        "        player={item.player}\n"
        "        index={item.displayIndex}\n"
        "        onChangeRank={openMoveModal}\n"
        "        onOpenCard={(p) => { setCardPlayer(p); setCardVisible(true); }}\n"
        "      />",
        "      <PlayerCard\n"
        "        player={item.player}\n"
        "        index={item.displayIndex}\n"
        "        onChangeRank={openMoveModal}\n"
        "        onOpenCard={(p) => { setCardPlayer(p); setCardVisible(true); }}\n"
        "        heatAccess={heatAccess}\n"
        "      />",
    ),

    # ── 6. Wire heatAccess into the inline PlayerCard at community/prospects FlatList ──
    (
        "pass heatAccess to inline PlayerCard",
        "<PlayerCard player={p} index={filtered.findIndex(fp => fp.id === p.id)} onOpenCard={(pl) => { setCardPlayer(pl); setCardVisible(true); }} />",
        "<PlayerCard player={p} index={filtered.findIndex(fp => fp.id === p.id)} onOpenCard={(pl) => { setCardPlayer(pl); setCardVisible(true); }} heatAccess={heatAccess} />",
    ),

    # ── 7. Merge heat in loadCommunityRankings ──────────────────────────────
    (
        "merge heat in loadCommunityRankings",
        "      const data = await getEngineRankings(format);\n"
        "      if (data.length > 0) setCommunityData(data);",
        "      const data = await getEngineRankings(format);\n"
        "      if (data.length > 0) setCommunityData(await mergeHeat(data));",
    ),

    # ── 8. Merge heat in handleLeagueChange ─────────────────────────────────
    (
        "merge heat in handleLeagueChange",
        "    try {\n"
        "      const live = await getEngineRankings(format);\n"
        "      const ovs = await getOverrides(leagueId || undefined);\n"
        "      setMyRanksEngine(live.length > 0 ? live : [...SEED]);\n"
        "      setOverrides(ovs);\n"
        "    } catch {\n"
        "      setMyRanksEngine([...SEED]);\n"
        "      setOverrides(new Map());\n"
        "    }\n"
        "  };\n\n"
        "  const handleProspectsTab",
        "    try {\n"
        "      const live = await getEngineRankings(format);\n"
        "      const ovs = await getOverrides(leagueId || undefined);\n"
        "      setMyRanksEngine(live.length > 0 ? await mergeHeat(live) : [...SEED]);\n"
        "      setOverrides(ovs);\n"
        "    } catch {\n"
        "      setMyRanksEngine([...SEED]);\n"
        "      setOverrides(new Map());\n"
        "    }\n"
        "  };\n\n"
        "  const handleProspectsTab",
    ),

    # ── 9. Merge heat in loadSavedState ─────────────────────────────────────
    (
        "merge heat in loadSavedState",
        "    try {\n"
        "      const live = await getEngineRankings(format);\n"
        "      const ovs = await getOverrides(selectedLeagueId);\n"
        "      setMyRanksEngine(live.length > 0 ? live : [...SEED]);\n"
        "      setOverrides(ovs);\n"
        "    } catch {\n"
        "      setMyRanksEngine([...SEED]);\n"
        "      setOverrides(new Map());",
        "    try {\n"
        "      const live = await getEngineRankings(format);\n"
        "      const ovs = await getOverrides(selectedLeagueId);\n"
        "      setMyRanksEngine(live.length > 0 ? await mergeHeat(live) : [...SEED]);\n"
        "      setOverrides(ovs);\n"
        "    } catch {\n"
        "      setMyRanksEngine([...SEED]);\n"
        "      setOverrides(new Map());",
    ),

    # ── 10. Merge heat in handleSelectBase ──────────────────────────────────
    (
        "merge heat in handleSelectBase",
        "      const rankings = await getEngineRankingsForSource(source, format);\n"
        "      setMyRanksEngine(rankings.length > 0 ? rankings : [...SEED]);",
        "      const rankings = await getEngineRankingsForSource(source, format);\n"
        "      setMyRanksEngine(rankings.length > 0 ? await mergeHeat(rankings) : [...SEED]);",
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
    print("Heat wire-up — Rankings tab")
    print("=" * 60)
    print()
    patch_file()
    print()
    print("Next: python3 scripts/heat_wire_waivers.py")
