// Model B -- matchup. "What did the Dolphins' WR1 do against the 49ers, and
// what will the Cardinals' WR1 do against them this week?"
//
// CURRENT SEASON ONLY. Player and defense numbers come exclusively from
// games of input.season. Only league constants (role means, Vegas elasticity,
// weather) are calibrated on earlier seasons -- 2021-2024, see
// scripts/weekly/matchup_calibrate.ts -- so a 2025 backtest is out-of-sample.
//
// 1. ROLES. Each team's skill players are ranked within position by
//    current-season usage per game (QB attempts+carries, RB carries+1.5x
//    targets, WR/TE targets): QB1, RB1, RB2, WR1..WR3, TE1 and so on. The
//    target-week depth chart only decides QB1 (a named starter beats a
//    backup's usage) and places players with no usage yet. Out players are
//    already gone from the pool, so the next man up inherits the role.
//
// 2. DEFENSE-VS-ROLE TRANSFER. For every current-season game, each opposing
//    player's actual PPR is compared with his expectation for that game: his
//    average in his OTHER games, shrunk to the league mean for his role,
//    scaled by that game's Vegas implied total and weather. The residual is
//    what the defense did to that role beyond what Vegas already expected.
//    A defense's role adjustment is the shrunk mean of those residuals,
//    pooled through a position-level mean so two games do not decide it.
//    Two passes: the second recomputes player baselines with the first
//    pass's defense adjustments taken out, so a WR who faced two soft
//    defenses is not credited with their softness.
//
// 3. PREDICTION. proj = baseline(role) x (implied / league) ^ elasticity
//                       x weather  +  w x defense adjustment for that role.
//    A player whose role changed this week is scaled toward the new role.
//
// WHAT THE BACKTEST SAID ABOUT STEP 2 (scripts/weekly/matchup_ablate.ts;
// tuned on 2022-2024 wk3-17, held out 2025 wk3-17, Spearman vs actual PPR):
//
//                      tune 22-24   test 2025
//   no defense term       .315        .304
//   defense, all pos      .315        .295
//   defense, QB only      .320        .311     <- default
//   (no Vegas            .302        .277;  no weather  .313  .288)
//
// The transfer carries real signal for QBs only (QB rho .34 -> .36 tune,
// .25 -> .28 test, early and late season alike). For WR, TE and RB the
// "what did the Dolphins' WR1 do against this defense" number did not predict
// the next WR1 at all -- it is computed and shown in the notes for every
// position, but only QBs get it in the projection. Re-run the ablation as
// seasons accumulate; if WR turns positive, raise defPos.WR.

import { impliedTotal, mean, ppr, shrink } from './common.ts';
import type { GameRow, ModelRow, PoolPlayer, Pos, StatRow, WeekInput, WeeklyModel } from './types.ts';
import { weatherAdjust } from './weather.ts';

// League role means, PPR per game, 2021-2024 (matchup_calibrate.ts).
const ROLE_MEAN: Record<string, number> = {
  QB1: 17.0, QB2: 8.7, RB1: 14.6, RB2: 8.0, RB3: 4.6, TE1: 9.3, TE2: 4.5,
  WR1: 15.0, WR2: 10.8, WR3: 7.4, WR4: 5.4,
};
const DEEP: Record<Pos, number> = { QB: 5, RB: 2.5, WR: 3.0, TE: 2.0 };
export const roleMean = (role: string) => ROLE_MEAN[role] ?? DEEP[role.slice(0, 2) as Pos];

// pts ~ baseline x (implied / reference)^e, fit 2021-2024.
const ELASTICITY: Record<Pos, number> = { QB: 0.35, RB: 0.35, WR: 0.10, TE: 0.30 };
const REF_IMPLIED = 22.5;

// Roles a defense adjustment is estimated for; deeper roles borrow the
// position-level number.
const MAIN_ROLES = ['QB1', 'RB1', 'RB2', 'WR1', 'WR2', 'WR3', 'TE1'];

