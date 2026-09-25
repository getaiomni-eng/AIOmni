// Tune model B (matchup) on 2022-2024, report 2025 (held out) and 2026 wk2,
// against the L8 baseline and an ablation without the defense transfer.
//
//   WEEKLY_DATA=... node scripts/weekly/matchup_tune.ts [grid]

import { lastNModel, loadDataset, marketModel, runBacktest, summarize, weekRange } from './harness.ts';
import { makeMatchup, type MatchupParams } from '../../supabase/functions/_shared/weekly/matchup.ts';
import type { WeeklyModel } from '../../supabase/functions/_shared/weekly/types.ts';

const ds = loadDataset();
const tuneWeeks = [2022, 2023, 2024].flatMap(s => weekRange(s, 3, 17));
const testWeeks = weekRange(2025, 3, 17);
const live: [number, number][] = [[2026, 2]];
const all = (m: WeeklyModel, weeks: [number, number][]) => summarize(runBacktest(ds, m, weeks)).ALL.rho;
const table = (m: WeeklyModel, weeks: [number, number][]) => {
  const s = summarize(runBacktest(ds, m, weeks));
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, `${v.rho.toFixed(3)} / ${v.top12.toFixed(2)}`]));
};

if (process.argv[2] === 'grid') {
  const res: { p: Partial<MatchupParams>; rho: number }[] = [];
  for (const kBase of [1, 2, 3, 5])
    for (const kRole of [2, 4, 8])
      for (const kPos of [4, 8, 16])
        for (const defWeight of [0.5, 1]) {
          const p = { kBase, kRole, kPos, defWeight };
          res.push({ p, rho: all(makeMatchup(p), tuneWeeks) });
        }
  res.sort((a, b) => b.rho - a.rho);
  console.log('top configs on 2022-2024:');
  for (const r of res.slice(0, 10)) console.log(r.rho.toFixed(4), JSON.stringify(r.p));
  process.exit(0);
}

const params: Partial<MatchupParams> = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const variants: Record<string, WeeklyModel> = {
  'L8 baseline': lastNModel(8),
  'matchup': makeMatchup(params),
  'matchup, no defense (ablation)': makeMatchup({ ...params, defWeight: 0 }),
  'matchup, 1 pass': makeMatchup({ ...params, passes: 1 }),
};
for (const [name, m] of Object.entries(variants)) {
  console.log(`\n== ${name}   (rho / top12)`);
  console.table({ 'tune 2022-24': table(m, tuneWeeks), 'test 2025': table(m, testWeeks), '2026 wk2': table(m, live) });
}

// Market on the same players: grade every model only on players FantasyPros ranked.
for (const prov of ['fantasypros', 'espn', 'sleeper']) {
  const mk = marketModel(ds, prov);
  const only = (m: WeeklyModel): WeeklyModel => (input) => {
    const ids = new Set(mk(input).map(r => r.gsis_id));
    return m(input).filter(r => ids.has(r.gsis_id));
  };
  console.log(`\n== 2026 wk2, only players ${prov} ranked (rho / top12)`);
  console.table({
    [prov]: table(mk, live),
    matchup: table(only(makeMatchup(params)), live),
    'L8': table(only(lastNModel(8)), live),
  });
}
