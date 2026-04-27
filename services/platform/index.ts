// services/platform/index.ts
// Platform dispatcher. Every screen imports getPlatform() from here.
// No screen should ever import sleeper.ts / espn.ts / yahoo.ts directly —
// that preserves the abstraction and makes adding future platforms (DraftKings,
// FanDuel, NFL.com) a pure additive change.

import { FantasyPlatform, PlatformId } from './types';
import { sleeperPlatform } from './sleeper';
import { espnPlatform } from './espn';
import { yahooPlatform } from './yahoo';
import { mflPlatform } from './mfl';
import { fleaflickerPlatform } from './fleaflicker';

export * from './types';

/**
 * Get the platform implementation for a platform ID.
 * This is the primary entry point for all platform operations.
 *
 * Usage:
 *   const platform = getPlatform(league.platformId);
 *   const waivers = await platform.getAvailablePlayers(league.id);
 */
export function getPlatform(id: PlatformId): FantasyPlatform {
  switch (id) {
    case 'sleeper':     return sleeperPlatform;
    case 'espn':        return espnPlatform;
    case 'yahoo':       return yahooPlatform;
    case 'mfl':         return mflPlatform;
    case 'fleaflicker': return fleaflickerPlatform;
    default:
      throw new Error(`Unknown platform: ${id}`);
  }
}

/** All platform IDs in a stable order — useful for iterating in UI. */
export const ALL_PLATFORMS: PlatformId[] = ['sleeper', 'espn', 'yahoo', 'mfl', 'fleaflicker'];

/**
 * Get all platforms the user is currently connected to.
 * Used by the home screen to decide which leagues to fetch.
 */
export async function getConnectedPlatforms(): Promise<FantasyPlatform[]> {
  const all = ALL_PLATFORMS.map(getPlatform);
  const checks = await Promise.all(
    all.map(async p => ({ platform: p, connected: await p.isAuthenticated() }))
  );
  return checks.filter(c => c.connected).map(c => c.platform);
}

/**
 * Fetch leagues from every connected platform in parallel.
 * Returns a flat array — the League objects already carry platformId for routing.
 */
export async function getAllLeagues(season?: string) {
  const connected = await getConnectedPlatforms();
  const results = await Promise.all(
    connected.map(p =>
      p.getLeagues(season).catch(err => {
        console.warn(`[${p.platformId}] getLeagues failed:`, err);
        return [];
      })
    )
  );
  return results.flat();
}

/** Re-export individual platforms for advanced use (tests, debugging). */
export { sleeperPlatform, espnPlatform, yahooPlatform, mflPlatform, fleaflickerPlatform };
