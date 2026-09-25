// Calibrate model C's environmental effects (travel, rest, weather) on 2021-2025.
//
// Unit: one team's offense in one game. Target: skill-position PPR (all
// players, and split QB / RB / WR+TE) minus what that offense and that
// defense produce/allow in their OTHER games that season (leave-one-out team
// and opponent effects). The residual is regressed on the game's conditions.
//
// Two versions of the question are reported:
//   vs team/opp LOO -- what model C needs, since C does not use Vegas
//   vs Vegas implied total -- whether the market already prices it
//
//   WEEKLY_DATA=... node scripts/weekly/context_calibrate.ts

import { loadDataset } from './harness.ts';
import { impliedTotal } from '../../supabase/functions/_shared/weekly/common.ts';
import { travelFeatures, weatherOf } from '../../supabase/functions/_shared/weekly/context.ts';
import type { GameRow } from '../../supabase/functions/_shared/weekly/types.ts';

const ds = loadDataset();
const games = ds.games.filter(g => g.season <= 2025 && g.home_score != null && g.week <= 18);
const gameByTeam = new Map<string, GameRow>();
for (const g of ds.games) { gameByTeam.set(`${g.season}|${g.week}|${g.home_team}`, g); gameByTeam.set(`${g.season}|${g.week}|${g.away_team}`, g); }

type Split = { all: number; QB: number; RB: number; REC: number };
const tg = new Map<string, Split>();
for (const r of ds.stats) {
  if (r.season > 2025) continue;
  const k = `${r.season}|${r.week}|${r.team}`;
  const t = tg.get(k) ?? { all: 0, QB: 0, RB: 0, REC: 0 };
  const p = r.fantasy_pts_ppr ?? 0;
  t.all += p; if (r.position === 'QB') t.QB += p; else if (r.position === 'RB') t.RB += p; else t.REC += p;
  tg.set(k, t);
}

interface Obs { season: number; team: string; opp: string; y: Split; x: Record<string, number>; implied: number | null }
const obs: Obs[] = [];
for (const g of games) {
  for (const team of [g.home_team, g.away_team]) {
    const opp = team === g.home_team ? g.away_team : g.home_team;
    const y = tg.get(`${g.season}|${g.week}|${team}`);
    if (!y) continue;
    const tf = travelFeatures(ds.games, g, team);
    const w = weatherOf(g, undefined);
    obs.push({
      season: g.season, team, opp, y, implied: impliedTotal(g, team),
      x: {
        home: tf.home ? 1 : 0, intl: tf.intl ? 1 : 0,
        dist1k: tf.distHome / 1000, east: Math.max(0, tf.tzShift), west: Math.max(0, -tf.tzShift),
        early: tf.bodyHour < 11 ? 1 : 0, late: tf.bodyHour >= 22 ? 1 : 0,
        short: tf.rest != null && tf.rest <= 5 ? 1 : 0, long: tf.rest != null && tf.rest >= 10 ? 1 : 0,
        road2: tf.secondRoad ? 1 : 0,
        oppShort: tf.oppRest != null && tf.oppRest <= 5 ? 1 : 0, oppLong: tf.oppRest != null && tf.oppRest >= 10 ? 1 : 0,
        indoor: w.indoor ? 1 : 0, wind15: !w.indoor && (w.wind ?? 0) >= 15 ? 1 : 0,
        windX: !w.indoor ? Math.max(0, (w.wind ?? 0) - 10) : 0,
        cold: !w.indoor && w.temp != null && w.temp <= 32 ? 1 : 0, frigid: !w.indoor && w.temp != null && w.temp <= 20 ? 1 : 0,
      },
    });
  }
}

// Leave-one-out offense and defense means per season, per split.
function looResid(key: keyof Split) {
  const off = new Map<string, number[]>(), def = new Map<string, number[]>(), lg = new Map<number, number[]>();
  for (const o of obs) {
    (off.get(`${o.season}|${o.team}`) ?? off.set(`${o.season}|${o.team}`, []).get(`${o.season}|${o.team}`)!).push(o.y[key]);
    (def.get(`${o.season}|${o.opp}`) ?? def.set(`${o.season}|${o.opp}`, []).get(`${o.season}|${o.opp}`)!).push(o.y[key]);
    (lg.get(o.season) ?? lg.set(o.season, []).get(o.season)!).push(o.y[key]);
  }
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  return obs.map(o => {
    const a = off.get(`${o.season}|${o.team}`)!, d = def.get(`${o.season}|${o.opp}`)!, l = lg.get(o.season)!;
    const offM = (sum(a) - o.y[key]) / (a.length - 1), defM = (sum(d) - o.y[key]) / (d.length - 1);
    const lgM = (sum(l) - o.y[key]) / (l.length - 1);
    return o.y[key] - (offM + defM - lgM);
  });
}

