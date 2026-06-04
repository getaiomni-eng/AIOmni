// The 9 universal preference questions for the AIOmni Custom Rankings Quiz.
// Question text + dimension delta mappings. Player references refreshed for
// the 2026 season (grounded in the live AIOmni v2 rankings) — keep these
// current as rankings/teams move; the dimension mappings below are what the
// engine reads, so prompts/labels can be edited freely as long as each
// question's A/B keeps the same directional meaning.

import type { Dimension, QuizQuestion } from './types';

export const QUESTIONS: QuizQuestion[] = [
  {
    id: 'q1_floor_ceiling',
    phase: 1,
    type: 'binary',
    prompt: "Pick 5 overall. Two backs left on the board, same projected points. Who do you take?",
    optionA: { label: 'Jonathan Taylor — workhorse volume, ~90% to finish top-12, limited boom weeks', value: 'A' },
    optionB: { label: "De'Von Achane — game-breaking ceiling, 35% shot at overall RB1, boom-or-bust", value: 'B' },
  },
  {
    id: 'q2_volume_efficiency',
    phase: 1,
    type: 'binary',
    prompt: 'Same projected fantasy points, Round 4. Who do you draft?',
    optionA: { label: 'David Montgomery — high-volume early-down grinder in Houston, safe touches but TD-dependent', value: 'A' },
    optionB: { label: 'Omarion Hampton — fewer guaranteed touches but explosive, ascending efficiency and breakaway upside', value: 'B' },
  },
  {
    id: 'q9_rb_vs_wr_priority',
    phase: 1,
    type: 'binary',
    prompt: 'Pick 3 overall. Bijan Robinson and Ja’Marr Chase both available, same projected points. Pick one.',
    optionA: { label: 'Bijan Robinson — RB1 in a top-3 offense, 300 touches projected',        value: 'A' },
    optionB: { label: 'Ja’Marr Chase — WR1 with target monopoly, ~165 targets projected',      value: 'B' },
  },
  {
    id: 'q3_established_ascending',
    phase: 1,
    type: 'rank',
    prompt: 'Rank your top 3 WR2 targets for Round 3.',
    rankTopN: 3,
    rankOptions: [
      { id: 'collins',  label: 'Nico Collins',         sublabel: 'HOU, proven alpha, locked-in target share' },
      { id: 'higgins',  label: 'Tee Higgins',          sublabel: 'CIN, established, steady WR2 next to Chase' },
      { id: 'olave',    label: 'Chris Olave',          sublabel: 'NO, talented but multiple concussions' },
      { id: 'tmac',     label: 'Tetairoa McMillan',    sublabel: 'CAR, Year 2, ascending young alpha' },
      { id: 'jameson',  label: 'Jameson Williams',     sublabel: 'DET, ascending, elite big-play speed' },
      { id: 'devonta',  label: 'DeVonta Smith',        sublabel: 'PHI, now the clear WR1 after the A.J. Brown trade' },
    ],
  },
  {
    id: 'q4_pass_catching_rb',
    phase: 1,
    type: 'binary',
    prompt: 'Round 5. PPR league. Pick one.',
    optionA: { label: 'Kyren Williams — 280 carries / ~20 catches, TD-dependent ground grinder', value: 'A' },
    optionB: { label: 'Breece Hall — 230 touches with 60+ targets, true three-down PPR back',     value: 'B' },
  },
  {
    id: 'q5_te_premium',
    phase: 1,
    type: 'binary',
    prompt: "It's Round 2. Pick your strategy.",
    optionA: { label: 'Take Trey McBride — the clear TE1, elite target share, positional edge locked in',           value: 'A' },
    optionB: { label: 'Skip TE — grab a WR/RB now, stream the Hockenson / Kraft tier around Round 8',               value: 'B' },
  },
  {
    id: 'q6_qb_urgency',
    phase: 1,
    type: 'slider',
    prompt: 'When do you typically draft QB1?',
    sliderMin: 0,
    sliderMax: 100,
    sliderLabels: [
      { value: 0,   label: 'Round 12+' },
      { value: 25,  label: 'Round 8-10' },
      { value: 50,  label: 'Round 6-7' },
      { value: 75,  label: 'Round 4-5' },
      { value: 100, label: 'Round 2-3' },
    ],
  },
  {
    id: 'q7_injury_discount',
    phase: 1,
    type: 'binary',
    prompt: 'Christian McCaffrey is on the board at his ADP (Round 3). Elite when healthy, but he’s now on the wrong side of 29 with a recent injury history.',
    optionA: { label: "Take him — the ceiling when healthy still wins leagues",      value: 'A' },
    optionB: { label: "Pass — the body's a risk at his age, take a younger RB",      value: 'B' },
  },
  {
    id: 'q8_rookie_aggression',
    phase: 1,
    type: 'binary',
    prompt: 'Round 4, same projected fantasy points. A hyped Year-1 rookie RB with a path to lead his backfield, or a proven veteran RB locked into a featured role on another team. Who do you take?',
    optionA: { label: 'Reach for the rookie — Year-1 alpha upside is the league-winning play',  value: 'A' },
    optionB: { label: 'Take the veteran — proven floor matters, rookies bust at high rates',    value: 'B' },
  },
];

