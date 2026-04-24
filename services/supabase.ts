// services/supabase.ts
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL  = 'https://khoruzvsprxyocisuhet.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    storage:          AsyncStorage,
    autoRefreshToken: true,
    persistSession:   true,
    detectSessionInUrl: true,
  },
});

// ── User helpers ─────────────────────────────────────────────

export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function upsertUser(params: {
  authId:          string;
  email?:          string;
  sleeperUsername?: string;
  tier?:           string;
}) {
  const { error } = await supabase
    .from('users')
    .upsert({
      auth_id:          params.authId,
      email:            params.email,
      sleeper_username: params.sleeperUsername,
      tier:             params.tier ?? 'free',
      updated_at:       new Date().toISOString(),
    }, { onConflict: 'auth_id' });

  if (error) console.error('upsertUser:', error.message);
}

export async function getUserRow() {
  const user = await getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('auth_id', user.id)
    .single();
  if (error) console.error('getUserRow:', error.message);
  return data;
}

export async function updateTier(tier: string) {
  const user = await getUser();
  if (!user) return;
  const { error } = await supabase
    .from('users')
    .update({ tier, updated_at: new Date().toISOString() })
    .eq('auth_id', user.id);
  if (error) console.error('updateTier:', error.message);
}

// ── Promo codes ──────────────────────────────────────────────

export async function validatePromoCode(code: string): Promise<{
  valid: boolean; tier?: string; discountPct?: number; error?: string;
}> {
  const { data, error } = await supabase
    .from('promo_codes')
    .select('*')
    .eq('code', code.toUpperCase())
    .single();

  if (error || !data) return { valid: false, error: 'Code not found' };
  if (data.expires_at && new Date(data.expires_at) < new Date())
    return { valid: false, error: 'Code expired' };
  if (data.uses >= data.max_uses)
    return { valid: false, error: 'Code fully redeemed' };

  return { valid: true, tier: data.tier, discountPct: data.discount_pct };
}

export async function redeemPromoCode(code: string) {
  await supabase.rpc('increment_promo_uses', { code_value: code.toUpperCase() });
}

// ── Memory helpers ───────────────────────────────────────────

export async function saveMemory(params: {
  leagueId: string;
  platform: string;
  content:  string;
}) {
  const user = await getUser();
  if (!user) return;

  const userRow = await getUserRow();
  if (!userRow) return;

  const { error } = await supabase.from('memories').insert({
    user_id:    userRow.id,
    league_id:  params.leagueId,
    platform:   params.platform,
    content:    params.content,
    tagged_date: new Date().toISOString().split('T')[0],
  });
  if (error) console.error('saveMemory:', error.message);
}

export async function getMemories(leagueId: string, limit = 10) {
  const userRow = await getUserRow();
  if (!userRow) return [];

  const { data, error } = await supabase
    .from('memories')
    .select('content, tagged_date')
    .eq('user_id', userRow.id)
    .eq('league_id', leagueId)
    .order('tagged_date', { ascending: false })
    .limit(limit);

  if (error) { console.error('getMemories:', error.message); return []; }
  return data ?? [];
}