function ols(y: number[], X: number[][], names: string[]) {
  const n = y.length, p = X[0].length;
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0)), Xty = new Array(p).fill(0);
  for (let i = 0; i < n; i++) for (let a = 0; a < p; a++) { Xty[a] += X[i][a] * y[i]; for (let b = 0; b < p; b++) XtX[a][b] += X[i][a] * X[i][b]; }
  // invert XtX (Gauss-Jordan)
  const M = XtX.map((r, i) => [...r, ...Array.from({ length: p }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < p; c++) {
    let piv = c; for (let r = c + 1; r < p; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c]; for (let j = 0; j < 2 * p; j++) M[c][j] /= d;
    for (let r = 0; r < p; r++) if (r !== c) { const f = M[r][c]; for (let j = 0; j < 2 * p; j++) M[r][j] -= f * M[c][j]; }
  }
  const inv = M.map(r => r.slice(p));
  const beta = inv.map(r => r.reduce((s, v, j) => s + v * Xty[j], 0));
  let sse = 0; for (let i = 0; i < n; i++) { const f = X[i].reduce((s, v, j) => s + v * beta[j], 0); sse += (y[i] - f) ** 2; }
  const s2 = sse / (n - p);
  return names.map((nm, j) => ({ term: nm, coef: +beta[j].toFixed(3), se: +Math.sqrt(s2 * inv[j][j]).toFixed(3), t: +(beta[j] / Math.sqrt(s2 * inv[j][j])).toFixed(2) }));
}

const travelTerms = ['home', 'intl', 'dist1k', 'east', 'west', 'early', 'short', 'long', 'road2', 'oppLong'];  // 'late' never occurs; oppShort is collinear with short (TNF)
const weatherTerms = ['indoor', 'windX', 'cold', 'frigid'];
const terms = [...travelTerms, ...weatherTerms];
const X = obs.map(o => [1, ...terms.map(t => o.x[t])]);
const names = ['const', ...terms];

const meanOf = (k: keyof Split) => obs.reduce((s, o) => s + o.y[k], 0) / obs.length;
console.log('team-games', obs.length, 'mean skill PPR', meanOf('all').toFixed(1), 'QB', meanOf('QB').toFixed(1), 'RB', meanOf('RB').toFixed(1), 'REC', meanOf('REC').toFixed(1));
console.log('counts', Object.fromEntries(terms.map(t => [t, obs.filter(o => o.x[t] > 0).length])));

for (const key of ['all', 'QB', 'RB', 'REC'] as const) {
  console.log(`\n== ${key}: residual vs team/opp leave-one-out`);
  console.table(ols(looResid(key), X, names));
}

// Does Vegas already price it? residual of team PPR on implied total.
const withV = obs.filter(o => o.implied != null);
const yv = withV.map(o => o.y.all), iv = withV.map(o => o.implied!);
const mi = iv.reduce((a, b) => a + b, 0) / iv.length, my = yv.reduce((a, b) => a + b, 0) / yv.length;
const b = iv.reduce((s, v, i) => s + (v - mi) * (yv[i] - my), 0) / iv.reduce((s, v) => s + (v - mi) ** 2, 0);
console.log(`\n== all: residual vs Vegas (PPR = ${(my - b * mi).toFixed(1)} + ${b.toFixed(2)} * implied)`);
console.table(ols(withV.map((o, i) => yv[i] - (my + b * (iv[i] - mi))), withV.map(o => [1, ...terms.map(t => o.x[t])]), names));

// Shrunk constants for context.ts: coef * max(0, 1 - 4/t^2). Anything under
// |t| = 2 goes to exactly zero; roughly 40 terms are tested here, so a single
// t of 2 is what chance alone produces.
const shrunk: Record<string, Record<string, number>> = {};
for (const key of ['QB', 'RB', 'REC'] as const) {
  const res = ols(looResid(key), X, names);
  shrunk[key] = Object.fromEntries(res.filter(r => r.term !== 'const')
    .map(r => [r.term, +(r.coef * Math.max(0, 1 - 4 / (r.t * r.t))).toFixed(3)]));
  shrunk[key].mean = +meanOf(key).toFixed(2);
}
console.log('\nSHRUNK', JSON.stringify(shrunk));
