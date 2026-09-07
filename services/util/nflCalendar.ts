// NFL season and week, derived from the calendar.
//
// Written because three separate call sites were guessing: fetchSnapCounts
// defaulted season to a hardcoded 2024, fetchAllLiveData defaulted
// currentWeek to 1 and the Coach called it with no arguments at all, and
// leagueActivity called getLeagues() with no season so the platform adapters
// fell back to '2025'. Every Coach answer all season was being handed
// week-1-of-2024 snap counts and December-2025 transactions.
//
// The NFL calendar is deterministic, so there is nothing to guess: week 1
// opens the Thursday after Labor Day (the first Monday on/after Sep 1) and
// each later week starts seven days on. Mirrors public.nfl_week_kickoff().

/** Season label. A season runs Sep -> Feb, so Jan/Feb belong to the prior year. */
export function nflSeason(now: Date = new Date()): number {
  const y = now.getFullYear();
  return now.getMonth() >= 2 ? y : y - 1;   // March onward = the new season
}

/** Thursday-after-Labor-Day opener for a season, local time. */
export function nflOpener(season: number): Date {
  const sep1 = new Date(season, 8, 1);
  const toMonday = (8 - (sep1.getDay() === 0 ? 7 : sep1.getDay())) % 7;
  return new Date(season, 8, 1 + toMonday + 3);
}

/**
 * Current regular-season week, 1..18.
 * Before the opener returns 1 (draft season — week 1 is what everyone is
 * preparing for); after week 18 returns 18 rather than null, because every
 * caller wants a usable week for context, not an absence to handle.
 */
export function nflWeek(now: Date = new Date(), season = nflSeason(now)): number {
  const days = Math.floor((now.getTime() - nflOpener(season).getTime()) / 86400000);
  if (days < 0) return 1;
  return Math.min(18, Math.max(1, Math.floor(days / 7) + 1));
}
