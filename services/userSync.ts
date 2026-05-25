// services/userSync.ts
// Cross-device data sync via Supabase
// Rankings + prompt usage survive phone switches and reinstalls

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

// ── Rankings Sync ─────────────────────────────────────────────────────────────

export async function syncRankingsToCloud(rankings: any[], format: string = 'PPR'): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return; // Not authenticated — local only

    await supabase
      .from('user_rankings')
      .upsert(
        {
          user_id: user.id,
          format,
          rankings_json: rankings,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,format' }
      );
  } catch (e) {
    console.log('syncRankingsToCloud error:', e);
    // Fail silently — local copy is the fallback
  }
}

export async function loadRankingsFromCloud(format: string = 'PPR'): Promise<any[] | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('user_rankings')
      .select('rankings_json, updated_at')
      .eq('user_id', user.id)
      .eq('format', format)
      .single();

    if (error || !data) return null;

    // Check if cloud is newer than local
    const localTs = await AsyncStorage.getItem(`rankings_ts_${format}`);
    const cloudTs = new Date(data.updated_at).getTime();
    const localTime = localTs ? parseInt(localTs, 10) : 0;

    if (cloudTs > localTime) {
      // Cloud is newer — update local
      const rankings = data.rankings_json as any[];
      await AsyncStorage.setItem(`my_custom_rankings_${format}`, JSON.stringify(rankings));
      await AsyncStorage.setItem(`rankings_ts_${format}`, cloudTs.toString());
      return rankings;
    }

    return null; // Local is newer or same
  } catch (e) {
    console.log('loadRankingsFromCloud error:', e);
    return null;
  }
}

// Call this on app startup after auth to pull cloud data if newer
export async function pullCloudDataOnLogin(): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Sync rankings for all formats
    for (const format of ['PPR', 'HALF', 'STD', 'SF', 'DYN']) {
      await loadRankingsFromCloud(format);
    }

    // Sync prompt usage
    await loadPromptUsageFromCloud();
  } catch (e) {
    console.log('pullCloudDataOnLogin error:', e);
  }
}

// ── Prompt Usage Sync ─────────────────────────────────────────────────────────

const FREE_LIFETIME_KEY = 'free_lifetime_used';

export async function syncPromptUsageToCloud(lifetimeUsed: number): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Surface errors explicitly — previous code relied on .catch which
    // misses error objects returned in the response (vs. thrown exceptions),
    // so failed writes were silent and prompt usage wasn't surviving
    // reinstall. Logging now so we can see what RLS/missing-column/etc.
    // problem is killing the write.
    const { error } = await supabase
      .from('prompt_usage')
      .upsert(
        {
          user_id: user.id,
          free_lifetime_used: lifetimeUsed,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );
    if (error) {
      console.log('[prompt-sync] upsert error:', error.message, error.code);
    }
  } catch (e: any) {
    console.log('[prompt-sync] threw:', e?.message);
  }
}

export async function loadPromptUsageFromCloud(): Promise<number | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    // .maybeSingle (not .single) so a first-time user with no row returns
    // null instead of throwing PGRST116. Previously the throw aborted the
    // load and AsyncStorage stayed at 0, masking any cloud data and
    // letting reinstalls reset the counter even when the row existed.
    const { data, error } = await supabase
      .from('prompt_usage')
      .select('free_lifetime_used')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.log('[prompt-sync] load error:', error.message, error.code);
      return null;
    }
    if (!data) {
      // No row yet — first time this user has been recorded. Initialize
      // from local (if any) so subsequent syncs upsert correctly.
      const localStr = await AsyncStorage.getItem(FREE_LIFETIME_KEY);
      const localUsed = parseInt(localStr || '0', 10);
      return localUsed;
    }

    const cloudUsed = Number(data.free_lifetime_used) || 0;
    const localStr = await AsyncStorage.getItem(FREE_LIFETIME_KEY);
    const localUsed = parseInt(localStr || '0', 10);

    // Take the higher value — prevents gaming by reinstalling AND
    // restores after a legitimate reinstall.
    const actual = Math.max(cloudUsed, localUsed);
    await AsyncStorage.setItem(FREE_LIFETIME_KEY, actual.toString());
    return actual;
  } catch (e: any) {
    console.log('[prompt-sync] load threw:', e?.message);
    return null;
  }
}
