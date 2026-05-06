// The 8 universal preference questions for the AIOmni Custom Rankings Quiz.
// Question text + dimension delta mappings as specified in the design doc
// (~/Downloads/quiz_design_spec.md).

import type { Dimension, QuizQuestion } from './types';

export const QUESTIONS: QuizQuestion[] = [
  {
    id: 'q1_floor_ceiling',
    phase: 1,
    type: 'binary',
    prompt: "You're picking your RB1 with the 5th overall pick. Who do you take?",
    optionA: { label: 'Saquon Barkley — 95% chance to finish top-12, 15% chance top-3', value: 'A' },
    optionB: { label: "De'Von Achane — 60% chance to finish top-12, 35% chance top-3",  value: 'B' },
  },
  {
    id: 'q2_volume_efficiency',
    phase: 1,
    type: 'binary',
    prompt: 'Same projected fantasy points, Round 4. Who do you draft?',
    optionA: { label: 'Chuba Hubbard — 265 touches projected, 4.1 YPC, lead back on a rebuilding offense', value: 'A' },
    optionB: { label: 'Bucky Irving — 200 touches projected, 5.4 YPC, top-10 offense',                    value: 'B' },
  },
  {
    id: 'q9_rb_vs_wr_priority',
    phase: 1,
    type: 'binary',
    prompt: 'Pick 3 overall. Bijan Robinson and Ja’Marr Chase both available. Same projected fantasy points. Pick one.',
    optionA: { label: 'Bijan Robinson — RB1 in a top-3 offense, 300 touches projected',          value: 'A' },
    optionB: { label: 'Ja’Marr Chase — WR1 with target monopoly, ~165 targets projected',   value: 'B' },
  },
  {
    id: 'q3_established_ascending',
    phase: 1,
    type: 'rank',
    prompt: 'Drag your top 3 WR2 targets in Round 3.',
    rankTopN: 3,
    rankOptions: [
      { id: 'diggs',  label: 'Stefon Diggs',         sublabel: 'Age 32, NE, last elite year was 2023' },
      { id: 'mhj',    label: 'Marvin Harrison Jr.',  sublabel: 'Year 3, ARI, ascending alpha' },
      { id: 'jeudy',  label: 'Jerry Jeudy',          sublabel: 'Year 7, CLE, finally consistent' },
      { id: 'olave',  label: 'Chris Olave',          sublabel: 'Year 4, NO, multiple concussion history' },
      { id: 'worthy', label: 'Xavier Worthy',        sublabel: 'Year 3, KC, breakout candidate' },
      { id: 'nabers', label: 'Malik Nabers',         sublabel: 'Year 3, NYG, ascending' },
    ],
  },
  {
    id: 'q4_pass_catching_rb',
    phase: 1,
    type: 'binary',
    prompt: 'Round 5. PPR league. Pick one.',
    optionA: { label: "Kyren Williams — 275 rushes / 25 catches projected, McVay's volume grinder", value: 'A' },
    optionB: { label: 'Ashton Jeanty — 230 rushes / 65 catches projected, three-down workhorse',     value: 'B' },
  },
  {
    id: 'q5_te_premium',
    phase: 1,
    type: 'binary',
    prompt: "It's Round 2. Pick your strategy.",
    optionA: { label: 'Take Brock Bowers — TE1 last year, 13 TDs, positional advantage locked in',                       value: 'A' },
    optionB: { label: 'Skip TE entirely — wait until Round 8 for value (Kelce / Hockenson tier), grab a WR/RB now',      value: 'B' },
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
    prompt: 'Christian McCaffrey is on the board at his ADP (Round 3). His last 2 seasons: 17 games, then 4 games.',
    optionA: { label: "Take him — too much upside to pass, he's healthy now",         value: 'A' },
    optionB: { label: "Pass — body's breaking down, take a healthier RB",             value: 'B' },
  },
  {
    id: 'q8_rookie_aggression',
    phase: 1,
    type: 'binary',
    prompt: 'Round 4. A rookie RB just drafted #5 overall has the same projected points as a Year-6 veteran already established as RB2 on his team.',
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
    A: { volume_efficiency: -15 },
    B: { volume_efficiency: +15 },
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

export function getRankDeltas(
  questionId: string,
  rankedIds: string[],
): Partial<Record<Dimension, number>> {
  const deltas: Partial<Record<Dimension, number>> = {};

  if (questionId === 'q3_established_ascending') {
    const top2 = rankedIds.slice(0, 2);
    const top3 = rankedIds.slice(0, 3);

    // Established (Diggs, Jeudy) in top 2 → veteran trust signal
    if (top2.includes('diggs')) {
      deltas.established_ascending = (deltas.established_ascending ?? 0) - 10;
      deltas.injury_discount       = (deltas.injury_discount ?? 0) - 8;
    }
    if (top2.includes('jeudy')) {
      deltas.established_ascending = (deltas.established_ascending ?? 0) - 6;
    }

    // Ascending names in top 2 → breakout-hunter signal
    const ascendingIds = ['mhj', 'worthy', 'nabers', 'olave'];
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

    // Diggs at #1 → strongest veteran-trust signal
    if (rankedIds[0] === 'diggs') {
      deltas.established_ascending = (deltas.established_ascending ?? 0) - 5;
    }

    // MHJ or Nabers at #1 → strongest ascending signal
    if (rankedIds[0] === 'mhj' || rankedIds[0] === 'nabers') {
      deltas.established_ascending = (deltas.established_ascending ?? 0) + 5;
    }
  }

  return deltas;
}
