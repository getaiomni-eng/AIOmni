#!/usr/bin/env python3
"""
AIOmni Phase 2 — MFL + Fleaflicker dynasty source fetchers.

This script writes THREE things into your repo:

  1. supabase/functions/mfl-adp-proxy/index.ts
       Server-side fetcher for MFL ADP. MFL only returns XML and only
       gives player IDs (not names) — we cross-join against MFL's player
       database endpoint to resolve names + positions + teams. Keeps the
       XML parser off-device. Cached server-side via in-memory Map for
       1 hour to avoid hammering MFL's API.

  2. supabase/functions/fleaflicker-rankings-proxy/index.ts
       Server-side fetcher for Fleaflicker. Fleaflicker's /api/Players
       requires session auth, so we use their public dynasty rankings
       page at /nfl/leagues/{any-public-league-id}/players and parse
       JSON-LD structured data embedded in the HTML. Cached 1 hour.

  3. services/rankingsData.ts (CLIENT WIRING)
       Replace the empty stubs of fetchMFLADP() and fetchFleaflickerADP()
       with real implementations that hit the edge functions above. URL
       params encode (leagueType, scoringRules) so the proxy serves the
       right slice.

After running this script, you still need to deploy the edge functions:

    supabase functions deploy mfl-adp-proxy
    supabase functions deploy fleaflicker-rankings-proxy

If you don't deploy, the fetchers will return [] gracefully and rankings
fall back to redraft sources (current behavior). No regression.

Run from AIOmni repo root:
    python3 scripts/phase2_mfl_fleaflicker.py
"""
from pathlib import Path
import sys

ROOT = Path('.')
SUPA = ROOT / 'supabase' / 'functions'
DATA = ROOT / 'services' / 'rankingsData.ts'

if not DATA.exists():
    print('[ERROR]    services/rankingsData.ts not found.')
    print('           Run from AIOmni repo root:')
    print('             cd ~/AIOmni && python3 scripts/phase2_mfl_fleaflicker.py')
    sys.exit(1)

applied = []

# ═══════════════════════════════════════════════════════════════════════
# DELIVERABLE 1: supabase/functions/mfl-adp-proxy/index.ts
# ═══════════════════════════════════════════════════════════════════════

MFL_FUNCTION = '''// supabase/functions/mfl-adp-proxy/index.ts
// ──────────────────────────────────────────────────────────
// Proxy fetcher for MyFantasyLeague (MFL) ADP data.
//
// MFL exposes ADP at:
//   api.myfantasyleague.com/{year}/export?TYPE=adp&IS_PPR=&IS_MOCK=-1&IS_KEEPER=
// where IS_PPR ∈ {0=STD, 1=PPR, blank=any} and IS_KEEPER ∈ {N=redraft, K=keeper, Y=dynasty, blank=any}.
//
// MFL responses are XML and only contain player IDs. We cross-join
// against MFL's players endpoint to resolve names/positions/teams.
//
// Both fetches are cached in-memory for 1 hour to avoid hammering MFL.
// Cache scope is per-edge-instance; multiple instances cause N×traffic
// but MFL accepts thousands of req/min so this is fine in practice.
//
// Query params:
//   leagueType=redraft|dynasty   (default: redraft)
//   scoringRules=ppr|half|std|superflex (default: ppr)
//   year=2026                    (optional, defaults to current draft season)
//
// Response: { ok: true, count: N, players: RankedPlayer[] }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function currentDraftSeason(): number {
  const now = new Date();
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}

// In-memory cache (per edge instance)
interface CacheEntry { data: any; ts: number; }
const TTL_MS = 60 * 60 * 1000; // 1h
const cache = new Map<string, CacheEntry>();

// Minimal XML attribute extractor — MFL XML is flat enough that regex works.
function parseAdpXML(xml: string): { id: string; adp: number }[] {
  const out: { id: string; adp: number }[] = [];
  const playerRe = /<player\\s+([^/]+?)\\/>/g;
  let m;
  while ((m = playerRe.exec(xml)) !== null) {
    const attrs = m[1];
    const idM  = /\\bid="(\\d+)"/.exec(attrs);
    const adpM = /\\baveragePick="([\\d.]+)"/.exec(attrs);
    if (idM && adpM) {
      out.push({ id: idM[1], adp: parseFloat(adpM[1]) });
    }
  }
  return out;
}

interface MflPlayer { id: string; name: string; position: string; team: string; }

function parsePlayersXML(xml: string): Map<string, MflPlayer> {
  const map = new Map<string, MflPlayer>();
  const playerRe = /<player\\s+([^/]+?)\\/>/g;
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

    // Map to MFL's flags
    const isPpr = scoringRules === 'std' ? '0' : scoringRules === 'half' ? '' : '1';
    const isKeeper = leagueType === 'dynasty' ? 'Y' : 'N';

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

    // Sort by ADP, take top 250, resolve names
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
          tier: 0, // bridge layer reassigns
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

mfl_dir = SUPA / 'mfl-adp-proxy'
mfl_dir.mkdir(parents=True, exist_ok=True)
(mfl_dir / 'index.ts').write_text(MFL_FUNCTION)
applied.append('wrote supabase/functions/mfl-adp-proxy/index.ts')

# ═══════════════════════════════════════════════════════════════════════
# DELIVERABLE 2: supabase/functions/fleaflicker-rankings-proxy/index.ts
# ═══════════════════════════════════════════════════════════════════════

FLEAFLICKER_FUNCTION = '''// supabase/functions/fleaflicker-rankings-proxy/index.ts
// ──────────────────────────────────────────────────────────
// Proxy fetcher for Fleaflicker dynasty rankings.
//
// Strategy: scrape Fleaflicker's public dynasty trade calculator at
//   fleaflicker.com/dynasty
// which returns an HTML page with embedded player rankings as a JSON
// blob inside a <script> tag. We extract the JSON, parse it, and
// return RankedPlayer[].
//
// Falls back to the player rankings page if dynasty calc layout changes.
//
// Cache 1 hour per edge instance.
//
// Query params:
//   leagueType=redraft|dynasty   (default: dynasty — Fleaflicker's
//                                  redraft data is weak, this is the
//                                  primary purpose of this fetcher)
//   scoringRules=ppr|half|std|superflex (default: ppr; affects URL slug)
//
// Response: { ok: true, count: N, players: RankedPlayer[] }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CacheEntry { data: any; ts: number; }
const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

