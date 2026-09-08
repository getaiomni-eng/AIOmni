import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearESPNCredentials } from './espn';
import { clearYahooTokens } from './yahoo';
import { resetTierCache } from './purchases';
import { resetPromptStateCache } from './promptQuota';
import { Platform } from 'react-native';
// services/auth.ts
import { supabase, upsertUser } from './supabase';

export interface AIOmniUser {
  id:    string;
  email: string;
}

export async function getUser(): Promise<AIOmniUser | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return { id: user.id, email: user.email ?? '' };
}

export async function signInWithEmail(email: string, password: string): Promise<{
  success: boolean; error?: string;
}> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { success: false, error: error.message };
  if (data.user) {
    await upsertUser({ authId: data.user.id, email: data.user.email });
  }
  return { success: true };
}

export async function signUpWithEmail(email: string, password: string): Promise<{
  success: boolean; error?: string;
}> {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { success: false, error: error.message };
  if (data.user) {
    await upsertUser({ authId: data.user.id, email: data.user.email });
  }
  return { success: true };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();

  // Signing out has to clear this device's platform identity, not just the
  // session. AsyncStorage is not scoped per account, so anything left here is
  // inherited by whoever signs in next.
  //
  // That used to be merely confusing -- a new account seeing someone else's
  // leagues. Since platform links started claiming league identities it is
  // worse: the next account would claim leagues it does not own and forfeit
  // its own free trial doing so.
  //
  // ESPN and Yahoo credentials are session cookies for someone else's account
  // and must never survive a sign-out either.
  try {
    await AsyncStorage.multiRemove([
      // identity
      'sleeper_username', 'user_email', 'sleeper_id',
      // platform links
      'espn_league_ids', 'espn_league_name', 'espn_team_name',
      'mfl_league_id', 'mfl_franchise_id', 'mfl_host', 'mfl_season',
      'fleaflicker_league_id', 'fleaflicker_team_id',
      // per-account caches that would otherwise show the previous user's data
      'league_counts_by_platform', 'roster_sync_last_at',
    ]);
  } catch { /* a failed cleanup must not trap the user in a signed-in state */ }

  // Secrets live in the Keychain on device and in the AsyncStorage fallback
  // on web; clearESPNCredentials/clearYahooTokens handle both.
  try { await clearESPNCredentials(); } catch {}
  try { await clearYahooTokens(); } catch {}

  // In-memory caches outlive the session otherwise.
  try { resetTierCache(); } catch {}
  try { resetPromptStateCache(); } catch {}
}

export async function resetPassword(email: string): Promise<{
  success: boolean; error?: string;
}> {
  // The app scheme cannot open from a browser, so web users clicking the
  // reset link landed nowhere and were locked out with no recovery path.
  const redirectTo = Platform.OS === 'web'
    ? 'https://app.getaiomni.com/auth/reset'
    : 'aiomnifantasy://auth/reset';
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function updatePassword(newPassword: string): Promise<{
  success: boolean; error?: string;
}> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { success: false, error: error.message };
  return { success: true };
}
