// services/heat.ts
// The Heat engine — unifies momentum signals across Sleeper, ESPN, Yahoo
// into a single 0-100 score. This is AIOmni's proprietary synthesis.
//
// Sleeper gives you trending adds (velocity). ESPN gives you percent owned
// (stock). Yahoo gives you sort order (ranked opinion). Each alone is noisy.
// Combined and normalized, they tell you how fast a player's fantasy value
// is changing — the one question every manager asks before a waiver move.

import type { HeatSignals, HeatDirection } from './platform/types';

// ─── TUNABLE WEIGHTS ────────────────────────────────────────
// Sum to 1.0. Encodes our opinion about which signals are most trustworthy.
// Heat predictive-accuracy tracking (did Heat 85+ actually post top-20 weeks?)
// will self-tune these over the season.

const WEIGHTS = {
  velocity:  0.50,  // Sleeper add/drop rate — most timely
  ownership: 0.30,  // ESPN/Yahoo percent-owned delta — most stable
  ranking:   0.20,  // AIOmni consensus rank movement — our own signal
} as const;

// ─── CORE COMPUTATION ───────────────────────────────────────

export interface HeatResult {
  score: number;                 // 0-100
  direction: HeatDirection;
  contributingSignals: string[]; // which signals fed in, for the "why" explainer
  components: {
    velocity: number | null;
    ownership: number | null;
    ranking: number | null;
  };
}

export function computeHeat(signals: HeatSignals): HeatResult {
  const components = {
    velocity: velocityScore(signals),
    ownership: ownershipScore(signals),
    ranking: rankingScore(signals),
  };

  // Redistribute weight across available signals. If user only has Sleeper,
  // velocity gets effectively 100% weight.
  const available: { key: keyof typeof WEIGHTS; score: number; weight: number }[] = [];
  if (components.velocity !== null)  available.push({ key: 'velocity', score: components.velocity, weight: WEIGHTS.velocity });
  if (components.ownership !== null) available.push({ key: 'ownership', score: components.ownership, weight: WEIGHTS.ownership });
  if (components.ranking !== null)   available.push({ key: 'ranking', score: components.ranking, weight: WEIGHTS.ranking });

  if (available.length === 0) {
    return { score: 0, direction: 'flat', contributingSignals: [], components };
  }

  const totalWeight = available.reduce((s, c) => s + c.weight, 0);
  const weightedSum = available.reduce((s, c) => s + c.score * c.weight, 0);
  const score = Math.max(0, Math.min(100, Math.round(weightedSum / totalWeight)));

  return {
    score,
    direction: inferDirection(signals),
    contributingSignals: available.map(c => c.key),
    components,
  };
}

// ─── COMPONENT SCORERS ──────────────────────────────────────
// Return null when platform provided no signal — this lets us redistribute
// weight. Returning 0 would instead penalize players on platforms without
// that data.

/**
 * Velocity: Sleeper adds minus drops, log-scaled.
 *   < 100 net adds   → cold (0-20)
 *   ~1,000           → warm (~50)
 *   ~10,000          → hot (~80)
 *   50,000+          → scorching (95+)
 */
function velocityScore(s: HeatSignals): number | null {
  if (s.addsLast48h === undefined && s.dropsLast48h === undefined) return null;

  const net = (s.addsLast48h ?? 0) - (s.dropsLast48h ?? 0);
  if (net === 0) return 50;

  const sign = net > 0 ? 1 : -1;
  const magnitude = Math.log10(Math.abs(net) + 1);
  const deflection = Math.min(50, magnitude * 12);

  return 50 + sign * deflection;
}

/**
 * Ownership: current percent-owned + 7-day delta.
 * High + rising = very hot. High + falling = cooling. Low + rising = breakout.
 */
