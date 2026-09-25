// Model C -- context: what the player has done THIS season, how he is being
// used, who he plays, and the conditions he plays them in.
//
//   proj = base x env x opp
//
//   base  current-season production. A blend of usage-based expected points
//         (xFP: opportunities priced at league rates) and actual PPG,
//         recency-weighted, pulled toward a depth-chart prior while the
//         sample is thin. Games he left early (snap share under 25% when he
//         normally plays half) are dropped: they measure the injury, not him.
//   env   travel, rest, home field and weather, each relative to the
//         conditions of the games his base came from -- a player whose two
//         games were both at home is not handed home field a second time.
//   opp   the defense's current-season points allowed to the position,
//         measured against what each offense it faced scores in its OTHER
//         games (strength-of-schedule adjusted), shrunk hard toward neutral.
//
// CURRENT SEASON ONLY for players and defenses. Nothing about a player or a
// defense comes from an earlier season, which is what makes this backtestable
// on 2025 as if it were the live year. League constants -- points per target,
// the environmental coefficients -- come from earlier seasons; they describe
// the game, not anyone in it.
//
// ENVIRONMENT CALIBRATION (scripts/weekly/context_calibrate.ts). 2,718
// team-games 2021-2025. Target: a team's skill-position PPR minus what that
// offense and that defense do in their other games that season. Coefficients
// kept at coef x max(0, 1 - 4/t^2): ~40 terms were tested, so |t| = 2 is what
// chance alone produces, and anything under it is set to exactly zero.
//
//   What survived (weather rows are superseded by weather.ts, see below):
//                              QB        RB       WR+TE
//     home field              +1.01      0       +1.50   (t 3.4 / 1.9 / 3.0)
//     indoor                  +0.25      0        0
//     wind, per mph over 10     0        0       -0.33   (t -3.7)
//     Thursday short week        0        0       +0.46   (both teams short)
//     off a bye                  0        0       -0.23
//     opponent off a bye       -0.08      0        0
//   What did not (all |t| < 1, set to zero): miles travelled, time zones
//   crossed in either direction, a West Coast team's 10am body-clock
//   kickoff, a second straight road game, international games (34 samples).
//
// WEATHER uses the shared weather.ts (player-level calibration) rather than
// the team-level rows above: it scored slightly better on both the tuning
// seasons and the 2025 holdout, and one weather table across models is
// better than two. The ENV weather rows remain for the weather: 'own' option.
//
// Travel is therefore computed and REPORTED on every player -- distance, time
// zones, body-clock kickoff, rest -- but it moves nobody. Five seasons of
// data say it does not change fantasy output once you know the team, the
// defense and whether they are at home. The "west coast team flying east"
// effect exists in betting folklore; it is not in these numbers.

import type { GameRow, ModelRow, Pos, StatRow, WeekInput, WeeklyModel } from './types.ts';
import { HOME_STADIUM, STADIUMS, kickoffUtc, miles, utcOffset } from './stadiums.ts';
import { weatherAdjust } from './weather.ts';
import type { Forecast } from './types.ts';

// ── environment ─────────────────────────────────────────────────────────────

const teamGamesCache = new WeakMap<GameRow[], Map<string, GameRow[]>>();
function teamGames(games: GameRow[]) {
  let m = teamGamesCache.get(games);
  if (m) return m;
  m = new Map();
  for (const g of games) for (const t of [g.home_team, g.away_team]) {
    const k = `${g.season}|${t}`;
    (m.get(k) ?? m.set(k, []).get(k)!).push(g);
  }
  for (const a of m.values()) a.sort((x, y) => x.week - y.week);
  teamGamesCache.set(games, m);
  return m;
}

export interface Travel {
  home: boolean; intl: boolean; distHome: number; distPrev: number;
  tzShift: number; bodyHour: number; rest: number | null; oppRest: number | null; secondRoad: boolean;
}

