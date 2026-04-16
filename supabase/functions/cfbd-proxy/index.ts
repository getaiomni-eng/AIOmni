import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CFBD_API_KEY = Deno.env.get('CFBD_API_KEY') || '';
const CFBD_BASE = 'https://apinext.collegefootballdata.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { endpoint, params } = await req.json();
    if (!endpoint) return new Response(JSON.stringify({ error: 'Missing endpoint' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const allowed = ['/stats/player/season', '/player/search', '/recruiting/players', '/rankings', '/games', '/scoreboard'];
    if (!allowed.some(a => endpoint.startsWith(a))) return new Response(JSON.stringify({ error: 'Not allowed' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    const res = await fetch(`${CFBD_BASE}${endpoint}${qs}`, { headers: { Authorization: `Bearer ${CFBD_API_KEY}` } });
    const data = await res.json();
    return new Response(JSON.stringify(data), { status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch { return new Response(JSON.stringify({ error: 'Proxy error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
});
