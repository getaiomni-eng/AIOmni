// Tune and ablate model C (context).
//
//   tune    2023 + 2024 weeks 3-17, each run as if it were the live season
//   test    2025 weeks 3-17 (untouched by tuning) + 2026 week 2
//   market  2026 week 2, graded only on players the market provider ranked,
//           so every row of that table is scored on the same players
//
//   WEEKLY_DATA=... node scripts/weekly/context_tune.ts

import { gradingPool, grade, lastNModel, loadDataset, makeInput, marketModel, summarize, weekRange } from './harness.ts';
import { makeContextModel, DEFAULT_OPTS, type ContextOpts } from '../../supabase/functions/_shared/weekly/context.ts';
import type { Pos, WeekInput, WeeklyModel } from '../../supabase/functions/_shared/weekly/types.ts';

const ds = loadDataset();
type Wk = { input: WeekInput; pool: ReturnType<typeof gradingPool> };
const cache = new Map<string, Wk>();
const wk = (s: number, w: number): Wk => {
  const k = `${s}|${w}`;
  if (!cache.has(k)) { const input = makeInput(ds, s, w); cache.set(k, { input, pool: gradingPool(ds, input) }); }
  return cache.get(k)!;
};
const TUNE = [...weekRange(2023, 3, 17), ...weekRange(2024, 3, 17)];
const TEST = weekRange(2025, 3, 17);
const LIVE: [number, number][] = [[2026, 2]];

function evalOn(model: WeeklyModel, weeks: [number, number][], restrict?: WeeklyModel) {
  const g = weeks.flatMap(([s, w]) => {
    const { input, pool } = wk(s, w);
    let p = pool;
    if (restrict) {
      const ids = new Set(restrict(input).map(r => r.gsis_id));
      p = new Map([...pool].map(([pos, m]) => [pos, new Map([...m].filter(([id]) => ids.has(id)))])) as typeof pool;
    }
    return grade(model(input), p, s, w);
  });
  return summarize(g);
}
const score = (m: WeeklyModel, weeks = TUNE) => evalOn(m, weeks);

// Coordinate descent on the tuning seasons, per position for alpha.
let best: ContextOpts = { ...DEFAULT_OPTS, alpha: { ...DEFAULT_OPTS.alpha } };
const allRho = (o: ContextOpts) => score(makeContextModel(o)).ALL.rho;
console.log('start', allRho(best));
for (let pass = 0; pass < 2; pass++) {
  for (const pos of ['QB', 'RB', 'WR', 'TE'] as Pos[]) {
    let bv = -1, ba = best.alpha[pos];
    for (const a of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const r = score(makeContextModel({ ...best, alpha: { ...best.alpha, [pos]: a } }))[pos].rho;
      if (r > bv) { bv = r; ba = a; }
    }
    best = { ...best, alpha: { ...best.alpha, [pos]: ba } };
  }
  for (const [key, vals] of [['decay', [1, 0.9, 0.8, 0.7, 0.6]], ['kPrior', [0.25, 0.5, 1, 2, 3]], ['kDef', [1, 2, 4, 8, 16]], ['kOff', [0.5, 1, 2, 4]]] as const) {
    let bv = -1, bx = best[key];
    for (const v of vals) { const r = allRho({ ...best, [key]: v }); if (r > bv) { bv = r; bx = v; } }
    best = { ...best, [key]: bx };
  }
  console.log(`pass ${pass}`, JSON.stringify(best), allRho(best));
}

const variants: Record<string, WeeklyModel> = {
  'C full': makeContextModel(best),
  'C - travel': makeContextModel({ ...best, travel: false }),
  'C - weather': makeContextModel({ ...best, weather: 'off' }),
  'C weather=shared (weather.ts)': makeContextModel({ ...best, weather: 'shared' }),
  'C - travel - weather': makeContextModel({ ...best, travel: false, weather: 'off' }),
  'C - opp': makeContextModel({ ...best, opp: false }),
  'C - usage (ppg only)': makeContextModel({ ...best, usage: false }),
  'cur-season ppg only': makeContextModel({ ...best, usage: false, opp: false, travel: false, weather: 'off', decay: 1 }),
  'L8 (uses prior season)': lastNModel(8),
};
const row = (s: ReturnType<typeof summarize>) => Object.fromEntries(['QB', 'RB', 'WR', 'TE', 'ALL'].map(p => [p, s[p].rho]));
for (const [label, weeks] of [['TUNE 2023-24', TUNE], ['TEST 2025', TEST], ['2026 wk2', LIVE]] as const) {
  console.log(`\n== ${label}: Spearman`);
  console.table(Object.fromEntries(Object.entries(variants).map(([k, m]) => [k, row(evalOn(m, weeks as [number, number][]))])));
}
console.log('\n== TEST 2025 top-12 hit rate');
console.table(Object.fromEntries(['C full', 'C - travel - weather', 'L8 (uses prior season)'].map(k => [k, Object.fromEntries(['QB', 'RB', 'WR', 'TE', 'ALL'].map(p => [p, evalOn(variants[k], TEST)[p].top12]))])));

console.log('\n== 2026 wk2 vs market, same players (only those the provider ranked)');
for (const prov of ['fantasypros', 'espn', 'sleeper']) {
  const mk = marketModel(ds, prov);
  console.table({
    [`${prov}`]: row(evalOn(mk, LIVE, mk)),
    [`C full on ${prov} players`]: row(evalOn(variants['C full'], LIVE, mk)),
    [`L8 on ${prov} players`]: row(evalOn(variants['L8 (uses prior season)'], LIVE, mk)),
  });
}
console.log('\nBEST', JSON.stringify(best));
