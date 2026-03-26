// app/utils/promptCounter.ts
// 25 prompts/week — resets Sunday noon

import AsyncStorage from '@react-native-async-storage/async-storage';

const PROMPT_COUNT_KEY = 'prompt_count';
const PROMPT_RESET_KEY = 'prompt_reset_time';
const WEEKLY_LIMIT = 25;

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
    // First time — set the first reset window
    await AsyncStorage.setItem(PROMPT_RESET_KEY, getNextSundayNoon().toString());
    await AsyncStorage.setItem(PROMPT_COUNT_KEY, '0');
    return;
  }

  const resetTime = parseInt(resetTimeStr, 10);
  if (now >= resetTime) {
    // Past reset time — wipe count and set next reset
    await AsyncStorage.setItem(PROMPT_COUNT_KEY, '0');
    await AsyncStorage.setItem(PROMPT_RESET_KEY, getNextSundayNoon().toString());
  }
}

export async function getRemainingPrompts(): Promise<number> {
  await maybeReset();
  const countStr = await AsyncStorage.getItem(PROMPT_COUNT_KEY);
  const used = parseInt(countStr || '0', 10);
  return Math.max(0, WEEKLY_LIMIT - used);
}

export async function canSendPrompt(): Promise<boolean> {
  const remaining = await getRemainingPrompts();
  return remaining > 0;
}

export async function incrementPrompt(): Promise<void> {
  await maybeReset();
  const countStr = await AsyncStorage.getItem(PROMPT_COUNT_KEY);
  const used = parseInt(countStr || '0', 10);
  await AsyncStorage.setItem(PROMPT_COUNT_KEY, (used + 1).toString());
}

export async function getResetTime(): Promise<Date | null> {
  const resetTimeStr = await AsyncStorage.getItem(PROMPT_RESET_KEY);
  if (!resetTimeStr) return null;
  return new Date(parseInt(resetTimeStr, 10));
}
