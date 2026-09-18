// services/leagueTrades.ts
// ─────────────────────────────────────────────────────────────────────
// Turns a platform Transaction into a two-sided trade the Trade Analyzer
// can prefill: "Team A sends X, Y" / "Team B sends Z".
//
// SLEEPER ONLY, on purpose. The other adapters cannot support this:
//   · MFL pushes every player in a transaction into `adds` under one
//     franchise ("we parse permissively"), so the two sides are not
//     recoverable.
//   · Fleaflicker returns one player per transaction row, so a trade
//     arrives as several unrelated single-player rows.
//   · ESPN's mTransactions2 shape is unverified here.
// Offering this for those platforms would prefill confidently wrong sides,
// which is worse than making someone type two lines. isTradeListSupported()
// is the gate, and manual entry stays the fallback everywhere else.

import { getPlatform } from './platform';
import type { Transaction } from './platform/types';

export type LeagueTradeOption = {
  id: string;
  timestamp: number;
  teamA: string;
  teamB: string;
  /** Text for the `giving` field — what Team A sent away. */
  aSends: string;
  /** Text for the `getting` field — what Team B sent away. */
  bSends: string;
  /** True when the platform reported draft picks moving in this trade. */
  hasPicks: boolean;
  /**
   * PROPOSED but not yet accepted. This is the highest-intent row in the
   * list -- "should I take this?" is a live question, where a completed
   * trade is already history -- so pending rows sort first and are badged.
   */
  pending: boolean;
  /** One of the two sides is the viewer's own roster. */
  involvesMe: boolean;
};

export function isTradeListSupported(platformId: string): boolean {
  return platformId === 'sleeper';
}

// "2027 1st" — the format parsePick() in trade.tsx already accepts, which
// lets the existing KTC pick-value pricing work with no changes. Rounds
// beyond 4th fall back to a bare round label; KTC does not price those
// meaningfully and the grader treats them as a generic asset.
const ORDINAL: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };
const pickText = (season: string, round: number): string =>
  ORDINAL[round] ? `${season} ${ORDINAL[round]}` : `${season} Round ${round}`;

/**
 * Derive the two sides of a trade.
 *
 * Returns null when the trade cannot be represented as A-for-B:
 *  · fewer or more than exactly 2 rosters involved (3-team trades are real
 *    and are deliberately skipped rather than mangled into two sides)
 *  · nothing identifiable on one side
 */
export function deriveTradeSides(
  tx: Transaction,
  teamNameByRosterId: Map<string, string>,
  myRosterId?: string | null,
): LeagueTradeOption | null {
  if (tx.type !== 'trade') return null;

  // Every roster touched by the trade, from all three signals. Sleeper's
  // explicit roster_ids is the most reliable when present.
  const rosters = new Set<string>(tx.rosterIds ?? []);
  for (const a of tx.adds) rosters.add(a.toRosterId);
  for (const d of tx.drops) rosters.add(d.fromRosterId);
  for (const p of (tx.picks ?? [])) { rosters.add(p.toRosterId); rosters.add(p.fromRosterId); }

  const ids = [...rosters].filter(Boolean);
  if (ids.length !== 2) return null;   // 3-teamers and malformed rows

  const [a, b] = ids;

  // A player in `adds` with toRosterId === B came FROM A, so A sent him.
  // Same logic for picks via toRosterId. This is why only the destination
  // matters and `drops` is not needed for reconstruction.
  const sentBy = (from: string, to: string): string[] => {
    const out: string[] = [];
    for (const add of tx.adds) {
      if (add.toRosterId !== to) continue;
      const nm = add.player?.name;
      // A player the platform could not resolve would prefill as a blank
      // or an id. Skip rather than feed the grader a garbage token.
      if (nm && !/^player\s*\d+$/i.test(nm)) out.push(nm);
    }
    for (const p of (tx.picks ?? [])) {
      if (p.toRosterId !== to || p.fromRosterId !== from) continue;
      if (p.season && p.round) out.push(pickText(p.season, p.round));
    }
    return out;
  };

  const aSends = sentBy(a, b);
  const bSends = sentBy(b, a);
  if (!aSends.length || !bSends.length) return null;

  return {
    id: tx.id,
    timestamp: tx.timestamp,
    teamA: teamNameByRosterId.get(a) ?? `Team ${a}`,
    teamB: teamNameByRosterId.get(b) ?? `Team ${b}`,
    aSends: aSends.join(', '),
    bSends: bSends.join(', '),
    hasPicks: (tx.picks ?? []).length > 0,
    pending: tx.status === 'pending',
    involvesMe: !!myRosterId && (a === myRosterId || b === myRosterId),
  };
}

