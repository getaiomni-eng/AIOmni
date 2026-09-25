// Weather adjustment for one game, per position. Pure; shared by the weekly
// models (matchup, context).
//
//   weatherAdjust(game: GameRow, forecast?: Forecast | null): WeatherAdj
//
// Returns a MULTIPLIER per position, relative to that player's own average
// across all venues (1 = no effect), plus a short note and where the reading
// came from. Prefers the live kickoff forecast; falls back to the kickoff
// temp/wind nflverse records on played games (the backtest proxy for a
// forecast). Domes and closed roofs are indoor. A null roof with no forecast
// (retractable or unknown venue) is treated as neutral rather than guessed.
//
// CALIBRATION (scripts/weekly/matchup_calibrate.ts, 2021-2024 player-games,
// actual PPR / the player's own other-game average, outdoor games with a
// recorded reading, relative to calm (<10 mph) outdoor games):
//
//   wind      10-14    15-19    20+          cold   <=25F   26-39F
//   QB        0.94     0.84     0.92 (n=26)          0.88    0.96
//   WR        0.96     0.91     0.93 (n=81)          0.90    0.99
//   TE        0.99     0.98     0.63 (n=27)          0.95    0.89
//   RB        1.01     0.83     1.01 (n=56)          1.00    1.03
//
// The table below is that, smoothed to be monotone and pulled toward 1 where
// the sample is thin: 20+ mph and the RB/TE rows are mostly noise and are
// deliberately damped. Indoor games ran +6% for QBs and +4% for WRs against
// calm outdoor games; half of that is kept, because dome games are mostly
// home games for dome teams and home advantage is tangled up in it.
//
// Precipitation is NOT calibrated: nflverse records no precipitation on
// played games. The live forecast carries it; its effect is kept small.

import { STADIUMS } from './stadiums.ts';
import type { Forecast, GameRow, Pos } from './types.ts';

export interface WeatherAdj {
  factor: Record<Pos, number>;
  note: string | null;
  source: 'forecast' | 'kickoff' | 'indoor' | 'none';
  wind: number | null; temp: number | null; precip: boolean | null;
}

const ONE: Record<Pos, number> = { QB: 1, RB: 1, WR: 1, TE: 1 };
const INDOOR: Record<Pos, number> = { QB: 1.03, RB: 1, WR: 1.02, TE: 1 };
const WIND: [number, Record<Pos, number>][] = [      // [min mph, factor], highest first
  [20, { QB: 0.85, RB: 1.0, WR: 0.89, TE: 0.95 }],
  [15, { QB: 0.87, RB: 1.0, WR: 0.91, TE: 0.97 }],
  [10, { QB: 0.95, RB: 1.0, WR: 0.96, TE: 0.99 }],
];
const COLD: [number, Record<Pos, number>][] = [      // [max temp F, factor], coldest first
  [25, { QB: 0.92, RB: 1.0, WR: 0.93, TE: 0.97 }],
  [39, { QB: 0.97, RB: 1.0, WR: 0.99, TE: 0.98 }],
];
const PRECIP: Record<Pos, number> = { QB: 0.97, RB: 1.02, WR: 0.97, TE: 0.98 };

// The venue decides the roof, not the game row. nflverse labels the MCG, Stade
// de France and Allianz Arena "dome" (all open-air) and leaves retractable
// roofs blank until the game is played -- so a live forecast would have been
// applied inside Houston or Indianapolis with the roof shut. A retractable
// roof keeps its recorded open/closed on played games and is assumed closed
// before kickoff, when it closes for exactly the weather that would matter.
function venueRoof(game: GameRow): string | null {
  const v = STADIUMS[game.stadium_id];
  if (!v) return game.roof;
  if (v.roof === 'dome') return 'dome';
  if (v.roof === 'outdoors') return 'outdoors';
  return game.roof === 'open' ? 'open' : 'closed';
}

export function weatherAdjust(game: GameRow, forecast?: Forecast | null): WeatherAdj {
  const roof = venueRoof(game);
  if (roof === 'dome' || roof === 'closed') {
    return { factor: { ...INDOOR }, note: null, source: 'indoor', wind: null, temp: null, precip: null };
  }
  const src = forecast ? 'forecast' : (game.wind != null || game.temp != null) ? 'kickoff' : 'none';
  if (src === 'none' || (roof == null && !forecast)) {
    return { factor: { ...ONE }, note: null, source: 'none', wind: null, temp: null, precip: null };
  }
  const wind = forecast ? forecast.wind : game.wind;
  const temp = forecast ? forecast.temp : game.temp;
  const precip = forecast ? forecast.precip : null;
  const f: Record<Pos, number> = { ...ONE };
  const parts: string[] = [];
  const w = wind != null ? WIND.find(([min]) => wind >= min) : undefined;
  if (w) { for (const p of Object.keys(f) as Pos[]) f[p] *= w[1][p]; parts.push(`${Math.round(wind!)} mph wind`); }
  const c = temp != null ? COLD.find(([max]) => temp <= max) : undefined;
  if (c) { for (const p of Object.keys(f) as Pos[]) f[p] *= c[1][p]; parts.push(`${Math.round(temp!)}F`); }
  if (precip) { for (const p of Object.keys(f) as Pos[]) f[p] *= PRECIP[p]; parts.push('precipitation'); }
  return { factor: f, note: parts.length ? parts.join(', ') : null, source: src, wind: wind ?? null, temp: temp ?? null, precip };
}
