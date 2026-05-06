// Custom Rankings Quiz — engine.
// computeDimensions: aggregates answer deltas → 8 dimension scores (0-100)
// generateRankingsFromQuiz: applies dimensions + position overrides to produce
//                           a personalized ranked list (Method 3 from the spec)
// save/loadQuizResult:      AsyncStorage persistence under key 'quiz_result_v1'
// getStrongestDimensions:   top-N dimensions by distance from neutral (50)

import AsyncStorage from '@react-native-async-storage/async-storage';

import { assignGlobalTier } from '../rankings/aiomniEngineBridge';
import { getAllActivePlayers } from '../nflPlayers';
import type { RankedPlayer, ScoringFormat } from '../rankingsData';

import { getDNALabel } from './dnaLabels';
import { PLAYER_TAGS } from './playerTags';
import {
  QUESTION_DIMENSION_MAP,
  QUESTIONS,
  getRankDeltas,
} from './questionBank';
import {
  ALL_DIMENSIONS,
  type Dimension,
  type PositionRanking,
  type QuizAnswer,
  type QuizResult,
} from './types';

const STORAGE_KEY = 'quiz_result_v1';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ─── computeDimensions ─────────────────────────────────────────────
export function computeDimensions(answers: QuizAnswer[]): Record<Dimension, number> {
  const dims: Record<Dimension, number> = ALL_DIMENSIONS.reduce(
    (acc, d) => ({ ...acc, [d]: 50 }),
    {} as Record<Dimension, number>,
  );

  for (const answer of answers) {
    const q = QUESTIONS.find(qq => qq.id === answer.questionId);
    if (!q) continue;

    if (q.type === 'binary') {
      const map = QUESTION_DIMENSION_MAP[q.id]?.[answer.value as string];
      if (map) {
        for (const [dim, delta] of Object.entries(map)) {
          dims[dim as Dimension] += delta as number;
        }
      }
    } else if (q.type === 'rank') {
      const deltas = getRankDeltas(q.id, answer.value as string[]);
      for (const [dim, delta] of Object.entries(deltas)) {
        dims[dim as Dimension] += delta as number;
      }
    } else if (q.type === 'slider' && q.id === 'q6_qb_urgency') {
      const value = answer.value as number;
      // linear: delta = value - 50, applied on top of starting 50 → final = value
      dims.qb_urgency = value;
    }
  }

  // Clamp all dimensions to [0, 100]
  for (const d of ALL_DIMENSIONS) {
    dims[d] = clamp(dims[d], 0, 100);
  }
  return dims;
}

