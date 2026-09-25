// Week-3 2026 (live pool) placement of named players, before vs after the
// fading prior-season prior in B and C.
import { loadDataset, makeInput } from './harness.ts';
import { positionRanks } from '../../supabase/functions/_shared/weekly/common.ts';
import { ensemble } from '../../supabase/functions/_shared/weekly/ensemble.ts';
import { makeMatchup } from '../../supabase/functions/_shared/weekly/matchup.ts';
import { makeContextModel } from '../../supabase/functions/_shared/weekly/context.ts';
import { modelRecency } from '../../supabase/functions/_shared/weekly/recency.ts';

const ds = loadDataset();
const input = makeInput(ds, 2026, 3, { live: true });
const names = process.argv.slice(2);
const ids = new Map(input.pool.map(p => [p.gsis_id, p]));
const run = (label: string, B: any, C: any) => {
  const A = modelRecency(input), b = B(input), c = C(input);
  const ens = ensemble(input.pool, { recency: A, matchup: b, context: c });
  const rb = positionRanks(b), rc = positionRanks(c);
  const byId = new Map(ens.map(e => [e.gsis_id, e]));
  for (const n of names) {
    const p = input.pool.find(x => x.player_name === n);
    if (!p) { console.log(label, n, 'not in pool'); continue; }
    const e = byId.get(p.gsis_id)!;
    const bd = b.find(r => r.gsis_id === p.gsis_id)!, cd = c.find(r => r.gsis_id === p.gsis_id)!;
    console.log(`${label.padEnd(6)} ${n.padEnd(16)} B ${p.position}${rb.get(p.gsis_id)} (${bd.proj.toFixed(1)}, role ${bd.detail?.role})  C ${p.position}${rc.get(p.gsis_id)} (${cd.proj.toFixed(1)})  ensemble ${p.position}${e.pos_rank}  [A ${e.ranks.recency}]`);
  }
};
run('before', makeMatchup({ kPrev: 0 }), makeContextModel({ kPrev: 0 }));
run('after', makeMatchup(), makeContextModel());
const ex = makeMatchup()(input).find(r => ids.get(r.gsis_id)?.player_name === names[0]);
console.log('\nB notes for', names[0], ex?.notes);
