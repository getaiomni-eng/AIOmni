// Verifies every stadium_id in the games data is in STADIUMS and every team has a home venue.
import { loadDataset } from './harness.ts';
import { STADIUMS, HOME_STADIUM, kickoffUtc, utcOffset } from '../../supabase/functions/_shared/weekly/stadiums.ts';
const ds = loadDataset();
const missing = new Set<string>();
for (const g of ds.games) {
  if (!STADIUMS[g.stadium_id]) missing.add(g.stadium_id);
  for (const t of [g.home_team, g.away_team]) if (!HOME_STADIUM[t]) missing.add('team:' + t);
}
console.log('missing', [...missing]);
const k = kickoffUtc('2026-09-27', '13:00'); console.log(k.toISOString(), utcOffset('America/Phoenix', k), utcOffset('America/Los_Angeles', k), utcOffset('America/Sao_Paulo', k));
const k2 = kickoffUtc('2025-12-07', '13:00'); console.log(k2.toISOString(), utcOffset('Europe/London', k2));
