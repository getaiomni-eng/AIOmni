import { loadDataset, runBacktest, summarize, weekRange } from './harness.ts';
import { makeMatchup, type MatchupParams } from '../../supabase/functions/_shared/weekly/matchup.ts';
const ds = loadDataset();
const W = { tune: [2022, 2023, 2024].flatMap(s => weekRange(s, 3, 17)), test25: weekRange(2025, 3, 17), wk2026: [[2026, 2]] } as Record<string, [number, number][]>;
const base = { kBase: 3, kRole: 8, kPos: 8 };
const V: Record<string, Partial<MatchupParams>> = {
  'QB only w.5': { ...base, defWeight: 0.5, defPos: { QB: 1, RB: 0, WR: 0, TE: 0 } },
  'QB only w1': { ...base, defWeight: 1, defPos: { QB: 1, RB: 0, WR: 0, TE: 0 } },
  'QB w1, WR .25': { ...base, defWeight: 1, defPos: { QB: 1, RB: 0, WR: 0.25, TE: 0 } },
  'QB only w1 kBase2': { ...base, kBase: 2, defWeight: 1, defPos: { QB: 1, RB: 0, WR: 0, TE: 0 } },
  'QB only w1 kBase5': { ...base, kBase: 5, defWeight: 1, defPos: { QB: 1, RB: 0, WR: 0, TE: 0 } },
  'QB only w1 roleChange1': { ...base, roleChange: 1, defWeight: 1, defPos: { QB: 1, RB: 0, WR: 0, TE: 0 } },
  'QB only w1 roleChange0': { ...base, roleChange: 0, defWeight: 1, defPos: { QB: 1, RB: 0, WR: 0, TE: 0 } },
};
const rows: Record<string, Record<string, string>> = {};
for (const [n, p] of Object.entries(V)) {
  rows[n] = {};
  for (const [wn, ws] of Object.entries(W)) {
    const s = summarize(runBacktest(ds, makeMatchup(p), ws));
    rows[n][wn] = `${s.ALL.rho.toFixed(3)} QB ${s.QB.rho.toFixed(3)}`;
  }
}
console.table(rows);
