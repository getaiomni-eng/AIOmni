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
    // PKCE flow: tokens arrive as ?code=xyz in query string instead of
    // URL fragment. iOS strips fragments from custom URL schemes; query
    // params survive. Required for password reset deep-links to work.
    flowType: 'pkce',
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
  // NEVER default tier here. The old `tier: params.tier ?? 'free'` made
  // every tier-less profile write (sign-in/sign-up call this with just
  // authId+email) overwrite the row's tier back to 'free' — silently
  // wiping manual grants AND any purchased tier whenever RevenueCat
  // hadn't re-synced yet. The column's DB default ('free', NOT NULL)
  // covers brand-new rows; an upsert that omits tier leaves the existing
  // value untouched on conflict. Only include it when a caller has an
  // authoritative tier to write (purchase/restore paths).
  const row: Record<string, unknown> = {
    auth_id:          params.authId,
    email:            params.email,
    sleeper_username: params.sleeperUsername,
    updated_at:       new Date().toISOString(),
  };
  if (params.tier) row.tier = params.tier;

  const { error } = await supabase
    .from('users')
    .upsert(row, { onConflict: 'auth_id' });

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

// updateTier removed 2026-07-30: users.tier is trigger-protected against
// client writes (see migration lock_tier_column). The RevenueCat webhook
// (service role) and manual postgres grants are the only writers.

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

// v2026-06-09: Coach learning loop. After each exchange, coach-learn extracts
// durable signals and MERGES them into a consolidated profile + league state
// (not raw Q/A). Fire-and-forget — learning is best-effort, never blocks chat.
export async function learnFromExchange(q: string, a: string, leagueName: string, platform: string): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const jwt = session?.access_token;
    if (!jwt) return;
    await fetch(`${SUPABASE_URL}/functions/v1/coach-learn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON, Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ q, a, leagueName, platform }),
    });
  } catch { /* best-effort */ }
}

// v2026-06-09: read the consolidated "what the Coach has learned about you"
// dossier (cross-league tendencies) + this league's situation, for injection.
export async function getCoachProfile(leagueName: string): Promise<{ profile: string; state: string }> {
  const userRow = await getUserRow();
  if (!userRow) return { profile: '', state: '' };
  const [pRes, sRes] = await Promise.all([
    supabase.from('memories').select('content').eq('user_id', userRow.id).eq('league_id', '__PROFILE__').order('tagged_date', { ascending: false }).limit(1),
    supabase.from('memories').select('content').eq('user_id', userRow.id).eq('league_id', `__STATE__:${leagueName}`).order('tagged_date', { ascending: false }).limit(1),
  ]);
  return { profile: pRes.data?.[0]?.content ?? '', state: sRes.data?.[0]?.content ?? '' };
}
