// Where does model B's edge come from? Ablations on tune (2022-24) and test (2025),
// plus early (wk3-9) vs late (wk10-17) for the defense transfer.
import { loadDataset, runBacktest, summarize, weekRange } from './harness.ts';
import { makeMatchup, type MatchupParams } from '../../supabase/functions/_shared/weekly/matchup.ts';

const ds = loadDataset();
const base: Partial<MatchupParams> = JSON.parse(process.argv[2] ?? '{"kBase":3,"kRole":8,"kPos":8,"defWeight":0.5}');
const W = {
  'tune22-24': [2022, 2023, 2024].flatMap(s => weekRange(s, 3, 17)),
  'test25': weekRange(2025, 3, 17),
  'early3-9': [2022, 2023, 2024, 2025].flatMap(s => weekRange(s, 3, 9)),
  'late10-17': [2022, 2023, 2024, 2025].flatMap(s => weekRange(s, 10, 17)),
} as Record<string, [number, number][]>;
const V: Record<string, Partial<MatchupParams>> = {
  full: base,
  'no defense': { ...base, defWeight: 0 },
  'no vegas': { ...base, vegas: false },
  'no weather': { ...base, weather: false },
  'def position-level only': { ...base, kRole: 1000 },
  'def QB only': { ...base, defPos: { QB: 1, RB: 0, WR: 0, TE: 0 } },
  'def QB+RB': { ...base, defPos: { QB: 1, RB: 1, WR: 0, TE: 0 } },
  'def full weight': { ...base, defWeight: 1 },
};
const rows: Record<string, Record<string, string>> = {};
for (const [n, p] of Object.entries(V)) {
  rows[n] = {};
  for (const [wn, ws] of Object.entries(W)) {
    const s = summarize(runBacktest(ds, makeMatchup(p), ws));
    rows[n][wn] = `${s.ALL.rho.toFixed(3)} (QB ${s.QB.rho.toFixed(2)} RB ${s.RB.rho.toFixed(2)} WR ${s.WR.rho.toFixed(2)} TE ${s.TE.rho.toFixed(2)})`;
  }
}
console.table(rows);
