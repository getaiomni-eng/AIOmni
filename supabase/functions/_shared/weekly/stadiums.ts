// Every venue in nflverse games 2021-2026, keyed by nflverse stadium_id.
//
// roof here is the venue's physical roof, not the per-game value: nflverse
// leaves roof blank for unplayed games at retractable venues and labels some
// international grounds "dome" that are open-air (MCG, Stade de France,
// Allianz Arena). 'retractable' is treated as weather-neutral -- those roofs
// close in the conditions that would matter.
//
// tz is IANA. Offsets are resolved at game time via Intl, so Arizona's missing
// DST and the Southern-hemisphere venues come out right.

export type Roof = 'outdoors' | 'dome' | 'retractable';
export interface Stadium { name: string; lat: number; lon: number; tz: string; roof: Roof; intl?: boolean }

export const STADIUMS: Record<string, Stadium> = {
  ATL97: { name: 'Mercedes-Benz Stadium',     lat: 33.7554, lon: -84.4008,  tz: 'America/New_York',     roof: 'retractable' },
  BAL00: { name: 'M&T Bank Stadium',          lat: 39.2780, lon: -76.6227,  tz: 'America/New_York',     roof: 'outdoors' },
  BOS00: { name: 'Gillette Stadium',          lat: 42.0909, lon: -71.2643,  tz: 'America/New_York',     roof: 'outdoors' },
  BUF00: { name: 'Highmark Stadium',          lat: 42.7738, lon: -78.7870,  tz: 'America/New_York',     roof: 'outdoors' },
  CAR00: { name: 'Bank of America Stadium',   lat: 35.2258, lon: -80.8528,  tz: 'America/New_York',     roof: 'outdoors' },
  CHI98: { name: 'Soldier Field',             lat: 41.8623, lon: -87.6167,  tz: 'America/Chicago',      roof: 'outdoors' },
  CIN00: { name: 'Paycor Stadium',            lat: 39.0955, lon: -84.5161,  tz: 'America/New_York',     roof: 'outdoors' },
  CLE00: { name: 'Huntington Bank Field',     lat: 41.5061, lon: -81.6995,  tz: 'America/New_York',     roof: 'outdoors' },
  DAL00: { name: 'AT&T Stadium',              lat: 32.7473, lon: -97.0945,  tz: 'America/Chicago',      roof: 'retractable' },
  DEN00: { name: 'Empower Field at Mile High', lat: 39.7439, lon: -105.0201, tz: 'America/Denver',      roof: 'outdoors' },
  DET00: { name: 'Ford Field',                lat: 42.3400, lon: -83.0456,  tz: 'America/Detroit',      roof: 'dome' },
  GNB00: { name: 'Lambeau Field',             lat: 44.5013, lon: -88.0622,  tz: 'America/Chicago',      roof: 'outdoors' },
  HOU00: { name: 'NRG Stadium',               lat: 29.6847, lon: -95.4107,  tz: 'America/Chicago',      roof: 'retractable' },
  IND00: { name: 'Lucas Oil Stadium',         lat: 39.7601, lon: -86.1639,  tz: 'America/Indiana/Indianapolis', roof: 'retractable' },
  JAX00: { name: 'EverBank Stadium',          lat: 30.3239, lon: -81.6373,  tz: 'America/New_York',     roof: 'outdoors' },
  KAN00: { name: 'GEHA Field at Arrowhead',   lat: 39.0489, lon: -94.4839,  tz: 'America/Chicago',      roof: 'outdoors' },
  LAX01: { name: 'SoFi Stadium',              lat: 33.9535, lon: -118.3392, tz: 'America/Los_Angeles',  roof: 'dome' },
  MIA00: { name: 'Hard Rock Stadium',         lat: 25.9580, lon: -80.2389,  tz: 'America/New_York',     roof: 'outdoors' },
  MIN01: { name: 'U.S. Bank Stadium',         lat: 44.9738, lon: -93.2581,  tz: 'America/Chicago',      roof: 'dome' },
  NAS00: { name: 'Nissan Stadium',            lat: 36.1665, lon: -86.7713,  tz: 'America/Chicago',      roof: 'outdoors' },
  NOR00: { name: 'Caesars Superdome',         lat: 29.9511, lon: -90.0812,  tz: 'America/Chicago',      roof: 'dome' },
  NYC01: { name: 'MetLife Stadium',           lat: 40.8135, lon: -74.0745,  tz: 'America/New_York',     roof: 'outdoors' },
  PHI00: { name: 'Lincoln Financial Field',   lat: 39.9008, lon: -75.1675,  tz: 'America/New_York',     roof: 'outdoors' },
  PHO00: { name: 'State Farm Stadium',        lat: 33.5276, lon: -112.2626, tz: 'America/Phoenix',      roof: 'retractable' },
  PIT00: { name: 'Acrisure Stadium',          lat: 40.4468, lon: -80.0158,  tz: 'America/New_York',     roof: 'outdoors' },
  SEA00: { name: 'Lumen Field',               lat: 47.5952, lon: -122.3316, tz: 'America/Los_Angeles',  roof: 'outdoors' },
  SFO01: { name: "Levi's Stadium",            lat: 37.4030, lon: -121.9700, tz: 'America/Los_Angeles',  roof: 'outdoors' },
  TAM00: { name: 'Raymond James Stadium',     lat: 27.9759, lon: -82.5033,  tz: 'America/New_York',     roof: 'outdoors' },
  VEG00: { name: 'Allegiant Stadium',         lat: 36.0908, lon: -115.1834, tz: 'America/Los_Angeles',  roof: 'dome' },
  WAS00: { name: 'Northwest Stadium',         lat: 38.9078, lon: -76.8645,  tz: 'America/New_York',     roof: 'outdoors' },
  // International and neutral-site venues.
  FRA00: { name: 'Deutsche Bank Park',        lat: 50.0686, lon: 8.6455,    tz: 'Europe/Berlin',        roof: 'outdoors', intl: true },
  GER00: { name: 'Allianz Arena',             lat: 48.2188, lon: 11.6247,   tz: 'Europe/Berlin',        roof: 'outdoors', intl: true },
  MUN01: { name: 'Allianz Arena',             lat: 48.2188, lon: 11.6247,   tz: 'Europe/Berlin',        roof: 'outdoors', intl: true },
  LON00: { name: 'Wembley Stadium',           lat: 51.5560, lon: -0.2796,   tz: 'Europe/London',        roof: 'outdoors', intl: true },
  LON02: { name: 'Tottenham Hotspur Stadium', lat: 51.6043, lon: -0.0664,   tz: 'Europe/London',        roof: 'outdoors', intl: true },
  MAD01: { name: 'Santiago Bernabeu',         lat: 40.4531, lon: -3.6883,   tz: 'Europe/Madrid',        roof: 'retractable', intl: true },
  MEL00: { name: 'Melbourne Cricket Ground',  lat: -37.8200, lon: 144.9834, tz: 'Australia/Melbourne',  roof: 'outdoors', intl: true },
  MEX00: { name: 'Estadio Banorte (Azteca)',  lat: 19.3029, lon: -99.1505,  tz: 'America/Mexico_City',  roof: 'outdoors', intl: true },
  PAR00: { name: 'Stade de France',           lat: 48.9245, lon: 2.3602,    tz: 'Europe/Paris',         roof: 'outdoors', intl: true },
  RIO00: { name: 'Maracana Stadium',          lat: -22.9122, lon: -43.2302, tz: 'America/Sao_Paulo',    roof: 'outdoors', intl: true },
  SAO00: { name: 'Arena Corinthians',         lat: -23.5453, lon: -46.4742, tz: 'America/Sao_Paulo',    roof: 'outdoors', intl: true },
};

