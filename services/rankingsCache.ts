// services/rankingsCache.ts
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
