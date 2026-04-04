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
}

export async function resetPassword(email: string): Promise<{
  success: boolean; error?: string;
}> {
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) return { success: false, error: error.message };
  return { success: true };
}