export function travelFeatures(games: GameRow[], g: GameRow, team: string): Travel {
  const venue = STADIUMS[g.stadium_id];
  const homeId = HOME_STADIUM[team];
  const homeSt = STADIUMS[homeId];
  const home = g.stadium_id === homeId;
  const distHome = venue && homeSt ? miles(homeSt, venue) : 0;
  const list = teamGames(games).get(`${g.season}|${team}`) ?? [];
  let prev: GameRow | undefined;
  for (const x of list) if (x.week < g.week) prev = x;
  const prevAdjacent = !!prev && prev.week === g.week - 1;
  const prevVenue = prevAdjacent ? STADIUMS[prev!.stadium_id] : homeSt;
  const distPrev = venue && prevVenue ? miles(prevVenue, venue) : distHome;
  const secondRoad = prevAdjacent && !home && prev!.stadium_id !== homeId;
  const kick = kickoffUtc(g.gameday, g.gametime);
  const homeOff = homeSt ? utcOffset(homeSt.tz, kick) : -5;
  const venueOff = venue ? utcOffset(venue.tz, kick) : homeOff;
  const bodyHour = ((kick.getUTCHours() + kick.getUTCMinutes() / 60 + homeOff) % 24 + 24) % 24;
  const isHomeTeam = team === g.home_team;
  return {
    home, intl: !!venue?.intl, distHome, distPrev, tzShift: venueOff - homeOff, bodyHour,
    rest: isHomeTeam ? g.home_rest : g.away_rest, oppRest: isHomeTeam ? g.away_rest : g.home_rest, secondRoad,
  };
}

export interface Weather { indoor: boolean; wind: number | null; temp: number | null; precip: boolean | null; source: 'forecast' | 'kickoff' | 'none' }

// Venue roof comes from STADIUMS, not the game row: nflverse labels the MCG
// and Stade de France "dome" and leaves retractable roofs blank before kickoff.
export function weatherOf(g: GameRow, forecast: Forecast | undefined): Weather {
  const venue = STADIUMS[g.stadium_id];
  const indoor = venue ? venue.roof !== 'outdoors' : (g.roof === 'dome' || g.roof === 'closed');
  if (indoor) return { indoor, wind: null, temp: null, precip: null, source: 'none' };
  if (forecast) return { indoor, wind: forecast.wind, temp: forecast.temp, precip: forecast.precip, source: 'forecast' };
  return { indoor, wind: g.wind, temp: g.temp, precip: null, source: g.wind != null || g.temp != null ? 'kickoff' : 'none' };
}

type Group = 'QB' | 'RB' | 'REC';
const group = (p: Pos): Group => p === 'QB' ? 'QB' : p === 'RB' ? 'RB' : 'REC';

// Shrunk coefficients, PPR points per team-game (see header).
const ENV: Record<Group, { mean: number; travel: Record<string, number>; weather: Record<string, number> }> = {
  QB:  { mean: 16.88, travel: { home: 1.009, oppLong: -0.077 }, weather: { indoor: 0.254 } },
  RB:  { mean: 22.42, travel: {},                               weather: {} },
  REC: { mean: 45.19, travel: { home: 1.497, short: 0.455, long: -0.231 }, weather: { windX: -0.327 } },
};

function envFeatures(games: GameRow[], g: GameRow, team: string, forecast?: Forecast) {
  const t = travelFeatures(games, g, team);
  const w = weatherOf(g, forecast);
  return {
    t, w,
    x: {
      home: t.home ? 1 : 0,
      short: t.rest != null && t.rest <= 5 ? 1 : 0,
      long: t.rest != null && t.rest >= 10 ? 1 : 0,
      oppLong: t.oppRest != null && t.oppRest >= 10 ? 1 : 0,
      indoor: w.indoor ? 1 : 0,
      windX: !w.indoor ? Math.max(0, (w.wind ?? 0) - 10) : 0,
    } as Record<string, number>,
  };
}

// ── options ────────────────────────────────────────────────────────────────

export interface ContextOpts {
  alpha: Record<Pos, number>;   // weight on xFP (usage) vs actual PPG
  decay: number;                // per-game recency weight, newest = 1
  kPrior: number;               // games' worth of weight on the depth prior
  kDef: number;                 // games' worth of shrink on a defense's residual
  kOff: number;                 // games' worth of shrink on an offense's expectation
  usage: boolean; opp: boolean; travel: boolean;
  weather: 'own' | 'shared' | 'off';
  // Prior-season prior, fading out as current-season games accumulate.
  kPrev: number;                // games' worth of weight on last season with 0 games this season
  fadeGames: number;            // current-season games at which that weight reaches 0
  kPrevOwn: number;             // games' worth pulling last season toward the depth prior
}

