// services/heatData.ts
// ═══════════════════════════════════════════════════════════════════════════
// HEAT DATA FETCH — Sleeper trending adds/drops into HeatSignals
// ═══════════════════════════════════════════════════════════════════════════
//
// Sleeper exposes two free, unauthenticated endpoints that give us velocity
// data for every NFL player in their database:
//
//   /v1/players/nfl/trending/add?lookback_hours=48&limit=200
//   /v1/players/nfl/trending/drop?lookback_hours=48&limit=200
//
// Each returns an array of { player_id, count }. We merge them into a
// HeatSignals map keyed by player_id that any screen can consume.
//
// Scope: velocity only. Ownership/rankDelta are filled in elsewhere when
// platform services surface them (ESPN percentOwned, Yahoo ownership).
// For a first-pass Heat surface, velocity alone covers ~90% of the signal
// value because it's the most timely — it answers "what's happening right
// now" better than ownership (which lags by days) or rank (which lags by
// weekly consensus updates).
//
// Caching: 15 minutes in-memory. Sleeper updates trending continuously but
// the numbers don't swing fast enough to warrant sub-15min refresh.
//
// This is pure read-only free-endpoint data. No auth, no user-scoped info.
// ═══════════════════════════════════════════════════════════════════════════

import type { HeatSignals } from './platform/types';

interface TrendingItem {
  player_id: string;
  count: number;
}

interface HeatDataCache {
  signals: Map<string, HeatSignals>;
  fetchedAt: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const LOOKBACK_HOURS = 48;
const TRENDING_LIMIT = 250;

let cache: HeatDataCache | null = null;
let inflight: Promise<Map<string, HeatSignals>> | null = null;

/**
 * Fetch global trending adds/drops from Sleeper and merge into a
 * player_id → HeatSignals map.
 *
 * Idempotent: multiple callers in the same render tick share a single
 * in-flight promise. Cached for 15 minutes.
 */
export async function getHeatSignalsMap(force = false): Promise<Map<string, HeatSignals>> {
  const now = Date.now();
  if (!force && cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.signals;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const [addsRes, dropsRes] = await Promise.all([
        fetch(`https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=${LOOKBACK_HOURS}&limit=${TRENDING_LIMIT}`),
        fetch(`https://api.sleeper.app/v1/players/nfl/trending/drop?lookback_hours=${LOOKBACK_HOURS}&limit=${TRENDING_LIMIT}`),
      ]);
      const adds: TrendingItem[] = addsRes.ok ? await addsRes.json() : [];
      const drops: TrendingItem[] = dropsRes.ok ? await dropsRes.json() : [];

      const map = new Map<string, HeatSignals>();
      for (const a of adds) {
        map.set(a.player_id, { addsLast48h: a.count });
      }
      for (const d of drops) {
        const existing = map.get(d.player_id) ?? {};
        map.set(d.player_id, { ...existing, dropsLast48h: d.count });
      }

      cache = { signals: map, fetchedAt: now };
      return map;
    } catch (e) {
      console.log('getHeatSignalsMap error:', e);
      // Return last known cache if available, else empty map
      return cache?.signals ?? new Map();
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * Convenience: for a list of player ids, return just the ids that are in the
 * heat-trending window. Useful for "show this section only if any heat".
 */
export async function heatIdsIn(playerIds: string[]): Promise<Set<string>> {
  const map = await getHeatSignalsMap();
  const hits = new Set<string>();
  for (const id of playerIds) if (map.has(id)) hits.add(id);
  return hits;
}

/** Manually invalidate the cache — call after user pull-to-refresh. */
export function invalidateHeatCache(): void {
  cache = null;
  inflight = null;
}
