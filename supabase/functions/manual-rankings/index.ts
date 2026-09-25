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
// INJURY DESK (the same page, run from a phone on Sunday morning):
//   GET  ?view=desk&season=&week=
//        -> every fantasy-relevant player (QB24/RB40/WR50/TE20 on the weekly
//           board) with an injury designation, a non-full practice, or an
//           override, plus overridden players the board has already removed.
//           Each carries the feeds (Sleeper, official report, practice), our
//           ranks, and up to 3 headlines from the content pipeline.
//   POST {action:'override', season, week, gsis_id, name, position, status}
//        status 'Out' | 'Active' | null -> writes player_status_overrides for
//        that week (null clears it). 'Active' means "rank him as healthy".
//   POST {action:'rebuild', season, week}
//        -> runs weekly-rankings now (refresh_status: true) and returns its
//           summary, so a decision reaches the board without waiting for cron.
//
// POSTS (daily social queue, public.social_posts; the Posts tab):
//   GET  ?view=posts
//        -> { autopost: 'on'|'off', today, days: [{date, posts}] } for yesterday
//           (a missed copy-paste post stays visible), today and the next 2 days.
//   POST {action:'post_hold', id}      queued -> held        (auto/semi)
//        {action:'post_release', id}   held -> queued; a publish_at already in
//                                      the past becomes now + 2 min
//        {action:'post_now', id}       queued|held -> queued, publish_at = now
//        {action:'post_done', id}      manual: ready -> done; semi: posted -> done
//                                      ("I made the YouTube upload public")
//        {action:'post_undo_done', id} done -> ready (manual) | posted (semi)
//        {action:'autopost', value}    'on' | 'off': app_settings.social_autopost,
//                                      the publisher's master switch
//   Every transition is a conditional PATCH on the status the row had when it
//   was read, so a tap can never overwrite what the publisher did a second
//   earlier: a lost race returns 409 with the row as it is now.
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

// ── injury desk ────────────────────────────────────────────────────────────
const DESK_CUT: Record<Pos, number> = { QB: 24, RB: 40, WR: 50, TE: 20 };
const OVERRIDE_STATUSES = new Set(['Out', 'Active']);
const FULL_PRACTICE = 'Full Participation in Practice';
const DNP = /did not participate/i;

// Headlines arrive HTML-escaped from RSS ("Jets&#39; ...", "&amp;").
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

interface Override { season: number | null; week: number | null; norm_name: string; position: string; injury_status: string | null }

// The most specific override wins: this exact week, then this season, then
// "until removed" (both null). Same precedence weekly-board applies.
function overrideMap(rows: Override[], season: number, week: number) {
  const spec = (o: Override) => (o.week != null ? 2 : 0) + (o.season != null ? 1 : 0);
  const out = new Map<string, Override>();
  for (const o of rows) {
    if (o.season != null && o.season !== season) continue;
    if (o.week != null && o.week !== week) continue;
    const k = `${o.norm_name}|${o.position}`;
    const prev = out.get(k);
    if (!prev || spec(o) > spec(prev)) out.set(k, o);
  }
  return out;
}

// Lower is more urgent: ruled out, then questionable with a missed practice,
// then questionable, then everything else (limited practice, overrides only).
function severity(status: string | null, practice: string | null) {
  if (status && /^(Out|Doubtful|IR|Injured Reserve|PUP|Sus)/i.test(status)) return 0;
  if (status === 'Questionable' && practice && DNP.test(practice)) return 1;
  if (status === 'Questionable') return 2;
  return 3;
}