// Tuned by coordinate descent on 2023 + 2024 (weeks 3-17, each run as if it
// were the live season); 2025 was held out. scripts/weekly/context_tune.ts.
// kDef = 16 means a defense needs ~16 games before its residual counts at
// half weight -- early-season defense numbers are mostly noise, and the tuning
// found that on its own.
export const DEFAULT_OPTS: ContextOpts = {
  alpha: { QB: 0.6, RB: 0.2, WR: 0.4, TE: 0.6 },
  decay: 0.9, kPrior: 2, kDef: 16, kOff: 4,
  usage: true, opp: true, travel: true, weather: 'shared',
  kPrev: 4, fadeGames: 12, kPrevOwn: 4,
};

// PPR per game by position and depth-chart slot rank. Only matters in the
// first weeks and for players with no games yet (rookies, returns); with
// kPrior = 1 a single game already outweighs it.
const PRIOR: Record<Pos, number[]> = {
  QB: [16, 4, 1], RB: [12, 6, 3, 1.5], WR: [11, 7, 4, 2, 1], TE: [8, 3, 1.5],
};
function priorFor(pos: Pos, depthRank: number | null, draftRound: number | null, rookie: boolean) {
  const t = PRIOR[pos];
  let v = depthRank == null ? t[Math.min(2, t.length - 1)] * 0.6 : t[Math.min(depthRank, t.length) - 1];
  if (rookie && draftRound != null) v *= draftRound === 1 ? 1.15 : draftRound === 2 ? 1.05 : 0.95;
  return v;
}

// ── league rates: PPR per opportunity, fit on seasons before this one ───────

type Rates = Record<Pos, [number, number]>;
const FALLBACK_RATES: Rates = { QB: [0.45, 0.6], RB: [0.55, 1.35], WR: [0.95, 0.055], TE: [1.1, 0.05] };
const opps = (r: StatRow): [number, number] =>
  r.position === 'QB' ? [r.attempts, r.carries]
    : r.position === 'RB' ? [r.carries, r.targets]
      : [r.targets, r.receiving_air_yards];

function fitRates(stats: StatRow[], season: number): Rates {
  const acc: Record<Pos, number[]> = { QB: [0, 0, 0, 0, 0], RB: [0, 0, 0, 0, 0], WR: [0, 0, 0, 0, 0], TE: [0, 0, 0, 0, 0] };
  for (const r of stats) {
    if (r.season >= season || r.season < season - 3) continue;
    const [a, b] = opps(r); const y = r.fantasy_pts_ppr ?? 0; const s = acc[r.position];
    s[0] += a * a; s[1] += a * b; s[2] += b * b; s[3] += a * y; s[4] += b * y;
  }
  const out = { ...FALLBACK_RATES };
  for (const p of Object.keys(acc) as Pos[]) {
    const [aa, ab, bb, ay, by] = acc[p];
    const det = aa * bb - ab * ab;
    if (aa > 0 && Math.abs(det) > 1e-9) out[p] = [(ay * bb - by * ab) / det, (by * aa - ay * ab) / det];
  }
  return out;
}

// ── the model ──────────────────────────────────────────────────────────────

const pct = (x: number) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;
const fmtMiles = (m: number) => Math.round(m).toLocaleString('en-US');

