#!/usr/bin/env python3
"""
Final fix for morning_patches errors.

Uses the actual AsyncStorage keys that mfl.ts and fleaflicker.ts already
use, so connection state is correctly detected:

  MFL: reads 'mfl_league_id' (presence = connected)
  Fleaflicker: reads 'fleaflicker_league_id' (presence = connected)

Also deletes the DYN entry from FORMATS array.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/fix_morning_errors_v2.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX_TSX = ROOT / "app" / "(tabs)" / "index.tsx"
RANKINGS_TSX = ROOT / "app" / "(tabs)" / "rankings.tsx"


# ─── FIX 1: replace broken imports + loaders ──────────────────────────────

OLD_IMPORTS = """import { getValidYahooToken } from '../../services/yahoo';
import { loadMflCredentials } from '../../services/platform/mfl';
import { loadFleaflickerCredentials } from '../../services/platform/fleaflicker';"""

NEW_IMPORTS = """import { getValidYahooToken } from '../../services/yahoo';"""

OLD_MFL_LOADER = """  const loadMflLeagues = async (_year: string = String(new Date().getFullYear())): Promise<League[]> => {
    try {
      const creds = await loadMflCredentials();
      if (!creds) return [];
      return [{
        id: String((creds as any).leagueId ?? 'mfl'),
        name: 'MFL League',
        platform: 'mfl' as any,
        format: 'PPR',
        rec: '0-0', rank: '-', pts: 0, opp: 0, week: 1,
      }];
    } catch { return []; }
  };"""

NEW_MFL_LOADER = """  const loadMflLeagues = async (_year: string = String(new Date().getFullYear())): Promise<League[]> => {
    try {
      const leagueId = await AsyncStorage.getItem('mfl_league_id');
      if (!leagueId) return [];
      return [{
        id: String(leagueId),
        name: 'MFL League',
        platform: 'mfl' as any,
        format: 'PPR',
        rec: '0-0', rank: '-', pts: 0, opp: 0, week: 1,
      }];
    } catch { return []; }
  };"""

OLD_FF_LOADER = """  const loadFleaflickerLeagues = async (_year: string = String(new Date().getFullYear())): Promise<League[]> => {
    try {
      const creds = await loadFleaflickerCredentials();
      if (!creds) return [];
      return [{
        id: String((creds as any).leagueId ?? 'fleaflicker'),
        name: 'Fleaflicker League',
        platform: 'fleaflicker' as any,
        format: 'PPR',
        rec: '0-0', rank: '-', pts: 0, opp: 0, week: 1,
      }];
    } catch { return []; }
  };"""

NEW_FF_LOADER = """  const loadFleaflickerLeagues = async (_year: string = String(new Date().getFullYear())): Promise<League[]> => {
    try {
      const leagueId = await AsyncStorage.getItem('fleaflicker_league_id');
      if (!leagueId) return [];
      return [{
        id: String(leagueId),
        name: 'Fleaflicker League',
        platform: 'fleaflicker' as any,
        format: 'PPR',
        rec: '0-0', rank: '-', pts: 0, opp: 0, week: 1,
      }];
    } catch { return []; }
  };"""


# ─── FIX 2: delete DYN line from FORMATS array ─────────────────────────────

OLD_DYN_LINE = "  { key: 'DYN', label: 'DYNASTY' },\n"
NEW_DYN_LINE = ""


def main():
    print("=" * 64)
    print("Final fix for morning_patches errors")
    print("=" * 64)
    print()

    # ── FIX 1 ──
    print("FIX 1 — index.tsx: use correct AsyncStorage keys")
    if INDEX_TSX.exists():
        s = INDEX_TSX.read_text()
        any_change = False

        if OLD_IMPORTS in s:
            s = s.replace(OLD_IMPORTS, NEW_IMPORTS)
            print("  [APPLIED]  removed broken imports")
            any_change = True
        elif "loadMflCredentials" not in s and "loadFleaflickerCredentials" not in s:
            print("  [ALREADY]  imports already removed")

        if OLD_MFL_LOADER in s:
            s = s.replace(OLD_MFL_LOADER, NEW_MFL_LOADER)
            print("  [APPLIED]  loadMflLeagues uses 'mfl_league_id' key")
            any_change = True
        elif "AsyncStorage.getItem('mfl_league_id')" in s:
            print("  [ALREADY]  MFL loader already fixed")

        if OLD_FF_LOADER in s:
            s = s.replace(OLD_FF_LOADER, NEW_FF_LOADER)
            print("  [APPLIED]  loadFleaflickerLeagues uses 'fleaflicker_league_id' key")
            any_change = True
        elif "AsyncStorage.getItem('fleaflicker_league_id')" in s:
            print("  [ALREADY]  Fleaflicker loader already fixed")

        if any_change:
            INDEX_TSX.write_text(s)
            print(f"  ✓ {INDEX_TSX.name} updated")

    # ── FIX 2 ──
    print()
    print("FIX 2 — rankings.tsx: delete DYN entry from FORMATS array")
    if RANKINGS_TSX.exists():
        s = RANKINGS_TSX.read_text()
        if OLD_DYN_LINE in s:
            s = s.replace(OLD_DYN_LINE, NEW_DYN_LINE)
            RANKINGS_TSX.write_text(s)
            print("  [APPLIED]  removed DYN entry from FORMATS")
            print(f"  ✓ {RANKINGS_TSX.name} updated")
        elif "{ key: 'DYN'" not in s:
            print("  [ALREADY]  DYN entry already removed")

    print()
    print("=" * 64)
    print("Next: npx tsc --noEmit")
    print("=" * 64)


if __name__ == "__main__":
    main()