// ─── Dimension delta map (binary answers) ───────────────────────────
// For binary questions only. Q3 (rank) uses getRankDeltas; Q6 (slider)
// is handled inline in computeDimensions.

export const QUESTION_DIMENSION_MAP: Record<
  string,
  Record<string, Partial<Record<Dimension, number>>>
> = {
  q1_floor_ceiling: {
    A: { floor_ceiling: -15, established_ascending: -10 },
    B: { floor_ceiling: +15, established_ascending: +10 },
  },
  q2_volume_efficiency: {
    // Two-fold read: Montgomery = volume + floor, Hampton = efficiency + ceiling.
    A: { volume_efficiency: -15, floor_ceiling: -10 },
    B: { volume_efficiency: +15, floor_ceiling: +10 },
  },
  q9_rb_vs_wr_priority: {
    A: { rb_vs_wr_priority: +15 },
    B: { rb_vs_wr_priority: -15 },
  },
  q4_pass_catching_rb: {
    A: { pass_catching_rb: -15 },
    B: { pass_catching_rb: +15 },
  },
  q5_te_premium: {
    A: { te_premium: +15 },
    B: { te_premium: -15 },
  },
  q7_injury_discount: {
    A: { injury_discount: +15 },
    B: { injury_discount: -15 },
  },
  q8_rookie_aggression: {
    A: { rookie_aggression: +15 },
    B: { rookie_aggression: -15 },
  },
};

// ─── Rank-question delta logic ──────────────────────────────────────
// Q3 — top-3 WR2 targets. The user's choices reveal both
// established_ascending and injury_discount postures.
//   established (veteran trust): collins, higgins
//   ascending  (breakout hunt):  tmac, jameson, devonta
//   injury flag:                 olave (concussion history)

export function getRankDeltas(
  questionId: string,
  rankedIds: string[],
): Partial<Record<Dimension, number>> {
  const deltas: Partial<Record<Dimension, number>> = {};

  if (questionId === 'q3_established_ascending') {
    const top2 = rankedIds.slice(0, 2);
    const top3 = rankedIds.slice(0, 3);

    // Established (Collins, Higgins) in top 2 → veteran trust signal
    if (top2.includes('collins')) {
      deltas.established_ascending = (deltas.established_ascending ?? 0) - 10;
      deltas.injury_discount       = (deltas.injury_discount ?? 0) - 8;
    }
    if (top2.includes('higgins')) {
      deltas.established_ascending = (deltas.established_ascending ?? 0) - 6;
    }

    // Ascending names in top 2 → breakout-hunter signal
    const ascendingIds = ['tmac', 'jameson', 'devonta'];
    const ascendingInTop2 = top2.filter(id => ascendingIds.includes(id)).length;
    if (ascendingInTop2 >= 1) {
      deltas.established_ascending = (deltas.established_ascending ?? 0) + 10;
    }
    if (ascendingInTop2 === 2) {
      deltas.established_ascending = (deltas.established_ascending ?? 0) + 5;
    }

    // Injury-prone (Olave) in top 3 → willing to take injury risk
    if (top3.includes('olave')) {
      deltas.injury_discount = (deltas.injury_discount ?? 0) + 8;
    }

    // Collins at #1 → strongest veteran-trust signal
    if (rankedIds[0] === 'collins') {
      deltas.established_ascending = (deltas.established_ascending ?? 0) - 5;
    }

    // TMac or DeVonta at #1 → strongest ascending signal
    if (rankedIds[0] === 'tmac' || rankedIds[0] === 'devonta') {
      deltas.established_ascending = (deltas.established_ascending ?? 0) + 5;
    }
  }

  return deltas;
}
