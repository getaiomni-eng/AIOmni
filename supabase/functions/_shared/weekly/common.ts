// Helpers every weekly model shares. Pure; no I/O.

import type {
  DepthRow, Forecast, GameRow, InjuryRow, PoolPlayer, Pos, SnapRow, StatRow, StatusRow, WeekInput,
} from './types.ts';
import { isBanned } from './banned.ts';

export const POSITIONS: Pos[] = ['QB', 'RB', 'WR', 'TE'];

// Statuses that mean "will not play". Doubtful players almost never do; the
// board has always removed them rather than ranking them 40th.
export const WILL_NOT_PLAY = new Set(['Out', 'Doubtful', 'IR', 'Injured Reserve', 'PUP', 'Sus', 'NA', 'DNR', 'COV']);

export const before = (s: number, w: number, season: number, week: number) =>
  s < season || (s === season && w < week);

export const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;

// Pull a noisy average toward a prior, weighted by sample size. k is the
// number of games' worth of weight the prior carries.
export const shrink = (obs: number, n: number, prior: number, k: number) =>
  n <= 0 || !isFinite(obs) ? prior : (obs * n + prior * k) / (n + k);

export const ppr = (r: StatRow) => r.fantasy_pts_ppr ?? 0;

// Target week's schedule, keyed by team.
export function weekGames(games: GameRow[], season: number, week: number) {
  const m = new Map<string, { game: GameRow; opponent: string; home: boolean }>();
  for (const g of games) {
    if (g.season !== season || g.week !== week) continue;
    m.set(g.home_team, { game: g, opponent: g.away_team, home: true });
    m.set(g.away_team, { game: g, opponent: g.home_team, home: false });
  }
  return m;
}

// Vegas implied team total from total and home-view spread.
export function impliedTotal(g: GameRow, team: string): number | null {
  if (g.total_line == null || g.spread_line == null) return null;
  const homeImplied = g.total_line / 2 + g.spread_line / 2;
  return team === g.home_team ? homeImplied : g.total_line - homeImplied;
}

// Rows for one player, newest first.
export function byPlayer(stats: StatRow[]) {
  const m = new Map<string, StatRow[]>();
  for (const r of stats) {
    let a = m.get(r.gsis_id);
    if (!a) m.set(r.gsis_id, a = []);
    a.push(r);
  }
  for (const a of m.values()) a.sort((x, y) => y.season - x.season || y.week - x.week);
  return m;
}

// Team-level totals per game (targets, carries, attempts), for share math.
export function teamGameTotals(stats: StatRow[]) {
  const m = new Map<string, { targets: number; carries: number; attempts: number; ppr: number }>();
  for (const r of stats) {
    const k = `${r.season}|${r.week}|${r.team}`;
    let t = m.get(k);
    if (!t) m.set(k, t = { targets: 0, carries: 0, attempts: 0, ppr: 0 });
    t.targets += r.targets; t.carries += r.carries; t.attempts += r.attempts; t.ppr += ppr(r);
  }
  return m;
}

