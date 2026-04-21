#!/usr/bin/env python3
"""
AIOmni Hour 1 — Rankings Engine Integration
Patches app/(tabs)/rankings.tsx to route all rankings through aiomniEngine.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/hour1_rankings_engine.py

What it does:
1. Swaps rankingsCache imports for the new aiomniEngineBridge imports
2. Drops fantasypros from BASE_SOURCES (licensing reasons)
3. Replaces every getConsensusRankings() call with getEngineRankings(format)
4. Replaces fetchBaseRankings(source) with getEngineRankingsForSource(source, format)
5. Drops the applyFormatAdjustments post-hoc adjustment (engine handles format natively)
6. Updates the hint text to reflect the new source

Safe to re-run: will no-op if the file already has the patched state.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "app" / "(tabs)" / "rankings.tsx"

# ─── Replacements ──────────────────────────────────────────────────────────
# Each entry: (description, old, new). Script verifies old appears EXACTLY
# ONCE before replacing. If the old text is not found, we check whether the
# new text is already present (means we've run before, no-op that step).

REPLACEMENTS = [
    # ── 1. Update imports from rankingsData: drop fetchBlendedConsensus ──
    (
        "rankingsData imports (drop fetchBlendedConsensus)",
        """import {
    RankedPlayer,
    RankingsSource,
    fetchBaseRankings,
    fetchBlendedConsensus,
    getCustomRankings,
    getSelectedBase,
    saveCustomRankings,
    setSelectedBase,
} from '../../services/rankingsData';""",
        """import {
    RankedPlayer,
    RankingsSource,
    getCustomRankings,
    getSelectedBase,
    saveCustomRankings,
    setSelectedBase,
} from '../../services/rankingsData';""",
    ),

    # ── 2. Replace rankingsCache import with aiomniEngineBridge import ──
    (
        "swap rankingsCache → aiomniEngineBridge",
        "import { getConsensusRankings, invalidateConsensusCache } from '../../services/rankingsCache';",
        "import { getEngineRankings, getEngineRankingsForSource, invalidateEngineCache } from '../../services/rankings/aiomniEngineBridge';",
    ),

    # ── 3. Drop applyFormatAdjustments import (engine handles format) ──
    (
        "drop applyFormatAdjustments import",
        "import { applyFormatAdjustments } from '../../services/rankingsData';\n",
        "",
    ),

    # ── 4. Drop unused ScoringFormat type import (no longer referenced) ──
    (
        "drop ScoringFormat type import",
        "import type { ScoringFormat } from '../../services/rankingsData';\n",
        "",
    ),

    # ── 5. Remove fantasypros from BASE_SOURCES ──
    (
        "drop fantasypros base source",
        "  { key: 'fantasypros', label: 'FantasyPros ECR', sub: 'Expert Consensus Rankings', color: palette.amber },\n",
        "",
    ),

    # ── 6. loadCommunityRankings: engine call + format dependency ──
    (
        "loadCommunityRankings → getEngineRankings",
        """  const loadCommunityRankings = async () => {
    setLoading(true);
    try {
      const data = await getConsensusRankings();
      if (data.length > 0) setCommunityData(data);
    } catch (e) {
      console.log('getConsensusRankings error:', e);
    } finally {
      setLoading(false);
    }
  };""",
        """  const loadCommunityRankings = async () => {
    setLoading(true);
    try {
      const data = await getEngineRankings(format);
      if (data.length > 0) setCommunityData(data);
    } catch (e) {
      console.log('getEngineRankings error:', e);
    } finally {
      setLoading(false);
    }
  };""",
    ),

    # ── 7. handleLeagueChange: seed from engine ──
    (
        "handleLeagueChange → engine seed",
        """    try {
      const live = await getConsensusRankings();
      const seed = live.length > 0 ? live : [...SEED];
      setMyRanks(seed);
      await saveCustomRankings(seed, format, leagueId || undefined);
    } catch {
      setMyRanks([...SEED]);
      await saveCustomRankings([...SEED], format, leagueId || undefined);
    }
  };

  const handleProspectsTab""",
        """    try {
      const live = await getEngineRankings(format);
      const seed = live.length > 0 ? live : [...SEED];
      setMyRanks(seed);
      await saveCustomRankings(seed, format, leagueId || undefined);
    } catch {
      setMyRanks([...SEED]);
      await saveCustomRankings([...SEED], format, leagueId || undefined);
    }
  };

  const handleProspectsTab""",
    ),

    # ── 8. loadSavedState: seed from engine ──
    (
        "loadSavedState → engine seed",
        """    try {
      const live = await getConsensusRankings();
      const seed = live.length > 0 ? live : [...SEED];
      setMyRanks(seed);
      await saveCustomRankings(seed, format, selectedLeagueId);
    } catch {
      setMyRanks([...SEED]);
      await saveCustomRankings([...SEED], format, selectedLeagueId);
    }
  };

  const handleSelectBase""",
        """    try {
      const live = await getEngineRankings(format);
      const seed = live.length > 0 ? live : [...SEED];
      setMyRanks(seed);
      await saveCustomRankings(seed, format, selectedLeagueId);
    } catch {
      setMyRanks([...SEED]);
      await saveCustomRankings([...SEED], format, selectedLeagueId);
    }
  };

  const handleSelectBase""",
    ),

    # ── 9. handleSelectBase: use engine source fetcher ──
    (
        "handleSelectBase → getEngineRankingsForSource",
        "      const rankings = await fetchBaseRankings(source);",
        "      const rankings = await getEngineRankingsForSource(source, format);",
    ),

    # ── 10. resetToConsensus: invalidate engine cache + re-fetch ──
    (
        "resetToConsensus → engine",
        """      invalidateConsensusCache();
      // Clear both local AND cloud copy so stale Supabase data doesn't override
      const localKey = selectedLeagueId ? 'my_custom_rankings_' + format + '_' + selectedLeagueId : 'my_custom_rankings_' + format;
      await AsyncStorage.removeItem(localKey);
      await AsyncStorage.removeItem('my_custom_rankings_v7');
      const live = await getConsensusRankings(true);""",
        """      invalidateEngineCache();
      // Clear both local AND cloud copy so stale Supabase data doesn't override
      const localKey = selectedLeagueId ? 'my_custom_rankings_' + format + '_' + selectedLeagueId : 'my_custom_rankings_' + format;
      await AsyncStorage.removeItem(localKey);
      await AsyncStorage.removeItem('my_custom_rankings_v7');
      const live = await getEngineRankings(format, true);""",
    ),

    # ── 11. Drop the redundant applyFormatAdjustments call ──
    #       Engine already handles scoring format via LeagueConfig. This line
    #       was double-adjusting community rankings after the engine ran.
    (
        "drop applyFormatAdjustments call",
        "  const rawData = mode === 'mine' ? myRanks : communityData;\n  const formatAdjusted = mode === 'mine' ? rawData : applyFormatAdjustments(rawData, format as ScoringFormat);\n  const filtered = formatAdjusted.filter(p =>",
        "  const rawData = mode === 'mine' ? myRanks : communityData;\n  const filtered = rawData.filter(p =>",
    ),

    # ── 12. Update hint text to reflect engine ──
    (
        "update hint text",
        "        <Text style={s.hint}>CONSENSUS · SLEEPER + ESPN + YAHOO</Text>",
        "        <Text style={s.hint}>AIOMNI ENGINE · MULTI-SOURCE BLEND</Text>",
    ),
]


def patch_file():
    if not TARGET.exists():
        print(f"ERROR: {TARGET} not found.")
        print("Make sure you're running this from /Users/patrickmeyer/AIOmni")
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
            # Not found. Could mean (a) already patched, or (b) file unexpectedly different.
            # Distinguish by looking for a fingerprint of the expected post-patch state.
            # For deletions (empty `new`), the fingerprint is "`old` is absent" — we're
            # already here. For replacements, use the first meaningful chunk of `new`.
            if new.strip() == "":
                # Deletion-style replacement — absence IS the patched state
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
            failed.append(f"{desc} (appears {count} times — ambiguous)")
            print(f"  [AMBIG]    {desc} — appears {count} times")

    if failed:
        print()
        print("WARNING: Some replacements did not apply cleanly.")
        print("The file was NOT modified. Review the MISSING/AMBIG items above.")
        for f in failed:
            print(f"  - {f}")
        sys.exit(2)

    if content == original:
        print()
        print(f"No changes needed (all {skipped} replacements already present).")
        return

    # Write the patched file
    TARGET.write_text(content)
    print()
    print(f"✓ Patched {TARGET}")
    print(f"  Applied: {applied}  Already patched: {skipped}")


if __name__ == "__main__":
    print("=" * 60)
    print("AIOmni Hour 1 — Rankings Engine Integration")
    print("=" * 60)
    print()
    patch_file()
    print()
    print("Next steps:")
    print("  1. npx tsc --noEmit       (verify no type errors)")
    print("  2. npx expo start --go    (test in Expo Go)")
    print("  3. Switch between Community / My Rankings — should match")
    print("  4. Toggle formats (PPR/HALF/STD/SF/DYN) — rankings should shift")
