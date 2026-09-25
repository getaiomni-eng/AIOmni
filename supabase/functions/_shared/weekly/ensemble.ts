// The weekly ensemble: recency + matchup + context + the manual top 25.
//
// AVERAGE RANKS, NOT POINTS. The three models project points, but the manual
// list is only an order, and the models' point scales differ (a model that
// shrinks harder compresses everyone toward the mean). Ranks put all four on
// one scale, so each gets exactly the equal vote the ensemble promises.
//
// PLAYERS OUTSIDE THE MANUAL 25. Treating them as "unranked" would drop the
// manual vote and let a player the user deliberately left out float above one
// they put 25th. Treating them as rank 26 would drag a model-consensus RB30
// UP to 26. So an unlisted player's manual rank is max(26, his mean model
// rank): never above anyone listed, never moved up by his own absence.
//
// When no manual list is saved for a position-week, the ensemble is the three
// models alone.

import { mean, POSITIONS, positionRanks } from './common.ts';
import type { ModelRow, PoolPlayer, Pos, WeekInput, WeeklyModel } from './types.ts';

export interface ManualRow { position: Pos; rank: number; gsis_id: string }

export interface EnsembleRow {
  gsis_id: string; position: Pos;
  pos_rank: number;
  score: number;                       // mean component rank, lower is better
  ranks: Record<string, number | null>; // per component; manual null when not listed
  proj_pts: number | null;             // mean of model projections
  notes: string[];
}

export function ensemble(
  pool: PoolPlayer[],
  outputs: Record<string, ModelRow[]>,
  manual: ManualRow[] = [],
): EnsembleRow[] {
  const inPool = new Set(pool.map(p => p.gsis_id));
  const models = Object.keys(outputs);
  const rankBy: Record<string, Map<string, number>> = {};
  const projBy: Record<string, Map<string, number>> = {};
  const notesBy = new Map<string, string[]>();
  for (const m of models) {
    const rows = outputs[m].filter(r => inPool.has(r.gsis_id) && isFinite(r.proj));
    rankBy[m] = positionRanks(rows);
    projBy[m] = new Map(rows.map(r => [r.gsis_id, r.proj]));
    for (const r of rows) for (const n of r.notes ?? []) {
      const a = notesBy.get(r.gsis_id) ?? [];
      a.push(`${m}: ${n}`);
      notesBy.set(r.gsis_id, a);
    }
  }
  const manualRank = new Map(manual.map(m => [m.gsis_id, m.rank]));
  const manualPositions = new Set(manual.map(m => m.position));

  const out: EnsembleRow[] = [];
  for (const pos of POSITIONS) {
    const rows = pool.filter(p => p.position === pos).map(p => {
      const ranks: Record<string, number | null> = {};
      const modelRanks: number[] = [];
      for (const m of models) {
        const r = rankBy[m].get(p.gsis_id);
        ranks[m] = r ?? null;
        if (r != null) modelRanks.push(r);
      }
      const comps = [...modelRanks];
      if (manualPositions.has(pos)) {
        const mr = manualRank.get(p.gsis_id);
        ranks.manual = mr ?? null;
        comps.push(mr ?? Math.max(26, modelRanks.length ? mean(modelRanks) : 26));
      }
      const projs = models.map(m => projBy[m].get(p.gsis_id)).filter((x): x is number => x != null);
      return {
        gsis_id: p.gsis_id, position: pos, pos_rank: 0,
        score: comps.length ? mean(comps) : Infinity,
        ranks, proj_pts: projs.length ? mean(projs) : null,
        notes: notesBy.get(p.gsis_id) ?? [],
      };
    }).filter(r => isFinite(r.score));
    rows.sort((a, b) => a.score - b.score || (b.proj_pts ?? 0) - (a.proj_pts ?? 0));
    rows.forEach((r, i) => { r.pos_rank = i + 1; });
    out.push(...rows);
  }
  return out;
}

// One overall order across positions, for the app's "All" view.
//
// Must never contradict the position order: WR5 always sits above WR6. So
// each position's k-th slot gets the k-th highest projection AT THAT
// POSITION (not necessarily the same player's own projection), and slots are
// compared by value over a replacement-level starter in a 12-team league
// (QB13, RB30, WR42, TE13). Raw points would bury every RB under 20 QBs;
// value over replacement is the standard way to put a QB beside a RB.
const REPLACEMENT: Record<Pos, number> = { QB: 13, RB: 30, WR: 42, TE: 13 };

export function overallRanks(rows: EnsembleRow[]): Map<string, number> {
  const scored: { id: string; vor: number; posRank: number }[] = [];
  for (const pos of POSITIONS) {
    const inPos = rows.filter(r => r.position === pos).sort((a, b) => a.pos_rank - b.pos_rank);
    const slots = inPos.map(r => r.proj_pts ?? 0).sort((a, b) => b - a);
    if (!slots.length) continue;
    const repl = slots[Math.min(REPLACEMENT[pos], slots.length) - 1];
    inPos.forEach((r, i) => scored.push({ id: r.gsis_id, vor: slots[i] - repl, posRank: r.pos_rank }));
  }
  scored.sort((a, b) => b.vor - a.vor || a.posRank - b.posRank);
  return new Map(scored.map((s, i) => [s.id, i + 1]));
}

// The model-only ensemble as a WeeklyModel, so the backtest can grade it.
export function ensembleModel(models: Record<string, WeeklyModel>): WeeklyModel {
  return (input: WeekInput) => {
    const outputs: Record<string, ModelRow[]> = {};
    for (const [k, m] of Object.entries(models)) outputs[k] = m(input);
    return ensemble(input.pool, outputs).map(r => ({ gsis_id: r.gsis_id, position: r.position, proj: -r.score }));
  };
}
