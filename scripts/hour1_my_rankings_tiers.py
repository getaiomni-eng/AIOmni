#!/usr/bin/env python3
"""
My Rankings tier dividers + live recompute.

Changes:
1. Import assignGlobalTier + assignPositionalTier from the bridge.
2. Grouping logic recomputes tiers from the user's list order when mode='mine'
   so moving a Tier 3 RB to rank #1 puts them in the user's Tier 1.
3. Flatten grouped into typed items (divider | player) for FlatList rendering.
4. renderRow handles both types, preserving virtualization.
5. FlatList takes the flat items array with item.key.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/hour1_my_rankings_tiers.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "app" / "(tabs)" / "rankings.tsx"

REPLACEMENTS = [
    # 1. Add tier-helper imports alongside existing bridge imports
    (
        "import tier helpers from bridge",
        "import { getEngineRankings, getEngineRankingsForSource, invalidateEngineCache } from '../../services/rankings/aiomniEngineBridge';",
        "import { getEngineRankings, getEngineRankingsForSource, invalidateEngineCache, assignGlobalTier, assignPositionalTier } from '../../services/rankings/aiomniEngineBridge';",
    ),

    # 2. Grouping logic: recompute tiers from user's order in My Rankings,
    #    keep engine tiers in Community. Then flatten into typed items for FlatList.
    (
        "grouping — recompute tiers in My Rankings + flatten for FlatList",
        """  // When position === 'ALL', use the global-rank tier (elite = top 6).
  // When filtering by position, use the engine's per-position tier so the
  // top N players at that position group under Tier 1.
  const grouped: { tier: number; players: RankedPlayer[] }[] = [];
  let lastTier = -1;
  filtered.forEach((p, i) => {
    const t = position === 'ALL' ? p.tier : ((p as any).positionalTier ?? p.tier);
    if (t !== lastTier) { grouped.push({ tier: t, players: [] }); lastTier = t; }
    grouped[grouped.length - 1].players.push({ ...p, rank: i + 1 });
  });""",
        """  // Tier source depends on mode + position filter.
  //   My Rankings: recompute tiers from user's list order. Moving a Tier 3
  //     RB to rank 1 puts them in the user's Tier 1 — their rankings, their tiers.
  //   Community:   use the tier from engine output (locked to algorithm).
  const grouped: { tier: number; players: RankedPlayer[] }[] = [];
  let lastTier = -1;
  filtered.forEach((p, i) => {
    const rank = i + 1;
    let t: number;
    if (mode === 'mine') {
      t = position === 'ALL' ? assignGlobalTier(rank) : assignPositionalTier(rank);
    } else {
      t = position === 'ALL' ? p.tier : ((p as any).positionalTier ?? p.tier);
    }
    if (t !== lastTier) { grouped.push({ tier: t, players: [] }); lastTier = t; }
    grouped[grouped.length - 1].players.push({ ...p, rank });
  });

  // Flatten grouped into typed items for FlatList (used in My Rankings).
  // Each item is either a divider or a player. FlatList's virtualization
  // handles both types transparently via the type-tagged renderRow below.
  type MyRanksItem =
    | { type: 'divider'; tier: number; key: string }
    | { type: 'player'; player: RankedPlayer; displayIndex: number; key: string };
  const flatItems: MyRanksItem[] = [];
  grouped.forEach((group, gIdx) => {
    flatItems.push({ type: 'divider', tier: group.tier, key: `tier-${gIdx}-${group.tier}` });
    group.players.forEach((p) => {
      flatItems.push({ type: 'player', player: p, displayIndex: p.rank - 1, key: p.id });
    });
  });""",
    ),

    # 3. renderRow handles both divider and player items
    (
        "renderRow — handle divider items",
        """  const renderRow = ({ item, index }: { item: RankedPlayer; index: number }) => (
    <PlayerCard player={item} index={index} onChangeRank={openMoveModal} onOpenCard={(p) => { setCardPlayer(p); setCardVisible(true); }} />
  );""",
        """  const renderRow = ({ item }: { item: MyRanksItem }) => {
    if (item.type === 'divider') {
      return (
        <View style={s.tierDivider}>
          <View style={s.tierLine} />
          <Text style={s.tierLabel}>{TIER_NAMES[item.tier]}</Text>
          <View style={s.tierLine} />
        </View>
      );
    }
    return (
      <PlayerCard
        player={item.player}
        index={item.displayIndex}
        onChangeRank={openMoveModal}
        onOpenCard={(p) => { setCardPlayer(p); setCardVisible(true); }}
      />
    );
  };""",
    ),

    # 4. FlatList uses the flat items array and item.key
    (
        "FlatList — use flatItems data + item.key",
        """          <FlatList
            data={filtered}
            keyExtractor={item => item.id}
            renderItem={renderRow}
            ListHeaderComponent={Header}
            contentContainerStyle={{ paddingHorizontal: SP[3], paddingBottom: 100 }}
            showsVerticalScrollIndicator={false}
          />""",
        """          <FlatList
            data={flatItems}
            keyExtractor={item => item.key}
            renderItem={renderRow}
            ListHeaderComponent={Header}
            contentContainerStyle={{ paddingHorizontal: SP[3], paddingBottom: 100 }}
            showsVerticalScrollIndicator={false}
          />""",
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
            if new.strip() == "":
                skipped += 1
                print(f"  [ALREADY]  {desc}")
            else:
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
        print(f"\nNo changes needed ({skipped} already patched).")
        return

    TARGET.write_text(content)
    print(f"\n✓ Patched {TARGET}  ({applied} applied, {skipped} already)")


if __name__ == "__main__":
    print("=" * 60)
    print("AIOmni — My Rankings Tier Dividers + Live Recompute")
    print("=" * 60)
    print()
    patch_file()
    print()
    print("Reload Expo, switch to My Rankings.")
    print("  - Tier dividers appear between groups")
    print("  - Move a player via CHANGE — tiers recompute based on new order")
    print("  - Position filter shows positional tiers (top 3 at position = Tier 1)")
