// Pure Sleeper draft-pick ownership computation — extracted from the
// coach's league loader so it's fixture-testable. This logic shipped
// broken twice (previous_owner_id keying missed multi-hop trades →
// ghost picks; acquired picks stamped with MY slot), so it now lives
// where a jest test can hold the line.
//
// Sleeper traded_picks semantics:
//   roster_id          — the pick's ORIGINAL owner (whose draft slot it is)
//   owner_id           — current holder
//   previous_owner_id  — only the LAST hop in a trade chain (unreliable
//                        for ownership; never key on it)

export type TradedPick = {
  season: string | number;
  round: number;
  roster_id: number;
  owner_id: number;
  previous_owner_id?: number;
};

export function computeOwnedPicks(opts: {
  rosterId: number;                 // my roster
  rounds: number;                   // draft rounds per season
  currentYear: number;              // slot numbers only known this year
  seasons: string[];                // e.g. ['2026','2027','2028']
  tradedPicks: TradedPick[];
  mySlot?: number;                  // my draft_order slot (current draft)
  slotByRosterId: Record<number, number | undefined>;
  nameByRosterId: Record<number, string>;
}): string {
  const { rosterId, rounds, currentYear, seasons, tradedPicks, mySlot, slotByRosterId, nameByRosterId } = opts;
  const slotPad = (n: number) => String(n).padStart(2, '0');
  const fmtPick = (season: string, round: number, originRid: number): string => {
    const via = originRid === rosterId ? '' : ` (via ${nameByRosterId[originRid] ?? `roster ${originRid}`})`;
    const slot = originRid === rosterId ? mySlot : slotByRosterId[originRid];
    if (season === String(currentYear) && slot) return `${round}.${slotPad(slot)}${via}`;
    return `R${round}${via}`;
  };

  const picksBySeason: Record<string, string[]> = Object.fromEntries(seasons.map(s => [s, []]));
  for (const season of seasons) {
    for (let round = 1; round <= rounds; round++) {
      // My ORIGINAL pick is gone iff any row shows my roster as its origin
      // with a different current holder — survives multi-hop chains.
      const tradedAway = tradedPicks.some(tp =>
        String(tp.season) === season && tp.round === round &&
        tp.roster_id === rosterId && tp.owner_id !== rosterId
      );
      if (!tradedAway) picksBySeason[season].push(fmtPick(season, round, rosterId));
    }
    // Picks I currently hold whose origin is another roster.
    for (const tp of tradedPicks.filter(tp =>
      String(tp.season) === season && tp.owner_id === rosterId && tp.roster_id !== rosterId
    )) {
      picksBySeason[season].push(fmtPick(season, tp.round, tp.roster_id));
    }
  }
  return seasons.map(s => `${s}: ${picksBySeason[s].sort().join(', ') || 'none'}`).join(' / ');
}