export function makeContextModel(o: Partial<ContextOpts> = {}): WeeklyModel {
  const opts: ContextOpts = { ...DEFAULT_OPTS, ...o, alpha: { ...DEFAULT_OPTS.alpha, ...(o.alpha ?? {}) } };
  return (input: WeekInput): ModelRow[] => {
    const S = input.season;
    const rates = fitRates(input.stats, S);
    const cur = input.stats.filter(r => r.season === S);

    const gameOf = new Map<string, GameRow>();
    for (const g of input.games) if (g.season === S) {
      gameOf.set(`${g.week}|${g.home_team}`, g); gameOf.set(`${g.week}|${g.away_team}`, g);
    }
    const snapPct = new Map<string, number>();
    for (const s of input.snaps) if (s.season === S && s.gsis_id && s.offense_pct != null) snapPct.set(`${s.gsis_id}|${s.week}`, s.offense_pct);

    // Current-season rows per player, newest first.
    const rowsBy = new Map<string, StatRow[]>();
    for (const r of cur) (rowsBy.get(r.gsis_id) ?? rowsBy.set(r.gsis_id, []).get(r.gsis_id)!).push(r);
    for (const a of rowsBy.values()) a.sort((x, y) => y.week - x.week);

    // Last season per player, priced the same way as this season (xFP + PPG),
    // week 18 excluded. Used only as a prior that fades as games accumulate.
    const prevBy = new Map<string, { xfp: number; ppg: number; n: number }>();
    if (opts.kPrev > 0) for (const r of input.stats) {
      if (r.season !== S - 1 || r.week >= 18) continue;
      const [ra, rb] = rates[r.position]; const [a, b] = opps(r);
      const v = prevBy.get(r.gsis_id) ?? { xfp: 0, ppg: 0, n: 0 };
      v.xfp += a * ra + b * rb; v.ppg += r.fantasy_pts_ppr ?? 0; v.n++; prevBy.set(r.gsis_id, v);
    }

    // Strength of opponent, position-level, SOS-adjusted.
    const oppMult = new Map<string, number>(); // `${def}|${pos}` -> multiplier
    const oppResid = new Map<string, { adj: number; n: number }>();
    if (opts.opp) {
      const pts = new Map<string, number>();         // `${week}|${team}|${pos}`
      const teamWeeks = new Map<string, number[]>(); // `${team}` -> weeks played
      for (const r of cur) {
        const k = `${r.week}|${r.team}|${r.position}`;
        pts.set(k, (pts.get(k) ?? 0) + (r.fantasy_pts_ppr ?? 0));
        const tw = teamWeeks.get(r.team) ?? []; if (!tw.includes(r.week)) tw.push(r.week); teamWeeks.set(r.team, tw);
      }
      // League per-team-game mean at each position, from earlier seasons (a constant of the game).
      const lg: Record<Pos, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
      const lgN = new Set<string>();
      for (const r of input.stats) if (r.season < S && r.season >= S - 3) { lg[r.position] += r.fantasy_pts_ppr ?? 0; lgN.add(`${r.season}|${r.week}|${r.team}`); }
      const nTG = Math.max(1, lgN.size);
      for (const p of Object.keys(lg) as Pos[]) lg[p] = lgN.size ? lg[p] / nTG : ({ QB: 17, RB: 22, WR: 30, TE: 13 } as Record<Pos, number>)[p];

      for (const pos of ['QB', 'RB', 'WR', 'TE'] as Pos[]) {
        const resid = new Map<string, number[]>();
        for (const [team, weeks] of teamWeeks) {
          for (const w of weeks) {
            const g = gameOf.get(`${w}|${team}`);
            if (!g) continue;
            const def = g.home_team === team ? g.away_team : g.home_team;
            const allowed = pts.get(`${w}|${team}|${pos}`) ?? 0;
            const others = weeks.filter(x => x !== w).map(x => pts.get(`${x}|${team}|${pos}`) ?? 0);
            const exp = (others.reduce((a, b) => a + b, 0) + lg[pos] * opts.kOff) / (others.length + opts.kOff);
            (resid.get(def) ?? resid.set(def, []).get(def)!).push(allowed - exp);
          }
        }
        for (const [def, rs] of resid) {
          const adj = rs.reduce((a, b) => a + b, 0) / (rs.length + opts.kDef);
          oppResid.set(`${def}|${pos}`, { adj, n: rs.length });
          oppMult.set(`${def}|${pos}`, Math.min(1.3, Math.max(0.75, 1 + adj / lg[pos])));
        }
      }
    }

    const out: ModelRow[] = [];
    for (const p of input.pool) {
      const target = gameOf.get(`${input.week}|${p.team}`);
      const rows = rowsBy.get(p.gsis_id) ?? [];
      // Drop early exits.
      const pcts = rows.map(r => snapPct.get(`${p.gsis_id}|${r.week}`)).filter((x): x is number => x != null).sort((a, b) => a - b);
      const medPct = pcts.length ? pcts[Math.floor(pcts.length / 2)] : null;
      const kept = rows.filter(r => {
        const s = snapPct.get(`${p.gsis_id}|${r.week}`);
        return !(s != null && medPct != null && pcts.length >= 2 && medPct >= 0.5 && s < 0.25);
      });
      const [ra, rb] = rates[p.position];
      let wsum = 0, wx = 0, wa = 0;
      kept.forEach((r, i) => {
        const w = Math.pow(opts.decay, i);
        const [a, b] = opps(r);
        wx += w * (a * ra + b * rb); wa += w * (r.fantasy_pts_ppr ?? 0); wsum += w;
      });
      const xfp = wsum ? wx / wsum : NaN, ppg = wsum ? wa / wsum : NaN;
      const alpha = opts.usage ? opts.alpha[p.position] : 0;
      const raw = wsum ? alpha * xfp + (1 - alpha) * ppg : NaN;
      const prior = priorFor(p.position, p.depth_rank, p.draft_round, p.rookie);
      const n = kept.length;
      const pv = prevBy.get(p.gsis_id);
      const prevRaw = pv ? alpha * (pv.xfp / pv.n) + (1 - alpha) * (pv.ppg / pv.n) : null;
      const prevS = pv ? (prevRaw! * pv.n + prior * opts.kPrevOwn) / (pv.n + opts.kPrevOwn) : null;
      const kf = prevS == null ? 0 : opts.kPrev * Math.max(0, 1 - n / opts.fadeGames);
      const baseNum = (n ? raw * n : 0) + (prevS ?? 0) * kf + prior * opts.kPrior;
      const baseDen = n + kf + opts.kPrior;
      const baseV = baseNum / baseDen;

      // Environment, relative to the conditions of the games the base came from.
      const notes: string[] = [];
      const detail: Record<string, number | string | boolean | null> = {
        games: n, xfp: isFinite(xfp) ? +xfp.toFixed(2) : null, ppg: isFinite(ppg) ? +ppg.toFixed(2) : null,
        prior: +prior.toFixed(1), base: +baseV.toFixed(2),
        prev_ppg: prevS == null ? null : +prevS.toFixed(2), prev_weight: +kf.toFixed(2),
      };
      let envMult = 1;
      if (target && (opts.travel || opts.weather !== 'off')) {
        const grp = group(p.position);
        const coef = ENV[grp];
        const now = envFeatures(input.games, target, p.team, input.forecast?.[target.game_id]);
        // A traded player's past games are judged from the team he played them for.
        const past = kept.flatMap(r => {
          const g = gameOf.get(`${r.week}|${r.team}`);
          return g ? [envFeatures(input.games, g, r.team, undefined)] : [];
        });
        const avg = (k: string) => past.length ? past.reduce((s, e) => s + e.x[k], 0) / past.length : (k === 'home' ? 0.5 : 0);
        // Home field and rest are the travel terms that survived calibration;
        // distance, time zones and body clock are reported but carry no weight.
        let homePts = 0, restPts = 0, weatherPts = 0;
        if (opts.travel) for (const [k, c] of Object.entries(coef.travel)) {
          const v = c * (now.x[k] - avg(k));
          if (k === 'home') homePts += v; else restPts += v;
        }
        if (opts.weather === 'own') for (const [k, c] of Object.entries(coef.weather)) weatherPts += c * (now.x[k] - avg(k));
        let wxMult = 1 + weatherPts / coef.mean;
        // An outdoor game with no forecast and no reading is unknown weather,
        // not average weather: leave it alone rather than compare it to his past.
        const wxUnknown = !now.w.indoor && now.w.wind == null && now.w.temp == null && now.w.precip == null;
        if (opts.weather === 'shared') {
          // weather.ts reads the roof off the game row; hand it the venue's
          // physical roof instead (see weatherOf). Retractables count as indoor.
          const f = (g: GameRow, fc?: Forecast) => {
            const v = STADIUMS[g.stadium_id];
            const roof = v ? (v.roof === 'outdoors' ? 'outdoors' : 'dome') : g.roof;
            return weatherAdjust({ ...g, roof }, fc).factor[p.position];
          };
          const pastGames = kept.map(r => gameOf.get(`${r.week}|${r.team}`)).filter((g): g is GameRow => !!g);
          const pastF = pastGames.length ? pastGames.reduce((s, g) => s + f(g), 0) / pastGames.length : 1;
          wxMult = f(target, input.forecast?.[target.game_id]) / pastF;
        }
        if (wxUnknown) wxMult = 1;
        const travelMult = 1 + (homePts + restPts) / coef.mean;
        envMult = travelMult * wxMult;
        const t = now.t;
        Object.assign(detail, {
          home: t.home, miles: Math.round(t.distHome), miles_prev: Math.round(t.distPrev), tz_shift: t.tzShift,
          body_clock: +t.bodyHour.toFixed(1), rest: t.rest, intl: t.intl,
          home_mult: +(1 + homePts / coef.mean).toFixed(3), rest_mult: +(1 + restPts / coef.mean).toFixed(3),
          travel_mult: +travelMult.toFixed(3), weather_mult: +wxMult.toFixed(3),
          wind: now.w.wind, temp: now.w.temp, indoor: now.w.indoor, weather_known: !wxUnknown,
        });
        const homeEff = homePts / coef.mean, restEff = restPts / coef.mean;
        if (t.intl || t.distHome >= 1500 || Math.abs(t.tzShift) >= 2 || t.bodyHour < 11) {
          const bits = [
            `${fmtMiles(t.distHome)} mi${t.intl ? ` to ${STADIUMS[target.stadium_id]?.name ?? target.stadium}` : ''}`,
            t.tzShift ? `${Math.abs(t.tzShift)} tz ${t.tzShift > 0 ? 'east' : 'west'}` : null,
            t.bodyHour < 11 ? `${Math.floor(t.bodyHour)}am body-clock kickoff` : null,
          ].filter(Boolean);
          notes.push(`Travel ${bits.join(', ')}: no measurable effect in 2021-25, not applied`);
        }
        if (Math.abs(homeEff) >= 0.02) {
          const where = t.home ? 'Home field' : target.location === 'Neutral' ? 'Neutral site, no home field' : 'Road game';
          notes.push(`${where}: ${pct(homeEff)} vs his games so far`);
        }
        if (Math.abs(restEff) >= 0.01) {
          notes.push(`${t.rest != null && t.rest <= 5 ? 'Short week' : t.rest != null && t.rest >= 10 ? 'Long rest' : 'Rest'} (${t.rest} days): ${pct(restEff)}`);
        }
        if (Math.abs(wxMult - 1) >= 0.02) {
          const cond = now.w.indoor ? 'indoor' : [now.w.wind != null ? `${Math.round(now.w.wind)} mph wind` : null, now.w.temp != null ? `${Math.round(now.w.temp)}F` : null, now.w.precip ? 'precipitation' : null].filter(Boolean).join(', ');
          notes.push(`Weather ${cond}: ${pct(wxMult - 1)} vs his games so far`);
        }
      }

      let om = 1;
      if (opts.opp) {
        om = oppMult.get(`${p.opponent}|${p.position}`) ?? 1;
        const r = oppResid.get(`${p.opponent}|${p.position}`);
        detail.opp_mult = +om.toFixed(3);
        detail.opp_resid = r ? +r.adj.toFixed(2) : null;
        if (Math.abs(om - 1) >= 0.05) notes.push(`${p.opponent} vs ${p.position} this season: ${pct(om - 1)} (SOS-adjusted, ${r?.n ?? 0} games)`);
      }
      if (kf >= 0.5) notes.push(`${S - 1} counted as ${kf.toFixed(1)} games (${prevS!.toFixed(1)} pts/g) beside ${n} this season`);
      else if (!n) notes.push(p.rookie ? 'No games yet: depth-chart + draft prior' : 'No games this season: depth-chart prior only');

      const proj = baseV * envMult * om;
      out.push({ gsis_id: p.gsis_id, position: p.position, proj: +proj.toFixed(3), notes, detail });
    }
    return out;
  };
}

export const modelContext: WeeklyModel = makeContextModel();
