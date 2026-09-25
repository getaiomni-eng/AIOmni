// Model A -- recency: a last-5 board blended with a last-7 board, with every
// usage spike in either window investigated before it is allowed to count.
//
// PER-GAME VALUE. Each game played is scored as a mix of what the player
// actually scored and what his usage was worth (xFP: targets, carries, pass
// attempts and air yards priced by a per-position regression fitted on the
// data the model is allowed to see). Usage is stickier than points; the mix
// weight is fitted, not assumed.
//
// WINDOWS. L5 and L7 are the last 5 and last 7 games PLAYED, crossing the
// season boundary but skipping prior-season week 18 (rested starters). Both
// are pulled toward a prior by a couple of games' worth of weight so a player
// with two games is not ranked on two games.
//
// SPIKES. A game whose usage departs sharply from the player's own baseline is
// investigated: was a same-position teammate Out / absent / gone early, or did
// the depth chart move? If the cause no longer holds this week (the teammate
// is back), the spike game is down-weighted. A dip caused by the player's own
// early exit is flagged. Unexplained spikes keep full weight -- they may be a
// real role change.
//
// MEASURED (Spearman vs actual PPR, fixed grading pool, weeks 3-17):
//
//                          2023-24 (fit)   2025 (held out)   2026 wk1-2
//   L8 raw average            0.242           0.258            0.167
//   L5 alone                  0.294           0.277            0.236
//   L7 alone                  0.289           0.298            0.281
//   L5/L7 50/50 blend         0.297           0.290            0.265
//   blend + spike handling    0.296           0.293            0.262
//
// L5 fits the training years slightly better; L7 wins both out-of-sample
// sets. L5 is better at TE, L7 at QB -- short windows chase QB game script.
// The 50/50 blend is the best fit and is chosen on fit years only. Most of
// the gain over a raw average is the usage mix and the prior, not the window.
//
// SPIKE HANDLING IS PARITY, and every variant tried was: down-weighting
// spikes whose cause is gone (0 / 0.35 / 0.6), up-weighting spikes whose
// cause persists (1.5-2.5x), thresholds 1.4-2x. All landed within +/-0.003
// of spikes-off on both fit and held-out years -- the same result the
// role-change detector found (notification-role-change header). Dropping a
// game the player LEFT EARLY actively hurt RBs (0.306 -> 0.295), so those
// dips are flagged, not dropped. It stays on at the mildest setting because
// its value is the explanation in `notes`, not the ranking.

import { before, mean } from './common.ts';
import type { ModelRow, Pos, StatRow, WeekInput, WeeklyModel } from './types.ts';

export interface RecencyConfig {
  w5: number;            // blend weight on L5 (1 - w5 on L7)
  alpha: number;         // per-game value = alpha*ppr + (1-alpha)*xfp
  kPrior: number;        // games' worth of weight the prior carries
  spikes: boolean;       // investigate spikes/dips
  spikeMult: number;     // usage >= spikeMult * baseline ...
  dipMult: number;       // usage <= dipMult * baseline ...
  wGone: number;         // weight on a spike game whose cause no longer holds
  wPersist: number;      // weight on a spike game whose cause still holds
  dropEarlyExit: boolean;
  questionable: number;  // multiplier for Questionable
}

// Fitted on 2023-2024 weeks 3-17, confirmed on 2025 (held out). See header.
export const RECENCY_DEFAULTS: RecencyConfig = {
  w5: 0.5, alpha: 0.6, kPrior: 2.5,
  spikes: true, spikeMult: 2.0, dipMult: 0.55, wGone: 0.6, wPersist: 1.0,
  dropEarlyExit: false, questionable: 0.93,
};

// Minimum absolute usage swing for a spike/dip to be investigated, per position.
const MIN_SWING: Record<Pos, number> = { QB: 10, RB: 6, WR: 4, TE: 3 };

