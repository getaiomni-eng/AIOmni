// services/auth.ts
// User authentication and account management via Supabase

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export interface AIOmniUser {
  id:               string;
  authId:           string;
  sleeperUsername:  string | null;
  email:            string | null;
  tier:             'free' | 'rankings' | 'pro' | 'premium' | 'dynasty_elite';
}

export async function signUp(email: string, password: string): Promise<{ user: AIOmniUser | null; error: string | null }> {
  try {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { user: null, error: error.message };
    if (!data.user) return { user: null, error: 'Sign up failed' };

    // Create user record
    const sleeperUsername = await AsyncStorage.getItem('sleeper_username');
    const { error: insertError } = await supabase.from('users').insert({
      auth_id:          data.user.id,
      email,
      sleeper_username: sleeperUsername ?? null,
      tier:             'free',
    });
    if (insertError) console.log('User insert error:', insertError);

    const user = await getUser();
    return { user, error: null };
  } catch (e: any) {
    return { user: null, error: e.message ?? 'Unknown error' };
  }
}

export async function signIn(email: string, password: string): Promise<{ user: AIOmniUser | null; error: string | null }> {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { user: null, error: error.message };
    const user = await getUser();
    return { user, error: null };
  } catch (e: any) {
    return { user: null, error: e.message ?? 'Unknown error' };
  }
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export async function getUser(): Promise<AIOmniUser | null> {
  try {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) return null;

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('auth_id', authUser.id)
      .single();

    if (error || !data) return null;

    return {
      id:              data.id,
      authId:          data.auth_id,
      sleeperUsername: data.sleeper_username,
      email:           data.email,
      tier:            data.tier,
    };
  } catch { return null; }
}

export async function isSignedIn(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  return !!session;
}

export async function updateSleeperUsername(username: string): Promise<boolean> {
  try {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) return false;

    const { error } = await supabase
      .from('users')
      .update({ sleeper_username: username, updated_at: new Date().toISOString() })
      .eq('auth_id', authUser.id);

    if (!error) await AsyncStorage.setItem('sleeper_username', username);
    return !error;
  } catch { return false; }
}

export async function getUserTier(): Promise<string> {
  try {
    const user = await getUser();
    return user?.tier ?? 'free';
  } catch { return 'free'; }
}

export const TIER_LIMITS: Record<string, number> = {
  free:          25,
  rankings:      25,
  pro:           75,
  premium:       125,
  dynasty_elite: 999999,
};

export function getPromptLimit(tier: string): number {
  return TIER_LIMITS[tier] ?? 25;
}