// Calibrate the non-player coefficients model B (matchup) uses, on 2021-2024
// only, so the 2025 backtest stays out-of-sample:
//   * role mean PPR (league prior for QB1, RB1, WR1 ...)
//   * Vegas elasticity: how player points scale with implied team total
//   * weather: wind and cold effects per position, outdoor games only
//
//   WEEKLY_DATA=... node scripts/weekly/matchup_calibrate.ts [fromSeason toSeason]

import { loadDataset } from './harness.ts';
import { impliedTotal, mean, ppr } from '../../supabase/functions/_shared/weekly/common.ts';
import type { GameRow, Pos, StatRow } from '../../supabase/functions/_shared/weekly/types.ts';

const [from = 2021, to = 2024] = process.argv.slice(2).map(Number);
const ds = loadDataset();
const games = ds.games.filter(g => g.season >= from && g.season <= to);
const gameOf = new Map<string, GameRow>();
for (const g of games) {
  gameOf.set(`${g.season}|${g.week}|${g.home_team}`, g);
  gameOf.set(`${g.season}|${g.week}|${g.away_team}`, g);
}
const stats = ds.stats.filter(r => r.season >= from && r.season <= to && r.week <= 17);

const usage = (r: StatRow) =>
  r.position === 'QB' ? r.attempts + r.carries
  : r.position === 'RB' ? r.carries + 1.5 * r.targets
  : r.targets;

// Season roles per team: rank players within position by usage per game played.
const seasonUse = new Map<string, { id: string; pos: Pos; team: string; season: number; use: number; n: number }>();
for (const r of stats) {
  const k = `${r.season}|${r.team}|${r.gsis_id}`;
  const s = seasonUse.get(k) ?? { id: r.gsis_id, pos: r.position, team: r.team, season: r.season, use: 0, n: 0 };
  s.use += usage(r); s.n++; seasonUse.set(k, s);
}
const role = new Map<string, string>();
const byTeamPos = new Map<string, typeof seasonUse extends Map<any, infer V> ? V[] : never>();
for (const s of seasonUse.values()) {
  if (s.n < 3) continue;
  const k = `${s.season}|${s.team}|${s.pos}`;
  (byTeamPos.get(k) ?? byTeamPos.set(k, []).get(k)!).push(s);
}
for (const [k, arr] of byTeamPos) {
  arr.sort((a, b) => b.use / b.n - a.use / a.n);
  arr.forEach((s, i) => role.set(`${s.season}|${s.team}|${s.id}`, `${s.pos}${i + 1}`));
}

// Role means.
const rolePts = new Map<string, number[]>();
for (const r of stats) {
  const rl = role.get(`${r.season}|${r.team}|${r.gsis_id}`);
  if (!rl) continue;
  (rolePts.get(rl) ?? rolePts.set(rl, []).get(rl)!).push(ppr(r));
}
console.log('role means', Object.fromEntries([...rolePts].filter(([k]) => /^(QB[12]|RB[1-3]|WR[1-4]|TE[12])$/.test(k))
  .sort().map(([k, v]) => [k, +mean(v).toFixed(2)])));

// Player-season aggregates for ratio work.
const ps = new Map<string, StatRow[]>();
for (const r of stats) (ps.get(`${r.season}|${r.gsis_id}`) ?? ps.set(`${r.season}|${r.gsis_id}`, []).get(`${r.season}|${r.gsis_id}`)!).push(r);
const teamImplied = new Map<string, number[]>();
for (const g of games) for (const t of [g.home_team, g.away_team]) {
  const it = impliedTotal(g, t); if (it == null) continue;
  (teamImplied.get(`${g.season}|${t}`) ?? teamImplied.set(`${g.season}|${t}`, []).get(`${g.season}|${t}`)!).push(it);
}

type Obs = { pos: Pos; pts: number; exp: number; lr: number; g: GameRow };
const obs: Obs[] = [];
for (const rows of ps.values()) {
  if (rows.length < 6) continue;
  const tot = rows.reduce((a, r) => a + ppr(r), 0);
  for (const r of rows) {
    const g = gameOf.get(`${r.season}|${r.week}|${r.team}`); if (!g) continue;
    const it = impliedTotal(g, r.team); const ti = teamImplied.get(`${r.season}|${r.team}`);
    if (it == null || !ti) continue;
    const exp = (tot - ppr(r)) / (rows.length - 1);
    if (exp < 4) continue;
    obs.push({ pos: r.position, pts: ppr(r), exp, lr: Math.log(it / mean(ti)), g });
  }
}

// Vegas elasticity: sum(pts) / sum(exp) as a function of implied/teamMean.
// Fit e in pts ~ exp * (it/mean)^e by grid search on squared error.
for (const pos of ['QB', 'RB', 'WR', 'TE'] as Pos[]) {
  const o = obs.filter(x => x.pos === pos);
  let best = 0, bestErr = Infinity;
  for (let e = 0; e <= 2.5; e += 0.05) {
    let err = 0; for (const x of o) err += (x.pts - x.exp * Math.exp(e * x.lr)) ** 2;
    if (err < bestErr) { bestErr = err; best = e; }
  }
  console.log(`vegas elasticity ${pos}: ${best.toFixed(2)}  (n=${o.length})`);
}

// Weather: ratio sum(pts)/sum(exp) by bucket, outdoor/open games with data,
// vs all indoor games as the reference.
const indoor = (g: GameRow) => g.roof === 'dome' || g.roof === 'closed';
for (const pos of ['QB', 'RB', 'WR', 'TE'] as Pos[]) {
  const o = obs.filter(x => x.pos === pos);
  const ratio = (xs: Obs[]) => xs.length ? (xs.reduce((a, x) => a + x.pts, 0) / xs.reduce((a, x) => a + x.exp, 0)) : NaN;
  const ref = ratio(o.filter(x => indoor(x.g)));
  const out = o.filter(x => !indoor(x.g) && x.g.wind != null && x.g.temp != null);
  const b = (f: (g: GameRow) => boolean) => { const xs = out.filter(x => f(x.g)); return `${(ratio(xs) / ref).toFixed(3)} (n=${xs.length})`; };
  console.log(`weather ${pos}: indoor ref ${ref.toFixed(3)} | outdoor all ${b(() => true)} | wind<10 ${b(g => g.wind! < 10)} | 10-14 ${b(g => g.wind! >= 10 && g.wind! < 15)} | 15-19 ${b(g => g.wind! >= 15 && g.wind! < 20)} | 20+ ${b(g => g.wind! >= 20)} | temp<=25 ${b(g => g.temp! <= 25)} | 26-39 ${b(g => g.temp! > 25 && g.temp! < 40)} | 40+ ${b(g => g.temp! >= 40)}`);
}
