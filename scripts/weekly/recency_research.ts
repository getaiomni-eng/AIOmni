// Research sweep for model A (recency). Fits on 2023-2024, confirms on 2025.
//
//   WEEKLY_DATA=... node --no-warnings scripts/weekly/recency_research.ts [grid|windows|spikes]

import { gradingPool, grade, loadDataset, makeInput, summarize, weekRange, lastNModel, type WeekGrade } from './harness.ts';
import { makeRecency, type RecencyConfig } from '../../supabase/functions/_shared/weekly/recency.ts';
import type { WeekInput, WeeklyModel } from '../../supabase/functions/_shared/weekly/types.ts';

const ds = loadDataset();
const mode = process.argv[2] ?? 'grid';
const TRAIN = [2023, 2024].flatMap(s => weekRange(s, 3, 17));
const TEST = weekRange(2025, 3, 17);
const LIVE: [number, number][] = [[2026, 1], [2026, 2]];

// Build inputs and grading pools once; reuse across configs.
const cache = new Map<string, { input: WeekInput; pool: ReturnType<typeof gradingPool> }>();
const get = (s: number, w: number) => {
  const k = `${s}|${w}`;
  if (!cache.has(k)) { const input = makeInput(ds, s, w); cache.set(k, { input, pool: gradingPool(ds, input) }); }
  return cache.get(k)!;
};
const run = (m: WeeklyModel, weeks: [number, number][]) => {
  const g: WeekGrade[] = [];
  for (const [s, w] of weeks) { const c = get(s, w); g.push(...grade(m(c.input), c.pool, s, w)); }
  return summarize(g);
};
const fmt = (r: ReturnType<typeof summarize>) =>
  ['QB', 'RB', 'WR', 'TE', 'ALL'].map(p => `${p} ${r[p].rho.toFixed(3)}`).join('  ');

if (mode === 'windows') {
  // L5 vs L7 vs blends, raw PPR (alpha=1) and usage-mixed, no spikes.
  for (const alpha of [1, 0.4]) {
    for (const w5 of [1, 0, 0.3, 0.5, 0.7]) {
      const m = makeRecency({ alpha, w5, spikes: false });
      console.log(`alpha=${alpha} w5=${w5}  TRAIN ${fmt(run(m, TRAIN))}\n${' '.repeat(16)}TEST  ${fmt(run(m, TEST))}\n${' '.repeat(16)}2026  ${fmt(run(m, LIVE))}`);
    }
  }
  for (const n of [5, 7, 8]) console.log(`baseline L${n}  TRAIN ${fmt(run(lastNModel(n), TRAIN))}\n              TEST  ${fmt(run(lastNModel(n), TEST))}\n              2026  ${fmt(run(lastNModel(n), LIVE))}`);
}

if (mode === 'grid') {
  const res: { cfg: Partial<RecencyConfig>; train: number }[] = [];
  for (const alpha of [0.2, 0.3, 0.4, 0.5, 0.6])
    for (const w5 of [0, 0.2, 0.3, 0.5])
      for (const kPrior of [0.5, 1, 1.5, 2.5]) {
        const cfg = { alpha, w5, kPrior, spikes: false };
        res.push({ cfg, train: run(makeRecency(cfg), TRAIN).ALL.rho });
      }
  res.sort((a, b) => b.train - a.train);
  for (const r of res.slice(0, 8)) console.log(JSON.stringify(r.cfg), r.train.toFixed(4), 'TEST', run(makeRecency(r.cfg), TEST).ALL.rho.toFixed(4));
}

if (mode === 'spikes') {
  const base = JSON.parse(process.argv[3] ?? '{}');
  const off = makeRecency({ ...base, spikes: false });
  console.log(`spikes OFF   TRAIN ${fmt(run(off, TRAIN))}\n             TEST  ${fmt(run(off, TEST))}\n             2026  ${fmt(run(off, LIVE))}`);
  for (const wGone of [0, 0.35, 0.6])
    for (const spikeMult of [1.4, 1.6, 2.0])
      for (const dropEarlyExit of [true, false]) {
        const m = makeRecency({ ...base, spikes: true, wGone, spikeMult, dropEarlyExit });
        console.log(`wGone=${wGone} mult=${spikeMult} drop=${dropEarlyExit}  TRAIN ${fmt(run(m, TRAIN))}  |  TEST ${fmt(run(m, TEST))}`);
      }
}
