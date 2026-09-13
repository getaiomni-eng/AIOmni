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

    // `?? 0` here was inventing projections (fixed 2026-09-13). Sleeper
    // returns a row for every rostered player but publishes pts_ppr for only
    // the startable subset -- 470 of 3,304 in week 1 -- so the old default
    // wrote a confident 0.0 for the other 2,834.
    //
    // That defeated every guard downstream. projectionFor returned 0 rather
    // than null, so Number.isFinite(0) passed, so getMatchups' "refuse to
    // publish a partial sum" gate counted a hit for every player and summed
    // the zeros anyway. A real lineup came out as a 7.6-vs-13.8 projected
    // matchup, which reads as a live score rather than a broken projection.
    //
    // It is exactly the failure this file's own doc comment forbids: showing
    // zeros as though they were real numbers. An absent key is left absent,
    // and projectionFor already returns null for it. A genuine 0.0 is still
    // stored, because Sleeper sends a number there and omits the key
    // entirely when it has no projection -- the two are distinguishable.
    const num = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null;

    const map = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const id = r?.player_id != null ? String(r.player_id) : null;
      const st = r?.stats;
      if (!id || !st) continue;

      const vals: Record<string, number> = {};
      const ppr = num(st[KEY.ppr]);
      const half = num(st[KEY.half]);
      const std = num(st[KEY.std]);
      if (ppr  != null) vals.ppr  = ppr;
      if (half != null) vals.half = half;
      if (std  != null) vals.std  = std;

      // No published projection in any format: keep the player OUT of the
      // map entirely rather than storing an empty row that later reads as
      // "known, and worth nothing".
      if (Object.keys(vals).length === 0) continue;
      map.set(id, vals);
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
