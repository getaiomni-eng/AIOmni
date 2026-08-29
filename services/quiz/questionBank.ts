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
    // v2026-08-28: archetypes, not names. Named players forced a fixed
    // draft slot into the premise, and any live-board pick could land two
    // top-2 backs in a "pick 5" scenario. The dilemma is what's measured.
    prompt: 'Early rounds. Two backs on the board, same projected points. Who do you take?',
    optionA: { label: 'The workhorse — huge touch volume, near-lock for top-12 at the position, limited boom weeks', value: 'A' },
    optionB: { label: 'The explosive one — boom-or-bust week to week, but a real shot at the overall RB1 season', value: 'B' },
  },
  {
    id: 'q2_volume_efficiency',
    phase: 1,
    type: 'binary',
    prompt: 'Middle rounds, same projected fantasy points. Who do you draft?',
    optionA: { label: 'The grinder — guaranteed early-down volume, safe touches but TD-dependent', value: 'A' },
    optionB: { label: 'The efficiency back — fewer guaranteed touches, but more yards per touch and breakaway upside', value: 'B' },
  },
  {
    id: 'q9_rb_vs_wr_priority',
    phase: 1,
    type: 'binary',
    prompt: 'Round 1. An elite back and an elite receiver are both on the board, same projected points. Pick one.',
    optionA: { label: 'The bell-cow RB — 300-touch workload in a top offense, positional scarcity on your side', value: 'A' },
    optionB: { label: 'The alpha WR — target monopoly, the safer week-to-week profile at a deeper position',     value: 'B' },
  },
  {
    id: 'q3_established_ascending',
    phase: 1,
    type: 'rank',
    // The one question that KEEPS names — ranking archetypes against each
    // other is meaningless. Names are refreshed from the live board and
    // rotated per attempt (see dynamicQuestions.ts).
    prompt: 'Rank your top 3 WR targets in the middle rounds.',
    rankTopN: 3,
    // v2026-08-27: ids are ARCHETYPES (est/inj/asc), not player slugs —
    // scoring keys on the archetype, so dynamicQuestions.ts can swap the
    // display names from the live board without touching getRankDeltas.
    rankOptions: [
      { id: 'est1', label: 'Nico Collins',      sublabel: 'HOU, proven alpha, locked-in target share' },
      { id: 'est2', label: 'Tee Higgins',       sublabel: 'CIN, established veteran, steady production' },
      { id: 'inj1', label: 'Chris Olave',       sublabel: 'NO, talented but injury-flagged' },
      { id: 'asc1', label: 'Tetairoa McMillan', sublabel: 'CAR, ascending Year-2 alpha' },
      { id: 'asc2', label: 'Jameson Williams',  sublabel: 'DET, ascending, elite big-play speed' },
      { id: 'asc3', label: 'DeVonta Smith',     sublabel: 'PHI, ascending target share' },
    ],
  },
  {
    id: 'q4_pass_catching_rb',
    phase: 1,
    type: 'binary',
    prompt: 'Middle rounds, PPR league. Same projected points. Pick one.',
    optionA: { label: 'The early-down hammer — heavy carries, barely targeted, leans on touchdowns', value: 'A' },
    optionB: { label: 'The three-down back — fewer carries but 60+ targets, PPR points every week',  value: 'B' },
  },
  {
    id: 'q5_te_premium',
    phase: 1,
    type: 'binary',
    prompt: 'Early rounds, the clear TE1 is on the board. Pick your strategy.',
    optionA: { label: 'Take the TE1 — pay up now and lock a weekly edge the rest of the league lacks', value: 'A' },
    optionB: { label: 'Skip TE — take a WR/RB here and stream the middle tier several rounds later',   value: 'B' },
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
    // v2026-08-27: was "Christian McCaffrey ... at his ADP (Round 3)" — a
    // hardcoded name + price that drifted from the live market within weeks
    // and made the quiz read stale. The question measures injury-risk
    // tolerance, not player knowledge; the archetype framing (like q8's)
    // carries the same dilemma and can't go out of date.
    prompt: 'A former overall RB1 is sliding in your draft — a full round below his usual price. Elite when healthy, but he’s on the wrong side of 29 with a recent injury history.',
    optionA: { label: "Take the discount — the ceiling when healthy still wins leagues", value: 'A' },
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
//   established (veteran trust): est1, est2
//   ascending  (breakout hunt):  tmac, jameson, devonta
//   injury flag:                 inj1 (injury-flagged archetype)

export function getRankDeltas(
  questionId: string,
  rankedIds: string[],
): Partial<Record<Dimension, number>> {
  const deltas: Partial<Record<Dimension, number>> = {};

  if (questionId === 'q3_established_ascending') {
    const top2 = rankedIds.slice(0, 2);
    const top3 = rankedIds.slice(0, 3);

    // Established archetypes in top 2 → veteran trust signal
    if (top2.includes('est1')) {
      deltas.established_ascending = (deltas.established_ascending ?? 0) - 10;
      deltas.injury_discount       = (deltas.injury_discount ?? 0) - 8;
    }
    if (top2.includes('est2')) {
      deltas.established_ascending = (deltas.established_ascending ?? 0) - 6;
    }

    // Ascending archetypes in top 2 → breakout-hunter signal
    const ascendingIds = ['asc1', 'asc2', 'asc3'];
    const ascendingInTop2 = top2.filter(id => ascendingIds.includes(id)).length;
    if (ascendingInTop2 >= 1) {
      deltas.established_ascending = (deltas.established_ascending ?? 0) + 10;
    }
    if (ascendingInTop2 === 2) {
      deltas.established_ascending = (deltas.established_ascending ?? 0) + 5;
    }

    // Injury-prone (Olave) in top 3 → willing to take injury risk
    if (top3.includes('inj1')) {
      deltas.injury_discount = (deltas.injury_discount ?? 0) + 8;
    }

    // Collins at #1 → strongest veteran-trust signal
    if (rankedIds[0] === 'est1') {
      deltas.established_ascending = (deltas.established_ascending ?? 0) - 5;
    }

    // TMac or DeVonta at #1 → strongest ascending signal
    // Any ascending archetype first = the same breakout-hunter signal.
    // (Was asc1|asc3 only, mirroring the old curated TMac/DeVonta copy —
    // under dynamic fill the slot assignment is board order, so keying
    // the bonus to specific slots made scoring arbitrary.)
    if (rankedIds[0]?.startsWith('asc')) {
      deltas.established_ascending = (deltas.established_ascending ?? 0) + 5;
    }
  }

  return deltas;
}
