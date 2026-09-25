// Tune the fading prior-season prior in models B (matchup) and C (context).
//
//   WEEKLY_DATA=... node scripts/weekly/prior_tune.ts
//
// Fit on 2023-2024 weeks 3-17, confirm on 2025 weeks 3-17 (held out), then
// 2026 weeks 1-2. Also reports weeks 1-6 of 2023-2025, where the prior does
// nearly all of its work.

import { gradingPool, grade, loadDataset, makeInput, summarize, weekRange, type WeekGrade } from './harness.ts';
import { makeMatchup, type MatchupParams } from '../../supabase/functions/_shared/weekly/matchup.ts';
import { makeContextModel, type ContextOpts } from '../../supabase/functions/_shared/weekly/context.ts';
import type { WeeklyModel } from '../../supabase/functions/_shared/weekly/types.ts';

const ds = loadDataset();
const sets: Record<string, [number, number][]> = {
  fit: [...weekRange(2023, 3, 17), ...weekRange(2024, 3, 17)],
  hold: weekRange(2025, 3, 17),
  early: [...weekRange(2023, 1, 6), ...weekRange(2024, 1, 6), ...weekRange(2025, 1, 6)],
  w26: [[2026, 1], [2026, 2]],
};
const cache = new Map<string, { input: ReturnType<typeof makeInput>; pool: ReturnType<typeof gradingPool> }>();
const get = (s: number, w: number) => {
  const k = `${s}|${w}`;
  let v = cache.get(k);
  if (!v) { const input = makeInput(ds, s, w); v = { input, pool: gradingPool(ds, input) }; cache.set(k, v); }
  return v;
};
export function score(model: WeeklyModel, set: string) {
  const g: WeekGrade[] = [];
  for (const [s, w] of sets[set]) { const { input, pool } = get(s, w); g.push(...grade(model(input), pool, s, w)); }
  return summarize(g);
}
const row = (m: WeeklyModel) => {
  const o: Record<string, number> = {};
  for (const set of Object.keys(sets)) o[set] = score(m, set).ALL.rho;
  return o;
};

const which = process.argv[2] ?? 'both';
const B = (o: Partial<MatchupParams>) => row(makeMatchup(o));
const C = (o: Partial<ContextOpts>) => row(makeContextModel(o));
if (which === 'B2') {
  const res: Record<string, Record<string, number>> = { base: B({}) };
  for (const kPrev of [10, 15, 20]) for (const fadeGames of [8, 10, 12, 16]) res[`k${kPrev} f${fadeGames}`] = B({ kPrev, fadeGames });
  for (const [k, f] of [[10, 8], [15, 10]] as const) {
    res[`k${k} f${f} R-target`] = B({ kPrev: k, fadeGames: f, prevRoles: true, prevRolesTargetOnly: true });
    res[`k${k} f${f} R-same`] = B({ kPrev: k, fadeGames: f, prevRoles: true, prevSameTeam: true });
    res[`k${k} f${f} R-target-same`] = B({ kPrev: k, fadeGames: f, prevRoles: true, prevRolesTargetOnly: true, prevSameTeam: true });
    res[`k${k} f${f} resid`] = B({ kPrev: k, fadeGames: f, prevResid: true });
    for (const kPrevOwn of [2, 8]) res[`k${k} f${f} own${kPrevOwn}`] = B({ kPrev: k, fadeGames: f, kPrevOwn });
  }
  console.table(res);
}
if (which === 'C2') {
  const res: Record<string, Record<string, number>> = { base: C({}) };
  for (const kPrev of [4, 6, 8]) for (const fadeGames of [8, 10, 12, 16]) res[`k${kPrev} f${fadeGames}`] = C({ kPrev, fadeGames });
  for (const kPrevOwn of [2, 8]) res[`k4 f8 own${kPrevOwn}`] = C({ kPrev: 4, fadeGames: 8, kPrevOwn });
  console.table(res);
}