function ownershipScore(s: HeatSignals): number | null {
  if (s.percentOwned === undefined && s.ownershipDelta7d === undefined) return null;

  const owned = s.percentOwned ?? 0;
  const delta = s.ownershipDelta7d ?? 0;

  // Base: 20-80 range. Fully-owned isn't max heat ("already everywhere" = no momentum).
  const ownershipBase = 20 + (owned * 0.6);
  // Delta: ±20 points
  const deltaBonus = Math.max(-20, Math.min(20, delta));

  return Math.max(0, Math.min(100, ownershipBase + deltaBonus));
}

/**
 * Ranking: consensus rank movement over 7 days. Negative = rising.
 *   -10 spots → 80
 *     0 spots → 50
 *    +10 spots → 20
 */
function rankingScore(s: HeatSignals): number | null {
  if (s.rankDelta7d === undefined) return null;

  const adjustment = Math.max(-50, Math.min(50, -s.rankDelta7d * 3));
  return Math.max(0, Math.min(100, 50 + adjustment));
}

function inferDirection(s: HeatSignals): HeatDirection {
  // Priority: velocity > ownership delta > rank delta
  if (s.addsLast48h !== undefined || s.dropsLast48h !== undefined) {
    const net = (s.addsLast48h ?? 0) - (s.dropsLast48h ?? 0);
    if (net > 500) return 'up';
    if (net < -500) return 'down';
    return 'flat';
  }
  if (s.ownershipDelta7d !== undefined) {
    if (s.ownershipDelta7d > 3) return 'up';
    if (s.ownershipDelta7d < -3) return 'down';
    return 'flat';
  }
  if (s.rankDelta7d !== undefined) {
    if (s.rankDelta7d < -2) return 'up';
    if (s.rankDelta7d > 2) return 'down';
    return 'flat';
  }
  return 'flat';
}

// ─── EXPLAINER ──────────────────────────────────────────────
// Powers the "why" behind a Heat score — used in Heat Reports and player cards.

export function explainHeat(
  playerName: string,
  signals: HeatSignals,
  result: HeatResult
): string {
  const parts: string[] = [];

  if (signals.addsLast48h && signals.addsLast48h > 1000) {
    parts.push(`added in ${signals.addsLast48h.toLocaleString()} Sleeper leagues in 48h`);
  }
  if (signals.dropsLast48h && signals.dropsLast48h > 1000) {
    parts.push(`dropped in ${signals.dropsLast48h.toLocaleString()} leagues`);
  }
  if (signals.ownershipDelta7d !== undefined && Math.abs(signals.ownershipDelta7d) > 3) {
    const dir = signals.ownershipDelta7d > 0 ? 'rose' : 'fell';
    parts.push(`ownership ${dir} ${Math.abs(signals.ownershipDelta7d).toFixed(0)} points this week`);
  }
  if (signals.rankDelta7d !== undefined && Math.abs(signals.rankDelta7d) >= 5) {
    const dir = signals.rankDelta7d < 0 ? 'climbed' : 'dropped';
    parts.push(`${dir} ${Math.abs(signals.rankDelta7d)} spots in consensus rankings`);
  }

  if (parts.length === 0) {
    return `${playerName}: stable across all signals (Heat ${result.score}).`;
  }
  return `${playerName} is Heat ${result.score} because ${parts.join(', ')}.`;
}

// ─── BATCH UTILITY ──────────────────────────────────────────

export function computeHeatBatch<T extends { heatSignals?: HeatSignals }>(
  players: T[]
): (T & { heatScore: number; heatDirection: HeatDirection })[] {
  return players.map(p => {
    if (!p.heatSignals) {
      return { ...p, heatScore: 0, heatDirection: 'flat' as HeatDirection };
    }
    const result = computeHeat(p.heatSignals);
    return { ...p, heatScore: result.score, heatDirection: result.direction };
  });
}

// ─── UI LABELS ──────────────────────────────────────────────

export function heatLabel(score: number): string {
  if (score >= 85) return 'SCORCHING';
  if (score >= 70) return 'HOT';
  if (score >= 55) return 'WARM';
  if (score >= 40) return 'COOLING';
  if (score >= 25) return 'COLD';
  return 'FROZEN';
}
