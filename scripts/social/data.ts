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

const etKick = (g: any) => {
  const [h, m] = String(g.gametime || '13:00').split(':').map(Number);
  const day = new Date(`${g.gameday}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  return `${day} ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'} ET`;
};

// Teams whose game this week has already kicked off. A Saturday post about a
// player who played Thursday night reads as a mistake (Matthew Golden in the
// first week-3 preview), so every forward-looking theme leaves them out.
async function startedTeams(db: Db, season: number, week: number) {
  const games = await db.get<any>(`nfl_games?select=home_team,away_team,gameday,gametime&season=eq.${season}&week=eq.${week}`);
  const out = new Set<string>();
  for (const g of games) {
    const [y, m, d] = String(g.gameday).split('-').map(Number);
    const [hh, mm] = String(g.gametime || '13:00').split(':').map(Number);
    const nov1 = new Date(Date.UTC(y, 10, 1));
    const dstEnd = Date.UTC(y, 10, 1 + ((7 - nov1.getUTCDay()) % 7));
    const local = Date.UTC(y, m - 1, d, hh, mm);
    if (local + (local < dstEnd ? 4 : 5) * 3600_000 <= Date.now()) { out.add(g.home_team); out.add(g.away_team); }
  }
  return out;
}

async function board(db: Db, season: number, week: number) {
  const [rows, started] = await Promise.all([
    db.get<any>(`public_weekly_board?select=gsis_id,player_name,position,team,opponent,rank,pos_rank,injury_status&season=eq.${season}&week=eq.${week}&order=rank.asc`),
    startedTeams(db, season, week),
  ]);
  return rows.filter(r => !started.has(r.team));
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
    const started = await startedTeams(db, season, boardWeek);
    const short = (p?: string | null) => !p ? 'practice not listed'
      : /did not/i.test(p) ? 'missed practice' : /limited/i.test(p) ? 'limited in practice' : /full/i.test(p) ? 'full practice' : p;
    const players = rows.filter(r => r.pos_rank <= CUT[r.position as Pos] && !started.has(r.team))
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

  if (theme === 'weather') {
    // weekly-board stores the kickoff forecast per outdoor game ("15mph Rain"),
    // refreshed daily at 09:00 UTC. Domes and closed roofs never appear.
    const [rows, games, notes] = await Promise.all([
      board(db, season, boardWeek),
      db.get<any>(`nfl_games?select=home_team,away_team,gameday,gametime&season=eq.${season}&week=eq.${boardWeek}`),
      db.get<any>(`nfl_weekly_board?select=team,weather_note&season=eq.${season}&week=eq.${boardWeek}&weather_note=not.is.null`),
    ]);
    const noteBy = new Map(notes.map(n => [n.team, n.weather_note as string]));
    const out: any[] = [];
    for (const g of games) {
      const note = noteBy.get(g.home_team) ?? noteBy.get(g.away_team);
      if (!note) continue;
      const wind = Number(note.match(/(\d+)\s*mph/i)?.[1] ?? 0);
      const cond = note.replace(/^\s*\d+\s*mph\s*/i, '').trim() || 'Clear';
      const wet = /rain|snow|storm|drizzle/i.test(cond);
      if (wind < 12 && !wet) continue;
      // Same factors weather.ts applies to QBs (calibrated on 2021-2024).
      const pass = wind >= 20 ? 15 : wind >= 15 ? 13 : wind >= 10 ? 5 : 0;
      const players = rows.filter(r => [g.home_team, g.away_team].includes(r.team) && ['QB', 'WR', 'TE'].includes(r.position)
        && r.pos_rank <= CUT[r.position as Pos]).slice(0, 4).map(r => line(r));
      if (!players.length) continue;
      out.push({ away: team(g.away_team), home: team(g.home_team), kickoff_et: etKick(g), wind, cond,
        impact: wind >= 15 ? 'high' : 'moderate', pass_hit_pct: Math.min(20, pass + (wet ? 3 : 0)), players });
    }
    out.sort((a, b) => b.wind - a.wind || b.pass_hit_pct - a.pass_hit_pct);
    return out.length ? { theme, season, week: boardWeek, games: out.slice(0, 4) } : null;
  }

  if (theme === 'waivers') {
    // Rostered % comes from ESPN's league-wide ownership, captured by the
    // Tuesday harvest (so Tuesday's generator runs after it, not at 7 AM).
    const [rows, own] = await Promise.all([
      board(db, season, boardWeek),
      db.get<any>(`player_ownership_snapshots?select=gsis_id,percent_owned,captured_at&provider=eq.espn&order=captured_at.desc`),
    ]);
    const latest = own[0]?.captured_at?.slice(0, 10);
    const pct = new Map(own.filter(o => o.captured_at?.slice(0, 10) === latest && o.percent_owned != null).map(o => [o.gsis_id, Number(o.percent_owned)]));
    const WCUT: Record<Pos, number> = { QB: 18, RB: 36, WR: 45, TE: 18 };
    const players = rows.filter(r => pct.has(r.gsis_id) && pct.get(r.gsis_id)! < 50 && r.pos_rank <= WCUT[r.position as Pos] && !r.injury_status)
      .sort((a, b) => a.pos_rank / WCUT[a.position as Pos] - b.pos_rank / WCUT[b.position as Pos])
      .slice(0, 8).map(r => ({ ...line(r), owned: Math.round(pct.get(r.gsis_id)!) }));
    return players.length >= 3 ? { theme, season, week: boardWeek, players } : null;
  }

  if (theme === 'next_man_up') {
    // A relevant starter ruled out (Out/Doubtful/IR), and the teammate next on
    // his depth-chart slot. Relevance = real volume this season, not name value.
    const [status, stats, rows, started] = await Promise.all([
      db.get<any>(`nfl_player_status?select=gsis_id,player_name,position,team,injury_status,status,depth_chart_position,depth_chart_order`),
      db.get<any>(`weekly_model_stats?select=gsis_id,position,team,targets,carries,attempts&season=eq.${season}`),
      board(db, season, boardWeek),
      startedTeams(db, season, boardWeek),
    ]);
    const vol = new Map<string, { t: number; c: number; a: number; g: number }>();
    for (const s of stats) {
      const v = vol.get(s.gsis_id) ?? { t: 0, c: 0, a: 0, g: 0 };
      v.t += s.targets; v.c += s.carries; v.a += s.attempts; v.g++; vol.set(s.gsis_id, v);
    }
    const per = (id: string, pos: string) => {
      const v = vol.get(id?.trim()); if (!v || !v.g) return 0;
      return pos === 'QB' ? v.a / v.g : pos === 'RB' ? (v.c + v.t) / v.g : v.t / v.g;
    };
    const MIN: Record<string, number> = { QB: 20, RB: 12, WR: 5.5, TE: 4.5 };
    const rank = new Map(rows.map(r => [r.gsis_id, r.pos_rank]));
    const pairs: any[] = [];
    for (const s of status) {
      const out = s.injury_status && ['Out', 'Doubtful', 'IR'].includes(s.injury_status);
      if (!out || started.has(s.team) || !MIN[s.position] || per(s.gsis_id, s.position) < MIN[s.position]) continue;
      // Who inherits: the best-ranked healthy teammate at the position on
      // this week's board (Puka out -> Davante Adams), not the next name on
      // the depth chart (which gave Tutu Atwell, WR101). The depth chart only
      // breaks ties for players the board doesn't rank.
      const mates = status.filter(t => t.team === s.team && t.position === s.position && t.gsis_id !== s.gsis_id && !t.injury_status)
        .sort((a, b) => (rank.get(a.gsis_id?.trim()) ?? 999) - (rank.get(b.gsis_id?.trim()) ?? 999)
          || (a.depth_chart_order ?? 99) - (b.depth_chart_order ?? 99));
      const up = mates[0];
      if (!up) continue;
      const n = per(up.gsis_id, up.position);
      const unit = up.position === 'QB' ? 'pass attempts' : up.position === 'RB' ? 'touches' : 'targets';
      pairs.push({
        out: { name: s.player_name, pos: s.position, team: team(s.team), status: s.injury_status },
        // A rank past the startable range reads as noise (QB73), so only show it inside 2x the cut.
        up: { name: up.player_name, pos: up.position, team: team(up.team),
              rank: (r => r != null && r <= CUT[up.position as Pos] * 2 ? r : undefined)(rank.get(up.gsis_id?.trim())),
              note: n ? `${n.toFixed(1)} ${unit} per game so far` : 'first real role this season' },
        vol: per(s.gsis_id, s.position),
      });
    }
    pairs.sort((a, b) => b.vol - a.vol);
    return pairs.length ? { theme, season, week: boardWeek, pairs: pairs.slice(0, 5).map(({ vol, ...p }) => p) } : null;
  }

  if (theme === 'shootout') {
    const [rows, games, started] = await Promise.all([
      board(db, season, boardWeek),
      db.get<any>(`nfl_games?select=home_team,away_team,gameday,gametime,total_line,spread_line&season=eq.${season}&week=eq.${boardWeek}&total_line=not.is.null`),
      startedTeams(db, season, boardWeek),
    ]);
    const top = games.filter(g => !started.has(g.home_team)).sort((a, b) => b.total_line - a.total_line).slice(0, 3).map(g => ({
      away: team(g.away_team), home: team(g.home_team), kickoff_et: etKick(g), total: Number(g.total_line),
      // spread_line is the HOME view: positive = home favoured.
      favorite: team(Number(g.spread_line) >= 0 ? g.home_team : g.away_team), spread: Math.abs(Number(g.spread_line)),
      players: rows.filter(r => [g.home_team, g.away_team].includes(r.team) && r.pos_rank <= CUT[r.position as Pos]).slice(0, 4).map(r => line(r)),
    }));
    return top.length ? { theme, season, week: boardWeek, games: top } : null;
  }

  if (theme === 'usage') {
    // Share of team targets (WR/TE) or touches (RB): last 2 games vs the
    // season's earlier games. Needs 3+ games, so the first post is after week 3.
    const stats = await db.get<any>(`weekly_model_stats?select=gsis_id,player_name,position,team,week,targets,carries&season=eq.${season}`);
    const weeks = [...new Set(stats.map(s => s.week))].sort((a, b) => a - b);
    if (weeks.length < 3) return null;
    const recent = new Set(weeks.slice(-2));
    const teamTot = new Map<string, { t: number; c: number }>();
    for (const s of stats) { const k = `${s.team}|${s.week}`; const v = teamTot.get(k) ?? { t: 0, c: 0 }; v.t += s.targets; v.c += s.carries; teamTot.set(k, v); }
    const acc = new Map<string, { r: any; b: number[]; a: number[] }>();
    for (const s of stats) {
      if (!['RB', 'WR', 'TE'].includes(s.position)) continue;
      const tt = teamTot.get(`${s.team}|${s.week}`)!;
      const share = s.position === 'RB' ? (s.carries + s.targets) / Math.max(1, tt.c + tt.t) : s.targets / Math.max(1, tt.t);
      const e = acc.get(s.gsis_id) ?? { r: s, b: [], a: [] };
      (recent.has(s.week) ? e.a : e.b).push(share); e.r = s; acc.set(s.gsis_id, e);
    }
    const avg = (x: number[]) => x.reduce((p, q) => p + q, 0) / x.length;
    const moves = [...acc.values()].filter(e => e.a.length === 2 && e.b.length >= 1).map(e => ({
      ...line(e.r, undefined), stat: e.r.position === 'RB' ? 'touch share' : 'target share',
      before: Math.round(avg(e.b) * 100), after: Math.round(avg(e.a) * 100),
    })).filter(m => Math.max(m.before, m.after) >= 15);
    const risers = moves.filter(m => m.after - m.before >= 8).sort((a, b) => (b.after - b.before) - (a.after - a.before)).slice(0, 5);
    const fallers = moves.filter(m => m.before - m.after >= 8).sort((a, b) => (b.before - b.after) - (a.before - a.after)).slice(0, 5);
    return risers.length + fallers.length ? { theme, season, week: weeks[weeks.length - 1], risers, fallers } : null;
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
