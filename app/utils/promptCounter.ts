// app/utils/promptCounter.ts
// 25 prompts/week — resets Sunday noon

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCurrentTier } from '../../services/purchases';

const PROMPT_COUNT_KEY = 'prompt_count';
const PROMPT_RESET_KEY = 'prompt_reset_time';

function getPromptLimit(tier: string): number {
  switch (tier) {
    case 'free': return 25;
    case 'rankings': return 0;
    case 'pro': return 75;
    case 'premium': return 125;
    case 'dynasty_elite': return 999;
    default: return 25;
  }
}

function getNextSundayNoon(): number {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const daysUntilSunday = day === 0 ? 7 : 7 - day;
  const next = new Date(now);
  next.setDate(now.getDate() + daysUntilSunday);
  next.setHours(12, 0, 0, 0);
  return next.getTime();
}

async function maybeReset(): Promise<void> {
  const resetTimeStr = await AsyncStorage.getItem(PROMPT_RESET_KEY);
  const now = Date.now();

  if (!resetTimeStr) {
    // First time — initialize used count to 0, set first reset window
    await AsyncStorage.setItem(PROMPT_RESET_KEY, getNextSundayNoon().toString());
    await AsyncStorage.setItem(PROMPT_COUNT_KEY, '0');
    return;
  }

  const resetTime = parseInt(resetTimeStr, 10);
  if (now >= resetTime) {
    // Past reset time — reset used count to 0 and set next window
    await AsyncStorage.setItem(PROMPT_COUNT_KEY, '0');
    await AsyncStorage.setItem(PROMPT_RESET_KEY, getNextSundayNoon().toString());
  }
}

export async function getRemainingPrompts(): Promise<number> {
  const tier = await getCurrentTier();
  const limit = getPromptLimit(tier);
  if (limit >= 999) return 999;
  await maybeReset();
  const countStr = await AsyncStorage.getItem(PROMPT_COUNT_KEY);
  const used = parseInt(countStr || '0', 10);
  return Math.max(0, limit - used);
}

export async function canSendPrompt(): Promise<boolean> {
  const tier = await getCurrentTier();
  if (getPromptLimit(tier) >= 999) return true;
  const remaining = await getRemainingPrompts();
  return remaining > 0;
}

export async function incrementPrompt(): Promise<void> {
  const tier = await getCurrentTier();
  const limit = getPromptLimit(tier);
  if (limit >= 999) return;
  await maybeReset();
  const countStr = await AsyncStorage.getItem(PROMPT_COUNT_KEY);
  const used = parseInt(countStr || '0', 10);
  await AsyncStorage.setItem(PROMPT_COUNT_KEY, (used + 1).toString());
}

export async function getResetTime(): Promise<Date> {
  const resetTimeStr = await AsyncStorage.getItem(PROMPT_RESET_KEY);
  if (!resetTimeStr) {
    return new Date(getNextSundayNoon());
  }
  return new Date(parseInt(resetTimeStr, 10));
}
