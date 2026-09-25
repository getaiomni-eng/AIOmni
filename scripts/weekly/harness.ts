// Local backtest harness for the weekly ranking models.
//
// Loads the JSON dataset built by prep.py (path in WEEKLY_DATA), builds a
// leakage-safe WeekInput for any (season, week), and grades a model's output
// against what actually happened that week.
//
// GRADING. Per position, Spearman between projection and actual PPR points
// over a FIXED pool: players who (a) were in buildPool for that week, (b) rank
// inside the top K at their position by a neutral prior -- mean PPR over their
// last 8 games played -- and (c) actually recorded a stat line that week. The
// pool does not depend on the model being graded, so every model is scored
// on the same players. Players who were ruled out after the pool was built
// simply drop out of (c); that is a separate problem from ranking.
//
// Run with Node 24 (native TypeScript): node scripts/weekly/backtest.ts ...

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleInput, mean, POSITIONS, ppr } from '../../supabase/functions/_shared/weekly/common.ts';
import type {
  DepthRow, GameRow, InjuryRow, ModelRow, Pos, SnapRow, StatRow, StatusRow, WeekInput, WeeklyModel,
} from '../../supabase/functions/_shared/weekly/types.ts';

export const GRADE_K: Record<Pos, number> = { QB: 24, RB: 36, WR: 48, TE: 18 };

export interface Dataset {
  stats: StatRow[]; games: GameRow[]; snaps: SnapRow[]; injuries: InjuryRow[]; depth: DepthRow[];
  status: StatusRow[];
  draft: Record<string, { draft_round: number | null; draft_pick: number | null; rookie_season: number | null }>;
  market: { season: string; week: string; provider: string; gsis_id: string; position: string; pos_rank: string }[];
}

export function loadDataset(dir = process.env.WEEKLY_DATA ?? ''): Dataset {
  if (!dir) throw new Error('set WEEKLY_DATA to the prep.py output directory');
  const j = (n: string) => JSON.parse(readFileSync(join(dir, `${n}.json`), 'utf8'));
  const status = (j('status') as any[]).map(s => ({
    ...s, depth_chart_order: s.depth_chart_order === 'NULL' || s.depth_chart_order === '' ? null : Number(s.depth_chart_order),
    gsis_id: s.gsis_id === 'NULL' || s.gsis_id === '' ? null : s.gsis_id,
    injury_status: s.injury_status === 'NULL' || s.injury_status === '' ? null : s.injury_status,
    status: s.status === 'NULL' || s.status === '' ? null : s.status,
  }));
  return {
    stats: j('stats'), games: j('games'), snaps: j('snaps'), injuries: j('injuries'),
    depth: j('depth'), status, draft: j('draft'), market: j('market'),
  };
}

// Everything a model may see when ranking (season, week).
export function makeInput(ds: Dataset, season: number, week: number, opts: { live?: boolean } = {}): WeekInput {
  return assembleInput({ ...ds, status: opts.live ? ds.status : undefined }, season, week);
}