async function buildDesk(season: number, week: number) {
  const since = new Date(Date.now() - 96 * 3600_000).toISOString();
  const [board, status, reports, overrides, sched, sources, items] = await Promise.all([
    all<any>(`weekly_rankings?select=gsis_id,player_name,position,team,opponent,pos_rank,rank_recency,rank_matchup,rank_context,rank_manual,injury_status,computed_at&season=eq.${season}&week=eq.${week}`),
    all<any>('nfl_player_status?select=gsis_id,player_name,position,team,status,injury_status,injury_body_part,practice_participation&position=in.(QB,RB,WR,TE)'),
    all<any>(`nfl_injury_reports?select=gsis_id,player_name,position,report_status,report_primary_injury,practice_status&season=eq.${season}&week=eq.${week}`),
    all<Override>('player_status_overrides?select=season,week,norm_name,position,injury_status'),
    all<any>(`nfl_schedule?select=home_team,away_team,kickoff_at&season=eq.${season}&week=eq.${week}`),
    all<any>('content_sources?select=id,name'),
    all<any>(`content_items?select=title,published_at,source_id&published_at=gte.${encodeURIComponent(since)}&title=not.is.null&order=published_at.desc`),
  ]);

  const game = new Map<string, { opp: string; kickoff: string | null }>();
  for (const g of sched) {
    const h = team(g.home_team), a = team(g.away_team);
    game.set(h, { opp: a, kickoff: g.kickoff_at ?? null });
    game.set(a, { opp: h, kickoff: g.kickoff_at ?? null });
  }
  const statusById = new Map<string, any>(), statusByName = new Map<string, any>();
  for (const s of status) {
    const id = cleanId(s.gsis_id);
    if (id) statusById.set(id, s);
    if (s.player_name) statusByName.set(`${norm(s.player_name)}|${s.position}`, s);
  }
  const repById = new Map<string, any>();
  for (const r of reports) if (r.gsis_id) repById.set(cleanId(r.gsis_id), r);
  const ovr = overrideMap(overrides, season, week);
  const srcName = new Map<number | string, string>(sources.map((s: any) => [s.id, s.name]));
  const heads = items.map((i: any) => {
    const title = decode(String(i.title));
    return { title, lower: title.toLowerCase(), src: srcName.get(i.source_id) ?? '', at: i.published_at };
  });
  // "Kenneth Walker III" is usually "Kenneth Walker" in a headline.
  const headlinesFor = (name: string) => {
    const full = name.toLowerCase();
    const bare = full.replace(/\s+(jr\.?|sr\.?|ii|iii|iv|v)$/i, '');
    return heads.filter(h => h.lower.includes(full) || h.lower.includes(bare)).slice(0, 3)
      .map(h => ({ title: h.title, src: h.src, at: h.at }));
  };

  const players: any[] = [];
  const seen = new Set<string>();
  let rebuiltAt: string | null = null;
  const card = (base: { gsis_id: string; name: string; position: Pos; team: string }, row: any | null) => {
    const sl = statusById.get(base.gsis_id) ?? statusByName.get(`${norm(base.name)}|${base.position}`) ?? null;
    const rep = repById.get(base.gsis_id) ?? null;
    const ov = ovr.get(`${norm(base.name)}|${base.position}`) ?? null;
    const g = game.get(base.team);
    return {
      gsis_id: base.gsis_id, name: base.name, position: base.position, team: base.team,
      opp: row?.opponent ?? g?.opp ?? null, kickoff: g?.kickoff ?? null,
      our_rank: row?.pos_rank ?? null,
      a: row?.rank_recency ?? null, b: row?.rank_matchup ?? null, c: row?.rank_context ?? null,
      you: row?.rank_manual ?? null,
      sleeper_injury: sl?.injury_status ?? null, body_part: sl?.injury_body_part ?? rep?.report_primary_injury ?? null,
      practice: rep?.practice_status ?? sl?.practice_participation ?? null,
      report: rep?.report_status ?? null,
      override: ov ? { status: ov.injury_status, week: ov.week } : null,
      headlines: headlinesFor(base.name),
      on_board: !!row,
    };
  };

  for (const row of board) {
    if (row.computed_at && (!rebuiltAt || row.computed_at > rebuiltAt)) rebuiltAt = row.computed_at;
    const pos = row.position as Pos;
    if (!POSITIONS.includes(pos)) continue;
    const id = cleanId(row.gsis_id);
    const sl = statusById.get(id);
    const rep = repById.get(id);
    const ov = ovr.get(`${norm(row.player_name)}|${pos}`);
    const flagged = !!sl?.injury_status || !!rep?.report_status
      || (!!rep?.practice_status && rep.practice_status !== FULL_PRACTICE);
    // Anyone with an override stays visible whatever his rank -- it is a
    // decision already made and must be undoable from here.
    if (!ov && !(flagged && row.pos_rank != null && row.pos_rank <= DESK_CUT[pos])) continue;
    seen.add(`${norm(row.player_name)}|${pos}`);
    players.push(card({ gsis_id: id, name: row.player_name, position: pos, team: team(row.team) }, row));
  }

  // Overridden players the board no longer carries (marked Out, then rebuilt).
  for (const [k, o] of ovr) {
    if (seen.has(k) || !POSITIONS.includes(o.position as Pos)) continue;
    const s = statusByName.get(k);
    if (!s?.team) continue;
    const id = cleanId(s.gsis_id);
    if (isBanned(id)) continue;
    players.push(card({ gsis_id: id, name: s.player_name, position: o.position as Pos, team: team(s.team) }, null));
  }

  const status0 = (p: any) => p.report ?? p.sleeper_injury;
  players.sort((x, y) => {
    const kx = x.kickoff ? Date.parse(x.kickoff) : Infinity, ky = y.kickoff ? Date.parse(y.kickoff) : Infinity;
    if (kx !== ky) return kx - ky;
    const sx = severity(status0(x), x.practice), sy = severity(status0(y), y.practice);
    if (sx !== sy) return sx - sy;
    return (x.our_rank ?? 999) - (y.our_rank ?? 999);
  });
  return { rebuilt_at: rebuiltAt, players };
}

