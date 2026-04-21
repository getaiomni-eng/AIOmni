#!/usr/bin/env python3
"""
Hour 2 — wire user overrides into rankings.tsx.

Transforms My Rankings from "save the whole list" to "save only deltas":
- myRanks state is now derived via useMemo from (myRanksEngine + overrides)
- CHANGE modal saves a delta instead of re-saving the whole list
- RESET clears all overrides
- Base source switch clears overrides (new base = fresh start)

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/hour2_rankings_overrides.py

Pre-req: hour2_supabase_migration.sql has been run in the Supabase editor
and services/rankings/userOverrides.ts is in place.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "app" / "(tabs)" / "rankings.tsx"

REPLACEMENTS = [
    # ── 1. Add useMemo to React import ──
    (
        "add useMemo to react import",
        "import React, { useCallback, useEffect, useState } from 'react';",
        "import React, { useCallback, useEffect, useMemo, useState } from 'react';",
    ),

    # ── 2. Add userOverrides imports ──
    #      Anchor on the following import line so OLD no longer matches after
    #      patching (prevents substring re-match on re-run).
    (
        "add userOverrides imports",
        """import { getEngineRankings, getEngineRankingsForSource, invalidateEngineCache, assignGlobalTier, assignPositionalTier } from '../../services/rankings/aiomniEngineBridge';
import { fetchDedupedProspects } from '../../services/rankingsData';""",
        """import { getEngineRankings, getEngineRankingsForSource, invalidateEngineCache, assignGlobalTier, assignPositionalTier } from '../../services/rankings/aiomniEngineBridge';
