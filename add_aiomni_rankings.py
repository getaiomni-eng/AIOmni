#!/usr/bin/env python3
"""
Adds AIOmni AI Rankings as 6th base option + fixes Sleeper input + ESPN loading
"""

# ── 1. Add AIOmni source to rankingsData.ts ──
with open('services/rankingsData.ts', 'r') as f:
    c = f.read()

# Add 'aiomni' to RankingsSource type
c = c.replace(
    "export type RankingsSource = 'sleeper' | 'espn' | 'yahoo' | 'fantasypros' | 'nfl';",
    "export type RankingsSource = 'sleeper' | 'espn' | 'yahoo' | 'fantasypros' | 'nfl' | 'aiomni';"
)

# Add aiomni case to dispatcher
c = c.replace(
    "case 'nfl':         return fetchSleeperADP(); // fallback to Sleeper for now",
    """case 'nfl':         return fetchSleeperADP(); // fallback to Sleeper for now
    case 'aiomni':      return fetchAIOmniRankings();"""
)

# Add the AIOmni rankings function before the ESPN team abbr function
aiomni_func = '''

// ── AIOmni AI Rankings — synthesized from all sources ───────
export async function fetchAIOmniRankings(): Promise<RankedPlayer[]> {
  // Pull from all available sources in parallel
  const [sleeper, espn, yahoo] = await Promise.allSettled([
    fetchSleeperADP(),
    fetchESPNADP(),
    fetchYahooADP(),
  ]);

  const sources: { name: string; data: RankedPlayer[] }[] = [];
  if (sleeper.status === 'fulfilled' && sleeper.value.length > 0)
    sources.push({ name: 'Sleeper ADP', data: sleeper.value });
  if (espn.status === 'fulfilled' && espn.value.length > 0)
    sources.push({ name: 'ESPN ADP', data: espn.value });
  if (yahoo.status === 'fulfilled' && yahoo.value.length > 0)
    sources.push({ name: 'Yahoo ADP', data: yahoo.value });

  if (sources.length === 0) {
    // Fallback to Sleeper if all fail
    return fetchSleeperADP();
  }

  // Build a unified player map with ranks from each source
  const playerMap = new Map<string, {
    name: string;
    position: string;
    team: string;
    id: string;
    ranks: { source: string; rank: number }[];
  }>();

  const normalize = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');

  for (const source of sources) {
    for (const p of source.data) {
      const key = normalize(p.name);
      if (playerMap.has(key)) {
        playerMap.get(key)!.ranks.push({ source: source.name, rank: p.rank });
      } else {
        playerMap.set(key, {
          name: p.name,
          position: p.position,
          team: p.team,
          id: p.id,
          ranks: [{ source: source.name, rank: p.rank }],
        });
      }
    }
  }

  // Calculate weighted score for each player
  // Players ranked by more sources get boosted
  // Lower median rank = better
  const scored = Array.from(playerMap.values()).map(p => {
    const rankValues = p.ranks.map(r => r.rank);
    rankValues.sort((a, b) => a - b);

    // Weighted median — more sources = more confidence
    const mid = Math.floor(rankValues.length / 2);
    const median = rankValues.length % 2 === 0
      ? (rankValues[mid - 1] + rankValues[mid]) / 2
      : rankValues[mid];

    // Confidence bonus: subtract 0.5 for each additional source
    const confidenceBonus = (p.ranks.length - 1) * 0.5;
    const aiScore = median - confidenceBonus;

    // Calculate agreement — how close sources are
    const spread = rankValues.length > 1
      ? rankValues[rankValues.length - 1] - rankValues[0]
      : 0;

    return {
      ...p,
      aiScore,
      median,
      sourceCount: p.ranks.length,
      spread,
      trend: spread <= 5 ? 'up' as const : spread <= 15 ? 'flat' as const : 'down' as const,
      trendVal: p.ranks.length,
    };
  });

  // Sort by AI score (lower = better)
  scored.sort((a, b) => a.aiScore - b.aiScore);

  return scored.slice(0, 200).map((p, i) => ({
    id: p.id,
    name: p.name,
    position: p.position,
    team: p.team,
    rank: i + 1,
    adp: p.median.toFixed(1),
    tier: i < 4 ? 1 : i < 10 ? 2 : i < 18 ? 3 : i < 25 ? 4 : 5,
    trend: p.trend,
    trendVal: p.sourceCount, // shows how many sources agree
  }));
}
'''

c = c.replace(
    "// ── ESPN team ID",
    aiomni_func + "\n// ── ESPN team ID"
)

with open('services/rankingsData.ts', 'w') as f:
    f.write(c)
print('✓ AIOmni rankings added to rankingsData.ts')

# ── 2. Add AIOmni option to rankings.tsx BASE_SOURCES ──
with open('app/(tabs)/rankings.tsx', 'r') as f:
    c = f.read()

# Add AIOmni as first option in BASE_SOURCES
c = c.replace(
    "const BASE_SOURCES: { key: RankingsSource; label: string; sub: string; color: string }[] = [",
    """const BASE_SOURCES: { key: RankingsSource; label: string; sub: string; color: string }[] = [
  { key: 'aiomni', label: 'AIOmni AI Rankings', sub: 'AI-synthesized from all sources', color: '#6eeb83' },"""
)

with open('app/(tabs)/rankings.tsx', 'w') as f:
    f.write(c)
