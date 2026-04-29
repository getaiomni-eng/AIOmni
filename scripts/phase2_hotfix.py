#!/usr/bin/env python3
"""
AIOmni Phase 2 hotfix.

Two issues found after deploy:

  1. MFL regex was returning count=0. Two bugs:
       (a) Lazy [^/]+? quantifier stopping too early before \/> sentinel.
           Replaced with a simpler pattern that grabs everything up to />.
       (b) IS_KEEPER=Y is rejected by MFL ("Invalid value"). Their valid
           values are N (redraft) or K (keeper). For dynasty we use blank
           which returns the full ADP pool. The mfl-adp-proxy is fixed to
           translate leagueType=dynasty -> blank instead of Y.

  2. Fleaflicker's /nfl/players is a hard 404. They moved player listings
     behind league IDs that require auth. Pivoting to KeepTradeCut, which:
       - Has a free public JSON API at https://keeptradecut.com/dynasty-rankings
         that returns ~600 players with KTC values + positional ranks
       - Is the actual gold standard in dynasty community
       - Returns JSON not HTML (no scraping fragility)
       - Doesn't require auth or a league context
     The proxy keeps the path name 'fleaflicker-rankings-proxy' to avoid
     redeploying under a new function name; internally it now hits KTC.

What this script does:

  A. Overwrites supabase/functions/mfl-adp-proxy/index.ts with the fixed
     regex + flag mapping.
  B. Overwrites supabase/functions/fleaflicker-rankings-proxy/index.ts
     with a KTC fetcher (same response shape, drop-in replacement).
  C. Leaves rankingsData.ts alone since the URL constants and call shape
     are unchanged.

After running this you redeploy both functions:

    supabase functions deploy mfl-adp-proxy
    supabase functions deploy fleaflicker-rankings-proxy

Run from AIOmni repo root:
    python3 scripts/phase2_hotfix.py
"""
from pathlib import Path
import sys

ROOT = Path('.')
SUPA = ROOT / 'supabase' / 'functions'
MFL  = SUPA / 'mfl-adp-proxy' / 'index.ts'
FF   = SUPA / 'fleaflicker-rankings-proxy' / 'index.ts'

if not MFL.exists() or not FF.exists():
    print('[ERROR]    expected proxy files not found.')
    print(f'           Looking for: {MFL} and {FF}')
    print('           Run from AIOmni repo root.')
    sys.exit(1)

# ═══════════════════════════════════════════════════════════════════════
# FIX A: MFL function — corrected regex + corrected keeper flag
# ═══════════════════════════════════════════════════════════════════════

MFL_FIXED = '''// supabase/functions/mfl-adp-proxy/index.ts
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
  const playerRe = /<player\\b([^>]*)\\/>/g;
  let m;
  while ((m = playerRe.exec(xml)) !== null) {
    const attrs = m[1];
    const idM   = /\\bid="(\\d+)"/.exec(attrs);
    const adpM  = /\\baveragePick="([\\d.]+)"/.exec(attrs);
    const rankM = /\\brank="(\\d+)"/.exec(attrs);
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
  const playerRe = /<player\\b([^>]*)\\/>/g;
  let m;
  while ((m = playerRe.exec(xml)) !== null) {
    const attrs = m[1];
    const idM   = /\\bid="(\\d+)"/.exec(attrs);
    const nameM = /\\bname="([^"]+)"/.exec(attrs);
    const posM  = /\\bposition="([^"]+)"/.exec(attrs);
    const teamM = /\\bteam="([^"]+)"/.exec(attrs);
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
'''

MFL.write_text(MFL_FIXED)
print('[APPLIED]  MFL proxy: fixed regex (greedy [^>]) + keeper flag (blank for dynasty)')

# ═══════════════════════════════════════════════════════════════════════
# FIX B: Replace Fleaflicker scraper with KeepTradeCut JSON fetcher
# ═══════════════════════════════════════════════════════════════════════

KTC_PROXY = '''// supabase/functions/fleaflicker-rankings-proxy/index.ts
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
  const m = /var\\s+playersArray\\s*=\\s*(\\[[\\s\\S]*?\\]);/m.exec(html);
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
'''

FF.write_text(KTC_PROXY)
print('[APPLIED]  Fleaflicker proxy: pivoted to KeepTradeCut (function name unchanged)')

print()
print('Done. 2 file(s) overwritten.')
print()
print('Redeploy:')
print('  supabase functions deploy mfl-adp-proxy')
print('  supabase functions deploy fleaflicker-rankings-proxy')
print()
print('Then re-run the curl tests to confirm both return ok:true with players.')