import { getOverrides, setOverride, clearOverrides, applyOverrides } from '../../services/rankings/userOverrides';
import { fetchDedupedProspects } from '../../services/rankingsData';""",
    ),

    # ── 3. Drop getCustomRankings + saveCustomRankings imports ──
    #      (no longer writing full lists; overrides module owns persistence)
    (
        "drop getCustomRankings + saveCustomRankings imports",
        """    RankedPlayer,
    RankingsSource,
    getCustomRankings,
    getSelectedBase,
    saveCustomRankings,
    setSelectedBase,""",
        """    RankedPlayer,
    RankingsSource,
    getSelectedBase,
    setSelectedBase,""",
    ),

    # ── 4. Replace myRanks state with engine state + overrides + useMemo derived ──
    (
        "replace myRanks state with engine + overrides + useMemo",
        "  const [myRanks, setMyRanks] = useState<RankedPlayer[]>([]);",
        """  // myRanksEngine = pristine engine output for this format (no user edits).
  // overrides     = user's per-player delta map (loaded from userOverrides module).
  // myRanks       = what the UI renders — engine + overrides, re-sorted, re-ranked.
  const [myRanksEngine, setMyRanksEngine] = useState<RankedPlayer[]>([]);
  const [overrides, setOverrides] = useState<Map<string, number>>(new Map());
  const myRanks = useMemo(
    () => applyOverrides(myRanksEngine, overrides),
    [myRanksEngine, overrides],
  );""",
    ),

    # ── 5. Rewrite handleLeagueChange: no more getCustomRankings; load engine + overrides ──
    (
        "rewrite handleLeagueChange",
        """  const handleLeagueChange = async (leagueId: string, leagueName: string) => {
    setSelectedLeagueId(leagueId || undefined);
    setSelectedLeagueName(leagueName);
    const custom = await getCustomRankings(format, leagueId || undefined);
    if (custom && custom.length > 0) {
      setMyRanks(custom); return;
    }
    try {
      const live = await getEngineRankings(format);
      const seed = live.length > 0 ? live : [...SEED];
      setMyRanks(seed);
      await saveCustomRankings(seed, format, leagueId || undefined);
    } catch {
      setMyRanks([...SEED]);
      await saveCustomRankings([...SEED], format, leagueId || undefined);
    }
  };""",
        """  const handleLeagueChange = async (leagueId: string, leagueName: string) => {
    setSelectedLeagueId(leagueId || undefined);
    setSelectedLeagueName(leagueName);
    try {
      const live = await getEngineRankings(format);
      const ovs = await getOverrides(leagueId || undefined);
      setMyRanksEngine(live.length > 0 ? live : [...SEED]);
      setOverrides(ovs);
    } catch {
      setMyRanksEngine([...SEED]);
      setOverrides(new Map());
    }
  };""",
    ),

    # ── 6. Rewrite loadSavedState: same pattern ──
    (
        "rewrite loadSavedState",
        """  const loadSavedState = async () => {
    const base = await getSelectedBase();
    setSelectedBaseState(base);
    const custom = await getCustomRankings(format, selectedLeagueId);
    if (custom && custom.length > 0) {
      setMyRanks(custom);
      return;
    }
    try {
      const live = await getEngineRankings(format);
      const seed = live.length > 0 ? live : [...SEED];
      setMyRanks(seed);
      await saveCustomRankings(seed, format, selectedLeagueId);
    } catch {
      setMyRanks([...SEED]);
      await saveCustomRankings([...SEED], format, selectedLeagueId);
    }
  };""",
        """  const loadSavedState = async () => {
    const base = await getSelectedBase();
    setSelectedBaseState(base);
    try {
      const live = await getEngineRankings(format);
      const ovs = await getOverrides(selectedLeagueId);
      setMyRanksEngine(live.length > 0 ? live : [...SEED]);
      setOverrides(ovs);
    } catch {
      setMyRanksEngine([...SEED]);
      setOverrides(new Map());
    }
  };""",
    ),

    # ── 7. Rewrite handleSelectBase: hydrate engine, clear overrides ──
    #       (picking a new base source = fresh start)
    (
        "rewrite handleSelectBase",
        """  const handleSelectBase = async (source: RankingsSource) => {
    setBaseModalVisible(false);
    setLoading(true);
    try {
      const rankings = await fetchBaseRankings(source);
      if (rankings.length > 0) {
        setMyRanks(rankings);
        await saveCustomRankings(rankings, format);
        await setSelectedBase(source);
        setSelectedBaseState(source);
      } else {
        // Fallback to seed if API fails
        setMyRanks([...SEED]);
        await saveCustomRankings([...SEED], format, selectedLeagueId);
        await setSelectedBase(source);
        setSelectedBaseState(source);
      }
    } catch {
      setMyRanks([...SEED]);
    }
    setLoading(false);
  };""",
        """  const handleSelectBase = async (source: RankingsSource) => {
    setBaseModalVisible(false);
    setLoading(true);
    try {
      const rankings = await getEngineRankingsForSource(source, format);
      if (rankings.length > 0) {
        setMyRanksEngine(rankings);
      } else {
        setMyRanksEngine([...SEED]);
      }
      // New base = fresh start; drop any existing overrides so the user
      // sees the new source as-is before layering their edits back on.
      await clearOverrides(selectedLeagueId);
      setOverrides(new Map());
      await setSelectedBase(source);
      setSelectedBaseState(source);
    } catch {
      setMyRanksEngine([...SEED]);
    }
    setLoading(false);
  };""",
    ),

    # ── 8. Delete saveMyRanks helper — no longer used (we save deltas, not lists) ──
    (
        "drop saveMyRanks helper",
        """  const saveMyRanks = (ranks: RankedPlayer[]) => {
    setMyRanks(ranks);
    saveCustomRankings(ranks, format, selectedLeagueId);
  };

