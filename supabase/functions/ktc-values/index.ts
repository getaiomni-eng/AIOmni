// supabase/functions/ktc-values/index.ts
// ───────────────────────────────────────────────────────────────────────
// Market trade values from KeepTradeCut, server-scraped and cached so client
// phones never hit KTC directly. Returns a compact name→{oneQB,sf} map for
// dynasty and redraft. Cache lives in the (private) public-rankings bucket as
// ktc_values.json and refreshes when older than 12h. The Trade Analyzer
// injects these as the MARKET anchor next to the proprietary AIOmni rank, so
// the model can flag where our engine disagrees with the crowd.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CACHE_PATH = 'ktc_values.json';
const TTL_MS = 12 * 60 * 60 * 1000;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function parsePage(html: string): Record<string, { oneQB: number; sf: number; pos: string; team: string }> {
  const m = html.match(/var playersArray\s*=\s*(\[.*?\]);/s);
  if (!m) throw new Error('playersArray not found');
  const arr = JSON.parse(m[1]);
  const out: Record<string, { oneQB: number; sf: number; pos: string; team: string }> = {};
  for (const p of arr) {
    if (!p?.playerName) continue;
    out[p.playerName] = {
      oneQB: p.oneQBValues?.value ?? 0,
      sf: p.superflexValues?.value ?? 0,
      pos: p.position ?? '',
      team: p.team ?? '',
    };
  }
  return out;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
    const forceRefresh = new URL(req.url).searchParams.get('refresh') === '1';

    // Serve cache if fresh (unless force-refresh)
    if (!forceRefresh) try {
      const { data: cached } = await sb.storage.from('public-rankings').download(CACHE_PATH);
      if (cached) {
        const parsed = JSON.parse(await cached.text());
        if (parsed.fetchedAt && Date.now() - parsed.fetchedAt < TTL_MS) {
          return new Response(JSON.stringify(parsed), {
            headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' },
          });
        }
      }
    } catch { /* no cache yet */ }

    // Refresh from KTC
    const UA = { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' } };
    const [dynHtml, rdHtml] = await Promise.all([
      fetch('https://keeptradecut.com/dynasty-rankings', UA).then(r => r.text()),
      fetch('https://keeptradecut.com/fantasy-rankings', UA).then(r => r.text()),
    ]);
    const payload = {
      fetchedAt: Date.now(),
      generated: new Date().toISOString().slice(0, 10),
      dynasty: parsePage(dynHtml),
      redraft: parsePage(rdHtml),
    };
    await sb.storage.from('public-rankings').upload(
      CACHE_PATH,
      new Blob([JSON.stringify(payload)], { type: 'application/json' }),
      { upsert: true, contentType: 'application/json' },
    );
    return new Response(JSON.stringify(payload), {
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
