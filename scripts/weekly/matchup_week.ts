// Live sanity run for model B: top N per position with notes.
//   WEEKLY_DATA=... node scripts/weekly/matchup_week.ts 2026 3 [N] [defense]
import { loadDataset, makeInput } from './harness.ts';
import { modelMatchup } from '../../supabase/functions/_shared/weekly/matchup.ts';

const [season = 2026, week = 3, n = 15] = process.argv.slice(2, 5).map(Number);
const focus = process.argv[5];
const ds = loadDataset();
const input = makeInput(ds, season, week, { live: true });
const pool = new Map(input.pool.map(p => [p.gsis_id, p]));
const rows = modelMatchup(input);
for (const pos of ['QB', 'RB', 'WR', 'TE']) {
  console.log(`\n${pos}`);
  rows.filter(r => r.position === pos).sort((a, b) => b.proj - a.proj).slice(0, n).forEach((r, i) => {
    const p = pool.get(r.gsis_id)!; const d = r.detail!;
    console.log(`${String(i + 1).padStart(2)} ${p.player_name.padEnd(22)} ${p.team.padEnd(3)} ${p.home ? 'vs' : '@ '} ${p.opponent.padEnd(3)} ${String(d.role).padEnd(4)} ${r.proj.toFixed(1).padStart(5)}  base ${d.baseline} x vegas ${d.vegas_f} (it ${d.implied}) x wx ${d.weather_f} + def ${d.def_adj}x${d.def_weight}  ${(r.notes ?? []).join(' | ')}`);
  });
}
if (focus) {
  console.log(`\nFacing ${focus}:`);
  rows.filter(r => pool.get(r.gsis_id)!.opponent === focus && (r.notes ?? []).some(x => x.includes('allowed')))
    .sort((a, b) => b.proj - a.proj).forEach(r => console.log(`  ${pool.get(r.gsis_id)!.player_name} (${r.detail!.role}) ${r.proj}: ${r.notes!.join(' | ')}`));
}