/**
 * Recent completed trades in a league, newest first, as prefillable sides.
 * Returns [] on any failure — this is a convenience, never a blocker.
 */
export async function fetchLeagueTrades(
  platformId: string,
  leagueId: string,
  limit = 8,
): Promise<LeagueTradeOption[]> {
  try {
    if (!isTradeListSupported(platformId)) return [];
    const plat = getPlatform(platformId as any);
    if (!plat) return [];

    const [txs, rosters] = await Promise.all([
      plat.getTransactions(leagueId, 50).catch(() => [] as Transaction[]),
      plat.getAllRosters(leagueId).catch(() => [] as any[]),
    ]);

    const nameBy = new Map<string, string>();
    for (const r of (rosters as any[])) {
      if (r?.rosterId) nameBy.set(String(r.rosterId), r.teamName || `Team ${r.rosterId}`);
    }

    let myRosterId: string | null = null;
    for (const r of (rosters as any[])) if (r?.isMe && r?.rosterId) myRosterId = String(r.rosterId);

    const out: LeagueTradeOption[] = [];
    const seen = new Set<string>();
    for (const tx of txs) {
      if (tx.type !== 'trade') continue;
      // 'pending' = proposed, awaiting acceptance. 'failed' = vetoed,
      // expired or rejected, which is noise nobody wants graded.
      //
      // MEASURED 2026-09-18 -- SLEEPER NEVER SENDS 'pending' HERE, so this
      // branch is currently dead on Sleeper and a proposed trade CANNOT be
      // auto-populated. Do not re-attempt it against this endpoint.
      //
      // The test: a league with two live outgoing proposals returned 84
      // transactions across weeks 0-18 and ZERO trades of any status
      // (74 free_agent/complete, 7 waiver/complete, 3 waiver/failed).
      // Note waiver/failed IS published -- so non-complete statuses are not
      // suppressed in general. Sleeper specifically withholds a TRADE until
      // both managers accept, which is correct: an unaccepted offer is a
      // private negotiation, not league news. /trades, /transactions/pending
      // and /trade_offers are all 404. The app's own GraphQL endpoint does
      // carry them but needs the user's bearer token, and Sleeper publishes
      // no OAuth flow -- asking people to extract a token is not a product.
      //
      // The shipping answer for a pending offer is the screenshot upload on
      // the Trade tab, which already handles it.
      //
      // Kept rather than deleted because it costs nothing (the condition
      // simply never matches), it is correct the moment any platform does
      // expose pending trades, and the involvesMe sort below improves the
      // completed-trade ordering regardless.
      if (tx.status !== 'complete' && tx.status !== 'pending') continue;
      const derived = deriveTradeSides(tx, nameBy, myRosterId);
      if (!derived || seen.has(derived.id)) continue;
      seen.add(derived.id);
      out.push(derived);
    }

    // Pending first, then the viewer's own deals, then newest. Sorting here
    // rather than slicing during the scan so a pending trade from an older
    // week can still outrank a completed one from today.
    out.sort((x, y) =>
      (Number(y.pending) - Number(x.pending)) ||
      (Number(y.involvesMe) - Number(x.involvesMe)) ||
      (y.timestamp - x.timestamp)
    );
    return out.slice(0, limit);
  } catch {
    return [];
  }
}
