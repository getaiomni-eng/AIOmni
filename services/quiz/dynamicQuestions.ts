// services/quiz/dynamicQuestions.ts
//
// Fills q3's WR list from the LIVE rankings board at quiz time.
//
// v2026-08-28: every OTHER question is now archetype-only (no player
// names) in questionBank.ts — naming players forced a draft slot into
// the premise and any live pick could produce an impossible scenario
// (the board's RB1/RB2 offered at "pick 5"). q3 is the exception because
// ranking six archetypes against each other is meaningless: there the
// names ARE the question, so they're pulled live and ROTATED between
// attempts so the same six faces don't repeat.
//
// Contract: scoring is keyed on SEMANTIC option ids ('est1', 'asc2', …),
// never on player names — so this module only ever swaps display names
// and sublabels. Returns the question untouched unless it finds a
// confident set, so a missing board just leaves the curated copy.
//
// Labels state only real board data (team, position rank, tier, curated
// archetype tags, Sleeper-feed age/experience/injury) — no fabricated
// stats or percentages.

import { getSleeperPlayers, type RankedPlayer } from '../rankingsData';
import type { QuizQuestion } from './types';

// The formula board carries rank/tier/posRank/sleeperId but NOT injury,
// age, or experience — the quiz verifier proved q3 could never fire and
// the injury guards were decorative without them. Pull those three from
// the (24h-cached) Sleeper feed before dynamizing; on any failure the
// board passes through un-enriched and the affected questions fall back
// to static copy, as designed.
export async function enrichBoardForQuiz(board: RankedPlayer[] | null | undefined): Promise<RankedPlayer[] | null | undefined> {
  if (!board || !board.length) return board;
  try {
    const feed = await getSleeperPlayers();
    return board.map(p => {
      const raw = p.sleeperId ? feed[p.sleeperId] : undefined;
      if (!raw) return p;
      return {
        ...p,
        injuryStatus: p.injuryStatus ?? raw.injury_status ?? null,
        age: raw.age,
        years_exp: raw.years_exp,
      } as RankedPlayer;
    });
  } catch {
    return board;
  }
}

// age/years_exp are attached by enrichBoardForQuiz above but aren't part
// of the RankedPlayer interface — read them as optional.
type Tagged = RankedPlayer & { age?: number; years_exp?: number };


export function applyDynamicQuestions(base: QuizQuestion[], boardRaw: RankedPlayer[] | null | undefined): QuizQuestion[] {
  if (!boardRaw || boardRaw.length < 60) return base;
  const board = boardRaw as Tagged[];

  return base.map(q => {
    if (q.id !== 'q3_established_ascending') return q;
    try {
      // Wider band than before (WR8-WR40): a bigger pool is what makes
      // rotation meaningful — the old WR8-26 window kept surfacing the
      // same handful of names every attempt.
      const wr2s = board.filter(p => p.position === 'WR' && (p.posRank ?? 0) >= 8 && (p.posRank ?? 0) <= 40);
      // Classification demands REAL experience data — a player with
      // unknown years_exp joins no bucket rather than being guessed at.
      const est = wr2s.filter(p => typeof p.years_exp === 'number' && p.years_exp >= 4 && !p.injuryStatus);
      const inj = wr2s.filter(p => !!p.injuryStatus);
      const asc = wr2s.filter(p => typeof p.years_exp === 'number' && p.years_exp <= 2 && !p.injuryStatus);
      if (est.length < 2 || inj.length < 1 || asc.length < 3) return q;

      // Rotate within each bucket so repeat takers get fresh faces. The
      // ARCHETYPE each slot represents never changes, so scoring is
      // identical however the names land.
      const pick = <T,>(pool: T[], n: number): T[] => {
        const copy = [...pool];
        const out: T[] = [];
        for (let i = 0; i < n && copy.length; i++) {
          out.push(...copy.splice(Math.floor(Math.random() * copy.length), 1));
        }
        return out;
      };
      const [e1, e2] = pick(est, 2);
      const [i1] = pick(inj, 1);
      const [a1, a2, a3] = pick(asc, 3);

      const opt = (id: string, p: Tagged, sub: string) => ({ id, label: p.name, sublabel: `${p.team}, ${sub}` });
      return { ...q, rankOptions: [
        opt('est1', e1, 'proven alpha, locked-in target share'),
        opt('est2', e2, 'established veteran, steady production'),
        opt('inj1', i1, `talented but flagged ${i1.injuryStatus}`),
        opt('asc1', a1, `ascending Year-${(a1.years_exp ?? 0) + 1}`),
        opt('asc2', a2, `ascending Year-${(a2.years_exp ?? 0) + 1}`),
        opt('asc3', a3, `ascending Year-${(a3.years_exp ?? 0) + 1}`),
      ]};
    } catch { return q; }
  });
}