export interface MatchupParams {
  kBase: number;      // games of weight on the role-mean prior for a player's baseline
  kRole: number;      // games of weight pulling a defense's role adjustment to its position mean
  kPos: number;       // player-games of weight pulling the position mean to zero
  defWeight: number;  // 0 = ablation (no defense transfer)
  passes: number;
  roleChange: number; // exponent on newRoleMean/oldRoleMean when a role changes
  defPos: Record<Pos, number>; // per-position multiplier on defWeight
  vegas: boolean;     // ablation switch
  weather: boolean;   // ablation switch
  // Prior-season prior, fading out as current-season games accumulate.
  kPrev: number;      // games of weight on last season's per-game rate with 0 games this season
  fadeGames: number;  // current-season games at which that weight reaches 0
  kPrevOwn: number;   // games of weight pulling last season's rate toward the role mean (thin seasons)
  prevRoles: boolean; // blend last season's usage into role assignment
  prevRolesTargetOnly: boolean; // ...only for this week's roles, not past games' roles
  prevSameTeam: boolean;        // ...only when he is on the same team as last season
  prevResid: boolean; // use the prior in the defense-residual expectations too
}
// Selected on 2022-2024 only (matchup_tune.ts grid, then matchup_qb.ts).
// The grid is flat: every kBase/kRole/kPos combination with defWeight 0.5
// lands within .004 of the best, so none of these is finely balanced.
export const DEFAULT_PARAMS: MatchupParams = { kBase: 3, kRole: 8, kPos: 8, defWeight: 0.5, passes: 2, roleChange: 0.5,
  defPos: { QB: 1, RB: 0, WR: 0, TE: 0 }, vegas: true, weather: true,
  kPrev: 10, fadeGames: 12, kPrevOwn: 4, prevRoles: false, prevRolesTargetOnly: false, prevSameTeam: false, prevResid: false };

const usage = (r: StatRow) =>
  r.position === 'QB' ? r.attempts + r.carries
  : r.position === 'RB' ? r.carries + 1.5 * r.targets
  : r.targets;

interface Resid { role: string; res: number; name: string; team: string; week: number }

const lastName = (n: string) => n.replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/i, '').split(' ').slice(-1)[0];

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const a = m.get(k);
  if (a) a.push(v); else m.set(k, [v]);
}

