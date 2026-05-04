#!/usr/bin/env python3
"""
UI fix: My Rankings tab shows '?' instead of player headshots.

Root cause: PlayerPhoto component constructs Sleeper CDN URL using playerId,
but My Rankings flow puts gsis_id (e.g. "00-0034796") in the player.id field.
Sleeper CDN expects their own numeric IDs (e.g. "4881"), so requests 404 and
fall back to the '?' placeholder.

Fix: Surface sleeper_id from nfl_players (where it's already populated) by
joining at read time in fetchAIOmniFormula. Pass through PlayerCard to
PlayerPhoto. PlayerPhoto prefers sleeper_id when available, falls back to
hiding image entirely if only gsis_id is available.

Three changes:
  1. services/rankingsData.ts: fetchAIOmniFormula joins nfl_players, returns sleeperId
  2. services/rankingsData.ts: RankedPlayer type adds optional sleeperId field
  3. app/(tabs)/rankings.tsx: PlayerPhoto prefers sleeperId, PlayerCard passes it through

Run from AIOmni repo root:
    python3 scripts/fix_headshots_sleeper_id.py
"""
from pathlib import Path
import sys

ROOT = Path('.')
DATA = ROOT / 'services' / 'rankingsData.ts'
TSX = ROOT / 'app' / '(tabs)' / 'rankings.tsx'

for f in [DATA, TSX]:
    if not f.exists():
        print(f'[ERROR] {f} not found.')
        sys.exit(1)

applied = []
warnings = []

# ====================================================================
# PATCH 1: services/rankingsData.ts - update fetchAIOmniFormula to join
# ====================================================================
s1 = DATA.read_text()
orig1 = s1

# The current fetchAIOmniFormula uses Supabase REST without join.
# We need to use the embed syntax to join nfl_players. PostgREST embed:
#   ?select=rank,gsis_id,...,nfl_players(sleeper_id)
# But nfl_proprietary_rankings probably doesn't have a foreign key to
# nfl_players. We may need to do TWO requests instead and merge in JS.

# Find the existing fetchAIOmniFormula definition
old1 = '''export async function fetchAIOmniFormula(
  format: ScoringFormat = 'PPR',
): Promise<RankedPlayer[]> {
  try {
    const url = `${PROPRIETARY_RANKINGS_URL}?format=eq.${format}&select=rank,gsis_id,name,position,team,score,tier,pos_rank,method&order=rank`;
    const res = await fetch(url, {
      headers: {
        'apikey': PHASE2_ANON,
        'Authorization': `Bearer ${PHASE2_ANON}`,
      },
    });
    if (!res.ok) {
      console.log('fetchAIOmniFormula HTTP', res.status);
      return [];
    }
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((r: any, i: number): RankedPlayer => ({
      id: r.gsis_id ?? String(i),
      name: r.name ?? 'Unknown',
      position: r.position ?? 'FLEX',
      team: r.team ?? '\u2014',
      rank: r.rank ?? (i + 1),
      adp: String(r.rank ?? (i + 1)),
      trend: 'flat' as const,
      trendVal: 0,
      tier: r.tier ?? assignTier(r.rank ?? (i + 1)),
      method: r.method ?? null,
    }) as any);
  } catch (e) {
    console.log('fetchAIOmniFormula error:', e);
    return [];
  }
}'''

new1 = '''export async function fetchAIOmniFormula(
  format: ScoringFormat = 'PPR',
): Promise<RankedPlayer[]> {
  try {
    // Step 1: Pull rankings from nfl_proprietary_rankings
    const url = `${PROPRIETARY_RANKINGS_URL}?format=eq.${format}&select=rank,gsis_id,name,position,team,score,tier,pos_rank,method&order=rank`;
    const res = await fetch(url, {
      headers: {
        'apikey': PHASE2_ANON,
        'Authorization': `Bearer ${PHASE2_ANON}`,
      },
    });
    if (!res.ok) {
      console.log('fetchAIOmniFormula HTTP', res.status);
      return [];
    }
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    
    // Step 2: Pull sleeper_id mapping from nfl_players for these gsis_ids
    // (Avoids embedding by FK; clean two-query approach.)
    const gsisIds = data.map((r: any) => r.gsis_id).filter(Boolean);
    const sleeperIdMap = new Map<string, string>();
    if (gsisIds.length > 0) {
      try {
        const idsCsv = gsisIds.map(id => `"${id}"`).join(',');
        const playersUrl = `https://khoruzvsprxyocisuhet.supabase.co/rest/v1/nfl_players?gsis_id=in.(${idsCsv})&select=gsis_id,sleeper_id`;
        const playersRes = await fetch(playersUrl, {
          headers: {
            'apikey': PHASE2_ANON,
            'Authorization': `Bearer ${PHASE2_ANON}`,
          },
        });
        if (playersRes.ok) {
          const players = await playersRes.json();
          if (Array.isArray(players)) {
            for (const p of players) {
              if (p.gsis_id && p.sleeper_id) {
                sleeperIdMap.set(p.gsis_id, p.sleeper_id);
              }
            }
          }
        }
      } catch (e) {
        console.log('fetchAIOmniFormula sleeper_id lookup error:', e);
        // Non-fatal: ranking still returns, just without headshots
      }
    }
    
    return data.map((r: any, i: number): RankedPlayer => ({
      id: r.gsis_id ?? String(i),
      sleeperId: sleeperIdMap.get(r.gsis_id),
      name: r.name ?? 'Unknown',
      position: r.position ?? 'FLEX',
      team: r.team ?? '\u2014',
      rank: r.rank ?? (i + 1),
      adp: String(r.rank ?? (i + 1)),
      trend: 'flat' as const,
      trendVal: 0,
      tier: r.tier ?? assignTier(r.rank ?? (i + 1)),
      method: r.method ?? null,
    }) as any);
  } catch (e) {
    console.log('fetchAIOmniFormula error:', e);
    return [];
  }
}'''