// Rookie prior by position and draft round (4 = day 3 / undrafted), measured on
// 2021-2025 rookies' weeks 1-4 PPR in games they played.
const ROOKIE_PRIOR: Record<Pos, number[]> = {
  QB: [12.6, 5.0, 3.0, 2.5], RB: [14.2, 8.4, 6.7, 4.4], WR: [11.5, 6.7, 4.6, 3.6], TE: [8.4, 5.5, 5.0, 3.6],
};
const DEPTH_SCALE = [1, 1, 0.55, 0.3];   // index by depth_rank (1-based); 3+ -> 0.3

const usage = (r: StatRow) =>
  r.position === 'QB' ? r.attempts + r.carries
  : r.position === 'RB' ? r.carries + r.targets
  : r.targets;

const gkey = (s: number, w: number) => s * 100 + w;

// Per-position least squares of PPR on usage features, fitted only on rows the
// model is allowed to see.
function features(r: StatRow): number[] {
  switch (r.position) {
    case 'QB': return [1, r.attempts, r.carries];
    case 'RB': return [1, r.carries, r.targets];
    default:   return [1, r.targets, r.receiving_air_yards];
  }
}
function solve(A: number[][], b: number[]) {
  const k = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (M[c][c] === 0) continue;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let j = c; j <= k; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row, i) => (row[i] ? row[k] / row[i] : 0));
}
function fitXfp(rows: StatRow[]) {
  const coef = new Map<Pos, number[]>();
  for (const pos of ['QB', 'RB', 'WR', 'TE'] as Pos[]) {
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
    for (const r of rows) {
      if (r.position !== pos || usage(r) <= 0) continue;
      const x = features(r), y = r.fantasy_pts_ppr ?? 0;
      for (let i = 0; i < 3; i++) { b[i] += x[i] * y; for (let j = 0; j < 3; j++) A[i][j] += x[i] * x[j]; }
    }
    A[0][0] += 1e-6;
    coef.set(pos, solve(A, b));
  }
  return (r: StatRow) => {
    const c = coef.get(r.position)!, x = features(r);
    return Math.max(0, x[0] * c[0] + x[1] * c[1] + x[2] * c[2]);
  };
}

interface Game { r: StatRow; key: number; u: number; v: number; w: number; snapPct: number | null }