// ─── generateRankingsFromQuiz (Method 3) ───────────────────────────
export async function generateRankingsFromQuiz(
  dimensions: Record<Dimension, number>,
  positionRanks: PositionRanking[],
  baseFormula: RankedPlayer[],
  _format: ScoringFormat,
): Promise<RankedPlayer[]> {
  // Build years_exp lookup from Sleeper player metadata for rookie /
  // established detection. Falls back to {} if the cache isn't ready.
  let yearsExpMap: Record<string, number | null> = {};
  try {
    const players = await getAllActivePlayers();
    yearsExpMap = players.reduce((acc, p: any) => {
      if (p.sleeperId) acc[p.sleeperId] = p.yearsExp ?? null;
      return acc;
    }, {} as Record<string, number | null>);
  } catch {
    // Non-fatal: rookie/established checks fall through to neutral.
  }

  // Step 1 — base scoreMap from formula rank
  const N = baseFormula.length;
  const scoreMap = new Map<string, number>();
  for (const p of baseFormula) {
    scoreMap.set(p.id, N - p.rank);
  }

  const d = dimensions;

  // Step 2 — per-player dimension adjustments
  for (const p of baseFormula) {
    let score = scoreMap.get(p.id) ?? 0;
    const sleeperId = (p as any).sleeperId ?? p.id;
    const yearsExp = yearsExpMap[sleeperId];
    const tag = PLAYER_TAGS[sleeperId];

    // floor / ceiling — proxied via tier
    if (d.floor_ceiling > 50 && p.tier >= 4) score += (d.floor_ceiling - 50) * 0.5;
    if (d.floor_ceiling < 50 && p.tier <= 2) score += (50 - d.floor_ceiling) * 0.5;

    // established / ascending — trend + years_exp
    const isAscending   = p.trend === 'up' || (yearsExp != null && yearsExp <= 2);
    const isEstablished = p.trend === 'flat' && yearsExp != null && yearsExp >= 5;
    if (d.established_ascending > 50 && isAscending)   score += (d.established_ascending - 50) * 0.4;
    if (d.established_ascending < 50 && isEstablished) score += (50 - d.established_ascending) * 0.4;

    // volume / efficiency — curated tag required
    if (d.volume_efficiency > 50 && tag?.style === 'efficiency') score += (d.volume_efficiency - 50) * 0.4;
    if (d.volume_efficiency < 50 && tag?.style === 'volume')     score += (50 - d.volume_efficiency) * 0.4;

    // pass-catching RB — curated tag required
    if (d.pass_catching_rb > 50 && tag?.pcRb)        score += (d.pass_catching_rb - 50) * 0.5;
    if (d.pass_catching_rb < 50 && tag?.pureRusher)  score += (50 - d.pass_catching_rb) * 0.5;

    // TE premium — applies to all TEs
    if (p.position === 'TE') {
      if (d.te_premium > 50) score += (d.te_premium - 50) * 0.6;
      else                    score -= (50 - d.te_premium) * 0.6;
    }

    // QB urgency — applies to all QBs
    if (p.position === 'QB') {
      if (d.qb_urgency > 50) score += (d.qb_urgency - 50) * 0.7;
      else                    score -= (50 - d.qb_urgency) * 0.7;
    }

    // Injury discount — uses injuryStatus
    const inj = p.injuryStatus;
    const hasInjuryFlag = !!inj && inj !== 'ACTIVE' && inj !== 'Healthy';
    if (hasInjuryFlag) {
      if (d.injury_discount < 50) score -= (50 - d.injury_discount) * 0.5;
      if (d.injury_discount > 50) score += (d.injury_discount - 50) * 0.3;
    }

    // Rookie aggression — uses years_exp
    const isRookie = yearsExp === 0 || yearsExp == null;
    if (isRookie) {
      if (d.rookie_aggression > 50) score += (d.rookie_aggression - 50) * 0.5;
      if (d.rookie_aggression < 50) score -= (50 - d.rookie_aggression) * 0.3;
    }

    // RB vs WR priority — early-round positional bias only.
    // Applied to top-tier players (tier <= 3, ~30 players) so it shifts
    // close RB/WR pairs in Rounds 1-3 without distorting the rest of the list.
    if (p.tier <= 3) {
      if (d.rb_vs_wr_priority > 50 && p.position === 'RB') score += (d.rb_vs_wr_priority - 50) * 0.4;
      if (d.rb_vs_wr_priority > 50 && p.position === 'WR') score -= (d.rb_vs_wr_priority - 50) * 0.4;
      if (d.rb_vs_wr_priority < 50 && p.position === 'WR') score += (50 - d.rb_vs_wr_priority) * 0.4;
      if (d.rb_vs_wr_priority < 50 && p.position === 'RB') score -= (50 - d.rb_vs_wr_priority) * 0.4;
    }

    scoreMap.set(p.id, score);
  }

  // Step 3 — direct overrides from positionRanks
  for (const pr of positionRanks) {
    if (pr.rankedPlayerIds.length === 0) continue; // skipped position

    const positionPlayers = baseFormula.filter(p => p.position === pr.position);
    const maxPositionScore = positionPlayers.length > 0
      ? Math.max(...positionPlayers.map(p => scoreMap.get(p.id) ?? 0))
      : 0;

    pr.rankedPlayerIds.forEach((playerId, i) => {
      // Highest user-rank gets the biggest bump above the rest of position
      scoreMap.set(playerId, maxPositionScore + 100 + (pr.rankedPlayerIds.length - i));
    });
  }

  // Step 4 — re-sort, regenerate rank + tier
  const sorted = [...baseFormula].sort((a, b) => {
    const sA = scoreMap.get(a.id) ?? 0;
    const sB = scoreMap.get(b.id) ?? 0;
    return sB - sA;
  });

  return sorted.map((p, i) => ({
    ...p,
    rank: i + 1,
    tier: assignGlobalTier(i + 1),
  }));
}

// ─── Persistence ────────────────────────────────────────────────────
export async function saveQuizResult(result: QuizResult): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(result));
}

export async function loadQuizResult(): Promise<QuizResult | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as QuizResult;
  } catch {
    return null;
  }
}

export async function clearQuizResult(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

// ─── getStrongestDimensions ────────────────────────────────────────
export function getStrongestDimensions(
  dims: Record<Dimension, number>,
  n = 3,
): Array<{ dim: Dimension; score: number; label: string; desc: string }> {
  return ALL_DIMENSIONS
    .map(dim => ({ dim, score: dims[dim], distance: Math.abs(dims[dim] - 50) }))
    .sort((a, b) => b.distance - a.distance)
    .slice(0, n)
    .map(({ dim, score }) => ({ dim, score, ...getDNALabel(dim, score) }));
}