if old1 in s1:
    s1 = s1.replace(old1, new1)
    applied.append("rankingsData.ts: fetchAIOmniFormula now fetches sleeper_id mapping")
else:
    warnings.append("fetchAIOmniFormula function not matched -- may have been edited")

# ====================================================================
# PATCH 2: Add sleeperId to RankedPlayer type
# ====================================================================
# Find the RankedPlayer interface/type definition
import re

ranked_player_pattern = re.compile(
    r'(export\s+(?:interface|type)\s+RankedPlayer\s*[={]\s*\{[^}]+?)(\n\})',
    re.DOTALL
)

match = ranked_player_pattern.search(s1)
if match:
    # Check if sleeperId is already there
    interface_body = match.group(1)
    if 'sleeperId' not in interface_body:
        # Insert sleeperId right before closing
        new_field = "\n  sleeperId?: string;"
        new_text = match.group(1) + new_field + match.group(2)
        s1 = s1[:match.start()] + new_text + s1[match.end():]
        applied.append("rankingsData.ts: added sleeperId?: string to RankedPlayer type")
    else:
        applied.append("rankingsData.ts: RankedPlayer already has sleeperId (no change needed)")
else:
    warnings.append("Could not locate RankedPlayer type definition")

if s1 != orig1:
    DATA.write_text(s1)

# ====================================================================
# PATCH 3: app/(tabs)/rankings.tsx -- PlayerPhoto prefers sleeperId
# ====================================================================
s2 = TSX.read_text()
orig2 = s2

# Update PlayerPhoto to accept and prefer sleeperId
old3a = '''function PlayerPhoto({ playerId, size = 48 }: { playerId: string; size?: number }) {
  const [err, setErr] = useState(false);
  if (!err && playerId) return (
    <Image
      source={{ uri: `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg` }}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: dark.surface, borderWidth: 2, borderColor: dark.border }}
      onError={() => setErr(true)}
    />
  );
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: dark.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: dark.border }}>
      <Text style={{ fontSize: size * 0.35, fontFamily: F.bold, color: dark.textMuted }}>?</Text>
    </View>
  );
}'''

new3a = '''function PlayerPhoto({ playerId, sleeperId, size = 48 }: { playerId: string; sleeperId?: string; size?: number }) {
  const [err, setErr] = useState(false);
  // Prefer sleeperId (always works with Sleeper CDN). Fall back to playerId
  // only if it does NOT look like a gsis_id (e.g. "00-0034796"); raw gsis_ids
  // 404 on Sleeper CDN, so just show the placeholder rather than fail.
  const looksLikeGsisId = playerId?.startsWith('00-');
  const effectiveId = sleeperId || (looksLikeGsisId ? null : playerId);
  if (!err && effectiveId) return (
    <Image
      source={{ uri: `https://sleepercdn.com/content/nfl/players/thumb/${effectiveId}.jpg` }}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: dark.surface, borderWidth: 2, borderColor: dark.border }}
      onError={() => setErr(true)}
    />
  );
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: dark.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: dark.border }}>
      <Text style={{ fontSize: size * 0.35, fontFamily: F.bold, color: dark.textMuted }}>?</Text>
    </View>
  );
}'''

if old3a in s2:
    s2 = s2.replace(old3a, new3a)
    applied.append("rankings.tsx: PlayerPhoto now prefers sleeperId, skips broken gsis_id requests")
else:
    warnings.append("PlayerPhoto function not matched")

# Update PlayerCard usage of PlayerPhoto -- pass sleeperId through
old3b = '''      <PlayerPhoto playerId={player.id} size={48} />'''
new3b = '''      <PlayerPhoto playerId={player.id} sleeperId={(player as any).sleeperId} size={48} />'''

if old3b in s2:
    s2 = s2.replace(old3b, new3b)
    applied.append("rankings.tsx: PlayerCard now passes sleeperId to PlayerPhoto")
else:
    warnings.append("PlayerCard's PlayerPhoto usage not matched")

if s2 != orig2:
    TSX.write_text(s2)

# ====================================================================
# Summary
# ====================================================================
print()
print("=" * 60)
for a in applied:
    print(f"[APPLIED]  {a}")
for w in warnings:
    print(f"[WARN]     {w}")
print("=" * 60)
print()

if applied and not warnings:
    print("All 4 changes applied cleanly.")
    print()
    print("Verify in simulator:")
    print("  npx expo start --clear")
    print()
    print("Open app -> Rankings tab -> My Rankings.")
    print("Player headshots should now load (instead of '?' placeholder).")
    print()
    print("If verified, commit:")
    print('  git add -A')
    print('  git commit -m "UI: My Rankings headshots via sleeper_id join"')
    print('  git push origin main')
elif applied:
    print(f"{len(applied)} applied, {len(warnings)} warnings. Manual review needed.")
else:
    print("Nothing applied -- file structure may have changed.")
