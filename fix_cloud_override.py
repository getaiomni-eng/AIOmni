#!/usr/bin/env python3
import os
PROJECT_ROOT = os.getcwd()

# Patch 1: rankings.tsx reset also clears local storage for this format/league
OLD_RESET = """  const resetToConsensus = async () => {
    try {
      invalidateConsensusCache();
      const live = await getConsensusRankings(true);
      const seed = live.length > 0 ? live : [...SEED];
      setMyRanks(seed);
      await saveCustomRankings(seed, format, selectedLeagueId);
    } catch {
      setMyRanks([...SEED]);
      await saveCustomRankings([...SEED], format, selectedLeagueId);
    }
  };"""

NEW_RESET = """  const resetToConsensus = async () => {
    try {
      invalidateConsensusCache();
      // Clear both local AND cloud copy so stale Supabase data doesn't override
      const localKey = selectedLeagueId ? 'my_custom_rankings_' + format + '_' + selectedLeagueId : 'my_custom_rankings_' + format;
      await AsyncStorage.removeItem(localKey);
      await AsyncStorage.removeItem('my_custom_rankings_v7');
      const live = await getConsensusRankings(true);
      const seed = live.length > 0 ? live : [...SEED];
      setMyRanks(seed);
      await saveCustomRankings(seed, format, selectedLeagueId);
    } catch (e) {
      console.log('reset error:', e);
      setMyRanks([...SEED]);
      await saveCustomRankings([...SEED], format, selectedLeagueId);
    }
  };"""

path = 'app/(tabs)/rankings.tsx'
with open(path, 'r') as f:
    content = f.read()

if OLD_RESET in content:
    content = content.replace(OLD_RESET, NEW_RESET)
    with open(path, 'w') as f:
        f.write(content)
    print("✓ Reset now clears local + cloud stale cache")
else:
    print("✗ Pattern not found")
