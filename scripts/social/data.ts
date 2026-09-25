// Builds each day's ThemeData from Postgres (read-only, PostgREST).
//
// Everything here is facts from our own tables: the live weekly board, the
// frozen graded snapshot, actual PPR from nfl_weekly_stats, and the expert
// consensus we already harvest. Nothing is invented, so a post can only be as
// wrong as the board it quotes.

import type { PlayerLine, Theme, ThemeData } from '../../supabase/functions/_shared/social/types.ts';

type Pos = 'QB' | 'RB' | 'WR' | 'TE';
const POS: Pos[] = ['QB', 'RB', 'WR', 'TE'];
// Relevance cut per position: roughly "startable in a 12-team league".
const CUT: Record<Pos, number> = { QB: 15, RB: 30, WR: 36, TE: 15 };

// Display team codes the way fans write them.
const TEAM: Record<string, string> = { LA: 'LAR' };
const team = (t: string | null | undefined) => (t ? TEAM[t] ?? t : '');

export interface Db { get<T = any>(path: string): Promise<T[]> }

export function restDb(url: string, key: string): Db {
  return {
    async get<T>(path: string): Promise<T[]> {
      const out: T[] = [];
      for (let off = 0; ; off += 1000) {
        const sep = path.includes('?') ? '&' : '?';
        const r = await fetch(`${url}/rest/v1/${path}${sep}limit=1000&offset=${off}`, {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
        });
        if (!r.ok) throw new Error(`read ${path.split('?')[0]} ${r.status}: ${(await r.text()).slice(0, 160)}`);
        const page = await r.json() as T[];
        out.push(...page);
        if (page.length < 1000) return out;
      }
    },
  };
}

const line = (r: any, rank?: number): PlayerLine =>
  ({ name: r.player_name, pos: r.position, team: team(r.team), opp: r.opponent ? team(r.opponent) : undefined, rank: rank ?? r.pos_rank });

// The week the live board is on, and the last week with real results.
async function weeks(db: Db, season: number) {
  const board = await db.get<{ week: number }>(`public_weekly_board?select=week&season=eq.${season}&order=week.desc`);
  const stats = await db.get<{ week: number }>(`weekly_model_stats?select=week&season=eq.${season}&order=week.desc`);
  return { boardWeek: board[0]?.week ?? 1, gradedWeek: stats[0]?.week ?? 0 };
}

// Expert consensus position rank: FantasyPros, or ESPN's median where
// FantasyPros publishes no list (QB).
async function consensus(db: Db, season: number, week: number) {
  const rows = await db.get<any>(`expert_weekly_rankings?select=provider,gsis_id,position,pos_rank&season=eq.${season}&week=eq.${week}&provider=in.(fantasypros,espn)`);
  const fp = new Map<string, number>(), espn = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.gsis_id || r.pos_rank == null) continue;
    if (r.provider === 'fantasypros') fp.set(r.gsis_id, r.pos_rank);
    else (espn.get(r.gsis_id) ?? espn.set(r.gsis_id, []).get(r.gsis_id)!).push(r.pos_rank);
  }
  const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  return (id: string) => fp.get(id) ?? (espn.has(id) ? med(espn.get(id)!) : null);
}

async function board(db: Db, season: number, week: number) {
  return db.get<any>(`public_weekly_board?select=gsis_id,player_name,position,team,opponent,rank,pos_rank,injury_status&season=eq.${season}&week=eq.${week}&order=rank.asc`);
}

