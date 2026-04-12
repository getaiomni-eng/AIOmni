import os

# ── 1. Update rankingsData.ts — per-format storage keys ──
with open('services/rankingsData.ts', 'r') as f:
    c = f.read()

old_get = """export async function getCustomRankings(): Promise<RankedPlayer[] | null> {
  const val = await AsyncStorage.getItem('my_custom_rankings_v7');
  if (!val) return null;
  try { return JSON.parse(val); } catch { return null; }
}

export async function saveCustomRankings(rankings: RankedPlayer[]): Promise<void> {
  await AsyncStorage.setItem('my_custom_rankings_v7', JSON.stringify(rankings));
}"""

new_get = """export async function getCustomRankings(format: string = 'PPR'): Promise<RankedPlayer[] | null> {
  const val = await AsyncStorage.getItem('my_custom_rankings_' + format);
  if (!val) {
    // Fallback to legacy key for migration
    const legacy = await AsyncStorage.getItem('my_custom_rankings_v7');
    if (legacy) return JSON.parse(legacy);
    return null;
  }
  try { return JSON.parse(val); } catch { return null; }
}

export async function saveCustomRankings(rankings: RankedPlayer[], format: string = 'PPR'): Promise<void> {
  await AsyncStorage.setItem('my_custom_rankings_' + format, JSON.stringify(rankings));
}"""

c = c.replace(old_get, new_get)
with open('services/rankingsData.ts', 'w') as f:
    f.write(c)
print('done - per-format storage keys')

# ── 2. Update rankings.tsx ──
with open('app/(tabs)/rankings.tsx', 'r') as f:
    c = f.read()

c = c.replace(
    'const custom = await getCustomRankings();',
    'const custom = await getCustomRankings(format);'
)

c = c.replace(
    'await saveCustomRankings(rankings);',
    'await saveCustomRankings(rankings, format);'
)

c = c.replace(
    'await saveCustomRankings([...SEED]);',
    'await saveCustomRankings([...SEED], format);'
)

old_save = """const saveMyRanks = (ranks: RankedPlayer[]) => {
    setMyRanks(ranks);
    saveCustomRankings(ranks);
  };"""

new_save = """const saveMyRanks = (ranks: RankedPlayer[]) => {
    setMyRanks(ranks);
    saveCustomRankings(ranks, format);
  };"""

c = c.replace(old_save, new_save)

c = c.replace(
    'const resetToConsensus = () => saveMyRanks([...SEED]);',
    'const resetToConsensus = () => { setMyRanks([...SEED]); saveCustomRankings([...SEED], format); };'
)

c = c.replace(
    """useEffect(() => {
    loadSavedState();
    loadCommunityRankings();
  }, []);""",
    """useEffect(() => {
    loadSavedState();
    loadCommunityRankings();
  }, [format]);"""
)

with open('app/(tabs)/rankings.tsx', 'w') as f:
    f.write(c)
print('done - rankings wired for per-format boards')