print('✓ AIOmni option added to rankings modal')

# ── 3. Fix Sleeper input ──
# The settings-page.tsx shows Sleeper as "Not linked" but has no input
# The onboarding/settings needs to let users type their Sleeper username
# Check if settings-page has Sleeper input capability
with open('app/settings-page.tsx', 'r') as f:
    c = f.read()

# Add Sleeper username editing
c = c.replace(
    """<View style={s.row}>
            <View style={[s.dot, { backgroundColor: '#00FFF9' }]} />
            <Text style={s.rowLabel}>Sleeper</Text>
            <Text style={s.rowValue}>{username ? `@${username}` : 'Not linked'}</Text>
          </View>""",
    """<TouchableOpacity style={s.row} onPress={() => {
            Alert.prompt(
              'Sleeper Username',
              'Enter your Sleeper username (without @)',
              async (text) => {
                if (text && text.trim()) {
                  const clean = text.trim().replace('@', '');
                  try {
                    const res = await fetch('https://api.sleeper.app/v1/user/' + clean);
                    const data = await res.json();
                    if (data && data.user_id) {
                      await AsyncStorage.setItem('sleeper_username', clean);
                      setUsername(clean);
                      Alert.alert('Connected', 'Sleeper account @' + clean + ' linked successfully.');
                    } else {
                      Alert.alert('Not Found', 'No Sleeper user found with that username.');
                    }
                  } catch {
                    Alert.alert('Error', 'Could not verify username. Try again.');
                  }
                }
              },
              'plain-text',
              username || ''
            );
          }}>
            <View style={[s.dot, { backgroundColor: '#00FFF9' }]} />
            <Text style={s.rowLabel}>Sleeper</Text>
            <Text style={[s.rowValue, { color: username ? palette.green : palette.amber }]}>{username ? '@' + username : 'Connect →'}</Text>
          </TouchableOpacity>"""
)

with open('app/settings-page.tsx', 'w') as f:
    f.write(c)
print('✓ Sleeper username input added to settings')

# Do the same for tabs settings
with open('app/(tabs)/settings.tsx', 'r') as f:
    c = f.read()

c = c.replace(
    """<View style={s.row}>
            <View style={[s.dot, { backgroundColor: '#00FFF9' }]} />
            <Text style={s.rowLabel}>Sleeper</Text>
            <Text style={s.rowValue}>{username ? `@${username}` : 'Not linked'}</Text>
          </View>""",
    """<TouchableOpacity style={s.row} onPress={() => {
            Alert.prompt(
              'Sleeper Username',
              'Enter your Sleeper username (without @)',
              async (text) => {
                if (text && text.trim()) {
                  const clean = text.trim().replace('@', '');
                  try {
                    const res = await fetch('https://api.sleeper.app/v1/user/' + clean);
                    const data = await res.json();
                    if (data && data.user_id) {
                      await AsyncStorage.setItem('sleeper_username', clean);
                      setUsername(clean);
                      Alert.alert('Connected', 'Sleeper account @' + clean + ' linked successfully.');
                    } else {
                      Alert.alert('Not Found', 'No Sleeper user found with that username.');
                    }
                  } catch {
                    Alert.alert('Error', 'Could not verify username. Try again.');
                  }
                }
              },
              'plain-text',
              username || ''
            );
          }}>
            <View style={[s.dot, { backgroundColor: '#00FFF9' }]} />
            <Text style={s.rowLabel}>Sleeper</Text>
            <Text style={[s.rowValue, { color: username ? palette.green : palette.amber }]}>{username ? '@' + username : 'Connect →'}</Text>
          </TouchableOpacity>"""
)

with open('app/(tabs)/settings.tsx', 'w') as f:
    f.write(c)
print('✓ Sleeper username input added to tabs settings')

# ── 4. Fix ESPN loading on Home ──
# ESPN needs leagueId from AsyncStorage — the fix_espn.py already updated loadESPNCredentials
# But the home screen might not be calling it correctly
# Check if espn_league_ids is being saved during ESPN login
# The issue might be that espn-login.tsx doesn't save league IDs
with open('app/(tabs)/index.tsx', 'r') as f:
    c = f.read()

# Make sure ESPN loading has a fallback when no leagueId
if 'loadESPNCredentials' in c and 'creds.leagueId' in c:
    # The home screen checks creds.leagueId — if missing it skips ESPN
    # Add a fallback: if credentials exist but no leagueId, try to fetch leagues list
    c = c.replace(
        "if (!creds?.leagueId) return [];",
        """if (!creds?.leagueId) {
        // Try to discover leagues
        try {
          const { getESPNLeagues } = require('../../services/espn');
          const leagues = await getESPNLeagues(creds);
          if (leagues && leagues.length > 0) {
            const AsyncStorage = require('@react-native-async-storage/async-storage').default;
            await AsyncStorage.setItem('espn_league_ids', JSON.stringify([leagues[0].id]));
            creds.leagueId = leagues[0].id;
          } else {
            return [];
          }
        } catch {
          return [];
        }
      }"""
    )
    print('✓ ESPN fallback league discovery added')
elif 'loadESPNCredentials' in c:
    print('– ESPN loading structure different than expected, skipping')
else:
    print('– No ESPN loading found in index.tsx')

with open('app/(tabs)/index.tsx', 'w') as f:
    f.write(c)

print('\n✓ All done. Run: npx expo export')
