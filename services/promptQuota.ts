// services/promptQuota.ts
//
// Tier binding for the prompt counter. This is the ONLY thing the app should
// import for quota questions; the counting itself lives in
// services/util/promptCounter.ts and exists in exactly one place.
//
// Tier policy (Option D, locked 2026-05-04 — unchanged by the merge):
//   Free:     10 prompts LIFETIME (non-renewing) — conversion forcing function
//   Rankings: 25 prompts/week (resets Sunday noon CT)
//   Pro:      50 prompts/week (resets Sunday noon CT)
//
// 2026-07-26: replaced app/utils/promptCounter.ts, which computed its reset
// with `now.setHours(12,0,0,0)` in DEVICE-LOCAL time. That made "Sunday noon"
// a different instant for every user, let a traveler shift their own reset,
// and refilled on any forward clock change. The core module now pins the
// boundary to America/Chicago wall clock and refuses to refill on a backward
// clock jump. Public API below is unchanged so call sites did not move.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCachedTier, getCurrentTier, type Tier } from './purchases';
import { syncPromptUsageToCloud } from './userSync';
import {
  LIFETIME_STORAGE_KEY,
  PromptCounter,
  STORAGE_KEY,
  type CounterStorage,
} from './util/promptCounter';

export const LIMITS: Record<Tier, number> = {
  free: 10,
  rankings: 25,
  pro: 50,
};

// ── platform-link gate ─────────────────────────────────────────────
// Free prompts unlock only after the user links at least one fantasy
// platform (2026-07-28 product decision): the coach is useless without a
// league anyway, and a linked platform is the activation signal + data
// we'd otherwise leave on the table. Checks every platform's storage
// footprint — AsyncStorage league keys plus SecureStore session tokens.
export async function hasLinkedPlatform(): Promise<boolean> {
  try {
    const asyncKeys = [
      'sleeper_username',
      'espn_leagues_v2', 'espn_league_ids',
      'mfl_leagues_v2', 'mfl_league_id',
      'fleaflicker_leagues_v2', 'fleaflicker_league_id',
    ];
    const pairs = await AsyncStorage.multiGet(asyncKeys);
    if (pairs.some(([, v]) => !!v && v !== '[]' && v !== 'null' && v !== '')) return true;
    const { getSecure } = require('./util/secureStore');
    const [yahoo, espn] = await Promise.all([getSecure('yahoo_tokens'), getSecure('espn_s2')]);
    return !!yahoo || !!espn;
  } catch { return true; } // fail open — never lock a paying/linked user out on a read error
}

// ── storage ────────────────────────────────────────────────────────
// CounterStorage is deliberately synchronous (the core is sync so its reset
// math stays trivially testable), which rules out AsyncStorage. expo-secure-
// store exposes sync getItem/setItem with exactly the right signatures, so it
// backs the counter directly — no new native dependency, no rebuild.
//
// Lazy require + try/catch mirrors services/util/secureStore.ts, for the
// reason documented there (build 162 boot crash on a bad native link).

let memoryFallback: Record<string, string> | null = null;

function getSecureStore(): any | null {
  try {
    return require('expo-secure-store');
  } catch (e: any) {
    console.log('[promptQuota] secure-store unavailable:', e?.message);
    return null;
  }
}

// Fail-open in-memory store, used only when the native module won't load at
// all. Quota then resets on relaunch — acceptable because an app in that state
// is already broken, and locking every user out of AI is the worse failure.
function memory(): Record<string, string> {
  if (!memoryFallback) memoryFallback = {};
  return memoryFallback;
}

const storage: CounterStorage = {
  get(key: string): string | null {
    const ss = getSecureStore();
    if (!ss) return memory()[key] ?? null;
    try {
      return ss.getItem(key) ?? null;
    } catch (e: any) {
      console.log('[promptQuota] get failed:', key, e?.message);
      return null;
    }
  },
  set(key: string, value: string): void {
    const ss = getSecureStore();
    if (!ss) {
      memory()[key] = value;
      return;
    }
    // Intentionally NOT swallowed: the core treats a throw here as "the
    // decrement did not persist" and fails closed rather than granting a
    // prompt it can't account for.
    ss.setItem(key, value);
  },
};

function counterFor(tier: Tier): PromptCounter {
  return new PromptCounter({
    storage,
    quota: LIMITS[tier],
    lifetime: tier === 'free',
  });
}

// ── migration ──────────────────────────────────────────────────────
// The old implementation kept three AsyncStorage keys holding USED counts.
// Without this, everyone currently at their cap would get an instant refill
// and anyone mid-week would lose their spent prompts. Idempotent, one-shot —
// same shape as migrateAsyncToSecure() in util/secureStore.ts.

const OLD_COUNT_KEY = 'prompt_count';
const OLD_RESET_KEY = 'prompt_reset_time';
const OLD_FREE_KEY = 'free_lifetime_used';
const MIGRATED_FLAG = 'promptCounter.migrated.v1';

let migration: Promise<void> | null = null;