async function saveOverride(b: any) {
  const { season, week } = parseSeasonWeek(b.season, b.week);
  const position = b.position as Pos;
  const name = String(b.name ?? '').trim();
  const status = b.status === null || b.status === '' ? null : String(b.status);
  if (season == null || week == null) return { code: 400, body: { ok: false, error: 'season and week are required' } };
  if (!POSITIONS.includes(position)) return { code: 400, body: { ok: false, error: 'position must be QB, RB, WR or TE' } };
  if (!name) return { code: 400, body: { ok: false, error: 'name is required' } };
  if (status !== null && !OVERRIDE_STATUSES.has(status)) return { code: 400, body: { ok: false, error: "status must be 'Out', 'Active' or null" } };
  const nn = norm(name);

  // The unique index is on COALESCE(season,0)/COALESCE(week,0), which
  // PostgREST's on_conflict cannot target, so replace by delete + insert.
  const key = `norm_name=eq.${encodeURIComponent(nn)}&position=eq.${position}&season=eq.${season}&week=eq.${week}`;
  const d = await sb(`player_status_overrides?${key}`, { method: 'DELETE' });
  if (!d.ok) return { code: 502, body: { ok: false, error: `could not clear the old override (${d.status}); nothing changed`, detail: (await d.text()).slice(0, 200) } };
  if (status === null) return { code: 200, body: { ok: true, override: null } };

  const ins = await sb('player_status_overrides', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ season, week, norm_name: nn, position, injury_status: status, reason: 'set from /rank desk' }),
  });
  if (!ins.ok) {
    const detail = (await ins.text()).slice(0, 200);
    console.log('[manual-rankings] override insert failed:', ins.status, detail);
    return { code: 502, body: { ok: false, error: `override not saved (${ins.status}); the previous one was cleared, tap again`, detail } };
  }
  const [row] = await ins.json();
  return { code: 200, body: { ok: true, override: { status: row.injury_status, week: row.week } } };
}

