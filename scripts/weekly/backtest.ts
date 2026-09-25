// Backtest the weekly models.
//
//   WEEKLY_DATA=/path/to/data node scripts/weekly/backtest.ts baselines
//   WEEKLY_DATA=... node scripts/weekly/backtest.ts <modelName> [season:from-to ...]
//
// Default windows: 2023-2025 weeks 3-17 (week 18 excluded: rested starters),
// plus 2026 weeks 1-2 where the market can be compared.

import {
  lastNModel, loadDataset, marketModel, runBacktest, summarize, weekRange,
} from './harness.ts';
import { MODELS } from './models.ts';
import type { WeeklyModel } from '../../supabase/functions/_shared/weekly/types.ts';

const [name = 'baselines', ...windows] = process.argv.slice(2);
const ds = loadDataset();

const parse = (w: string) => {
  const [s, r] = w.split(':');
  const [a, b] = (r ?? '3-17').split('-').map(Number);
  return weekRange(Number(s), a, b ?? a);
};
const hist = windows.length ? windows.flatMap(parse) : [2023, 2024, 2025].flatMap(s => weekRange(s, 3, 17));
const live: [number, number][] = [[2026, 1], [2026, 2]];

const models: Record<string, WeeklyModel> = name === 'baselines'
  ? { L3: lastNModel(3), L5: lastNModel(5), L8: lastNModel(8) }
  : name === 'all' ? { ...MODELS } : { [name]: MODELS[name] };
if (Object.values(models).some(m => !m)) throw new Error(`unknown model ${name}; have ${Object.keys(MODELS).join(', ')}`);

for (const [k, m] of Object.entries(models)) {
  console.log(`\n== ${k}  history ${hist.length} weeks`);
  console.table(summarize(runBacktest(ds, m, hist)));
  console.log(`== ${k}  2026 wk1-2`);
  console.table(summarize(runBacktest(ds, m, live)));
}
if (name === 'baselines' || name === 'all') {
  for (const p of ['fantasypros', 'espn', 'sleeper']) {
    console.log(`\n== market:${p}  2026 wk1-2 (only players the market ranked)`);
    console.table(summarize(runBacktest(ds, marketModel(ds, p), live)));
  }
}
