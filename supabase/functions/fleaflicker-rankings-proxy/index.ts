// supabase/functions/fleaflicker-rankings-proxy/index.ts
// ──────────────────────────────────────────────────────────
// PIVOT NOTE (April 2026):
//   Fleaflicker's /nfl/players returns 404 -- player listings now require
//   a league context. Pivoted to KeepTradeCut (KTC) which is the actual
//   gold standard in the dynasty community AND has a free public JSON
//   endpoint. Function name kept as 'fleaflicker-rankings-proxy' to avoid
//   redeploy churn; the contents are KTC.
//
// KTC publishes their dynasty rankings as a JSON blob embedded in the
// page source. We extract it server-side and return our standard shape.
//
// Endpoints:
//   /dynasty-rankings?format=2&filters=  -- 1QB dynasty PPR
//   /dynasty-rankings?format=1&filters=  -- Superflex dynasty
//   /redraft-rankings?format=2&filters=  -- Redraft 1QB
//   /redraft-rankings?format=1&filters=  -- Redraft superflex
//
// Cached 1 hour per edge instance.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CacheEntry { data: any; ts: number; }
const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function ktcUrl(leagueType: string, scoringRules: string): string {
  // KTC format param: 1 = superflex, 2 = 1QB. Default to 1QB.
  const format = scoringRules === 'superflex' ? '1' : '2';
  const path = leagueType === 'dynasty' ? 'dynasty-rankings' : 'redraft-rankings';
  return `https://keeptradecut.com/${path}?format=${format}&filters=`;
}

interface KTCPlayer {
  playerName: string;
  position: string;
  team: string;
  oneQBValues?: { value: number; rank: number; positionalRank: number };
  superflexValues?: { value: number; rank: number; positionalRank: number };
  age?: number;
  playerID?: number;
}

// KTC embeds player data in a window assignment like:
//   var playersArray = [{...}, {...}, ...]
// We extract the JSON between the brackets and parse.
function extractKtcPlayers(html: string): KTCPlayer[] {
  // Look for the playersArray assignment
  const m = /var\s+playersArray\s*=\s*(\[[\s\S]*?\]);/m.exec(html);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[1]);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.log('KTC JSON parse error:', e);
    return [];
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const url = new URL(req.url);
    const leagueType = url.searchParams.get('leagueType') || 'dynasty';
    const scoringRules = url.searchParams.get('scoringRules') || 'ppr';
    const isSuperflex = scoringRules === 'superflex';

    const cacheKey = `${leagueType}|${scoringRules}`;
    const hit = cache.get(cacheKey);
    if (hit && (Date.now() - hit.ts) < TTL_MS) {
      return new Response(JSON.stringify(hit.data), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const ktc = ktcUrl(leagueType, scoringRules);
    const res = await fetch(ktc, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AIOmni/1.0; +https://getaiomni.com)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) throw new Error(`KTC HTTP ${res.status}`);
    const html = await res.text();
    const raw = extractKtcPlayers(html);

    // Sort by appropriate rank field, take top 250
    const sorted = raw
      .map((p, i) => {
        const vals = isSuperflex ? p.superflexValues : p.oneQBValues;
        return {
          ...p,
          _rank: vals?.rank ?? (i + 999),
          _value: vals?.value ?? 0,
        };
      })
      .filter(p => p._rank < 999)
      .sort((a, b) => a._rank - b._rank)
      .slice(0, 250);

    const players = sorted.map((p, i) => ({
      id: p.playerID ? String(p.playerID) : String(i),
      name: p.playerName ?? 'Unknown',
      position: p.position ?? 'FLEX',
      team: p.team ?? '—',
      rank: i + 1,
      // KTC values are 0-10000ish; map to ADP-ish scale for display.
      // Using rank directly is more useful than synthesized ADP.
      adp: (i + 1).toFixed(1),
      trend: 'flat' as const,
      trendVal: 0,
      tier: 0,
    }));

    const payload = { ok: true, count: players.length, players, source: 'KTC' };
    cache.set(cacheKey, { data: payload, ts: Date.now() });

    return new Response(JSON.stringify(payload), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('ktc proxy error:', err);
    return new Response(JSON.stringify({ ok: false, error: err.message ?? String(err) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
