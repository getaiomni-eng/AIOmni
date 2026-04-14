// services/season.ts
// Dynamic NFL season — auto-rolls when Sleeper flips to next year
import AsyncStorage from '@react-native-async-storage/async-storage';

let cachedSeason: string | null = null;

export async function getNFLSeason(): Promise<string> {
  if (cachedSeason) return cachedSeason;
  
  try {
    const state = await (await fetch('https://api.sleeper.app/v1/state/nfl')).json();
    cachedSeason = state.season || String(new Date().getFullYear());
    await AsyncStorage.setItem('nfl_season', cachedSeason);
    return cachedSeason;
  } catch {
    const saved = await AsyncStorage.getItem('nfl_season');
    cachedSeason = saved || String(new Date().getFullYear());
    return cachedSeason;
  }
}

export async function getNFLWeek(): Promise<number> {
  try {
    const state = await (await fetch('https://api.sleeper.app/v1/state/nfl')).json();
    return state.display_week || 1;
  } catch { return 1; }
}

export function getAvailableSeasons(): string[] {
  const current = new Date().getFullYear();
  return [String(current), String(current - 1), String(current - 2), String(current - 3)];
}
