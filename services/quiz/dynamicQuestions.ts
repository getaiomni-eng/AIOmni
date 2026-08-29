// services/quiz/dynamicQuestions.ts
//
// Fills the quiz's player examples from the LIVE rankings board at quiz
// time, so question copy can never drift from the market (the McCaffrey
// "at his ADP (Round 3)" staleness bug, generalized away).
//
// Contract: scoring is keyed on question ids + option values ('A'/'B')
// and, for q3, on SEMANTIC option ids ('est1', 'asc2', …) — never on
// player names. This module therefore only ever swaps LABEL TEXT and
// q3's display names; ids, values, types and dimension deltas are
// untouched. Every dynamizer returns null unless it finds confident
// matches, and the caller falls back to the curated static copy — the
// quiz can never break because the board didn't load.
//
// Labels state only real board data (team, position rank, tier, curated
// archetype tags, Sleeper-feed age/experience/injury) — no fabricated
// stats or percentages.

import { getSleeperPlayers, type RankedPlayer } from '../rankingsData';
import { PLAYER_TAGS } from './playerTags';
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
type Tagged = RankedPlayer & { style?: 'volume' | 'efficiency'; pcRb?: boolean; pureRusher?: boolean; age?: number; years_exp?: number };

function withTags(board: RankedPlayer[]): Tagged[] {
  return board.map(p => {
    const t = p.sleeperId ? PLAYER_TAGS[p.sleeperId] : undefined;
    return t ? { ...p, ...t } : p;
  });
}

// 12-team rounds: rank 1-12 = R1, 13-24 = R2, …
const inRankBand = (p: RankedPlayer, lo: number, hi: number) => p.rank >= lo && p.rank <= hi;

// The SCENARIO must match where the named players actually sit. Static
// prompts ("Pick 5 overall") plus live players produced nonsense — the
// board's RB1/RB2 offered at pick 5, which no drafter has ever seen.
// Derive the round from the LATER-ranked player of the pair, since both
// have to still be on the board for the question to make sense.
const roundOf = (...players: RankedPlayer[]): number =>
  Math.max(1, Math.ceil(Math.max(...players.map(p => p.rank)) / 12));

const rbLabel = (p: Tagged, flavor: string) => {
  const bits = [p.team, `RB${p.posRank ?? '?'}`, `Tier ${p.tier}`, flavor];
  return `${p.name} — ${bits.join(', ')}`;
};

// Pick the volume/efficiency pair closest to each other in rank inside a band.
function rbPair(board: Tagged[], lo: number, hi: number, wantA: (p: Tagged) => boolean, wantB: (p: Tagged) => boolean): [Tagged, Tagged] | null {
  const rbs = board.filter(p => p.position === 'RB' && inRankBand(p, lo, hi) && !p.injuryStatus);
  const as = rbs.filter(wantA);
  const bs = rbs.filter(wantB);
  let best: [Tagged, Tagged] | null = null;
  let bestGap = Infinity;
  for (const a of as) for (const b of bs) {
    if (a.id === b.id) continue;
    const gap = Math.abs(a.rank - b.rank);
    if (gap < bestGap) { bestGap = gap; best = [a, b]; }
  }
  // Only swap the copy when the pair is genuinely comparable — a 15-spot
  // gap makes "same projected points" read false.
  return best && bestGap <= 10 ? best : null;
}