async function migrateOnce(): Promise<void> {
  if (storage.get(MIGRATED_FLAG)) return;

  try {
    const [oldFree, oldCount, oldReset] = await Promise.all([
      AsyncStorage.getItem(OLD_FREE_KEY),
      AsyncStorage.getItem(OLD_COUNT_KEY),
      AsyncStorage.getItem(OLD_RESET_KEY),
    ]);

    // Free tier: lifetime used → remaining. Never expires, so no reset check.
    if (oldFree !== null && !storage.get(LIFETIME_STORAGE_KEY)) {
      const used = Math.max(0, parseInt(oldFree, 10) || 0);
      storage.set(
        LIFETIME_STORAGE_KEY,
        JSON.stringify({
          schemaVersion: 1,
          periodId: 'lifetime',
          remaining: Math.max(0, LIMITS.free - used),
          quota: LIMITS.free,
        }),
      );
    }

    // Paid tiers: weekly used → remaining, but only if the OLD reset instant
    // hasn't already passed. If it has, their week had rolled over under the
    // old rules and carrying the count forward would double-charge them.
    if (oldCount !== null && !storage.get(STORAGE_KEY)) {
      const alreadyReset = oldReset !== null && Date.now() >= (parseInt(oldReset, 10) || 0);
      const used = alreadyReset ? 0 : Math.max(0, parseInt(oldCount, 10) || 0);
      const tier = await getCurrentTier();
      // Free users can hold a stale weekly count from a lapsed subscription;
      // seed against the rankings cap so a later upgrade doesn't over-grant.
      const cap = tier === 'free' ? LIMITS.rankings : LIMITS[tier];
      const counter = counterFor(tier === 'free' ? 'rankings' : tier);
      storage.set(
        STORAGE_KEY,
        JSON.stringify({
          schemaVersion: 1,
          periodId: currentWeeklyPeriodId(counter),
          remaining: Math.max(0, cap - used),
          quota: cap,
        }),
      );
    }

    storage.set(MIGRATED_FLAG, '1');
    await AsyncStorage.multiRemove([OLD_COUNT_KEY, OLD_RESET_KEY, OLD_FREE_KEY]).catch(() => {});
  } catch (e: any) {
    console.log('[promptQuota] migration failed:', e?.message);
    // Leave the flag unset so the next launch retries rather than starting
    // everyone fresh off a transient AsyncStorage error.
  }
}

/** The period id the core would assign to right now, derived from its own
 *  reset boundary so migration can't disagree with it. */
function currentWeeklyPeriodId(counter: PromptCounter): string {
  // nextResetAt() is the END of the current period; the period it belongs to
  // started seven days earlier.
  const next = counter.nextResetAt();
  const start = new Date(next.getTime() - 7 * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(start);
  return parts; // en-CA renders YYYY-MM-DD
}

function ensureMigrated(): Promise<void> {
  if (!migration) migration = migrateOnce();
  return migration;
}

// ── public API (unchanged surface — see git history for the old impl) ──

export async function getRemainingPrompts(): Promise<number> {
  await ensureMigrated();
  const tier = await getCurrentTier();
  return counterFor(tier).getRemaining();
}

export async function getPromptLimit(): Promise<number> {
  const tier = await getCurrentTier();
  return LIMITS[tier];
}

/**
 * Atomic check-and-charge. Returns false if the user is over their cap
 * (caller routes to the paywall), true once the decrement has PERSISTED —
 * a storage failure returns false rather than granting an untracked prompt.
 */
export async function consumePrompt(): Promise<boolean> {
  await ensureMigrated();
  const tier = await getCurrentTier();
  const counter = counterFor(tier);
  const result = counter.tryConsume();
  if (result.ok && tier === 'free') {
    syncPromptUsageToCloud(LIMITS.free - result.remaining); // fire-and-forget
  }
  return result.ok;
}

export async function canSendPrompt(): Promise<boolean> {
  return (await getRemainingPrompts()) > 0;
}

/** Charge without inspecting the outcome. Prefer consumePrompt() at new call
 *  sites — this exists for callers that check the cap separately. */
export async function incrementPrompt(): Promise<void> {
  await consumePrompt();
}

export async function getResetTime(): Promise<Date | null> {
  const tier = await getCurrentTier();
  if (tier === 'free') return null; // lifetime allowance — nothing to reset
  return counterFor(tier).nextResetAt();
}

// ── display helpers ────────────────────────────────────────────────

const RESET_LABEL_TZ = 'America/Chicago';

/**
 * "Resets Sunday 12 PM CT" — the reset is a fixed Chicago instant for every
 * user, so it MUST be formatted in Chicago. Rendering it in device-local time
 * prints the wrong hour for everyone outside CT.
 */
export function formatResetLabel(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: RESET_LABEL_TZ,
    weekday: 'long',
    hour: 'numeric',
    hour12: true,
  }).formatToParts(at);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sunday';
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '12';
  const period = parts.find((p) => p.type === 'dayPeriod')?.value ?? 'PM';
  return `Resets ${weekday} ${hour} ${period.toUpperCase()} CT`;
}

export interface PromptStatus {
  used: number;
  cap: number;
  resetType: 'lifetime' | 'weekly';
  nextResetDate?: Date;
  remaining: number;
}

/** Snapshot for UI. Uses the cached tier so it can run during render. */
export async function getPromptStatus(): Promise<PromptStatus> {
  await ensureMigrated();
  const tier = getCachedTier();
  const counter = counterFor(tier);
  const cap = LIMITS[tier];
  const remaining = counter.getRemaining();
  return {
    used: cap - remaining,
    cap,
    remaining,
    resetType: tier === 'free' ? 'lifetime' : 'weekly',
    nextResetDate: tier === 'free' ? undefined : counter.nextResetAt(),
  };
}

export async function getPromptDisplayInfo(): Promise<{
  remaining: number;
  limit: number;
  tier: string;
  isLifetime: boolean;
  resetLabel: string;
}> {
  await ensureMigrated();
  const tier = await getCurrentTier();
  const counter = counterFor(tier);
  const remaining = counter.getRemaining();
  const limit = LIMITS[tier];
  const isLifetime = tier === 'free';

  const resetLabel = isLifetime
    ? remaining > 0
      ? `${remaining} free prompts remaining`
      : 'Free prompts used — upgrade for more'
    : formatResetLabel(counter.nextResetAt());

  return { remaining, limit, tier, isLifetime, resetLabel };
}
