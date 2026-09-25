// supabase/functions/manual-rankings/index.ts
//
// Backend for getaiomni.com/rank: the page where Patrick hand-ranks the top 25
// at each position every week. That ranking is the fourth model in the weekly
// ensemble, next to the three computed ones, and lands in
// manual_weekly_rankings.
//
// AUTH IS A SHARED KEY, not a Supabase JWT. The page is static and has no
// login; every request must carry `x-rank-key` matching the RANK_TOOL_KEY
// secret, compared in constant time. verify_jwt is false in config.toml for
// that reason. Reads are keyed too: the saved rankings are the opinion the
// ensemble is built on, not something to serve to anyone who finds the URL.
// With no secret set the function refuses everything rather than running open.
//
//   GET  ?season=&week=  -> candidates per position in a market-default order,
//                           plus whatever is already saved for that week
//   POST {season, week, position, players: [gsis_id, ...]}  (0-25 ids)
//                        -> replaces that position via replace_manual_rankings(),
//                           one transaction, so a failure never leaves it empty
//
// CANDIDATES. Rostered skill players from the live Sleeper mirror
// (nfl_player_status), minus anyone on IR/Out/PUP/suspended, ordered by the
// market so the list starts close to done: FantasyPros ECR first, then ESPN's
// median expert rank for players FantasyPros does not cover, then Sleeper's
// projection rank, then everyone unranked by name. The tiers are kept separate
// rather than interleaved because ranks from different sources are not on the
// same scale -- ESPN's WR60 is not FantasyPros' WR60.
//
// IDS. nfl_player_status.gsis_id carries a leading space on some rows (as
// Sleeper serves it: " 00-0035229" is T.J. Hockenson), so every id is trimmed
// before it is compared, or David Montgomery, DK Metcalf, Terry McLaurin and
// Hockenson all fall out of the join. Market rows that still do not match are
// matched by name + position, never name alone -- a name-only join has already
// put a linebacker's "Out" on Justin Jefferson once.

import { isBanned } from '../_shared/weekly/banned.ts';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RANK_KEY     = Deno.env.get('RANK_TOOL_KEY') ?? '';

type Pos = 'QB' | 'RB' | 'WR' | 'TE';
const POSITIONS: Pos[] = ['QB', 'RB', 'WR', 'TE'];
const CAP: Record<Pos, number> = { QB: 60, RB: 100, WR: 140, TE: 60 };
const MAX_RANKED = 25;

// Not a start decision anyone is making this week.
const EXCLUDED = new Set(['IR', 'Out', 'PUP', 'Sus', 'NA', 'DNR', 'COV']);
// Market feeds use a few codes the Sleeper mirror and nfl_schedule do not.
const TEAM_ALIAS: Record<string, string> = { JAC: 'JAX', LA: 'LAR', WSH: 'WAS', OAK: 'LV', SD: 'LAC', STL: 'LAR' };

