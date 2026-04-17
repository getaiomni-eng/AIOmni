#!/usr/bin/env python3
import os, sys
PROJECT_ROOT = os.getcwd()

CACHE_MODULE = '''// services/rankingsCache.ts
// Shared in-memory cache for blended consensus rankings.
// Ensures every screen sees the same snapshot. 15-minute TTL.

import { fetchBlendedConsensus } from './rankingsData';
import type { RankedPlayer } from './rankingsData';

const TTL_MS = 15 * 60 * 1000;

interface CacheEntry {
  data: RankedPlayer[];
  fetchedAt: number;
}

let cache: CacheEntry | null = null;
let inflight: Promise<RankedPlayer[]> | null = null;

export async function getConsensusRankings(forceRefresh = false): Promise<RankedPlayer[]> {
  const now = Date.now();
  if (!forceRefresh && cache && (now - cache.fetchedAt) < TTL_MS) {
    return cache.data;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const data = await fetchBlendedConsensus();
      if (data && data.length > 0) {
        cache = { data, fetchedAt: Date.now() };
      }
      return data;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function invalidateConsensusCache(): void {
  cache = null;
}

export function getConsensusFetchedAt(): number | null {
  return cache ? cache.fetchedAt : null;
}
'''

def patch_file(rel_path, patches):
    path = os.path.join(PROJECT_ROOT, rel_path)
    if not os.path.exists(path):
        print(f"  SKIP: {rel_path}"); return
    with open(path, 'r') as f: content = f.read()
    original = content
    for name, find, replace in patches:
        if find in content:
            content = content.replace(find, replace)
            print(f"  ✓ {name}")
        else:
            print(f"  ✗ {name} (not found)")
    if content != original:
        with open(path, 'w') as f: f.write(content)
        print(f"  → wrote {rel_path}")

if not os.path.exists(os.path.join(PROJECT_ROOT, 'app', '(tabs)')):
    print("ERROR: not in project root"); sys.exit(1)

cache_path = os.path.join(PROJECT_ROOT, 'services', 'rankingsCache.ts')
with open(cache_path, 'w') as f:
    f.write(CACHE_MODULE)
print("✓ Created services/rankingsCache.ts")

RANKINGS_PATCHES = [
    (
        "Import cache module",
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
    fetchBaseRankings,
    fetchBlendedConsensus,
    getCustomRankings,
    getSelectedBase,
    saveCustomRankings,
    setSelectedBase,
} from '../../services/rankingsData';
import { getConsensusRankings, invalidateConsensusCache } from '../../services/rankingsCache';""",
    ),
    (
        "Community loader uses shared cache",
        """  const loadCommunityRankings = async () => {
    setLoading(true);
    try {
      const data = await fetchBlendedConsensus();
      if (data.length > 0) setCommunityData(data);
    } catch (e) {
      console.log('fetchBlendedConsensus error:', e);
    } finally {
      setLoading(false);
    }
  };""",
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
    ),
    (
        "My Rankings initial seed uses shared cache",
        """    try {
      const live = await fetchBlendedConsensus();
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
    ),
    (
        "League change seed uses shared cache",
        """    try {
      const live = await fetchBlendedConsensus();
      const seed = live.length > 0 ? live : [...SEED];
      setMyRanks(seed);
      await saveCustomRankings(seed, format, leagueId || undefined);
    } catch {
      setMyRanks([...SEED]);
      await saveCustomRankings([...SEED], format, leagueId || undefined);
    }
  };""",
        """    try {
      const live = await getConsensusRankings();
      const seed = live.length > 0 ? live : [...SEED];
      setMyRanks(seed);
      await saveCustomRankings(seed, format, leagueId || undefined);
    } catch {
      setMyRanks([...SEED]);
      await saveCustomRankings([...SEED], format, leagueId || undefined);
    }
  };""",
    ),
    (
        "Reset uses forceRefresh",
        """  const resetToConsensus = async () => {
    try {
      const live = await fetchBlendedConsensus();
      const seed = live.length > 0 ? live : [...SEED];
      setMyRanks(seed);
      await saveCustomRankings(seed, format, selectedLeagueId);
    } catch {
      setMyRanks([...SEED]);
      await saveCustomRankings([...SEED], format, selectedLeagueId);
    }
  };""",
        """  const resetToConsensus = async () => {
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
  };""",
    ),
]

print("\n── rankings.tsx ──")
patch_file('app/(tabs)/rankings.tsx', RANKINGS_PATCHES)
print("\n✓ Done. Reload Expo, then tap RESET in My Rankings to force fresh pull.")
