#!/usr/bin/env python3
"""
Fix the handleSelectBase / resetToConsensus / handleMyRankingsTab paths in
rankings.tsx that still reference setMyRanks and saveCustomRankings from the
pre-Hour-2 API. Replace with clearOverrides + engine recompute.

After Hour 2:
  - myRanks is useMemo(applyOverrides(myRanksEngine, overrides))
  - There's no setMyRanks — list recomputes automatically
  - There's no saveCustomRankings — we store deltas via setOverride/clearOverrides
  - Switching base source means clearing overrides (user deltas were relative
    to old base) and reloading the engine for the new source

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/hour2_hotfix_select_base.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "app" / "(tabs)" / "rankings.tsx"

OLD = """    setBaseModalVisible(false);
    setLoading(true);
    try {
      const rankings = await getEngineRankingsForSource(source, format);
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
  };"""

NEW = """    setBaseModalVisible(false);
    setLoading(true);
    try {
      // Switching base source invalidates prior deltas (they were relative
      // to the old source's ordering). Clear the user's overrides for this
      // league, then reload engine output for the new source. useMemo
      // recomputes `myRanks` automatically off the new engine + empty deltas.
      const leagueScope = selectedLeagueId || null;
      await clearOverrides(leagueScope);
      setOverrides([]);
      const rankings = await getEngineRankingsForSource(source, format);
      setMyRanksEngine(rankings.length > 0 ? rankings : [...SEED]);
      await setSelectedBase(source);
      setSelectedBaseState(source);
    } catch (e) {
      console.log('handleSelectBase error:', e);
      setMyRanksEngine([...SEED]);
    }
    setLoading(false);
  };"""


def main():
    if not TARGET.exists():
        print(f"ERROR: {TARGET} not found")
        sys.exit(1)

    content = TARGET.read_text()
    count = content.count(OLD)

    if count == 1:
        content = content.replace(OLD, NEW)
        TARGET.write_text(content)
        print(f"✓ Patched handleSelectBase in {TARGET.name}")
    elif count == 0 and NEW.strip()[:60] in content:
        print("Already patched.")
    elif count == 0:
        print("ERROR: old block not found. Has rankings.tsx been edited since?")
        print("Expected to find (first line):")
        print(f"  {OLD.splitlines()[0]}")
        sys.exit(2)
    else:
        print(f"ERROR: expected 1 match, found {count}")
        sys.exit(2)


if __name__ == "__main__":
    print("=" * 60)
    print("Hour 2 hotfix — handleSelectBase uses overrides API")
    print("=" * 60)
    print()
    main()
    print()
    print("Then: npx tsc --noEmit")