export async function buildTheme(db: Db, theme: Theme, season: number): Promise<ThemeData | null> {
  const { boardWeek, gradedWeek } = await weeks(db, season);

  if (theme === 'rankings' || theme === 'final_calls') {
    const rows = await board(db, season, boardWeek);
    const top = (n: number) => Object.fromEntries(POS.map(p =>
      [p, rows.filter(r => r.position === p).sort((a, b) => a.pos_rank - b.pos_rank).slice(0, n).map(r => line(r))])) as Record<Pos, PlayerLine[]>;
    if (theme === 'rankings') return { theme, season, week: boardWeek, lists: top(12) };
    const ov = await db.get<any>(`player_status_overrides?select=norm_name,position,injury_status&season=eq.${season}&week=eq.${boardWeek}`);
    const norm = (s: string) => s.toLowerCase().replace(/[.'’]/g, '').replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '').replace(/\s+/g, ' ').trim();
    const status = await db.get<any>(`nfl_player_status?select=player_name,position,team`);
    const calls = ov.filter(o => o.injury_status === 'Out' || o.injury_status === 'Active').map(o => {
      const s = status.find(x => norm(x.player_name) === o.norm_name && x.position === o.position);
      return { name: s?.player_name ?? o.norm_name, pos: o.position, team: team(s?.team), call: o.injury_status === 'Out' ? 'Out' as const : 'Playing' as const };
    });
    return { theme, season, week: boardWeek, top5: top(5), calls };
  }

  if (theme === 'injuries') {
    const [rows, reps] = await Promise.all([
      db.get<any>(`weekly_rankings?select=gsis_id,player_name,position,team,opponent,pos_rank,injury_status&season=eq.${season}&week=eq.${boardWeek}&injury_status=not.is.null`),
      db.get<any>(`nfl_injury_reports?select=gsis_id,practice_status,report_status&season=eq.${season}&week=eq.${boardWeek}`),
    ]);
    const rep = new Map(reps.map(r => [r.gsis_id, r]));
    const short = (p?: string | null) => !p ? 'practice not listed'
      : /did not/i.test(p) ? 'missed practice' : /limited/i.test(p) ? 'limited in practice' : /full/i.test(p) ? 'full practice' : p;
    const players = rows.filter(r => r.pos_rank <= CUT[r.position as Pos])
      .sort((a, b) => a.pos_rank - b.pos_rank)
      .slice(0, 10)
      .map(r => ({ ...line(r), status: rep.get(r.gsis_id)?.report_status ?? r.injury_status, practice: short(rep.get(r.gsis_id)?.practice_status) }));
    return players.length ? { theme, season, week: boardWeek, players } : null;
  }

  if (theme === 'disagree') {
    const [rows, cons] = await Promise.all([board(db, season, boardWeek), consensus(db, season, boardWeek)]);
    // Injured players are left out: a gap that exists because the consensus
    // already priced in a missed practice (DJ Moore, WR35 vs WR76 in week 3)
    // is not a disagreement, and "we're higher on him" would read as a miss.
    const gaps = rows.map(r => ({ r, c: cons(r.gsis_id) }))
      .filter(x => !x.r.injury_status && x.c != null && Math.min(x.r.pos_rank, x.c!) <= CUT[x.r.position as Pos])
      .map(x => ({ ...line(x.r), ours: x.r.pos_rank as number, consensus: x.c as number }));
    // Relative gaps: WR8 vs WR15 matters more than WR38 vs WR45.
    const score = (g: { ours: number; consensus: number }) => (g.consensus - g.ours) / Math.sqrt(Math.min(g.ours, g.consensus));
    const higher = gaps.filter(g => g.ours < g.consensus).sort((a, b) => score(b) - score(a)).slice(0, 5);
    const lower = gaps.filter(g => g.ours > g.consensus).sort((a, b) => score(a) - score(b)).slice(0, 5);
    return higher.length + lower.length ? { theme, season, week: boardWeek, higher, lower } : null;
  }

  if (theme === 'tnf') {
    const games = await db.get<any>(`nfl_games?select=away_team,home_team,gameday,gametime,weekday&season=eq.${season}&week=eq.${boardWeek}&weekday=eq.Thursday`);
    if (!games.length) return null;
    const g = games[0];
    const rows = (await board(db, season, boardWeek)).filter(r => [g.away_team, g.home_team].includes(r.team));
    const players = rows.filter(r => r.pos_rank <= CUT[r.position as Pos] + 6).slice(0, 10).map(r => line(r));
    const [h, m] = String(g.gametime || '20:15').split(':').map(Number);
    const kickoff_et = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'} ET`;
    return { theme, season, week: boardWeek, game: { away: team(g.away_team), home: team(g.home_team), kickoff_et }, players };
  }

  // hits / report_card: grade the frozen pre-game snapshot of the last week
  // with results. Only weeks with an aiomni_ensemble snapshot (week 3 on).
  const w = gradedWeek;
  const [snap, actual, cons] = await Promise.all([
    db.get<any>(`ranking_snapshots?select=gsis_id,player_name,position,team,pos_rank&season=eq.${season}&week=eq.${w}&source=eq.aiomni_ensemble`),
    db.get<any>(`weekly_model_stats?select=gsis_id,player_name,position,team,fantasy_pts_ppr&season=eq.${season}&week=eq.${w}`),
    consensus(db, season, w),
  ]);
  if (!snap.length || !actual.length) return null;
  const finish = new Map<string, { finish: number; pts: number }>();
  for (const p of POS) {
    actual.filter(a => a.position === p).sort((a, b) => (b.fantasy_pts_ppr ?? 0) - (a.fantasy_pts_ppr ?? 0))
      .forEach((a, i) => finish.set(a.gsis_id, { finish: i + 1, pts: Number(a.fantasy_pts_ppr ?? 0) }));
  }
  const graded = snap.filter(s => finish.has(s.gsis_id)).map(s => ({ s, f: finish.get(s.gsis_id)!, c: cons(s.gsis_id) }));

  if (theme === 'hits') {
    const hits = graded.filter(x => x.s.pos_rank <= 12 && x.f.finish <= 5)
      .sort((a, b) => b.f.pts - a.f.pts).slice(0, 5)
      .map(x => ({ ...line(x.s), finish: x.f.finish, pts: x.f.pts }));
    const sleepers = graded.filter(x => x.c != null && x.c - x.s.pos_rank >= 5 && x.f.finish <= 12)
      .sort((a, b) => (b.c! - b.s.pos_rank) - (a.c! - a.s.pos_rank)).slice(0, 5)
      .map(x => ({ ...line(x.s), finish: x.f.finish, pts: x.f.pts }));
    return hits.length ? { theme, season, week: w, hits, sleepers } : null;
  }

  // report_card: of each side's top 12 per position, how many finished top 12.
  let ours = 0, theirs = 0, total = 0;
  for (const p of POS) {
    const inPos = graded.filter(x => x.s.position === p);
    ours += inPos.filter(x => x.s.pos_rank <= 12 && x.f.finish <= 12).length;
    theirs += inPos.filter(x => x.c != null && x.c <= 12 && x.f.finish <= 12).length;
    total += 12;
  }
  const best = graded.filter(x => x.c != null && x.f.finish <= 12)
    .sort((a, b) => (b.c! - b.s.pos_rank) - (a.c! - a.s.pos_rank))[0];
  return {
    theme, season, week: w,
    ours: { top12_hits: ours, top12_total: total },
    consensus: { top12_hits: theirs, top12_total: total },
    best_call: best && best.c! > best.s.pos_rank ? { ...line(best.s), ours: best.s.pos_rank, consensus: best.c!, finish: best.f.finish } : null,
  };
}
