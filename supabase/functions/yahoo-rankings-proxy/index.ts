// supabase/functions/yahoo-rankings-proxy/index.ts
// Fetches Yahoo's global NFL ADP using the AIOmni service account token.
// Auto-refreshes the token if expired.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CLIENT_ID = Deno.env.get('YAHOO_SERVICE_CLIENT_ID')!;
const CLIENT_SECRET = Deno.env.get('YAHOO_SERVICE_CLIENT_SECRET')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function getValidAccessToken(supabase: any): Promise<string> {
  const { data: tokens, error } = await supabase
    .from('yahoo_service_tokens')
    .select('*')
    .eq('id', 'aiomni_service')
    .single();
  if (error || !tokens) {
    throw new Error('No service account tokens found. Run yahoo-oauth-init flow first.');
  }

  const expiresAt = new Date(tokens.expires_at).getTime();
  const now = Date.now();

  if (expiresAt - now < 5 * 60 * 1000) {
    const basicAuth = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      redirect_uri: 'oob',
    });
    const refreshRes = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!refreshRes.ok) {
      const text = await refreshRes.text();
      throw new Error(`Refresh failed HTTP ${refreshRes.status}: ${text.slice(0, 200)}`);
    }
    const refreshed = await refreshRes.json();
    const newExpiresAt = new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString();
    await supabase.from('yahoo_service_tokens').update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? tokens.refresh_token,
      expires_at: newExpiresAt,
      last_refreshed: new Date().toISOString(),
    }).eq('id', 'aiomni_service');
    return refreshed.access_token;
  }

  return tokens.access_token;
}

interface RankedPlayer {
  id: string; name: string; position: string; team: string;
  rank: number; adp: string; trend: string; trendVal: number; tier: number;
}

function assignTier(rank: number): number {
  if (rank <= 6) return 1;
  if (rank <= 15) return 2;
  if (rank <= 30) return 3;
  if (rank <= 60) return 4;
  return 5;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const accessToken = await getValidAccessToken(supabase);

    // Yahoo's API caps single-request responses at 25 players regardless of
    // the count param. Paginate via ;start=N. 10 parallel pages = 250 players.
    const PAGE_SIZE = 25;
    const PAGES = 8; // 8 × 25 = 200 cap
    const pageResponses = await Promise.all(
      Array.from({ length: PAGES }, async (_, i) => {
        const url = `https://fantasysports.yahooapis.com/fantasy/v2/game/nfl/players;sort=OR;start=${i * PAGE_SIZE};count=${PAGE_SIZE}?format=json`;
        const r = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        if (!r.ok) {
          const text = await r.text();
          console.error(`Yahoo page ${i} HTTP ${r.status}: ${text.slice(0, 200)}`);
          return null;
        }
        return r.json();
      }).map(p => p.catch(() => null))
    );

    const result: RankedPlayer[] = [];
    let rank = 0;
    for (const data of pageResponses) {
      const yahooPlayers = data?.fantasy_content?.game?.[1]?.players;
      if (!yahooPlayers) continue;
      const count = yahooPlayers.count ?? 0;
      for (let i = 0; i < count; i++) {
        const p = yahooPlayers[i]?.player?.[0];
        if (!p) continue;
        rank++;
        const findField = (key: string) => p.find((x: any) => x[key])?.[key];
        result.push({
          id: findField('player_key') ?? String(rank),
          name: p.find((x: any) => x.name)?.name?.full ?? 'Unknown',
          position: findField('display_position') ?? 'FLEX',
          team: findField('editorial_team_abbr') ?? '-',
          rank,
          adp: rank.toFixed(1),
          trend: 'flat',
          trendVal: 0,
          tier: assignTier(rank),
        });
      }
    }
    if (result.length === 0) throw new Error('no players in response');

    return new Response(JSON.stringify({ ok: true, count: result.length, players: result }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('yahoo-rankings-proxy error:', err);
    return new Response(JSON.stringify({ ok: false, error: err.message ?? String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