export const HOME_STADIUM: Record<string, string> = {
  ARI: 'PHO00', ATL: 'ATL97', BAL: 'BAL00', BUF: 'BUF00', CAR: 'CAR00', CHI: 'CHI98', CIN: 'CIN00',
  CLE: 'CLE00', DAL: 'DAL00', DEN: 'DEN00', DET: 'DET00', GB: 'GNB00', HOU: 'HOU00', IND: 'IND00',
  JAX: 'JAX00', KC: 'KAN00', LA: 'LAX01', LAC: 'LAX01', LV: 'VEG00', MIA: 'MIA00', MIN: 'MIN01',
  NE: 'BOS00', NO: 'NOR00', NYG: 'NYC01', NYJ: 'NYC01', PHI: 'PHI00', PIT: 'PIT00', SEA: 'SEA00',
  SF: 'SFO01', TB: 'TAM00', TEN: 'NAS00', WAS: 'WAS00',
};

// Great-circle distance in statute miles.
export function miles(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// UTC offset in hours for an IANA zone at an instant. Cached per zone+day.
const offCache = new Map<string, number>();
export function utcOffset(tz: string, at: Date): number {
  const key = `${tz}|${at.toISOString().slice(0, 10)}`;
  const hit = offCache.get(key);
  if (hit !== undefined) return hit;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find(p => p.type === t)!.value);
  const local = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'));
  const off = Math.round((local - at.getTime()) / 36e5 * 4) / 4;
  offCache.set(key, off);
  return off;
}

// nflverse gameday + gametime are US/Eastern wall-clock. Returns the UTC instant.
export function kickoffUtc(gameday: string, gametime: string): Date {
  const [y, m, d] = gameday.split('-').map(Number);
  const [hh, mm] = (gametime || '13:00').split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh + 5, mm));   // assume EST, then correct
  const off = utcOffset('America/New_York', guess);            // -4 (EDT) or -5 (EST)
  return new Date(Date.UTC(y, m - 1, d, hh - off, mm));
}
