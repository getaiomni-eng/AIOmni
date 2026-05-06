// app/utils/promptCounter.ts
// Tier-aware prompt system (Option D, locked 2026-05-04):
//   Free:     10 prompts LIFETIME (non-renewing) — conversion forcing function
//   Rankings: 25 prompts/week (resets Sunday noon)
//   Pro:      50 prompts/week (resets Sunday noon)

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCachedTier, getCurrentTier, type Tier } from '../../services/purchases';
import { syncPromptUsageToCloud } from '../../services/userSync';

const PROMPT_COUNT_KEY = 'prompt_count';
const PROMPT_RESET_KEY = 'prompt_reset_time';
const FREE_LIFETIME_KEY = 'free_lifetime_used';

const LIMITS: Record<Tier, number> = {
  free: 10,
  rankings: 25,
  pro: 50,
};

function getNextSundayNoon(): number {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const daysUntilSunday = day === 0 ? 7 : 7 - day;
  const next = new Date(now);
  next.setDate(now.getDate() + daysUntilSunday);
  next.setHours(12, 0, 0, 0);
  return next.getTime();
}

// Weekly reset — only applies to paid tiers
async function maybeResetWeekly(): Promise<void> {
  const resetTimeStr = await AsyncStorage.getItem(PROMPT_RESET_KEY);
  const now = Date.now();

  if (!resetTimeStr) {
    await AsyncStorage.setItem(PROMPT_RESET_KEY, getNextSundayNoon().toString());
    await AsyncStorage.setItem(PROMPT_COUNT_KEY, '0');
    return;
  }

  const resetTime = parseInt(resetTimeStr, 10);
  if (now >= resetTime) {
    await AsyncStorage.setItem(PROMPT_COUNT_KEY, '0');
    await AsyncStorage.setItem(PROMPT_RESET_KEY, getNextSundayNoon().toString());
  }
}

export async function getRemainingPrompts(): Promise<number> {
  const tier = await getCurrentTier();
  const limit = LIMITS[tier];

  if (tier === 'free') {
    // Lifetime — read from separate key, never resets
    const usedStr = await AsyncStorage.getItem(FREE_LIFETIME_KEY);
    const used = parseInt(usedStr || '0', 10);
    return Math.max(0, limit - used);
  }

  // Paid tiers — weekly reset
  await maybeResetWeekly();
  const countStr = await AsyncStorage.getItem(PROMPT_COUNT_KEY);
  const used = parseInt(countStr || '0', 10);
  return Math.max(0, limit - used);
}

export async function getPromptLimit(): Promise<number> {
  const tier = await getCurrentTier();
  return LIMITS[tier];
}

// ── consumePrompt: atomic check-and-increment ──────────────────────
// Returns false if the user is over their cap (caller routes to paywall).
// Returns true after incrementing the appropriate counter.
//
// Replaces the older canSendPrompt() + incrementPrompt() pair which had
// a TOCTOU window — two rapid sends could both pass the check, then both
// increment, allowing one extra prompt past the cap. Existing call sites
// that use the older pair still work; new sites should prefer this.
export async function consumePrompt(): Promise<boolean> {
  const tier = await getCurrentTier();
  if (tier === 'free') {
    const usedStr = await AsyncStorage.getItem(FREE_LIFETIME_KEY);
    const used = parseInt(usedStr || '0', 10);
    if (used >= LIMITS.free) return false;
    const next = used + 1;
    await AsyncStorage.setItem(FREE_LIFETIME_KEY, String(next));
    syncPromptUsageToCloud(next); // fire-and-forget
    return true;
  }
  await maybeResetWeekly();
  const countStr = await AsyncStorage.getItem(PROMPT_COUNT_KEY);
  const used = parseInt(countStr || '0', 10);
  if (used >= LIMITS[tier]) return false;
  await AsyncStorage.setItem(PROMPT_COUNT_KEY, String(used + 1));
  return true;
}

// ── getPromptStatus: structured read for UI display ─────────────────
// Sync-cache-tier variant for places that render the counter and need a
// snapshot. Uses getCachedTier so it can run during render without await.
export interface PromptStatus {
  used: number;
  cap: number;
  resetType: 'lifetime' | 'weekly';
  nextResetDate?: Date;
  remaining: number;
}

export async function getPromptStatus(): Promise<PromptStatus> {
  const tier = getCachedTier();
  if (tier === 'free') {
    const used = parseInt((await AsyncStorage.getItem(FREE_LIFETIME_KEY)) || '0', 10);
    return {
      used,
      cap: LIMITS.free,
      resetType: 'lifetime',
      remaining: Math.max(0, LIMITS.free - used),
    };
  }
  await maybeResetWeekly();
  const used = parseInt((await AsyncStorage.getItem(PROMPT_COUNT_KEY)) || '0', 10);
  const cap = LIMITS[tier];
  return {
    used,
    cap,
    resetType: 'weekly',
    nextResetDate: new Date(getNextSundayNoon()),
    remaining: Math.max(0, cap - used),
  };
}

export async function canSendPrompt(): Promise<boolean> {
  const remaining = await getRemainingPrompts();
  return remaining > 0;
}

export async function incrementPrompt(): Promise<void> {
  const tier = await getCurrentTier();

  if (tier === 'free') {
    const usedStr = await AsyncStorage.getItem(FREE_LIFETIME_KEY);
    const used = parseInt(usedStr || '0', 10);
    const newUsed = used + 1;
    await AsyncStorage.setItem(FREE_LIFETIME_KEY, newUsed.toString());
    syncPromptUsageToCloud(newUsed); // fire and forget
    return;
  }

  // Paid tiers — weekly counter
  await maybeResetWeekly();
  const countStr = await AsyncStorage.getItem(PROMPT_COUNT_KEY);
  const used = parseInt(countStr || '0', 10);
  await AsyncStorage.setItem(PROMPT_COUNT_KEY, (used + 1).toString());
}

export async function getResetTime(): Promise<Date | null> {
  const tier = await getCurrentTier();
  if (tier === 'free') return null; // no reset for free — lifetime
  const resetTimeStr = await AsyncStorage.getItem(PROMPT_RESET_KEY);
  if (!resetTimeStr) return null;
  return new Date(parseInt(resetTimeStr, 10));
}

// Returns display-friendly info for the prompt counter UI
export async function getPromptDisplayInfo(): Promise<{
  remaining: number;
  limit: number;
  tier: string;
  isLifetime: boolean;
  resetLabel: string;
}> {
  const tier = await getCurrentTier();
  const remaining = await getRemainingPrompts();
  const limit = LIMITS[tier];
  const isLifetime = tier === 'free';

  let resetLabel = '';
  if (isLifetime) {
    resetLabel = remaining > 0 ? `${remaining} free prompts remaining` : 'Free prompts used — upgrade for more';
  } else {
    const resetTime = await getResetTime();
    if (resetTime) {
      const now = new Date();
      const diff = resetTime.getTime() - now.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      if (days > 0) {
        resetLabel = `Resets in ${days}d ${hours}h`;
      } else if (hours > 0) {
        resetLabel = `Resets in ${hours}h`;
      } else {
        resetLabel = 'Resets soon';
      }
    }
  }

  return { remaining, limit, tier, isLifetime, resetLabel };
}