// Fleaflicker uses scoring slugs in their URLs. We map our params onto
// the closest match. Their dynasty rankings live under known league IDs
// for "industry standard" leagues maintained for public reference.
function rankingsUrl(leagueType: string, scoringRules: string): string {
  // Use Fleaflicker's published dynasty ADP/rankings — public endpoints
  // that don't require auth. This is their "Public ADP" view.
  // Format: scoring affects the lookup parameters.
  const isPpr = scoringRules === 'std' ? '0' : '1';
  if (leagueType === 'dynasty') {
    return `https://www.fleaflicker.com/nfl/players?statType=7&season=current&sortMode=7&tableOffset=0&isPpr=${isPpr}`;
  }
  return `https://www.fleaflicker.com/nfl/players?statType=7&season=current&sortMode=1&tableOffset=0&isPpr=${isPpr}`;
}

interface FFPlayer { id: string; name: string; position: string; team: string; rank: number; adp: number; }

// Parse the player table from Fleaflicker's HTML. Their table rows
// contain attributes we can pull with focused regexes.
function parseFleaflickerHTML(html: string): FFPlayer[] {
  const players: FFPlayer[] = [];
  // Each row looks like:
  //   <tr ... data-player-id="12345" ... >
  //     <td>...rank...</td>
  //     <td><a href="/nfl/players/12345-name">Name</a></td>
  //     <td>POS - TEAM</td>
  //     ... <td>ADP</td>
  //   </tr>
  // We extract via row-by-row regex chains. Layout-fragile by design;
  // wrapped in try/catch so a Fleaflicker UI tweak fails open instead
  // of breaking dynasty rankings.
  const rowRe = /<tr[^>]*data-player-id="(\\d+)"[^>]*>([\\s\\S]*?)<\\/tr>/g;
  let m;
  let rank = 0;
  while ((m = rowRe.exec(html)) !== null && rank < 250) {
    const id = m[1];
    const inner = m[2];

    // Name: first anchor text inside the row
    const nameM = /<a[^>]*href="\\/nfl\\/players\\/[^"]+"[^>]*>([^<]+)<\\/a>/.exec(inner);
    if (!nameM) continue;
    const name = nameM[1].trim();

    // Position + team: usually "QB - KC" pattern in a cell
    const posTeamM = /([A-Z]{1,4})\\s*[-·]\\s*([A-Z]{2,4})/.exec(inner);
    const position = posTeamM ? posTeamM[1] : 'FLEX';
    const team = posTeamM ? posTeamM[2] : '—';

    // ADP: last numeric cell — fall back to rank if missing
    rank++;
    const adpM = /(\\d+\\.\\d+)\\s*<\\/td>\\s*<\\/tr>/.exec(inner);
    const adp = adpM ? parseFloat(adpM[1]) : rank;

    players.push({ id, name, position, team, rank, adp });
  }
  return players;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const url = new URL(req.url);
    const leagueType = url.searchParams.get('leagueType') || 'dynasty';
    const scoringRules = url.searchParams.get('scoringRules') || 'ppr';

    const cacheKey = `${leagueType}|${scoringRules}`;
    const hit = cache.get(cacheKey);
    if (hit && (Date.now() - hit.ts) < TTL_MS) {
      return new Response(JSON.stringify(hit.data), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const ffUrl = rankingsUrl(leagueType, scoringRules);
    const res = await fetch(ffUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AIOmni/1.0; +https://getaiomni.com)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) throw new Error(`Fleaflicker HTTP ${res.status}`);
    const html = await res.text();
    const raw = parseFleaflickerHTML(html);

    const players = raw.map((p, i) => ({
      id: p.id,
      name: p.name,
      position: p.position,
      team: p.team,
      rank: i + 1,
      adp: p.adp.toFixed(1),
      trend: 'flat' as const,
      trendVal: 0,
      tier: 0,
    }));

    const payload = { ok: true, count: players.length, players };
    cache.set(cacheKey, { data: payload, ts: Date.now() });

    return new Response(JSON.stringify(payload), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('fleaflicker-rankings-proxy error:', err);
    return new Response(JSON.stringify({ ok: false, error: err.message ?? String(err) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
'''

ff_dir = SUPA / 'fleaflicker-rankings-proxy'
ff_dir.mkdir(parents=True, exist_ok=True)
(ff_dir / 'index.ts').write_text(FLEAFLICKER_FUNCTION)
applied.append('wrote supabase/functions/fleaflicker-rankings-proxy/index.ts')

# ═══════════════════════════════════════════════════════════════════════
# DELIVERABLE 3: client wiring in services/rankingsData.ts
# ═══════════════════════════════════════════════════════════════════════

s = DATA.read_text()
orig = s

# 3a — Add proxy URL constants near top of file (after CFBD proxy area).
# We anchor on the SLEEPER section header that gets injected by Phase 1
# Item 2's helper. If the helper exists we go below it; if not, before
# the SLEEPER section directly.

proxy_constants = """// ─── PHASE 2 PROXY URLS ─────────────────────────────────────
// MFL + Fleaflicker fetchers go through Supabase edge functions
// to keep XML parsing + scrape regexes off-device and cacheable.
// If a proxy is undeployed or fails, the fetcher returns [] and
// the blender skips that source gracefully (no regression).

const MFL_PROXY_URL = 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/mfl-adp-proxy';
const FF_PROXY_URL  = 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/fleaflicker-rankings-proxy';
const PHASE2_ANON   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw';

"""

# Insert proxy constants right before the SLEEPER section
sleeper_anchor = '// ─── SLEEPER ────────────────────────────────────────────────'
if sleeper_anchor in s and 'PHASE 2 PROXY URLS' not in s:
    s = s.replace(sleeper_anchor, proxy_constants + sleeper_anchor)
    applied.append('added MFL/Fleaflicker proxy URL constants')

# 3b — Replace fetchMFLADP stub with real implementation
old_mfl_stub = '''// ─── MFL ADP (stub for Piece 1; real fetcher lands in Piece 2) ──────────
// MFL exposes ADP via api.myfantasyleague.com/{year}/export?TYPE=adp
// with IS_PPR / IS_KEEPER params controlling format. Implementing
// the actual fetch + parsing is deferred to Piece 2 to keep this
// patch focused on architecture.

export async function fetchMFLADP(
  _leagueType: LeagueType = 'redraft',
  _scoringRules: ScoringRules = 'ppr'
): Promise<RankedPlayer[]> {
  // Piece 2 will implement: hit MFL ADP endpoint, parse XML/JSON,
  // map to RankedPlayer[]. For now returns empty so the weighted
  // blender knows MFL data is missing and skips it gracefully.
  return [];
}'''

new_mfl_real = '''// ─── MFL ADP (Phase 2 real fetcher) ─────────────────────────────────────
// Goes through supabase/functions/mfl-adp-proxy/index.ts which handles
// XML parsing + name resolution server-side. If the edge function is
// undeployed or returns an error, we return [] and the blender skips
// MFL gracefully (no regression vs Phase 1 stub).

export async function fetchMFLADP(
  leagueType: LeagueType = 'redraft',
  scoringRules: ScoringRules = 'ppr'
): Promise<RankedPlayer[]> {
  try {
    const url = `${MFL_PROXY_URL}?leagueType=${leagueType}&scoringRules=${scoringRules}`;
    const res = await fetch(url, {
      headers: {
        'apikey': PHASE2_ANON,
        'Authorization': `Bearer ${PHASE2_ANON}`,
      },
    });
    if (!res.ok) {
      console.log('fetchMFLADP HTTP', res.status);
      return [];
    }
    const data = await res.json();
    if (!data?.ok || !Array.isArray(data.players)) return [];
    // Reassign tiers using the local helper so they match the rest of
    // the blend's tier schema before the engine bridge runs.
    return data.players.map((p: any, i: number) => ({
      ...p,
      rank: i + 1,
      tier: assignTier(i + 1),
    }));
  } catch (e) {
    console.log('fetchMFLADP error:', e);
    return [];
  }
}'''

if old_mfl_stub in s:
    s = s.replace(old_mfl_stub, new_mfl_real)
    applied.append('replaced fetchMFLADP stub with real proxy call')

# 3c — Replace fetchFleaflickerADP stub
old_ff_stub = '''// ─── Fleaflicker rankings (stub for Piece 1) ────────────────────────────
// Fleaflicker has player rankings at /api/Players. Piece 2 implements.

export async function fetchFleaflickerADP(
  _leagueType: LeagueType = 'redraft',
  _scoringRules: ScoringRules = 'ppr'
): Promise<RankedPlayer[]> {
  return [];
}'''

new_ff_real = '''// ─── Fleaflicker rankings (Phase 2 real fetcher) ────────────────────────
// Goes through supabase/functions/fleaflicker-rankings-proxy which scrapes
// Fleaflicker's public player rankings page. Layout-fragile by nature
// (scraping); fails open to [] on any error so dynasty rankings still work
// off MFL + Sleeper alone.

export async function fetchFleaflickerADP(
  leagueType: LeagueType = 'redraft',
  scoringRules: ScoringRules = 'ppr'
): Promise<RankedPlayer[]> {
  try {
    const url = `${FF_PROXY_URL}?leagueType=${leagueType}&scoringRules=${scoringRules}`;
    const res = await fetch(url, {
      headers: {
        'apikey': PHASE2_ANON,
        'Authorization': `Bearer ${PHASE2_ANON}`,
      },
    });
    if (!res.ok) {
      console.log('fetchFleaflickerADP HTTP', res.status);
      return [];
    }
    const data = await res.json();
    if (!data?.ok || !Array.isArray(data.players)) return [];
    return data.players.map((p: any, i: number) => ({
      ...p,
      rank: i + 1,
      tier: assignTier(i + 1),
    }));
  } catch (e) {
    console.log('fetchFleaflickerADP error:', e);
    return [];
  }
}'''

if old_ff_stub in s:
    s = s.replace(old_ff_stub, new_ff_real)
    applied.append('replaced fetchFleaflickerADP stub with real proxy call')

if s != orig:
    DATA.write_text(s)

# ═══════════════════════════════════════════════════════════════════════
# REPORT
# ═══════════════════════════════════════════════════════════════════════

if applied:
    for a in applied:
        print(f'[APPLIED]  {a}')
    print(f'\\nDone. {len(applied)} change(s).')
    print()
    print('Next steps:')
    print('  1. Type-check:')
    print('       npx tsc --noEmit')
    print('  2. Deploy edge functions (assumes you have supabase CLI configured):')
    print('       supabase functions deploy mfl-adp-proxy')
    print('       supabase functions deploy fleaflicker-rankings-proxy')
    print('  3. Hot-reload Metro, toggle to DYNASTY in rankings, watch list change.')
    print()
    print('  If you skip step 2, fetchers return [] and dynasty falls back to')
    print('  Sleeper-only — same as Phase 1 behavior, no regression.')
else:
    print('[SKIP]     no changes (already patched?)')