export function applyDynamicQuestions(base: QuizQuestion[], boardRaw: RankedPlayer[] | null | undefined): QuizQuestion[] {
  if (!boardRaw || boardRaw.length < 60) return base;
  const board = withTags(boardRaw);

  return base.map(q => {
    try {
      switch (q.id) {
        case 'q1_floor_ceiling': {
          const pair = rbPair(board, 1, 18, p => p.style === 'volume', p => p.style === 'efficiency');
          if (!pair) return q;
          return { ...q,
            prompt: `Round ${roundOf(...pair)}. Two backs on the board, same projected points. Who do you take?`,
            optionA: { ...q.optionA!, label: rbLabel(pair[0], 'workhorse volume profile — the steady floor') },
            optionB: { ...q.optionB!, label: rbLabel(pair[1], 'explosive profile — the boom-week ceiling') },
          };
        }
        case 'q2_volume_efficiency': {
          const pair = rbPair(board, 30, 66, p => p.style === 'volume', p => p.style === 'efficiency');
          if (!pair) return q;
          return { ...q,
            prompt: `Round ${roundOf(...pair)}. Same projected fantasy points. Who do you draft?`,
            optionA: { ...q.optionA!, label: rbLabel(pair[0], 'guaranteed-touches grinder') },
            optionB: { ...q.optionB!, label: rbLabel(pair[1], 'fewer touches, more juice per touch') },
          };
        }
        case 'q4_pass_catching_rb': {
          const pair = rbPair(board, 30, 80, p => !!p.pureRusher && !p.pcRb, p => !!p.pcRb);
          if (!pair) return q;
          return { ...q,
            prompt: `Round ${roundOf(...pair)}. PPR league. Pick one.`,
            optionA: { ...q.optionA!, label: rbLabel(pair[0], 'early-down ground game') },
            optionB: { ...q.optionB!, label: rbLabel(pair[1], 'three-down passing-game role') },
          };
        }
        case 'q9_rb_vs_wr_priority': {
          const rb = board.find(p => p.position === 'RB' && (p.posRank ?? 99) <= 2 && p.rank <= 8);
          const wr = board.find(p => p.position === 'WR' && (p.posRank ?? 99) <= 2 && p.rank <= 8);
          if (!rb || !wr) return q;
          return { ...q,
            prompt: `Round ${roundOf(rb, wr)}. Both are on the board, same projected points. Pick one.`,
            optionA: { ...q.optionA!, label: `${rb.name} — ${rb.team}, RB${rb.posRank}, Tier ${rb.tier} bell-cow` },
            optionB: { ...q.optionB!, label: `${wr.name} — ${wr.team}, WR${wr.posRank}, Tier ${wr.tier} target monopoly` },
          };
        }
        case 'q5_te_premium': {
          const te1 = board.find(p => p.position === 'TE' && p.posRank === 1);
          const streamers = board.filter(p => p.position === 'TE' && (p.posRank ?? 0) >= 7 && (p.posRank ?? 0) <= 11).slice(0, 2);
          if (!te1 || streamers.length < 2) return q;
          const lastName = (n: string) => {
            const parts = n.split(' ').filter(w => !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(w));
            return parts[parts.length - 1] ?? n;
          };
          let lastNames = streamers.map(s2 => lastName(s2.name));
          if (lastNames[0] === lastNames[1]) lastNames = streamers.map(s2 => s2.name);
          return { ...q,
            prompt: `It's Round ${roundOf(te1)}. Pick your strategy.`,
            optionA: { ...q.optionA!, label: `Take ${te1.name} — the clear TE1, positional edge locked in` },
            optionB: { ...q.optionB!, label: `Skip TE — grab a WR/RB now, stream the ${lastNames.join(' / ')} tier later` },
          };
        }
        case 'q3_established_ascending': {
          const wr2s = board.filter(p => p.position === 'WR' && (p.posRank ?? 0) >= 8 && (p.posRank ?? 0) <= 26);
          // Classification demands REAL experience data — a player with
          // unknown years_exp joins no bucket rather than being guessed at.
          const est = wr2s.filter(p => typeof p.years_exp === 'number' && p.years_exp >= 4 && !p.injuryStatus);
          const inj = wr2s.filter(p => !!p.injuryStatus);
          const asc = wr2s.filter(p => typeof p.years_exp === 'number' && p.years_exp <= 2 && !p.injuryStatus);
          if (est.length < 2 || inj.length < 1 || asc.length < 3) return q;
          const opt = (id: string, p: Tagged, sub: string) => ({ id, label: p.name, sublabel: `${p.team}, ${sub}` });
          const shown = [est[0], est[1], inj[0], asc[0], asc[1], asc[2]];
          return { ...q,
            prompt: `Rank your top 3 WR targets for Round ${roundOf(...shown)}.`,
            rankOptions: [
            opt('est1', est[0], 'proven alpha, locked-in target share'),
            opt('est2', est[1], 'established veteran, steady production'),
            opt('inj1', inj[0], `talented but flagged ${inj[0].injuryStatus}`),
            opt('asc1', asc[0], `ascending Year-${(asc[0].years_exp ?? 0) + 1}`),
            opt('asc2', asc[1], `ascending Year-${(asc[1].years_exp ?? 0) + 1}`),
            opt('asc3', asc[2], `ascending Year-${(asc[2].years_exp ?? 0) + 1}`),
          ]};
        }
        default: return q;
      }
    } catch { return q; }
  });
}
