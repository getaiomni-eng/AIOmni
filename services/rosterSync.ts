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

// Match the normalization used in services/rankingsData.ts:fetchBlendedConsensus
// so news-side matching joins cleanly across data sources.
function normalize(name: string): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/, '')
    .replace(/[^a-z]/g, '');
}

/**
 * Replace the user's full rostered_players cache with the provided list.
 * Coalesces — does nothing if the last sync was < MIN_INTERVAL_MS ago,
 * unless `force` is set (used when the user changes leagues).
 */
export async function syncRosteredPlayers(
  players: RosteredPlayer[],
  opts: { force?: boolean } = {},
): Promise<void> {
  try {
    if (!opts.force) {
      const lastStr = await AsyncStorage.getItem(LAST_SYNC_KEY);
      if (lastStr) {
        const last = parseInt(lastStr, 10);
        if (Date.now() - last < MIN_INTERVAL_MS) return;
      }
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // De-dupe within the same user — same player on multiple rosters
    // collapses to one row per (user_id, normalized_name, league_id).
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

    // Wipe the user's existing rows then re-insert. Cheaper than diffing
    // server-side; the table holds at most ~200 rows per user (a handful
    // of leagues × ~30 roster slots).
    await supabase.from('user_rostered_players').delete().eq('user_id', user.id);
    // Upsert in case any leftover row survives the delete (rare race).
    const { error } = await supabase
      .from('user_rostered_players')
      .upsert(rows, { onConflict: 'user_id,normalized_name,league_id' });
    if (error) {
      console.log('[rosterSync] upsert error:', error.message);
      return;
    }

    await AsyncStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
  } catch (e) {
    console.log('[rosterSync] error:', e);
  }
}
