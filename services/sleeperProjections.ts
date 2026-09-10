// Weekly point projections, read from Sleeper.
//
// Sleeper publishes projections at an UNDOCUMENTED endpoint that the public
// v1 API does not mention. It returns ~3,100 players with pts_ppr,
// pts_half_ppr and pts_std -- exactly the three formats the app already
// supports -- keyed on the same player_id the roster endpoints use, so it
// joins directly with no name matching.
//
// The Sleeper ADAPTER has always set `projected: undefined`, which is why the
// Coach answers matchup questions with "both projected totals show 0.0, so I
// can't call this on the numbers". Nothing needed building; it needed reading.
//
// Treated as best-effort throughout BECAUSE it is undocumented: it can change
// shape or disappear without notice, and when it does every caller must
// degrade to the behaviour it has today rather than break.

import { logCaught } from './util/logCaught';

export type ProjFormat = 'ppr' | 'half' | 'std';

const KEY: Record<ProjFormat, string> = {
  ppr:  'pts_ppr',
  half: 'pts_half_ppr',
  std:  'pts_std',
};

type Cache = { at: number; week: number; season: string; map: Map<string, Record<string, number>> };
let cache: Cache | null = null;
const TTL_MS = 30 * 60 * 1000;   // projections move during the week, not by the minute

/**
 * player_id -> { ppr, half, std } for one week.
 * Returns an empty map on any failure; callers must treat that as "no
 * projections available" and say so rather than showing zeros as though
 * they were real numbers.
 */
export async function fetchWeekProjections(season: string, week: number): Promise<Map<string, Record<string, number>>> {
  if (cache && cache.week === week && cache.season === season && Date.now() - cache.at < TTL_MS) {
    return cache.map;
  }
  try {
    const pos = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(p => `position[]=${p}`).join('&');
    const url = `https://api.sleeper.app/projections/nfl/${season}/${week}?season_type=regular&${pos}&order_by=pts_ppr`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`sleeper projections ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('unexpected projections shape');

    const map = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const id = r?.player_id != null ? String(r.player_id) : null;
      const st = r?.stats;
      if (!id || !st) continue;
      map.set(id, {
        ppr:  Number(st[KEY.ppr]  ?? 0),
        half: Number(st[KEY.half] ?? 0),
        std:  Number(st[KEY.std]  ?? 0),
      });
    }
    cache = { at: Date.now(), week, season, map };
    return map;
  } catch (e) {
    logCaught('sleeperProjections.fetch', e);
    return new Map();
  }
}

/** The projection for one player in one scoring format, or null if unknown. */
export function projectionFor(
  map: Map<string, Record<string, number>>,
  sleeperId: string | undefined | null,
  format: ProjFormat = 'ppr',
): number | null {
  if (!sleeperId) return null;
  const row = map.get(String(sleeperId));
  if (!row) return null;
  const v = row[format];
  return Number.isFinite(v) ? v : null;
}
