// services/api.ts
// All Claude API calls go through this service.
// The actual API key lives in the Supabase Edge Function — never in the app bundle.

import { supabase } from './supabase';

const SUPABASE_URL = 'https://khoruzvsprxyocisuhet.supabase.co';

export async function callClaude(params: {
  messages:   { role: string; content: string }[];
  system?:    string;
  max_tokens?: number;
  model?:     string;
}): Promise<string> {
  try {
    const { data: { session } } = await supabase.auth.getSession();

    const res = await fetch(`${SUPABASE_URL}/functions/v1/claude`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': session ? `Bearer ${session.access_token}` : '',
      },
      body: JSON.stringify({
        messages:   params.messages,
        system:     params.system,
        max_tokens: params.max_tokens ?? 1000,
        model:      params.model ?? 'claude-sonnet-4-20250514',
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error ?? `API error ${res.status}`);
    }

    const data = await res.json();
    return data.content ?? '';
  } catch (e: any) {
    console.log('callClaude error:', e);
    if (e?.name === 'AbortError') return 'Request timed out. Check your connection and try again.';
    return 'Connection error. Check your network and try again.';
  }
}

export async function validatePromoCode(code: string): Promise<{
  valid: boolean;
  discountPercent: number;
  error?: string;
}> {
  try {
    const { data, error } = await supabase
      .from('promo_codes')
      .select('discount_percent, uses_remaining, expires_at')
      .eq('code', code.toUpperCase().trim())
      .single();

    if (error || !data) return { valid: false, discountPercent: 0, error: 'Invalid code' };
    if (data.uses_remaining <= 0) return { valid: false, discountPercent: 0, error: 'Code expired' };
    if (data.expires_at && new Date(data.expires_at) < new Date()) return { valid: false, discountPercent: 0, error: 'Code expired' };

    return { valid: true, discountPercent: data.discount_percent };
  } catch (e: any) {
    return { valid: false, discountPercent: 0, error: e.message };
  }
}

export async function redeemPromoCode(code: string): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('promo_codes')
      .select('uses_remaining')
      .eq('code', code.toUpperCase().trim())
      .single();

    if (!data || data.uses_remaining <= 0) return false;

    const { error } = await supabase
      .from('promo_codes')
      .update({ uses_remaining: data.uses_remaining - 1 })
      .eq('code', code.toUpperCase().trim());

    return !error;
  } catch { return false; }
}

export async function validateAppleReceipt(receiptData: string, tier: string): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return false;

    const res = await fetch(`${SUPABASE_URL}/functions/v1/validate-receipt`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ receiptData, tier }),
    });

    if (!res.ok) return false;
    const data = await res.json();
    return data.valid === true;
  } catch { return false; }
}

export async function getServerPromptCount(): Promise<number> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return 0;

    const weekStart = getWeekStart();
    const userRecord = await supabase.from('users').select('id').eq('auth_id', user.id).single();
    if (!userRecord.data) return 0;

    const { data } = await supabase
      .from('prompt_usage')
      .select('count')
      .eq('user_id', userRecord.data.id)
      .eq('week_start', weekStart)
      .single();

    return data?.count ?? 0;
  } catch { return 0; }
}

export async function incrementServerPromptCount(): Promise<number> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return 0;

    const weekStart  = getWeekStart();
    const userRecord = await supabase.from('users').select('id').eq('auth_id', user.id).single();
    if (!userRecord.data) return 0;
    const userId = userRecord.data.id;

    const { data: existing } = await supabase
      .from('prompt_usage')
      .select('count')
      .eq('user_id', userId)
      .eq('week_start', weekStart)
      .single();

    const newCount = (existing?.count ?? 0) + 1;

    await supabase.from('prompt_usage').upsert({
      user_id:    userId,
      week_start: weekStart,
      count:      newCount,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,week_start' });

    return newCount;
  } catch { return 0; }
}

function getWeekStart(): string {
  const now  = new Date();
  const day  = now.getDay(); // 0 = Sunday
  const diff = now.getDate() - day;
  const sunday = new Date(now.setDate(diff));
  return sunday.toISOString().split('T')[0];
}