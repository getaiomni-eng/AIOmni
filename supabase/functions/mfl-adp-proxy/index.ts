// supabase/functions/mfl-adp-proxy/index.ts
// ──────────────────────────────────────────────────────────
// Proxy fetcher for MyFantasyLeague (MFL) ADP data.
//
// MFL valid IS_KEEPER values: N (redraft), K (keeper). For dynasty
// we omit the flag and get the full ADP pool. (The legacy "Y" flag
// returns an "Invalid value" error.)
//
// Cached in-memory per edge instance for 1 hour.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function currentDraftSeason(): number {
  const now = new Date();
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}

interface CacheEntry { data: any; ts: number; }
const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

// Robust XML attribute extractor. Greedy match up to the self-closing
// /> handles attribute order and whitespace variations correctly.
function parseAdpXML(xml: string): { id: string; adp: number; rank: number }[] {
  const out: { id: string; adp: number; rank: number }[] = [];
  const playerRe = /<player\b([^>]*)\/>/g;
  let m;
  while ((m = playerRe.exec(xml)) !== null) {
    const attrs = m[1];
    const idM   = /\bid="(\d+)"/.exec(attrs);
    const adpM  = /\baveragePick="([\d.]+)"/.exec(attrs);
    const rankM = /\brank="(\d+)"/.exec(attrs);
    if (idM && adpM) {
      out.push({
        id: idM[1],
        adp: parseFloat(adpM[1]),
        rank: rankM ? parseInt(rankM[1]) : 999,
      });
    }
  }
  return out;
}

interface MflPlayer { id: string; name: string; position: string; team: string; }

function parsePlayersXML(xml: string): Map<string, MflPlayer> {
  const map = new Map<string, MflPlayer>();
  const playerRe = /<player\b([^>]*)\/>/g;
  let m;
  while ((m = playerRe.exec(xml)) !== null) {
    const attrs = m[1];
    const idM   = /\bid="(\d+)"/.exec(attrs);
    const nameM = /\bname="([^"]+)"/.exec(attrs);
    const posM  = /\bposition="([^"]+)"/.exec(attrs);
    const teamM = /\bteam="([^"]+)"/.exec(attrs);
    if (idM && nameM) {
      // MFL stores names "Last, First" — flip to "First Last"
      const raw = nameM[1];
      const parts = raw.split(',').map(p => p.trim());
      const name = parts.length === 2 ? `${parts[1]} ${parts[0]}` : raw;
      map.set(idM[1], {
        id: idM[1],
        name,
        position: posM ? posM[1] : 'FLEX',
        team: teamM ? teamM[1] : '—',
      });
    }
  }
  return map;
}

async function fetchMflAdp(year: number, isPpr: string, isKeeper: string) {
  // isKeeper blank means "all leagues" which gives us full ADP pool
  const url = `https://api.myfantasyleague.com/${year}/export?TYPE=adp&IS_PPR=${isPpr}&IS_MOCK=-1&IS_KEEPER=${isKeeper}&FCOUNT=0`;
  const res = await fetch(url, { headers: { 'User-Agent': 'AIOmni/1.0' } });
  if (!res.ok) throw new Error(`MFL ADP HTTP ${res.status}`);
  return parseAdpXML(await res.text());
}

async function fetchMflPlayers(year: number) {
  const url = `https://api.myfantasyleague.com/${year}/export?TYPE=players&DETAILS=0`;
  const res = await fetch(url, { headers: { 'User-Agent': 'AIOmni/1.0' } });
  if (!res.ok) throw new Error(`MFL players HTTP ${res.status}`);
  return parsePlayersXML(await res.text());
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const url = new URL(req.url);
    const leagueType = url.searchParams.get('leagueType') || 'redraft';
    const scoringRules = url.searchParams.get('scoringRules') || 'ppr';
    const year = parseInt(url.searchParams.get('year') || String(currentDraftSeason()));

    // PPR flag: 1 = full PPR, 0 = standard. Half-PPR doesn't have a
    // direct flag — we use full-PPR data and let the engine bridge
    // apply half-PPR adjustments downstream.
    const isPpr = scoringRules === 'std' ? '0' : '1';

    // Keeper flag: 'K' for keeper leagues, 'N' for redraft, blank for
    // dynasty (returns full ADP pool which dynasty drafts pull from).
    // 'Y' is INVALID — MFL rejects it.
    const isKeeper = leagueType === 'dynasty' ? '' : 'N';

    const cacheKey = `${year}|${isPpr}|${isKeeper}`;
    const hit = cache.get(cacheKey);
    if (hit && (Date.now() - hit.ts) < TTL_MS) {
      return new Response(JSON.stringify(hit.data), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const [adp, players] = await Promise.all([
      fetchMflAdp(year, isPpr, isKeeper),
      fetchMflPlayers(year),
    ]);

    const sorted = adp
      .filter(a => players.has(a.id))
      .sort((a, b) => a.adp - b.adp)
      .slice(0, 250)
      .map((a, i) => {
        const p = players.get(a.id)!;
        return {
          id: p.id,
          name: p.name,
          position: p.position,
          team: p.team,
          rank: i + 1,
          adp: a.adp.toFixed(1),
          trend: 'flat' as const,
          trendVal: 0,
          tier: 0,
        };
      });

    const payload = { ok: true, count: sorted.length, players: sorted };
    cache.set(cacheKey, { data: payload, ts: Date.now() });

    return new Response(JSON.stringify(payload), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('mfl-adp-proxy error:', err);
    return new Response(JSON.stringify({ ok: false, error: err.message ?? String(err) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
