// app/utils/promptCounter.ts
// Tier-aware prompt system:
//   Free:     10 prompts LIFETIME (non-renewing)
//   Rankings: 20 prompts/week (resets Sunday noon)
//   Pro:      40 prompts/week (resets Sunday noon)

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCurrentTier } from '../../services/purchases';
import { syncPromptUsageToCloud } from '../../services/userSync';

const PROMPT_COUNT_KEY = 'prompt_count';
const PROMPT_RESET_KEY = 'prompt_reset_time';
const FREE_LIFETIME_KEY = 'free_lifetime_used';

const LIMITS: Record<string, number> = {
  free: 10,       // lifetime, never resets
  rankings: 20,   // per week
  pro: 40,        // per week
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
  const limit = LIMITS[tier] ?? LIMITS.free;

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
  return LIMITS[tier] ?? LIMITS.free;
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
  const limit = LIMITS[tier] ?? LIMITS.free;
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