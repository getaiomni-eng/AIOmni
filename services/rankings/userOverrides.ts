// services/rankings/userOverrides.ts
// ═══════════════════════════════════════════════════════════════════════════
// USER RANKINGS OVERRIDES
// ═══════════════════════════════════════════════════════════════════════════
//
// Stores the user's opinions as DELTAS from the engine baseline instead of
// as full 200-player lists. This is foundational to the long-term moat —
// aggregating deltas across users lets us detect which players the community
// consistently ranks higher or lower than the algorithm, and feed that
// signal back into the engine.
//
// STORAGE MODEL
// ─────────────
//   Key:    (user_id, player_id, league_id)
//   Value:  delta — signed integer, capped ±200
//
// Example: user moves Chase from engine rank #2 to #1.
//   -> delta = 1 - 2 = -1
//   -> persist { user_id, chase_id, league, delta: -1 }
//
// When rendering, we take the engine output and shift each overridden
// player's effective rank by their delta, then re-sort and renumber.
//
// LOCAL-FIRST WITH CLOUD SYNC
// ───────────────────────────
// AsyncStorage is the primary read path (fast + works offline). When the
// user is authenticated, writes propagate to Supabase and a background
// fetch refreshes local from cloud on read. Unauthenticated users still
// get working overrides locally on-device — they just don't sync across
// devices.
//
// LEAGUE SCOPING
// ──────────────
// Overrides are scoped per-league with a '__global__' sentinel for the
// default "All Leagues" view. This lets a user have different opinions
// for different league contexts down the road (dynasty vs. redraft, etc.),
// matching the existing leagueId parameter pattern.
//
// ═══════════════════════════════════════════════════════════════════════════

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import type { RankedPlayer } from '../rankingsData';

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

const GLOBAL_LEAGUE = '__global__';
const MAX_DELTA = 200;
const MIN_DELTA = -200;

function localKey(leagueId: string | null | undefined): string {
  return `user_rankings_overrides_${leagueId || GLOBAL_LEAGUE}`;
}

function normalizeLeagueId(leagueId: string | null | undefined): string {
  return leagueId || GLOBAL_LEAGUE;
}

function clampDelta(delta: number): number {
  const rounded = Math.round(delta);
  if (rounded < MIN_DELTA) return MIN_DELTA;
  if (rounded > MAX_DELTA) return MAX_DELTA;
  return rounded;
}

// ─── READ ───────────────────────────────────────────────────────────────────

/**
 * Fetch all overrides for the current user + given league.
 * Reads from AsyncStorage (fast); fires a background refresh from Supabase
 * if the user is authenticated so stale caches heal on the next call.
 */
export async function getOverrides(
  leagueId?: string | null,
): Promise<Map<string, number>> {
  const key = localKey(leagueId);

  // Read local cache first
  let localMap = new Map<string, number>();
  try {
    const cached = await AsyncStorage.getItem(key);
    if (cached) {
      const parsed = JSON.parse(cached) as Record<string, number>;
      localMap = new Map(Object.entries(parsed));
    }
  } catch (e) {
    console.log('getOverrides local read error:', e);
  }

  // Background refresh from cloud — don't block the UI on it.
  // Next call to getOverrides will reflect any incoming changes.
  refreshFromCloud(leagueId).catch(e => console.log('override cloud refresh:', e));

  return localMap;
}

/**
 * Pull overrides from Supabase and overwrite local cache.
 * Only runs when user is authenticated. No-op otherwise.
 */
async function refreshFromCloud(
  leagueId: string | null | undefined,
): Promise<Map<string, number>> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) return new Map();

    const leagueKey = normalizeLeagueId(leagueId);
    const { data, error } = await supabase
      .from('user_rankings_overrides')
      .select('player_id, delta')
      .eq('user_id', user.id)
      .eq('league_id', leagueKey);

    if (error || !data) return new Map();

    const map = new Map<string, number>();
    const obj: Record<string, number> = {};
    for (const row of data) {
      map.set(row.player_id, row.delta);
      obj[row.player_id] = row.delta;
    }

    await AsyncStorage.setItem(localKey(leagueId), JSON.stringify(obj));
    return map;
  } catch (e) {
    console.log('refreshFromCloud error:', e);
    return new Map();
  }
}

