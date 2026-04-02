// supabase/functions/claude/index.ts
// Deploy with: supabase functions deploy claude
// Set secret with: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Verify user is authenticated
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    // Check prompt limit server-side
    const weekStart  = getWeekStart();
    const userRecord = await supabase.from('users').select('id, tier').eq('auth_id', user.id).single();

    if (userRecord.data) {
      const usage = await supabase
        .from('prompt_usage')
        .select('count')
        .eq('user_id', userRecord.data.id)
        .eq('week_start', weekStart)
        .single();

      const count = usage.data?.count ?? 0;
      const limit = getTierLimit(userRecord.data.tier);

      if (count >= limit) {
        return new Response(JSON.stringify({ error: 'prompt_limit_reached', limit }), { status: 429, headers: corsHeaders });
      }

      // Increment count
      await supabase.from('prompt_usage').upsert({
        user_id:    userRecord.data.id,
        week_start: weekStart,
        count:      count + 1,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,week_start' });
    }

    // Forward to Anthropic
    const body = await req.json();
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      body.model      ?? 'claude-sonnet-4-20250514',
        max_tokens: body.max_tokens ?? 1000,
        system:     body.system,
        messages:   body.messages,
      }),
    });

    const data = await anthropicRes.json();
    const text = data.content?.[0]?.text ?? '';

    return new Response(JSON.stringify({ content: text }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});

function getWeekStart(): string {
  const now    = new Date();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - now.getDay());
  return sunday.toISOString().split('T')[0];
}

function getTierLimit(tier: string): number {
  const limits: Record<string, number> = {
    free: 25, rankings: 25, pro: 75, premium: 125, dynasty_elite: 999999,
  };
  return limits[tier] ?? 25;
}