// Platform links that follow the account instead of the device.
//
// Only NON-SECRET identifiers sync: a Sleeper user id, an MFL league and
// franchise, a Fleaflicker league and team. ESPN (espn_s2 + SWID) and Yahoo
// hold live session cookies -- anyone reading those could act as the user on
// that platform -- so they stay in device storage and are not handled here.
//
// Claiming is also the abuse control. The first account to claim a given
// league identity owns the free trial for it; a second account claiming the
// same one forfeits its trial. That replaces device binding, which cost users
// a reconnect on every new device and prevented nothing: AsyncStorage is not
// scoped per account and sign-out never cleared it, so signing out and
// signing up again kept the leagues AND handed over a fresh allowance.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { logCaught } from './util/logCaught';

export type LinkPlatform = 'sleeper' | 'mfl' | 'fleaflicker';

/** AsyncStorage keys that make up each platform's identity. First key is the id. */
const KEYS: Record<LinkPlatform, { id: string; meta: string[] }> = {
  // sleeper_username rides along in meta so a restore on a second device
  // rehydrates the key the REST of the app actually reads. Restoring only
  // sleeper_id would record the claim and still show Sleeper as
  // disconnected everywhere in the UI.
  sleeper:     { id: 'sleeper_id',            meta: ['sleeper_username'] },
  mfl:         { id: 'mfl_league_id',         meta: ['mfl_franchise_id', 'mfl_host', 'mfl_season'] },
  fleaflicker: { id: 'fleaflicker_league_id', meta: ['fleaflicker_team_id'] },
};

/**
 * Resolve and persist the numeric Sleeper user id from the username.
 *
 * WHY THIS EXISTS (measured 2026-09-18): connecting Sleeper wrote ONLY
 * 'sleeper_username'. Nothing has ever written 'sleeper_id', which is the key
 * this module claims on -- so claimAllLocal() ran on every home-screen load,
 * read null, and recorded nothing. Every Sleeper connection since launch was
 * invisible to the backend. Proof: all four rows in user_platform_links are
 * mfl/fleaflicker, whose adapters DO write their legacy single-league keys
 * via multiSet. Not one Sleeper row exists.
 *
 * The id, not the username, is the identity on purpose: a username can be
 * changed on Sleeper, and the claim is what the free-trial abuse control
 * hangs off. An identifier a user can rotate at will is not a fingerprint.
 *
 * Self-healing: this runs for everyone already connected, so their link is
 * claimed on next launch with no migration and no prompt.
 */
async function ensureSleeperId(): Promise<string | null> {
  const existing = await AsyncStorage.getItem('sleeper_id');
  if (existing) return existing;
  const username = await AsyncStorage.getItem('sleeper_username');
  if (!username) return null;
  try {
    const res = await fetch('https://api.sleeper.app/v1/user/' + encodeURIComponent(username));
    if (!res.ok) return null;
    const data = await res.json();
    const uid = data?.user_id ? String(data.user_id) : null;
    if (uid) await AsyncStorage.setItem('sleeper_id', uid);
    return uid;
  } catch (e) {
    // Offline or Sleeper down. Claiming is best-effort and retried on every
    // launch, so a miss here costs nothing.
    logCaught('platformLinks.ensureSleeperId', e);
    return null;
  }
}

async function readLocal(p: LinkPlatform) {
  if (p === 'sleeper') await ensureSleeperId();
  const id = await AsyncStorage.getItem(KEYS[p].id);
  if (!id) return null;
  const meta: Record<string, string> = {};
  for (const k of KEYS[p].meta) {
    const v = await AsyncStorage.getItem(k);
    if (v) meta[k] = v;
  }
  return { id, meta };
}

/**
 * Record this account's claim on a platform identity.
 * Returns whether the free trial was forfeited, so the caller can say so
 * plainly rather than letting the user discover it at zero prompts.
 */
export async function claimPlatform(p: LinkPlatform): Promise<{ forfeited: boolean } | null> {
  try {
    const local = await readLocal(p);
    if (!local) return null;
    const { data, error } = await supabase.rpc('claim_platform_link', {
      p_platform: p, p_external_id: local.id, p_meta: local.meta,
    });
    if (error) { logCaught('platformLinks.claim', error); return null; }
    const row = Array.isArray(data) ? data[0] : data;
    return { forfeited: row?.trial_forfeited === true };
  } catch (e) {
    logCaught('platformLinks.claim', e);
    return null;
  }
}

/** Claim everything currently connected on this device. Safe to call repeatedly. */
export async function claimAllLocal(): Promise<void> {
  for (const p of Object.keys(KEYS) as LinkPlatform[]) {
    await claimPlatform(p);
  }
}

/**
 * Pull this account's links down and write them into local storage.
 *
 * This is what makes the web app and a second phone work without
 * reconnecting. Local values win when present: a link the user just set up
 * on THIS device is more current than what the server last saw.
 * Returns how many platforms were restored.
 */
export async function restorePlatformLinks(): Promise<number> {
  try {
    const { data, error } = await supabase.rpc('my_platform_links');
    if (error || !Array.isArray(data)) return 0;
    let n = 0;
    for (const row of data) {
      const p = row.platform as LinkPlatform;
      if (!KEYS[p]) continue;
      const existing = await AsyncStorage.getItem(KEYS[p].id);
      if (existing) continue;                       // device already set up
      await AsyncStorage.setItem(KEYS[p].id, String(row.external_id));
      const meta = (row.meta ?? {}) as Record<string, string>;
      for (const k of KEYS[p].meta) {
        if (meta[k]) await AsyncStorage.setItem(k, String(meta[k]));
      }
      n++;
    }
    return n;
  } catch (e) {
    logCaught('platformLinks.restore', e);
    return 0;
  }
}

export async function unlinkPlatform(p: LinkPlatform): Promise<void> {
  try { await supabase.rpc('unlink_platform', { p_platform: p }); }
  catch (e) { logCaught('platformLinks.unlink', e); }
}
