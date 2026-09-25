// Head-to-head vs the market on IDENTICAL players: only those the provider
// ranked AND in the grading pool. backtest.ts grades the market on its own
// subset, which is not a fair fight; this is.
//   WEEKLY_DATA=... node scripts/weekly/vs_market.ts 2026:1 2026:2
import { gradingPool, grade, loadDataset, makeInput, marketModel, summarize, type WeekGrade } from './harness.ts';
import { MODELS } from './models.ts';

const ds = loadDataset();
const weeks = process.argv.slice(2).map(a => a.split(':').map(Number) as [number, number]);
for (const provider of ['fantasypros', 'espn', 'sleeper']) {
  const acc: Record<string, WeekGrade[]> = {};
  for (const [s, w] of weeks) {
    const input = makeInput(ds, s, w);
    const mk = marketModel(ds, provider)(input);
    const ranked = new Set(mk.map(r => r.gsis_id));
    const pool = gradingPool(ds, input);
    for (const m of pool.values()) for (const id of [...m.keys()]) if (!ranked.has(id)) m.delete(id);
    const runs = { market: mk, old_board: marketModel(ds, 'aiomni')(input), ...Object.fromEntries(Object.entries(MODELS).map(([k, f]) => [k, f(input)])) };
    for (const [k, rows] of Object.entries(runs)) (acc[k] ??= []).push(...grade(rows, pool, s, w));
  }
  console.log(`\n== ${provider}, same players, ${weeks.map(w => w.join(':')).join(' ')}`);
  console.table(Object.fromEntries(Object.entries(acc).map(([k, g]) => {
    const sm = summarize(g);
    return [k, { QB: sm.QB.rho, RB: sm.RB.rho, WR: sm.WR.rho, TE: sm.TE.rho, ALL: sm.ALL.rho, top12: sm.ALL.top12 }];
  })));
}