export function makeRecency(cfg: Partial<RecencyConfig> = {}): WeeklyModel {
  const C = { ...RECENCY_DEFAULTS, ...cfg };
  return (input: WeekInput): ModelRow[] => {
    const { season, week } = input;
    const stats = input.stats.filter(r => r.season >= season - 2 && before(r.season, r.week, season, week));
    const xfp = fitXfp(stats);

    // Usable history: previous + current season, skipping prior-season week 18.
    const usable = stats.filter(r => r.season >= season - 1 && !(r.week === 18 && r.season < season));

    const hist = new Map<string, StatRow[]>();
    const teamRows = new Map<string, StatRow[]>();       // season|week|team -> rows
    const teamKeys = new Map<string, number[]>();        // team -> game keys
    for (const r of usable) {
      if (!hist.has(r.gsis_id)) hist.set(r.gsis_id, []);
      hist.get(r.gsis_id)!.push(r);
      const tk = `${r.season}|${r.week}|${r.team}`;
      if (!teamRows.has(tk)) {
        teamRows.set(tk, []);
        if (!teamKeys.has(r.team)) teamKeys.set(r.team, []);
        teamKeys.get(r.team)!.push(gkey(r.season, r.week));
      }
      teamRows.get(tk)!.push(r);
    }
    for (const a of hist.values()) a.sort((x, y) => y.season - x.season || y.week - x.week);
    for (const a of teamKeys.values()) a.sort((x, y) => y - x);

    const snapPct = new Map<string, number>();
    for (const s of input.snaps) {
      if (s.gsis_id && s.season >= season - 1 && s.offense_pct != null) snapPct.set(`${s.season}|${s.week}|${s.gsis_id}`, s.offense_pct);
    }
    const report = new Map<string, string>();
    for (const i of input.injuries) {
      if (i.season >= season - 1 && i.report_status) report.set(`${i.season}|${i.week}|${i.gsis_id}`, i.report_status);
    }
    const depthRank = new Map<string, number>();
    for (const d of input.depth) {
      if (!d.gsis_id || d.season < season - 1) continue;
      const k = `${d.season}|${d.week}|${d.gsis_id}`;
      const p = depthRank.get(k);
      if (p == null || d.slot_rank < p) depthRank.set(k, d.slot_rank);
    }
    const inPool = new Map(input.pool.map(p => [p.gsis_id, p]));
    const nameOf = (id: string) => hist.get(id)?.[0]?.player_name ?? inPool.get(id)?.player_name ?? id;

    // Relevant teammates' average usage over the team's 5 games before `key`.
    const teammates = (team: string, pos: Pos, key: number, self: string) => {
      const keys = (teamKeys.get(team) ?? []).filter(k => k < key).slice(0, 5);
      const tot = new Map<string, { u: number; n: number }>();
      for (const k of keys) {
        for (const r of teamRows.get(`${Math.floor(k / 100)}|${k % 100}|${team}`) ?? []) {
          if (r.gsis_id === self) continue;
          const rel = pos === 'WR' || pos === 'TE' ? (r.position === 'WR' || r.position === 'TE') : r.position === pos;
          if (!rel) continue;
          const t = tot.get(r.gsis_id) ?? { u: 0, n: 0 };
          t.u += usage(r); t.n++; tot.set(r.gsis_id, t);
        }
      }
      return [...tot.entries()].map(([id, t]) => ({ id, avg: t.u / Math.max(keys.length, 1), n: t.n }));
    };

    const out: ModelRow[] = [];
    for (const p of input.pool) {
      const h = hist.get(p.gsis_id) ?? [];
      const notes: string[] = [];
      const games: Game[] = h.slice(0, 14).map(r => ({
        r, key: gkey(r.season, r.week), u: usage(r),
        v: C.alpha * (r.fantasy_pts_ppr ?? 0) + (1 - C.alpha) * xfp(r),
        w: 1, snapPct: snapPct.get(`${r.season}|${r.week}|${r.gsis_id}`) ?? null,
      }));

      // Prior: draft capital for rookies / no history; else the player's older
      // games (8-14 back); else a discounted version of what little there is.
      const rd = Math.min(Math.max(p.draft_round ?? 4, 1), 4) - 1;
      const dScale = DEPTH_SCALE[Math.min(p.depth_rank ?? 1, 3)];
      const draftPrior = ROOKIE_PRIOR[p.position][rd] * dScale;
      const older = games.slice(7).map(g => g.v);
      const prior = games.length === 0 ? draftPrior
        : p.rookie ? draftPrior
        : older.length >= 2 ? mean(older)
        : 0.7 * mean(games.map(g => g.v));

      let dropped = 0, flagged = 0;
      if (C.spikes && games.length >= 3) {
        const recent = games.slice(0, 7);
        for (const g of recent) {
          const others = games.filter(x => x !== g).slice(0, 8).map(x => x.u).sort((a, b) => a - b);
          if (others.length < 2) continue;
          const base = others[Math.floor(others.length / 2)];
          const swing = g.u - base;
          const wk = `${g.r.season === season ? '' : g.r.season + ' '}wk${g.r.week}`;
          const isSpike = g.u >= C.spikeMult * Math.max(base, 1) && swing >= MIN_SWING[p.position];
          const isDip = g.u <= C.dipMult * base && -swing >= MIN_SWING[p.position];
          if (!isSpike && !isDip) continue;
          flagged++;

          if (isDip) {
            // Own early exit: snap share far below his norm.
            const norms = recent.filter(x => x !== g && x.snapPct != null).map(x => x.snapPct!);
            const norm = mean(norms);
            const early = g.snapPct != null && g.snapPct < 0.5 && norms.length >= 2 && norm >= 0.6;
            if (early) {
              if (C.dropEarlyExit) { g.w = 0; dropped++; }
              notes.push(`${wk} usage dip (${g.u} vs ${base} typical): left early (${Math.round(g.snapPct! * 100)}% snaps)` +
                (C.dropEarlyExit ? '; playing this week, game dropped' : '; counted as played'));
            }
            continue;
          }

          // Spike: find the cause.
          const tk = `${g.r.season}|${g.r.week}|${g.r.team}`;
          const played = new Set((teamRows.get(tk) ?? []).map(r => r.gsis_id));
          const causes: { id: string; how: string }[] = [];
          for (const m of teammates(g.r.team, p.position, g.key, p.gsis_id)) {
            // A teammate who mattered: at least this player's usual usage.
            if (m.n < 2 || m.avg < Math.max(base, MIN_SWING[p.position])) continue;
            const rep = report.get(`${g.r.season}|${g.r.week}|${m.id}`);
            const sp = snapPct.get(`${g.r.season}|${g.r.week}|${m.id}`);
            if (!played.has(m.id) || rep === 'Out' || rep === 'Doubtful') {
              causes.push({ id: m.id, how: !played.has(m.id) && rep && rep !== 'Out' ? `did not play (${rep})` : rep ?? 'did not play' });
            }
            else if (sp != null && sp < 0.5) causes.push({ id: m.id, how: `left early (${Math.round(sp * 100)}% snaps)` });
          }
          const dNow = depthRank.get(`${season}|${week}|${p.gsis_id}`);
          const dThen = depthRank.get(`${g.r.season}|${g.r.week}|${p.gsis_id}`);
          const dPrev = depthRank.get(`${g.r.season}|${g.r.week - 1}|${p.gsis_id}`);
          const depthUp = dThen != null && dPrev != null && dThen < dPrev;

          const label = `${wk} usage spike (${g.u} vs ${base} typical)`;
          if (causes.length) {
            // Cause still holds unless the teammate is back in the pool on this team.
            const back = causes.filter(c => inPool.get(c.id)?.team === p.team);
            const who = causes.map(c => `${nameOf(c.id)} ${c.how}`).join(', ');
            if (back.length) {
              g.w = C.wGone;
              notes.push(`${label}: ${who}; ${back.map(c => nameOf(c.id)).join(', ')} back this week, spike down-weighted`);
            } else {
              g.w = C.wPersist;
              const why = causes.map(c => {
                const now = inPool.get(c.id);
                return now ? `${nameOf(c.id)} now on ${now.team}` : `${nameOf(c.id)} not active this week`;
              }).join(', ');
              notes.push(`${label}: ${who}; ${why}, spike kept`);
            }
          } else if (depthUp) {
            if (dNow != null && dNow <= dThen!) {
              g.w = C.wPersist;
              notes.push(`${label}: moved up the depth chart (${dPrev} -> ${dThen}); still ${dNow} this week, spike kept`);
            } else {
              g.w = C.wGone;
              notes.push(`${label}: depth chart bump (${dPrev} -> ${dThen}) since reverted, spike down-weighted`);
            }
          }
          // Unexplained spikes keep full weight: they may be a real role change.
        }
      }

      const windowed = (n: number, useW: boolean) => {
        const gs = (useW ? games.filter(g => g.w > 0) : games).slice(0, n);
        const sw = gs.reduce((s, g) => s + (useW ? g.w : 1), 0);
        const sv = gs.reduce((s, g) => s + (useW ? g.w : 1) * g.v, 0);
        return { val: (sv + C.kPrior * prior) / (sw + C.kPrior), n: gs.length };
      };
      const l5 = windowed(5, true), l7 = windowed(7, true);
      let proj = C.w5 * l5.val + (1 - C.w5) * l7.val;
      const plain = C.w5 * windowed(5, false).val + (1 - C.w5) * windowed(7, false).val;
      if (p.injury_status === 'Questionable') proj *= C.questionable;

      out.push({
        gsis_id: p.gsis_id, position: p.position, proj,
        notes: notes.length ? notes : undefined,
        detail: {
          l5: +l5.val.toFixed(2), l7: +l7.val.toFixed(2), blend: +proj.toFixed(2),
          games: games.length, prior: +prior.toFixed(2),
          spike_adj: +(C.w5 * l5.val + (1 - C.w5) * l7.val - plain).toFixed(2),
          flagged, dropped,
        },
      });
    }
    return out;
  };
}

export const modelRecency: WeeklyModel = makeRecency();
