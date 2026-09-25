// Print model C's live board for a week: top N per position with notes.
//   WEEKLY_DATA=... node scripts/weekly/context_live.ts [season] [week] [N]
import { loadDataset, makeInput } from './harness.ts';
import { modelContext } from '../../supabase/functions/_shared/weekly/context.ts';
const [S = '2026', W = '3', N = '15'] = process.argv.slice(2);
const ds = loadDataset();
const input = makeInput(ds, +S, +W, { live: true });
const rows = modelContext(input);
const byId = new Map(input.pool.map(p => [p.gsis_id, p]));
for (const pos of ['QB', 'RB', 'WR', 'TE']) {
  console.log(`\n${pos}`);
  rows.filter(r => r.position === pos).sort((a, b) => b.proj - a.proj).slice(0, +N).forEach((r, i) => {
    const p = byId.get(r.gsis_id)!; const d = r.detail!;
    console.log(`${String(i + 1).padStart(2)} ${p.player_name.padEnd(22)} ${p.team.padEnd(3)} ${p.home ? 'vs' : '@ '} ${p.opponent.padEnd(3)} ${r.proj.toFixed(1).padStart(5)}  g${d.games} base ${d.base} env ${((d.travel_mult as number) * (d.weather_mult as number)).toFixed(3)} opp ${d.opp_mult}${p.injury_status ? ' [' + p.injury_status + ']' : ''}${r.notes?.length ? '  | ' + r.notes.join(' | ') : ''}`);
  });
}
console.log('\nBAL @ DAL (Rio):');
for (const r of rows) { const p = byId.get(r.gsis_id)!; if ((p.team === 'BAL' || p.team === 'DAL') && r.proj > 8) console.log(`  ${p.player_name} ${p.team} ${r.proj.toFixed(1)} ${JSON.stringify({ miles: r.detail!.miles, tz: r.detail!.tz_shift, body: r.detail!.body_clock, rest: r.detail!.rest, home: r.detail!.home, travel: r.detail!.travel_mult, weather: r.detail!.weather_mult })}`); }
