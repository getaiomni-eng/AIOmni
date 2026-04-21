#!/usr/bin/env python3
"""
AIOmni — wire platform layer + Heat into the Waivers tab.

What this does (ONLY the Waivers tab):
  1. Adds imports for the platform layer, Heat engine, and HeatBadge
  2. Replaces the old weekStats-based waivers loader with the new
     platform-agnostic getAvailablePlayers() call
  3. Computes Heat scores on the loaded players
  4. Renders HeatBadge next to each waiver row

Does NOT touch Roster, Standings, Matchup, or Activity tabs.
Does NOT change the existing Player type or PlayerRow component.

Run: python3 patch_waivers.py
"""

import sys
import os

FILE = 'app/league.tsx'

def fail(msg):
    print(f"✗ {msg}")
    sys.exit(1)

def must_replace(src, old, new, label):
    """Raise if the exact string isn't found — prevents silent no-ops."""
    if old not in src:
        # Try to find a close match to help debug
        first_line = old.strip().split('\n')[0][:60]
        print(f"\n✗ FAILED: {label}")
        print(f"   Looking for: {first_line}...")
        print(f"   This means the file has been modified since the patch was designed.")
        fail(f"Could not apply: {label}")
    count = src.count(old)
    if count > 1:
        fail(f"Ambiguous: {label} matches {count} places — refusing to patch")
    return src.replace(old, new)

def main():
    if not os.path.exists(FILE):
        fail(f"File not found: {FILE}  (are you in the project root?)")

    with open(FILE, 'r') as f:
        src = f.read()

    original = src

    # ── STEP 1: Add imports ──
    # Insert new imports right after the askAI import — that line is stable.
    old_import = "import { askAI } from \"../services/ai\";"
    new_import = """import { askAI } from "../services/ai";
import { getPlatform, type PlatformId, type AvailablePlayer } from '../services/platform';
import { computeHeatBatch } from '../services/heat';
import { HeatBadge } from '../components/HeatIcon';"""

    if old_import not in src:
        fail("Couldn't find askAI import — file structure has changed")
    src = src.replace(old_import, new_import)

    # ── STEP 2: Widen waivers state type ──
    # The current state is typed as Player[]. We widen to (Player | AvailablePlayer)[]
    # so both legacy fallback (dummy) data and real platform data flow through.
    # AvailablePlayer extends Player in spirit but not as a TS extends — so use union.
    old_state = "const [waivers,      setWaivers]      = useState<Player[]>([]);"
    new_state = "const [waivers,      setWaivers]      = useState<(Player & Partial<AvailablePlayer>)[]>([]);"
    src = must_replace(src, old_state, new_state, "widen waivers state type")

    # ── STEP 3: Replace the weekStats-based waivers loader with platform call ──
    # The old code builds waivers from weekStats (which only contains players who
    # posted fantasy points this week — excludes rookies in dynasty leagues).
    #
    # We replace it with platform.getAvailablePlayers() + Heat computation.
    # The rest of loadSleeper stays unchanged.
    old_waivers_load = """    const ownedIds = new Set(rosters.flatMap((r: any) => r.players ?? []));
    setWaivers(Object.entries(weekStats).filter(([id, s]: any) => !ownedIds.has(id) && (s.pts_ppr ?? 0) > 0).map(([id, s]: any) => ({ slot:'', pos:s.position ?? '?', name:s.player?.full_name ?? id, team:s.team ?? '—', lastWk:s.pts_ppr ?? 0, owned:'0%', trend:'→' } as Player)).sort((a: Player, b: Player) => (b.lastWk ?? 0) - (a.lastWk ?? 0)).slice(0, 30));"""

    new_waivers_load = """    // Waivers now come from the platform layer — correctly includes rookies
    // in dynasty leagues, properly excludes rostered players (including taxi/IR),
    // and returns Heat signals for each player.
    try {
      const platformImpl = getPlatform(platform as PlatformId);
      const available = await platformImpl.getAvailablePlayers(leagueId, { limit: 50 });
      const withHeat = computeHeatBatch(available);
      // Adapt AvailablePlayer to the shape PlayerRow expects (Player type).
      // We carry through the heat fields so the waiver render can use them.
      const adapted = withHeat.map(p => ({
        slot: '',
        pos: p.position,
        name: p.name,
        team: p.team,
        lastWk: 0,
        owned: p.percentOwned !== undefined ? `${Math.round(p.percentOwned)}%` : '—',
        trend: p.heatDirection === 'up' ? '↑' : p.heatDirection === 'down' ? '↓' : '→',
        injured: !!p.injuryStatus,
        // Extra fields from AvailablePlayer — used by the Heat badge
        id: p.id,
        heatScore: p.heatScore,
        heatDirection: p.heatDirection,
        trendingAdds: p.trendingAdds,
        percentOwned: p.percentOwned,
      })) as (Player & Partial<AvailablePlayer>)[];
      setWaivers(adapted);
    } catch (e) {
      console.log('[league] platform.getAvailablePlayers failed:', e);
      setWaivers([]);
    }"""

    src = must_replace(src, old_waivers_load, new_waivers_load, "replace waivers loader with platform call")

    # ── STEP 4: Update the Waivers tab render to show HeatBadge ──
    # Old render wraps each row in a styled card and passes to PlayerRow.
    # We add the HeatBadge in an absolutely-positioned overlay so the
    # existing PlayerRow component needs no changes.
    old_render = """            {tab === 'WAIVERS' && (
              <View>
                <SectionHeader label="AVAILABLE" barColor={C.gold} />
                {waivers.map((p, i) => (
                  <View key={i} style={styles.waiverCard}>
                    <View style={styles.waiverCardShine} />
                    <PlayerRow player={p} showScore={false} showOwned showAdd />
                  </View>
                ))}
              </View>
            )}"""

    new_render = """            {tab === 'WAIVERS' && (
              <View>
                <SectionHeader label="AVAILABLE" barColor={C.gold} />
                {waivers.length === 0 ? (
                  <Text style={{ color:'#7a9eaa', fontFamily:F.mono, fontSize:SZ.sm, textAlign:'center', marginTop:24, letterSpacing:1 }}>
                    No free agents available.
                  </Text>
                ) : waivers.map((p, i) => {
                  const heat = (p as any).heatScore;
                  const heatDir = (p as any).heatDirection;
                  return (
                    <View key={(p as any).id ?? i} style={styles.waiverCard}>
                      <View style={styles.waiverCardShine} />
                      <View style={{ flexDirection:'row', alignItems:'center' }}>
                        <View style={{ flex:1 }}>
                          <PlayerRow player={p} showScore={false} showOwned showAdd />
                        </View>
                        {heat !== undefined && heat > 0 && (
                          <View style={{ paddingRight: 10, paddingLeft: 4 }}>
                            <HeatBadge score={heat} direction={heatDir} size={22} />
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}"""

    src = must_replace(src, old_render, new_render, "update Waivers tab render with HeatBadge")

    if src == original:
        fail("No changes were made — patch may have already been applied")

    with open(FILE, 'w') as f:
        f.write(src)

    print("✓ Patched app/league.tsx")
    print("  • Added imports: getPlatform, computeHeatBatch, HeatBadge")
    print("  • Widened waivers state to include AvailablePlayer fields")
    print("  • Replaced weekStats-based waivers loader with platform.getAvailablePlayers()")
    print("  • Wired HeatBadge into the Waivers tab render")
    print()
    print("Next: npx tsc --noEmit  (expect clean)")
    print("Then: reload Expo and open your Armchair Fantasy league → Waivers tab")

if __name__ == '__main__':
    main()