export function makeMatchup(params: Partial<MatchupParams> = {}): WeeklyModel {
  const P = { ...DEFAULT_PARAMS, ...params };
  return (input: WeekInput): ModelRow[] => {
    const S = input.season, W = input.week;
    const cur = input.stats.filter(r => r.season === S && r.week < W);

    // Last season, per player (week 18 excluded: rested starters).
    const prev = new Map<string, { use: number; pts: number; n: number; team: string; wk: number }>();
    if (P.kPrev > 0) for (const r of input.stats) {
      if (r.season !== S - 1 || r.week >= 18) continue;
      const a = prev.get(r.gsis_id) ?? { use: 0, pts: 0, n: 0, team: r.team, wk: 0 };
      a.use += usage(r); a.pts += ppr(r); a.n++;
      if (r.week >= a.wk) { a.wk = r.week; a.team = r.team; }
      prev.set(r.gsis_id, a);
    }
    const fade = (n: number) => P.kPrev * Math.max(0, 1 - n / P.fadeGames);
    const curN = new Map<string, number>();
    for (const r of cur) curN.set(r.gsis_id, (curN.get(r.gsis_id) ?? 0) + 1);
    // Last season's per-game points, pulled toward the role mean by its own sample size.
    const prevRate = (id: string, role: string) => {
      const a = prev.get(id);
      return a ? (a.pts + roleMean(role) * P.kPrevOwn) / (a.n + P.kPrevOwn) : null;
    };
    // Baseline: this season's rate, last season's rate (fading), the role mean.
    const baseOf = (id: string, rate: number, n: number, role: string, prior: number) => {
      const pr = prevRate(id, role);
      const kf = pr == null ? 0 : fade(n);
      const num = (n && isFinite(rate) ? rate * n : 0) + (pr ?? 0) * kf + prior * P.kBase;
      return num / ((n && isFinite(rate) ? n : 0) + kf + P.kBase);
    };

    // Games of this season, by team-week.
    const gameOf = new Map<string, GameRow>();
    const lines: number[] = [];
    for (const g of input.games) {
      if (g.season !== S) continue;
      gameOf.set(`${g.week}|${g.home_team}`, g); gameOf.set(`${g.week}|${g.away_team}`, g);
      for (const t of [g.home_team, g.away_team]) { const it = impliedTotal(g, t); if (it != null) lines.push(it); }
    }
    const ref = lines.length >= 20 ? mean(lines) : REF_IMPLIED;
    const vegasF = (g: GameRow | undefined, team: string, pos: Pos) => {
      const it = g && P.vegas ? impliedTotal(g, team) : null;
      return it == null ? 1 : Math.pow(it / ref, ELASTICITY[pos]);
    };
    const wxCache = new Map<string, ReturnType<typeof weatherAdjust>>();
    const wx = (g: GameRow | undefined, live = false) => {
      if (!g || !P.weather) return null;
      const k = g.game_id + (live ? '|live' : '');
      let v = wxCache.get(k);
      if (!v) { v = weatherAdjust(g, live ? input.forecast?.[g.game_id] : null); wxCache.set(k, v); }
      return v;
    };

    // ── usage rates and per-game roles ───────────────────────────────────
    const rateTeam = new Map<string, { use: number; n: number }>();   // player|team
    const ratePl = new Map<string, { use: number; n: number }>();     // player, any team
    for (const r of cur) {
      for (const [m, k] of [[rateTeam, `${r.gsis_id}|${r.team}`], [ratePl, r.gsis_id]] as const) {
        const a = m.get(k) ?? { use: 0, n: 0 }; a.use += usage(r); a.n++; m.set(k, a);
      }
    }
    // Usage per game for role assignment. With prevRoles, last season's usage
    // is blended in with the same fading weight, so a two-game dip cannot
    // demote last year's WR1 to WR2.
    const blendUse = (id: string, curUse: number | null, n: number, team: string | null, target: boolean) => {
      let pv = P.prevRoles && (target || !P.prevRolesTargetOnly) ? prev.get(id) : undefined;
      if (pv && P.prevSameTeam && team != null && pv.team !== team) pv = undefined;
      const kf = pv ? fade(n) : 0;
      if (curUse == null && !kf) return null;
      return ((curUse ?? 0) * n + (pv ? pv.use / pv.n : 0) * kf) / (n + kf);
    };
    const rt = (id: string, team: string) => {
      const a = rateTeam.get(`${id}|${team}`);
      return blendUse(id, a ? a.use / a.n : null, a?.n ?? 0, team, false) ?? 0;
    };

    const byTeamGame = new Map<string, StatRow[]>();
    for (const r of cur) push(byTeamGame, `${r.week}|${r.team}|${r.position}`, r);
    const gameRole = new Map<StatRow, string>();
    const roleUse = new Map<string, number[]>();    // league usage by role, for placing no-usage players
    for (const rows of byTeamGame.values()) {
      rows.sort((a, b) => rt(b.gsis_id, b.team) - rt(a.gsis_id, a.team));
      rows.forEach((r, i) => {
        const role = `${r.position}${i + 1}`;
        gameRole.set(r, role);
        push(roleUse, role, rt(r.gsis_id, r.team));
      });
    }

    // Each player's current-season games, and his most common role.
    const games = new Map<string, StatRow[]>();
    for (const r of cur) push(games, r.gsis_id, r);
    const usualRole = new Map<string, string>();
    for (const [id, rows] of games) {
      const c = new Map<string, number>();
      for (const r of rows) { const rl = gameRole.get(r)!; c.set(rl, (c.get(rl) ?? 0) + 1); }
      usualRole.set(id, [...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]);
    }

    // ── defense-vs-role transfer, iterated ───────────────────────────────
    const ctxF = (r: StatRow) => {
      const g = gameOf.get(`${r.week}|${r.team}`);
      return vegasF(g, r.team, r.position) * (wx(g)?.factor[r.position] ?? 1);
    };
    let defAdj = new Map<string, Map<string, number>>();   // defense -> role -> pts
    let defRes = new Map<string, Resid[]>();
    const adjOf = (def: string, role: string) => defAdj.get(def)?.get(role) ?? 0;
    // A game's points with context and (after pass 1) the defense taken out.
    const dw = (pos: Pos) => P.defWeight * P.defPos[pos];
    const neutral = (r: StatRow) => Math.max(0, ppr(r) - dw(r.position) * adjOf(r.opponent, gameRole.get(r)!)) / ctxF(r);

    for (let pass = 0; pass < P.passes; pass++) {
      const res = new Map<string, Resid[]>();
      for (const rows of games.values()) {
        const neut = rows.map(neutral);
        const tot = neut.reduce((a, b) => a + b, 0);
        rows.forEach((r, i) => {
          const role = gameRole.get(r)!;
          const nOther = rows.length - 1;
          const base = P.prevResid
            ? baseOf(r.gsis_id, nOther ? (tot - neut[i]) / nOther : NaN, nOther, role, roleMean(role))
            : shrink(nOther ? (tot - neut[i]) / nOther : NaN, nOther, roleMean(role), P.kBase);
          push(res, r.opponent, { role, res: ppr(r) - base * ctxF(r), name: r.player_name, team: r.team, week: r.week });
        });
      }
      const next = new Map<string, Map<string, number>>();
      for (const [def, rs] of res) {
        const m = new Map<string, number>();
        for (const pos of ['QB', 'RB', 'WR', 'TE'] as Pos[]) {
          const pr = rs.filter(x => x.role.startsWith(pos));
          // position-level, in units of each role's own mean
          const unit = pr.reduce((s, x) => s + x.res / roleMean(x.role), 0) / (pr.length + P.kPos);
          m.set(`${pos}*`, unit * roleMean(`${pos}1`));
          for (const role of MAIN_ROLES) {
            if (!role.startsWith(pos)) continue;
            const rr = pr.filter(x => x.role === role);
            const sum = rr.reduce((s, x) => s + x.res, 0);
            m.set(role, (sum + P.kRole * unit * roleMean(role)) / (rr.length + P.kRole));
          }
          // deeper roles use the position unit
          m.set(`${pos}unit`, unit);
        }
        next.set(def, m);
      }
      defAdj = next; defRes = res;
    }
    const defFor = (def: string, role: string) => {
      const m = defAdj.get(def); if (!m) return 0;
      return m.has(role) ? m.get(role)! : (m.get(`${role.slice(0, 2)}unit`) ?? 0) * roleMean(role);
    };

    // ── target-week roles ────────────────────────────────────────────────
    const roleNow = new Map<string, string>();
    const byTeamPos = new Map<string, PoolPlayer[]>();
    for (const p of input.pool) push(byTeamPos, `${p.team}|${p.position}`, p);
    const placeholderUse = (pos: Pos, depth: number | null) => {
      const u = roleUse.get(`${pos}${depth ?? 3}`);
      return (u && u.length ? mean(u) : 0) * 0.9;
    };
    for (const ps of byTeamPos.values()) {
      const score = (p: PoolPlayer) => {
        const a = ratePl.get(p.gsis_id);
        return blendUse(p.gsis_id, a ? a.use / a.n : null, a?.n ?? 0, p.team, true) ?? placeholderUse(p.position, p.depth_rank);
      };
      ps.sort((a, b) => score(b) - score(a) || (a.depth_rank ?? 99) - (b.depth_rank ?? 99));
      if (ps[0]?.position === 'QB') {
        const starter = ps.findIndex(p => p.depth_rank === 1);
        if (starter > 0) ps.unshift(...ps.splice(starter, 1));
      }
      ps.forEach((p, i) => roleNow.set(p.gsis_id, `${p.position}${i + 1}`));
    }

    // ── predict ──────────────────────────────────────────────────────────
    const out: ModelRow[] = [];
    for (const p of input.pool) {
      const role = roleNow.get(p.gsis_id)!;
      const rows = games.get(p.gsis_id) ?? [];
      const n = rows.length;
      let rate = n ? mean(rows.map(neutral)) : NaN;
      const usual = usualRole.get(p.gsis_id);
      let roleNote: string | null = null;
      if (n && usual && usual !== role) {
        rate *= Math.pow(roleMean(role) / roleMean(usual), P.roleChange);
        roleNote = `role ${usual} -> ${role} this week`;
      }
      let prior = roleMean(role);
      if (!n) prior *= p.rookie && p.draft_round === 1 ? 1.0 : 0.85;
      const base = P.kPrev > 0 ? baseOf(p.gsis_id, rate, n, role, prior) : shrink(rate, n, prior, P.kBase);
      const pr = prevRate(p.gsis_id, role);
      const prevW = pr == null ? 0 : fade(n);
      const g = gameOf.get(`${W}|${p.team}`);
      const vf = vegasF(g, p.team, p.position);
      const w = wx(g, true);
      const wf = w?.factor[p.position] ?? 1;
      const dAdj = defFor(p.opponent, role);
      const proj = Math.max(0, base * vf * wf + dw(p.position) * dAdj);

      const notes: string[] = [];
      if (roleNote) notes.push(roleNote);
      if (prevW >= 0.5) notes.push(`${S - 1} counted as ${prevW.toFixed(1)} games (${pr!.toFixed(1)} ppg) beside ${n} this season`);
      const seen = (defRes.get(p.opponent) ?? []).filter(x => x.role === role).sort((a, b) => a.week - b.week);
      if (Math.abs(dAdj) >= 1 && seen.length) {
        const ex = seen.map(x => `${x.team} ${lastName(x.name)} ${x.res >= 0 ? '+' : ''}${x.res.toFixed(1)} wk${x.week}`).join(', ');
        notes.push(`${p.opponent} allowed ${role}s ${dAdj >= 0 ? '+' : ''}${dAdj.toFixed(1)} over expectation (${ex})`
          + (dw(p.position) ? '' : ' [shown, not weighted]'));
      }
      if (w?.note) notes.push(`weather: ${w.note}`);
      const it = g ? impliedTotal(g, p.team) : null;
      out.push({
        gsis_id: p.gsis_id, position: p.position, proj: +proj.toFixed(2), notes,
        detail: {
          role, usual_role: usual ?? null, games: n, rate: isFinite(rate) ? +rate.toFixed(2) : null,
          baseline: +base.toFixed(2), implied: it, vegas_f: +vf.toFixed(3), weather_f: +wf.toFixed(3),
          def_adj: +dAdj.toFixed(2), def_n: seen.length, def_weight: dw(p.position),
          prev_ppg: pr == null ? null : +pr.toFixed(2), prev_weight: +prevW.toFixed(2),
        },
      });
    }
    return out;
  };
}

export const modelMatchup: WeeklyModel = makeMatchup();