// ── grading ───────────────────────────────────────────────────────────────
function ranks(xs: number[]) {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r as number[];
}
export function spearman(a: number[], b: number[]) {
  if (a.length < 5) return NaN;
  const ra = ranks(a), rb = ranks(b);
  const ma = mean(ra), mb = mean(rb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

// The fixed grading pool for a week: gsis_id -> actual PPR, per position.
export function gradingPool(ds: Dataset, input: WeekInput) {
  const { season, week } = input;
  const actual = new Map<string, number>();
  for (const r of ds.stats) if (r.season === season && r.week === week) actual.set(r.gsis_id, ppr(r));
  const hist = new Map<string, number[]>();
  const sorted = [...input.stats].sort((a, b) => b.season - a.season || b.week - a.week);
  for (const r of sorted) {
    const a = hist.get(r.gsis_id) ?? [];
    if (a.length < 8) { a.push(ppr(r)); hist.set(r.gsis_id, a); }
  }
  const out = new Map<Pos, Map<string, number>>();
  for (const pos of POSITIONS) {
    const cands = input.pool
      .filter(p => p.position === pos && hist.has(p.gsis_id))
      .map(p => ({ id: p.gsis_id, prior: mean(hist.get(p.gsis_id)!) }))
      .sort((a, b) => b.prior - a.prior)
      .slice(0, GRADE_K[pos]);
    const m = new Map<string, number>();
    for (const c of cands) if (actual.has(c.id)) m.set(c.id, actual.get(c.id)!);
    out.set(pos, m);
  }
  return out;
}

export interface WeekGrade { season: number; week: number; pos: Pos; n: number; rho: number; top12: number }

export function grade(rows: ModelRow[], pool: Map<Pos, Map<string, number>>, season: number, week: number): WeekGrade[] {
  const proj = new Map(rows.map(r => [r.gsis_id, r.proj]));
  const out: WeekGrade[] = [];
  for (const pos of POSITIONS) {
    const m = pool.get(pos)!;
    const ids = [...m.keys()].filter(id => proj.has(id) && isFinite(proj.get(id)!));
    const p = ids.map(id => proj.get(id)!), a = ids.map(id => m.get(id)!);
    // top-12 hit rate: of the model's top 12 in the pool, how many finished top 12 in the pool.
    const byP = [...ids].sort((x, y) => proj.get(y)! - proj.get(x)!).slice(0, 12);
    const byA = new Set([...ids].sort((x, y) => m.get(y)! - m.get(x)!).slice(0, 12));
    out.push({ season, week, pos, n: ids.length, rho: spearman(p, a), top12: byP.filter(id => byA.has(id)).length / 12 });
  }
  return out;
}

// Market consensus as a pseudo-model (2026 only). Median position rank across
// a provider's experts; lower rank -> higher proj.
export function marketModel(ds: Dataset, provider: string): WeeklyModel {
  return (input) => {
    const ranksBy = new Map<string, number[]>();
    for (const m of ds.market) {
      if (Number(m.season) !== input.season || Number(m.week) !== input.week || m.provider !== provider) continue;
      const r = Number(m.pos_rank);
      if (!isFinite(r) || !m.gsis_id || m.gsis_id === 'NULL') continue;
      const a = ranksBy.get(m.gsis_id) ?? [];
      a.push(r); ranksBy.set(m.gsis_id, a);
    }
    const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    return input.pool.filter(p => ranksBy.has(p.gsis_id))
      .map(p => ({ gsis_id: p.gsis_id, position: p.position, proj: -med(ranksBy.get(p.gsis_id)!) }));
  };
}

// Neutral baseline: mean PPR over the last N games played (any season).
export function lastNModel(n: number): WeeklyModel {
  return (input) => {
    const hist = new Map<string, number[]>();
    const sorted = [...input.stats].sort((a, b) => b.season - a.season || b.week - a.week);
    for (const r of sorted) {
      const a = hist.get(r.gsis_id) ?? [];
      if (a.length < n) { a.push(ppr(r)); hist.set(r.gsis_id, a); }
    }
    return input.pool.map(p => ({ gsis_id: p.gsis_id, position: p.position, proj: hist.has(p.gsis_id) ? mean(hist.get(p.gsis_id)!) : 0 }));
  };
}

export function runBacktest(ds: Dataset, model: WeeklyModel, weeks: [number, number][]) {
  const all: WeekGrade[] = [];
  for (const [s, w] of weeks) {
    const input = makeInput(ds, s, w);
    const pool = gradingPool(ds, input);
    all.push(...grade(model(input), pool, s, w));
  }
  return all;
}

export function summarize(grades: WeekGrade[]) {
  const out: Record<string, { rho: number; top12: number; weeks: number }> = {};
  for (const pos of [...POSITIONS, 'ALL'] as const) {
    const g = grades.filter(x => (pos === 'ALL' || x.pos === pos) && isFinite(x.rho));
    out[pos] = { rho: +mean(g.map(x => x.rho)).toFixed(4), top12: +mean(g.map(x => x.top12)).toFixed(3), weeks: g.length };
  }
  return out;
}

export function weekRange(season: number, from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  for (let w = from; w <= to; w++) out.push([season, w]);
  return out;
}