// ─── WRITE ──────────────────────────────────────────────────────────────────

/**
 * Set (or clear) a single player's override delta.
 * delta === 0 removes the override entirely.
 * Writes local immediately; cloud is fire-and-forget.
 */
export async function setOverride(
  playerId: string,
  delta: number,
  leagueId?: string | null,
): Promise<void> {
  const clamped = clampDelta(delta);
  const key = localKey(leagueId);
  const leagueKey = normalizeLeagueId(leagueId);

  // Local write (blocking)
  try {
    const existing = await AsyncStorage.getItem(key);
    const obj: Record<string, number> = existing ? JSON.parse(existing) : {};
    if (clamped === 0) {
      delete obj[playerId];
    } else {
      obj[playerId] = clamped;
    }
    await AsyncStorage.setItem(key, JSON.stringify(obj));
  } catch (e) {
    console.log('setOverride local error:', e);
  }

  // Cloud write (fire-and-forget; user may be offline or unauthenticated)
  try {
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) return;

    if (clamped === 0) {
      await supabase
        .from('user_rankings_overrides')
        .delete()
        .eq('user_id', user.id)
        .eq('player_id', playerId)
        .eq('league_id', leagueKey);
    } else {
      await supabase
        .from('user_rankings_overrides')
        .upsert({
          user_id: user.id,
          player_id: playerId,
          league_id: leagueKey,
          delta: clamped,
          updated_at: new Date().toISOString(),
        });
    }
  } catch (e) {
    console.log('setOverride cloud error:', e);
  }
}

/**
 * Remove all of the user's overrides for the given league.
 * Used by the RESET button in My Rankings.
 */
export async function clearOverrides(leagueId?: string | null): Promise<void> {
  const key = localKey(leagueId);
  const leagueKey = normalizeLeagueId(leagueId);

  try {
    await AsyncStorage.removeItem(key);
  } catch (e) {
    console.log('clearOverrides local error:', e);
  }

  try {
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) return;

    await supabase
      .from('user_rankings_overrides')
      .delete()
      .eq('user_id', user.id)
      .eq('league_id', leagueKey);
  } catch (e) {
    console.log('clearOverrides cloud error:', e);
  }
}

// ─── APPLY ──────────────────────────────────────────────────────────────────

/**
 * Apply overrides on top of the engine ranking.
 *
 * Algorithm:
 *   1. Compute effective rank for each player: engine_rank + delta
 *   2. Sort by effective rank ascending
 *   3. Tie-break: players with an explicit override come first (user intent)
 *   4. Secondary tie-break: original engine rank (stable ordering)
 *   5. Renumber 1..N
 *
 * V1 limitation: when two users' overrides target the same rank, the user
 * can only pin one of them reliably — the second assertion may resolve to
 * rank N+1. Future iteration will use per-override timestamps so the most
 * recent edit always wins. Acceptable for V1 — single-player edits work.
 */
export function applyOverrides(
  rankings: RankedPlayer[],
  overrides: Map<string, number>,
): RankedPlayer[] {
  if (overrides.size === 0) return rankings;

  const adjusted = rankings.map(p => ({
    player: p,
    effective: p.rank + (overrides.get(p.id) ?? 0),
    hasOverride: overrides.has(p.id),
  }));

  adjusted.sort((a, b) => {
    if (a.effective !== b.effective) return a.effective - b.effective;
    if (a.hasOverride !== b.hasOverride) return a.hasOverride ? -1 : 1;
    return a.player.rank - b.player.rank;
  });

  return adjusted.map((item, i) => ({
    ...item.player,
    rank: i + 1,
  }));
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

/**
 * Compute the delta a user needs to pin a player at `targetRank`, given the
 * player's engine rank. Exposed so callers (the CHANGE modal) can preview
 * the resulting delta without mutating state.
 */
export function computeDelta(engineRank: number, targetRank: number): number {
  return clampDelta(targetRank - engineRank);
}

/**
 * True if a player has any user override active. Useful for badging the
 * card with a "✦" or similar visual affordance (Hour 3 polish).
 */
export function hasOverride(
  playerId: string,
  overrides: Map<string, number>,
): boolean {
  return overrides.has(playerId);
}