async function rebuild(b: any) {
  const { season, week } = parseSeasonWeek(b.season, b.week);
  if (season == null || week == null) return { code: 400, body: { ok: false, error: 'season and week are required' } };
  // A full run is ~5-30s; well under the edge wall clock, but a phone on
  // cellular should get a clear error rather than hang forever.
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 120_000);
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/weekly-rankings`, {
      method: 'POST', signal: ctl.signal,
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ season, week, refresh_status: true }),
    });
    const text = await r.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    if (!r.ok || !data || data.ok === false) {
      return { code: 502, body: { ok: false, error: `rebuild failed: ${data?.error ?? `weekly-rankings ${r.status}`}`, detail: data ?? text.slice(0, 300) } };
    }
    return {
      code: 200,
      body: {
        ok: true, season: data.season, week: data.week, pool: data.pool, top5: data.top5,
        written: data.written, model_errors: data.model_errors ?? {}, duration_seconds: data.duration_seconds,
        rebuilt_at: new Date().toISOString(),
      },
    };
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    return { code: 504, body: { ok: false, error: aborted ? 'rebuild timed out after 120s; it may still finish, reload in a minute' : `rebuild failed: ${(e as Error)?.message ?? e}` } };
  } finally { clearTimeout(t); }
}

// ── posts: daily social queue ─────────────────────────────────────────────
const NETWORK_ORDER = ['x', 'threads', 'bluesky', 'instagram', 'facebook', 'youtube', 'tiktok', 'reddit'];
const POST_ACTIONS = new Set(['post_hold', 'post_release', 'post_now', 'post_done', 'post_undo_done']);

// Calendar day in US/Eastern, the day a post is "for".
function etDate(offsetDays = 0, now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(now + offsetDays * 86_400_000));
}

async function autopostSetting(): Promise<'on' | 'off'> {
  const r = await sb('app_settings?select=value&key=eq.social_autopost');
  const rows = r.ok ? await r.json() : [];
  return Array.isArray(rows) && rows[0]?.value === 'off' ? 'off' : 'on';
}

async function buildPosts() {
  const dates = [-1, 0, 1, 2].map(d => etDate(d));
  const [rows, autopost] = await Promise.all([
    all<any>(`social_posts?select=*&post_date=gte.${dates[0]}&post_date=lte.${dates[3]}&order=post_date.asc,id.asc`),
    autopostSetting(),
  ]);
  const rank = (n: string) => { const i = NETWORK_ORDER.indexOf(n); return i < 0 ? 99 : i; };
  const days = dates.map(date => ({
    date,
    posts: rows.filter(r => r.post_date === date)
      .sort((a, b) => rank(a.network) - rank(b.network) || String(a.theme).localeCompare(String(b.theme)) || a.id - b.id),
  }));
  return { autopost, today: dates[1], days };
}

async function postAction(b: any) {
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) return { code: 400, body: { ok: false, error: 'id must be a positive integer' } };
  const r = await sb(`social_posts?select=*&id=eq.${id}`);
  const [row] = r.ok ? await r.json() : [];
  if (!row) return { code: 404, body: { ok: false, error: `post ${id} not found` } };

  const now = new Date().toISOString();
  const auto = row.mode === 'auto' || row.mode === 'semi';
  let patch: Record<string, unknown> | null = null;
  let why = '';
  switch (b.action) {
    case 'post_hold':
      if (!auto) why = 'only automatic posts can be held';
      else if (row.status !== 'queued') why = `it is ${row.status}, not queued`;
      else patch = { status: 'held' };
      break;
    case 'post_release': {
      if (!auto) why = 'only automatic posts can be released';
      else if (row.status !== 'held') why = `it is ${row.status}, not held`;
      else {
        const past = !row.publish_at || Date.parse(row.publish_at) < Date.now();
        patch = { status: 'queued', publish_at: past ? new Date(Date.now() + 120_000).toISOString() : row.publish_at };
      }
      break;
    }
    case 'post_now':
      if (!auto) why = 'copy-paste posts are published by hand';
      else if (row.status !== 'queued' && row.status !== 'held') why = `it is ${row.status}`;
      else patch = { status: 'queued', publish_at: now };
      break;
    case 'post_done':
      if (row.mode === 'manual' && row.status === 'ready') patch = { status: 'done', posted_at: now };
      else if (row.mode === 'semi' && row.status === 'posted') patch = { status: 'done' };
      else why = row.mode === 'auto' ? 'automatic posts are marked posted by the publisher' : `it is ${row.status}`;
      break;
    case 'post_undo_done':
      if (row.status !== 'done') why = `it is ${row.status}, not done`;
      else if (row.mode === 'manual') patch = { status: 'ready', posted_at: null };
      else if (row.mode === 'semi') patch = { status: 'posted' };
      else why = 'automatic posts cannot be un-done';
      break;
  }
  if (!patch) return { code: 409, body: { ok: false, error: `cannot ${String(b.action).replace('post_', '').replace(/_/g, ' ')}: ${why}`, row } };

  // Conditional on the status we just read: the publisher may have moved it.
  const u = await sb(`social_posts?id=eq.${id}&status=eq.${encodeURIComponent(row.status)}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...patch, updated_at: now }),
  });
  if (!u.ok) return { code: 502, body: { ok: false, error: `update failed (${u.status})`, detail: (await u.text()).slice(0, 200) } };
  const [updated] = await u.json();
  if (!updated) {
    const f = await sb(`social_posts?select=*&id=eq.${id}`);
    const [fresh] = f.ok ? await f.json() : [];
    return { code: 409, body: { ok: false, error: `it changed to ${fresh?.status ?? 'something else'} a moment ago; nothing was changed`, row: fresh ?? row } };
  }
  return { code: 200, body: { ok: true, row: updated } };
}

