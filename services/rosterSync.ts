// services/rosterSync.ts
// Syncs the current user's rostered players up to public.user_rostered_players
// so server-side notification jobs can match news against rosters without
// needing platform OAuth tokens (which live in AsyncStorage).
//
// Called from the home tab whenever loadLeagues completes — coalesced via
// AsyncStorage timestamp so we only re-sync at most once per hour even if
// the user refreshes repeatedly.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { normalizePlayerName as normalize } from './util/normalizeName';

const LAST_SYNC_KEY = 'roster_sync_last_at';
const MIN_INTERVAL_MS = 60 * 60 * 1000; // 1h

export type RosteredPlayer = {
  name:        string;     // display name as the platform returned it
  position?:   string;
  team?:       string;
  leagueId?:   string;     // platform's league_id
  platform?:   string;     // 'sleeper' | 'espn' | 'yahoo' | 'mfl' | 'fleaflicker'
  isStarter?:  boolean;
};

/**
 * Replace the user's rostered_players for the league(s) represented in
 * `players` with the provided list. PRESERVES rows for any league_id
 * not present in the call — without this, opening League A would wipe
 * League B's roster server-side, and notification jobs would only ever
 * know about whichever league the user most recently viewed.
 *
 * Coalesces per-league: skips a league if its last sync was
 * < MIN_INTERVAL_MS ago, unless `force` is set.
 */
export async function syncRosteredPlayers(
  players: RosteredPlayer[],
  opts: { force?: boolean } = {},
): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Normalize the incoming list.
    const rows = players
      .filter(p => p?.name)
      .map(p => ({
        user_id:         user.id,
        normalized_name: normalize(p.name),
        display_name:    p.name,
        league_id:       p.leagueId ?? '_unscoped',
        platform:        p.platform ?? null,
        position:        p.position ?? null,
        team:            p.team ?? null,
        is_starter:      !!p.isStarter,
        synced_at:       new Date().toISOString(),
      }))
      .filter(r => r.normalized_name.length > 0);

    if (rows.length === 0) return;

    // Per-league cooldown so refreshing one league doesn't gate syncing
    // another. Each league_id has its own last-sync timestamp keyed in
    // AsyncStorage.
    const leagueIds = Array.from(new Set(rows.map(r => r.league_id)));
    const now = Date.now();
    const toSync: string[] = [];
    for (const lid of leagueIds) {
      if (opts.force) { toSync.push(lid); continue; }
      const lastStr = await AsyncStorage.getItem(`${LAST_SYNC_KEY}:${lid}`);
      if (lastStr && now - parseInt(lastStr, 10) < MIN_INTERVAL_MS) continue;
      toSync.push(lid);
    }
    if (toSync.length === 0) return;

    const syncSet = new Set(toSync);
    const rowsToWrite = rows.filter(r => syncSet.has(r.league_id));

    // Per-league wipe-then-upsert. We delete only the rows scoped to
    // (user_id, league_id) being synced — other leagues' rows survive.
    for (const lid of toSync) {
      const { error: delErr } = await supabase
        .from('user_rostered_players')
        .delete()
        .eq('user_id', user.id)
        .eq('league_id', lid);
      if (delErr) {
        console.log('[rosterSync] delete error:', lid, delErr.message);
      }
    }

    const { error: upErr } = await supabase
      .from('user_rostered_players')
      .upsert(rowsToWrite, { onConflict: 'user_id,normalized_name,league_id' });
    if (upErr) {
      console.log('[rosterSync] upsert error:', upErr.message);
      return;
    }

    for (const lid of toSync) {
      await AsyncStorage.setItem(`${LAST_SYNC_KEY}:${lid}`, String(now));
    }
  } catch (e: any) {
    console.log('[rosterSync] error:', e?.message);
  }
}