""",
        "",
    ),

    # ── 9. Rewrite resetToConsensus to clear overrides ──
    (
        "rewrite resetToConsensus",
        """  const resetToConsensus = async () => {
    try {
      invalidateEngineCache();
      // Clear both local AND cloud copy so stale Supabase data doesn't override
      const localKey = selectedLeagueId ? 'my_custom_rankings_' + format + '_' + selectedLeagueId : 'my_custom_rankings_' + format;
      await AsyncStorage.removeItem(localKey);
      await AsyncStorage.removeItem('my_custom_rankings_v7');
      const live = await getEngineRankings(format, true);
      const seed = live.length > 0 ? live : [...SEED];
      setMyRanks(seed);
      await saveCustomRankings(seed, format, selectedLeagueId);
    } catch (e) {
      console.log('reset error:', e);
      setMyRanks([...SEED]);
      await saveCustomRankings([...SEED], format, selectedLeagueId);
    }
  };""",
        """  const resetToConsensus = async () => {
    try {
      invalidateEngineCache();
      // Clear legacy full-list storage keys (dead code paths from Hour 1)
      const localKey = selectedLeagueId ? 'my_custom_rankings_' + format + '_' + selectedLeagueId : 'my_custom_rankings_' + format;
      await AsyncStorage.removeItem(localKey);
      await AsyncStorage.removeItem('my_custom_rankings_v7');
      // Clear user overrides (the new storage model)
      await clearOverrides(selectedLeagueId);
      setOverrides(new Map());
      // Re-fetch engine
      const live = await getEngineRankings(format, true);
      setMyRanksEngine(live.length > 0 ? live : [...SEED]);
    } catch (e) {
      console.log('reset error:', e);
      setMyRanksEngine([...SEED]);
      setOverrides(new Map());
    }
  };""",
    ),

    # ── 10. Rewrite confirmMove: compute delta from engine rank, save via setOverride ──
    (
        "rewrite confirmMove",
        """  const confirmMove = () => {
    if (!movePlayer) return;
    const target = parseInt(moveRank, 10);
    if (isNaN(target) || target < 1) { setMovePlayer(null); return; }
    const curIdx = myRanks.findIndex(p => p.id === movePlayer.id);
    if (curIdx === -1) { setMovePlayer(null); return; }
    const newIdx = Math.min(Math.max(target - 1, 0), myRanks.length - 1);
    const next = [...myRanks];
    const [moved] = next.splice(curIdx, 1);
    next.splice(newIdx, 0, moved);
    const renumbered = next.map((p, i) => ({ ...p, rank: i + 1 }));
    saveMyRanks(renumbered);
    setMovePlayer(null);
  };""",
        """  const confirmMove = () => {
    if (!movePlayer) return;
    const target = parseInt(moveRank, 10);
    if (isNaN(target) || target < 1) { setMovePlayer(null); return; }
    // Delta is relative to the ENGINE rank (not the displayed rank), so the
    // user's intent survives re-engine runs, format switches, and other
    // overrides shifting the list around them.
    const enginePlayer = myRanksEngine.find(p => p.id === movePlayer.id);
    if (!enginePlayer) { setMovePlayer(null); return; }
    const delta = target - enginePlayer.rank;
    const newOverrides = new Map(overrides);
    if (delta === 0) {
      newOverrides.delete(movePlayer.id);
    } else {
      newOverrides.set(movePlayer.id, Math.max(-200, Math.min(200, delta)));
    }
    setOverrides(newOverrides);
    // Persist in background — UI already reflects the change via useMemo
    setOverride(movePlayer.id, delta, selectedLeagueId).catch(e => console.log('setOverride:', e));
    setMovePlayer(null);
  };""",
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
        print("\nWARNING: Did not apply cleanly. File NOT modified.")
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
    print("AIOmni Hour 2 — User Overrides (delta storage)")
    print("=" * 60)
    print()
    patch_file()
    print()
    print("Verify:")
    print("  1. npx tsc --noEmit")
    print("  2. Reload Expo, navigate to My Rankings")
    print("  3. Tap CHANGE on a player, move them to rank #1")
    print("  4. Close and reopen the app — edit should persist")
    print("  5. Tap RESET — all edits should clear")