export const normName = (s: string) =>
  s.toLowerCase().replace(/[.'’]/g, '').replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '').replace(/\s+/g, ' ').trim();

// The players every model ranks this week.
//
// Team comes from the target-week depth chart when there is one (catches
// trades and signings the stat history cannot know about), else the player's
// most recent stat row. Anyone officially Out/Doubtful, or on IR/PUP per the
// live Sleeper mirror, is dropped -- removed, not demoted.
export function buildPool(args: {
  season: number; week: number;
  stats: StatRow[]; games: GameRow[]; injuries: InjuryRow[]; depth: DepthRow[];
  status?: StatusRow[];
  draft?: Record<string, { draft_round: number | null; draft_pick: number | null; rookie_season: number | null }>;
}): PoolPlayer[] {
  const { season, week } = args;
  const sched = weekGames(args.games, season, week);

  // Last stat row per player within the previous and current season.
  const latest = new Map<string, StatRow>();
  for (const r of args.stats) {
    if (r.season < season - 1 || !before(r.season, r.week, season, week)) continue;
    const p = latest.get(r.gsis_id);
    if (!p || r.season > p.season || (r.season === p.season && r.week > p.week)) latest.set(r.gsis_id, r);
  }

  // Target-week depth chart. A team with no chart for this week (its game
  // kicked off before the sync ever captured one -- ATL and GB in week 3)
  // falls back to its latest earlier chart this season for depth RANK only.
  // Without that, every player on the team read as "no depth info", and the
  // context model's prior treated Bijan Robinson as a deep backup (1.8 pts).
  // Roster membership ("not on the chart -> cut") still uses the target week.
  const depthRank = new Map<string, { team: string; rank: number; name: string; pos: Pos }>();
  const depthTeams = new Set<string>();
  const chartWeek = new Map<string, number>();   // team -> week of chart used
  for (const d of args.depth) {
    if (d.season !== season || d.week > week) continue;
    if (d.week > (chartWeek.get(d.team) ?? 0)) chartWeek.set(d.team, d.week);
  }
  for (const d of args.depth) {
    if (d.season !== season || !d.gsis_id || d.week !== chartWeek.get(d.team)) continue;
    if (d.week === week) depthTeams.add(d.team);
    const p = depthRank.get(d.gsis_id);
    if (!p || d.slot_rank < p.rank) depthRank.set(d.gsis_id, { team: d.team, rank: d.slot_rank, name: d.player_name, pos: d.position });
  }

  const report = new Map<string, InjuryRow>();
  for (const i of args.injuries) if (i.season === season && i.week === week) report.set(i.gsis_id, i);
  const sleeper = new Map<string, StatusRow>();
  // trim(): Sleeper pads some gsis ids with a leading space.
  for (const s of args.status ?? []) if (s.gsis_id?.trim()) sleeper.set(s.gsis_id.trim(), s);

  const ids = new Set([...latest.keys(), ...depthRank.keys()]);
  const pool: PoolPlayer[] = [];
  for (const id of ids) {
    if (isBanned(id)) continue;
    const last = latest.get(id);
    const dr = depthRank.get(id);
    // A player whose team has a depth chart this week but who is not on it has
    // been cut, traded or benched out of the rotation.
    if (last && !dr && depthTeams.has(last.team)) continue;
    const team = dr?.team ?? last!.team;
    const g = sched.get(team);
    if (!g) continue; // bye
    const rep = report.get(id);
    const sl = sleeper.get(id);
    const inj = rep?.report_status ?? sl?.injury_status ?? null;
    if (inj && WILL_NOT_PLAY.has(inj)) continue;
    if (sl?.status && WILL_NOT_PLAY.has(sl.status)) continue;
    const dft = args.draft?.[id];
    pool.push({
      gsis_id: id,
      player_name: last?.player_name ?? dr!.name,
      position: last?.position ?? dr!.pos,
      team, opponent: g.opponent, game_id: g.game.game_id, home: g.home,
      injury_status: inj, practice_status: rep?.practice_status ?? sl?.practice_participation ?? null,
      depth_rank: dr?.rank ?? null,
      rookie: dft?.rookie_season === season,
      draft_round: dft?.draft_round ?? null, draft_pick: dft?.draft_pick ?? null,
    });
  }
  return pool;
}

// Everything a model may see when ranking (season, week). The ONE place the
// leakage rule is enforced, used by both the edge function and the backtest.
export function assembleInput(raw: {
  stats: StatRow[]; games: GameRow[]; snaps: SnapRow[]; injuries: InjuryRow[]; depth: DepthRow[];
  status?: StatusRow[]; forecast?: Record<string, Forecast>;
  draft?: Record<string, { draft_round: number | null; draft_pick: number | null; rookie_season: number | null }>;
}, season: number, week: number): WeekInput {
  const stats = raw.stats.filter(r => before(r.season, r.week, season, week));
  const snaps = raw.snaps.filter(r => before(r.season, r.week, season, week));
  const injuries = raw.injuries.filter(r => r.season < season || (r.season === season && r.week <= week));
  const depth = raw.depth.filter(r => r.season < season || (r.season === season && r.week <= week));
  // Target-week (and later) games lose their outcome. Kickoff temp/wind stay:
  // in the backtest they stand in for the forecast the live run will have.
  const games = raw.games
    .filter(g => g.season <= season)
    .map(g => (g.season === season && g.week >= week) ? { ...g, home_score: null, away_score: null } : g);
  const pool = buildPool({ season, week, stats, games, injuries, depth, status: raw.status, draft: raw.draft });
  return { season, week, stats, games, snaps, injuries, depth, status: raw.status, forecast: raw.forecast, pool };
}

// Position ranks (1 = best) from projections.
export function positionRanks<T extends { gsis_id: string; position: Pos; proj: number }>(rows: T[]) {
  const out = new Map<string, number>();
  for (const pos of POSITIONS) {
    rows.filter(r => r.position === pos && isFinite(r.proj))
      .sort((a, b) => b.proj - a.proj)
      .forEach((r, i) => out.set(r.gsis_id, i + 1));
  }
  return out;
}
