import os

f = 'services/espn.ts'
with open(f, 'r') as fh:
    c = fh.read()

old = '''export async function loadESPNCredentials(): Promise<ESPNCredentials | null> {
  const espnS2 = await AsyncStorage.getItem('espn_s2');
  const swid = await AsyncStorage.getItem('espn_swid');
  if (!espnS2 || !swid) return null;
  return { espnS2, swid };
}'''

new = '''export async function loadESPNCredentials(): Promise<ESPNCredentials | null> {
  const espnS2 = await AsyncStorage.getItem('espn_s2');
  const swid = await AsyncStorage.getItem('espn_swid');
  if (!espnS2 || !swid) return null;
  const leagueIdsStr = await AsyncStorage.getItem('espn_league_ids');
  const teamName = await AsyncStorage.getItem('espn_team_name');
  let leagueId: number | undefined;
  if (leagueIdsStr) {
    try {
      const ids = JSON.parse(leagueIdsStr);
      leagueId = Array.isArray(ids) ? ids[0] : parseInt(leagueIdsStr);
    } catch {
      leagueId = parseInt(leagueIdsStr);
    }
  }
  return { espnS2, swid, leagueId, teamName: teamName ?? undefined };
}'''

c = c.replace(old, new)
with open(f, 'w') as fh:
    fh.write(c)
print('done - ESPN credentials fixed')
