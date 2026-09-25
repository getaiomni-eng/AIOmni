// Players AIOmni does not rank, anywhere. Owner's rule (2026-09-24).
//
// Applied at every place a ranking is built, so no board can show them:
//   aiomni-rankings-engine-v2   season rankings (before rank numbers are assigned)
//   weekly-board                current app weekly board
//   _shared/weekly/common.ts    buildPool -> every weekly model and the ensemble
//   manual-rankings             the /rank tool's candidate list
//
// KEYED BY gsis_id, NEVER BY NAME. "Watson" alone would also remove Christian
// Watson (WR, GB) -- and a name-only match already put a linebacker's injury
// on Justin Jefferson once. Removed BEFORE ranks are assigned, so the players
// behind close up rather than leaving a gap at the banned spot.

export const BANNED_PLAYERS: Record<string, string> = {
  '00-0033537': 'Deshaun Watson (QB)',
};

export const isBanned = (gsisId: string | null | undefined): boolean =>
  !!gsisId && Object.hasOwn(BANNED_PLAYERS, gsisId.trim());
