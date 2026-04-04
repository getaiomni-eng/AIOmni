import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CLAUDE_API_KEY = Deno.env.get('CLAUDE_API_KEY')!;
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY   = Deno.env.get('SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LIMITS: Record<string, number> = {
  free: 25, rankings: 25, pro: 75, premium: 125, dynasty_elite: 999999,
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const authHeader = req.headers.get('Authorization');
    let tier = 'free';

    if (authHeader) {
      const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
      if (user) {
        const { data: userRow } = await supabase.from('users').select('id, tier, prompts_used, prompts_reset').eq('auth_id', user.id).single();
        if (userRow) {
          tier = userRow.tier ?? 'free';
          const limit = LIMITS[tier] ?? 25;
          const now = new Date();
          const resetAt = new Date(userRow.prompts_reset);
          if (now >= resetAt) {
            const next = new Date(now);
            const d = next.getDay() === 0 ? 7 : 7 - next.getDay();
            next.setDate(next.getDate() + d);
            next.setHours(12, 0, 0, 0);
            await supabase.from('users').update({ prompts_used: 0, prompts_reset: next.toISOString() }).eq('auth_id', user.id);
            userRow.prompts_used = 0;
          }
          if (userRow.prompts_used >= limit) {
            return new Response(JSON.stringify({ error: 'prompt_limit_reached', limit, tier }), { status: 429, headers: { ...CORS, 'Content-Type': 'application/json' } });
          }
          await supabase.from('users').update({ prompts_used: userRow.prompts_used + 1 }).eq('auth_id', user.id);
        }
      }
    }

    const body = await req.json();
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: body.model ?? 'claude-sonnet-4-20250514', max_tokens: body.max_tokens ?? 1000, messages: body.messages, system: body.system }),
    });
    const data = await claudeRes.json();
    return new Response(JSON.stringify(data), { status: claudeRes.status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
