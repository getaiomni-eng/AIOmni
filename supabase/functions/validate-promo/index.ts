import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { code, redeem = false } = await req.json();
    if (!code) return new Response(JSON.stringify({ valid: false, error: 'No code' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    const { data, error } = await supabase.from('promo_codes').select('*').eq('code', code.toUpperCase().trim()).single();
    if (error || !data) return new Response(JSON.stringify({ valid: false, error: 'Code not found' }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    if (data.expires_at && new Date(data.expires_at) < new Date()) return new Response(JSON.stringify({ valid: false, error: 'Code expired' }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    if (data.uses >= data.max_uses) return new Response(JSON.stringify({ valid: false, error: 'Code fully redeemed' }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    if (redeem) await supabase.from('promo_codes').update({ uses: data.uses + 1 }).eq('code', data.code);
    return new Response(JSON.stringify({ valid: true, tier: data.tier, discountPct: data.discount_pct }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ valid: false, error: e.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