const ALLOWED_ORIGINS = new Set(['https://getaiomni.com', 'https://www.getaiomni.com']);
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const norm = (s: unknown) =>
  String(s ?? '').toLowerCase().replace(/[.'’]/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '').replace(/\s+/g, ' ').trim();
const cleanId = (s: unknown) => String(s ?? '').trim();
const team = (t: unknown) => { const s = String(t ?? '').trim().toUpperCase(); return TEAM_ALIAS[s] ?? s; };

function nflSeason(d = new Date()) { return d.getUTCMonth() >= 2 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; }

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const ok = ALLOWED_ORIGINS.has(origin) || LOCAL_ORIGIN.test(origin);
  return {
    ...(ok ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-rank-key',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// Constant-time: compare every byte regardless of where the first mismatch is.
function keyMatches(given: string): boolean {
  if (!RANK_KEY) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(RANK_KEY);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}

async function sb(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', ...(init.headers ?? {}),
    },
  });
}

// PostgREST caps a page at 1000 rows regardless of `limit`; a week of ESPN
// expert rows alone is ~1600.
async function all<T = any>(path: string): Promise<T[]> {
  const out: T[] = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let off = 0; off < 20000; off += 1000) {
    const r = await sb(`${path}${sep}limit=1000&offset=${off}`);
    if (!r.ok) throw new Error(`${path.split('?')[0]} ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const page = await r.json();
    if (!Array.isArray(page)) break;
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

async function defaultWeek(season: number): Promise<number> {
  // Same rule as the board crons: COALESCE(MAX(week), 0) + 1.
  const r = await sb(`nfl_weekly_stats?select=week&season=eq.${season}&season_type=eq.REG&order=week.desc&limit=1`);
  if (!r.ok) throw new Error(`nfl_weekly_stats ${r.status}`);
  const rows = await r.json();
  const max = Array.isArray(rows) && rows.length ? Number(rows[0].week) || 0 : 0;
  return Math.min(18, max + 1);
}

interface Candidate {
  gsis_id: string; name: string; position: Pos; team: string;
  opp: string | null; home: boolean | null; kickoff: string | null;
  injury: string | null;
  market: { src: 'FP' | 'ESPN' | 'SLP'; rank: number } | null;
}

async function buildCandidates(season: number, week: number) {
  const [status, sched, market] = await Promise.all([
    all<any>('nfl_player_status?select=gsis_id,player_name,position,team,status,injury_status&position=in.(QB,RB,WR,TE)'),
    all<any>(`nfl_schedule?select=home_team,away_team,kickoff_at&season=eq.${season}&week=eq.${week}`),
    all<any>(`expert_weekly_rankings?select=provider,expert_id,gsis_id,player_name,position,team,pos_rank&season=eq.${season}&week=eq.${week}&provider=in.(fantasypros,espn,sleeper)&format=eq.ppr`),
  ]);

  const game = new Map<string, { opp: string; home: boolean; kickoff: string | null }>();
  const kickoffs: Record<string, string> = {};
  for (const g of sched) {
    const h = team(g.home_team), a = team(g.away_team);
    game.set(h, { opp: a, home: true, kickoff: g.kickoff_at ?? null });
    game.set(a, { opp: h, home: false, kickoff: g.kickoff_at ?? null });
    if (g.kickoff_at) { kickoffs[h] = g.kickoff_at; kickoffs[a] = g.kickoff_at; }
  }

  // Market ranks per player: FP ECR, ESPN median across experts (projection
  // only when no expert ranked him), Sleeper projection.
  const fp = new Map<string, number>(), slp = new Map<string, number>();
  const espnExperts = new Map<string, number[]>(), espnProj = new Map<string, number>();
  const marketInfo = new Map<string, { name: string; position: Pos; team: string }>();
  for (const m of market) {
    const id = cleanId(m.gsis_id);
    const r = Number(m.pos_rank);
    if (!id || !isFinite(r) || !POSITIONS.includes(m.position)) continue;
    if (!marketInfo.has(id)) marketInfo.set(id, { name: m.player_name, position: m.position, team: team(m.team) });
    if (m.provider === 'fantasypros') fp.set(id, Math.min(fp.get(id) ?? Infinity, r));
    else if (m.provider === 'sleeper') slp.set(id, Math.min(slp.get(id) ?? Infinity, r));
    else if (m.provider === 'espn') {
      if (m.expert_id === 'projection') espnProj.set(id, r);
      else { const a = espnExperts.get(id) ?? []; a.push(r); espnExperts.set(id, a); }
    }
  }
  const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const marketOf = (id: string): Candidate['market'] => {
    if (fp.has(id)) return { src: 'FP', rank: fp.get(id)! };
    if (espnExperts.has(id)) return { src: 'ESPN', rank: median(espnExperts.get(id)!) };
    if (espnProj.has(id)) return { src: 'ESPN', rank: espnProj.get(id)! };
    if (slp.has(id)) return { src: 'SLP', rank: slp.get(id)! };
    return null;
  };

  const byId = new Map<string, Candidate>();
  const byNamePos = new Map<string, any>();
  const excluded = new Set<string>();
  for (const s of status) {
    const id = cleanId(s.gsis_id);
    if (isBanned(id)) continue;           // owner's rule: _shared/weekly/banned.ts
    const t = team(s.team);
    if (s.player_name) byNamePos.set(`${norm(s.player_name)}|${s.position}`, s);
    const out = (s.injury_status && EXCLUDED.has(s.injury_status)) || s.status === 'Inactive';
    if (out) { if (id) excluded.add(id); continue; }
    if (!id || !t) continue;
    const g = game.get(t);
    byId.set(id, {
      gsis_id: id, name: s.player_name, position: s.position, team: t,
      opp: g?.opp ?? null, home: g?.home ?? null, kickoff: g?.kickoff ?? null,
      injury: s.injury_status ?? null, market: null,
    });
  }

  // Market players the mirror did not key by gsis: match by name + position,
  // else keep them on the market's own team so a ranked player never vanishes.
  for (const [id, info] of marketInfo) {
    if (byId.has(id) || excluded.has(id) || isBanned(id)) continue;
    const s = byNamePos.get(`${norm(info.name)}|${info.position}`);
    if (s && ((s.injury_status && EXCLUDED.has(s.injury_status)) || s.status === 'Inactive')) continue;
    const t = s?.team ? team(s.team) : info.team;
    const g = game.get(t);
    byId.set(id, {
      gsis_id: id, name: s?.player_name ?? info.name, position: info.position, team: t,
      opp: g?.opp ?? null, home: g?.home ?? null, kickoff: g?.kickoff ?? null,
      injury: s?.injury_status ?? null, market: null,
    });
  }

  const tier = { FP: 0, ESPN: 1, SLP: 2 } as const;
  const byPos: Record<Pos, Candidate[]> = { QB: [], RB: [], WR: [], TE: [] };
  for (const c of byId.values()) {
    if (!POSITIONS.includes(c.position)) continue;
    c.market = marketOf(c.gsis_id);
    byPos[c.position].push(c);
  }
  for (const p of POSITIONS) {
    byPos[p].sort((a, b) => {
      const ta = a.market ? tier[a.market.src] : 3, tb = b.market ? tier[b.market.src] : 3;
      if (ta !== tb) return ta - tb;
      if (a.market && b.market && a.market.rank !== b.market.rank) return a.market.rank - b.market.rank;
      return a.name.localeCompare(b.name);
    });
  }
  return { byPos, byId, kickoffs };
}

async function loadSaved(season: number, week: number) {
  const rows = await all<any>(
    `manual_weekly_rankings?select=position,rank,gsis_id,player_name,team,saved_at&season=eq.${season}&week=eq.${week}&order=position.asc,rank.asc`);
  const saved: Record<Pos, any[]> = { QB: [], RB: [], WR: [], TE: [] };
  const savedAt: Record<Pos, string | null> = { QB: null, RB: null, WR: null, TE: null };
  for (const r of rows) {
    const p = r.position as Pos;
    if (!saved[p]) continue;
    saved[p].push(r);
    if (!savedAt[p] || r.saved_at > savedAt[p]!) savedAt[p] = r.saved_at;
  }
  return { saved, savedAt };
}

function parseSeasonWeek(season: unknown, week: unknown) {
  const s = Number(season), w = Number(week);
  return {
    season: Number.isInteger(s) && s >= 2020 && s <= 2100 ? s : null,
    week: Number.isInteger(w) && w >= 1 && w <= 18 ? w : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (!RANK_KEY) return json(req, { ok: false, error: 'RANK_TOOL_KEY is not configured' }, 500);
  if (!keyMatches(req.headers.get('x-rank-key') ?? '')) return json(req, { ok: false, error: 'unauthorized' }, 401);

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const p = parseSeasonWeek(url.searchParams.get('season'), url.searchParams.get('week'));
      const season = p.season ?? nflSeason();
      const week = p.week ?? await defaultWeek(season);

      const [{ byPos, byId, kickoffs }, { saved, savedAt }] = await Promise.all([
        buildCandidates(season, week), loadSaved(season, week),
      ]);

      const candidates: Record<Pos, Candidate[]> = { QB: [], RB: [], WR: [], TE: [] };
      const savedOut: Record<Pos, any[]> = { QB: [], RB: [], WR: [], TE: [] };
      for (const pos of POSITIONS) {
        const list = byPos[pos].slice(0, CAP[pos]);
        const have = new Set(list.map(c => c.gsis_id));
        // A saved player always stays pickable, even past the cap or after a
        // status change -- otherwise reopening the page would silently drop him.
        for (const r of saved[pos]) {
          const c = byId.get(r.gsis_id) ?? {
            gsis_id: r.gsis_id, name: r.player_name, position: pos, team: r.team,
            opp: null, home: null, kickoff: null, injury: null, market: null,
          };
          if (!have.has(c.gsis_id)) { list.push(c); have.add(c.gsis_id); }
          savedOut[pos].push(c.gsis_id);
        }
        candidates[pos] = list;
      }
      const stamps = POSITIONS.map(p => savedAt[p]).filter(Boolean) as string[];
      return json(req, {
        ok: true, season, week, kickoffs, candidates,
        saved: savedOut, saved_at_by_position: savedAt,
        saved_at: stamps.length ? stamps.sort().at(-1) : null,
      });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== 'object') return json(req, { ok: false, error: 'body must be JSON' }, 400);
      const { season, week } = parseSeasonWeek(body.season, body.week);
      const position = body.position as Pos;
      const players: unknown = body.players;
      if (season == null || week == null) return json(req, { ok: false, error: 'season and week are required' }, 400);
      if (!POSITIONS.includes(position)) return json(req, { ok: false, error: 'position must be QB, RB, WR or TE' }, 400);
      if (!Array.isArray(players) || players.length > MAX_RANKED) {
        return json(req, { ok: false, error: `players must be an array of at most ${MAX_RANKED} gsis ids` }, 400);
      }
      const ids = players.map(cleanId);
      if (ids.some(id => !id)) return json(req, { ok: false, error: 'empty player id' }, 400);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      if (dupes.length) return json(req, { ok: false, error: `duplicate players: ${[...new Set(dupes)].join(', ')}` }, 400);

      // Validate against the FULL candidate set (not the capped list) plus
      // anyone already saved, so re-saving an existing order always works.
      const [{ byId }, { saved }] = await Promise.all([buildCandidates(season, week), loadSaved(season, week)]);
      const savedHere = new Map(saved[position].map(r => [r.gsis_id, r]));
      const rows: { gsis_id: string; player_name: string; team: string }[] = [];
      const unknown: string[] = [];
      for (const id of ids) {
        const c = byId.get(id);
        if (c && c.position === position) rows.push({ gsis_id: id, player_name: c.name, team: c.team });
        else if (savedHere.has(id)) { const r = savedHere.get(id)!; rows.push({ gsis_id: id, player_name: r.player_name, team: r.team }); }
        else unknown.push(id);
      }
      if (unknown.length) {
        return json(req, { ok: false, error: `not a ${position} candidate for week ${week}: ${unknown.join(', ')}` }, 400);
      }

      const r = await sb('rpc/replace_manual_rankings', {
        method: 'POST',
        body: JSON.stringify({ p_season: season, p_week: week, p_position: position, p_rows: rows }),
      });
      if (!r.ok) {
        const detail = (await r.text()).slice(0, 300);
        console.log('[manual-rankings] save failed:', r.status, detail);
        return json(req, { ok: false, error: `save failed (${r.status}); nothing was changed`, detail }, 502);
      }
      const out = await r.json();
      return json(req, {
        ok: true, season, week, position,
        saved: (out as any[]).map(x => x.gsis_id),
        saved_at: (out as any[]).reduce((m, x) => (!m || x.saved_at > m ? x.saved_at : m), null as string | null),
      });
    }

    return json(req, { ok: false, error: 'method not allowed' }, 405);
  } catch (e) {
    console.log('[manual-rankings] error:', (e as Error)?.message ?? e);
    return json(req, { ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