async function setAutopost(b: any) {
  const value = b.value === 'on' || b.value === 'off' ? b.value : null;
  if (!value) return { code: 400, body: { ok: false, error: "value must be 'on' or 'off'" } };
  const now = new Date().toISOString();
  const u = await sb('app_settings?key=eq.social_autopost', {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ value, updated_at: now }),
  });
  if (!u.ok) return { code: 502, body: { ok: false, error: `could not save the switch (${u.status})` } };
  const rows = await u.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    const i = await sb('app_settings', {
      method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ key: 'social_autopost', value, updated_at: now }),
    });
    if (!i.ok) return { code: 502, body: { ok: false, error: `could not save the switch (${i.status})` } };
  }
  return { code: 200, body: { ok: true, autopost: value } };
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
      // Posts are keyed by calendar day, not NFL week: answer before the
      // week lookup so the tab loads even when that query is slow.
      if (url.searchParams.get('view') === 'posts') return json(req, { ok: true, ...(await buildPosts()) });
      const p = parseSeasonWeek(url.searchParams.get('season'), url.searchParams.get('week'));
      const season = p.season ?? nflSeason();
      const week = p.week ?? await defaultWeek(season);

      if (url.searchParams.get('view') === 'desk') {
        const desk = await buildDesk(season, week);
        return json(req, { ok: true, season, week, ...desk });
      }

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
      if (body.action === 'override') { const r = await saveOverride(body); return json(req, r.body, r.code); }
      if (body.action === 'rebuild') { const r = await rebuild(body); return json(req, r.body, r.code); }
      if (POST_ACTIONS.has(body.action)) { const r = await postAction(body); return json(req, r.body, r.code); }
      if (body.action === 'autopost') { const r = await setAutopost(body); return json(req, r.body, r.code); }
      if (body.action != null) return json(req, { ok: false, error: `unknown action ${String(body.action).slice(0, 30)}` }, 400);
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
