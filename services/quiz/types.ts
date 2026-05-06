// Custom Rankings Quiz — type definitions.
// See ~/Downloads/quiz_design_spec.md for the full design.

import type { RankedPlayer } from '../rankingsData';

export type QuestionType = 'binary' | 'rank' | 'slider';
export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K';
export type Dimension =
  | 'floor_ceiling'
  | 'established_ascending'
  | 'volume_efficiency'
  | 'pass_catching_rb'
  | 'te_premium'
  | 'qb_urgency'
  | 'injury_discount'
  | 'rookie_aggression'
  | 'rb_vs_wr_priority';

export const ALL_DIMENSIONS: Dimension[] = [
  'floor_ceiling',
  'established_ascending',
  'volume_efficiency',
  'pass_catching_rb',
  'te_premium',
  'qb_urgency',
  'injury_discount',
  'rookie_aggression',
  'rb_vs_wr_priority',
];

export interface QuizQuestion {
  id: string;
  phase: 1 | 2;
  type: QuestionType;
  prompt: string;
  helpText?: string;
  // Binary
  optionA?: { label: string; value: string };
  optionB?: { label: string; value: string };
  // Rank
  rankOptions?: { id: string; label: string; sublabel?: string }[];
  rankTopN?: number;
  // Slider
  sliderMin?: number;
  sliderMax?: number;
  sliderLabels?: { value: number; label: string }[];
}

export interface QuizAnswer {
  questionId: string;
  // binary: 'A' | 'B', rank: ordered string ids, slider: number
  value: string | string[] | number;
}

export interface PositionRanking {
  position: Position;
  rankedPlayerIds: string[]; // 0-10 entries, in user's rank order
}

export interface QuizResult {
  userId: string; // 'local' for v1; can be Supabase user id later
  completedAt: string; // ISO
  answers: QuizAnswer[];
  positionRanks: PositionRanking[];
  dimensions: Record<Dimension, number>; // each 0-100
  generatedRankings: RankedPlayer[];
}
