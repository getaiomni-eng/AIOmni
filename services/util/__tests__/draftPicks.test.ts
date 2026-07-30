// Regression fixtures for Sleeper draft-pick ownership.
//
// The scenario mirrors the real bug found 2026-07-29: the user's 2026
// 1st and 2nd had been traded away THROUGH CHAINS (me→A, A→B), the old
// previous_owner_id keying missed them, and the coach hallucinated
// "you own 1.10 and 2.10" — then built trade offers around ghost picks.

import { computeOwnedPicks, type TradedPick } from '../draftPicks';

const ME = 10;
const TEAM_A = 4;
const TEAM_B = 7;
const REILLY = 3;

const base = {
  rosterId: ME,
  rounds: 4,
  currentYear: 2026,
  seasons: ['2026', '2027'],
  mySlot: 10,
  slotByRosterId: { [ME]: 10, [TEAM_A]: 4, [TEAM_B]: 2, [REILLY]: 7 } as Record<number, number | undefined>,
  nameByRosterId: { [ME]: 'me', [TEAM_A]: 'teamA', [TEAM_B]: 'teamB', [REILLY]: 'Reilly01' },
};

describe('computeOwnedPicks', () => {
  test('no trades → own every original pick, current year numbered by my slot', () => {
    const out = computeOwnedPicks({ ...base, tradedPicks: [] });
    expect(out).toBe('2026: 1.10, 2.10, 3.10, 4.10 / 2027: R1, R2, R3, R4');
  });

  test('multi-hop trade away kills the ghost pick (the 2026-07-29 bug)', () => {
    // My 2026 1st went me→A then A→B: the row's previous_owner is A, not
    // me — the old previous_owner_id keying missed this and kept "1.10".
    const tradedPicks: TradedPick[] = [
      { season: '2026', round: 1, roster_id: ME, owner_id: TEAM_B, previous_owner_id: TEAM_A },
      { season: '2026', round: 2, roster_id: ME, owner_id: TEAM_A, previous_owner_id: ME },
    ];
    const out = computeOwnedPicks({ ...base, tradedPicks });
    expect(out).not.toContain('1.10');
    expect(out).not.toContain('2.10');
    expect(out).toContain('3.10');
    expect(out).toContain('4.10');
  });

  test('acquired pick carries the ORIGIN slot and origin owner name', () => {
    // Reilly01's 2026 4th (their slot = 7) now belongs to me → "4.07 (via
    // Reilly01)", NOT a duplicate of my own 4.10.
    const tradedPicks: TradedPick[] = [
      { season: '2026', round: 4, roster_id: REILLY, owner_id: ME, previous_owner_id: REILLY },
    ];
    const out = computeOwnedPicks({ ...base, tradedPicks });
    expect(out).toContain('4.07 (via Reilly01)');
    expect(out).toContain('4.10');           // my own 4th, still mine
  });

  test('future seasons render as Rx with origin attribution', () => {
    const tradedPicks: TradedPick[] = [
      { season: '2027', round: 1, roster_id: TEAM_B, owner_id: ME, previous_owner_id: TEAM_B },
      { season: '2027', round: 2, roster_id: ME, owner_id: TEAM_A, previous_owner_id: ME },
    ];
    const out = computeOwnedPicks({ ...base, tradedPicks });
    const y2027 = out.split(' / ')[1];
    expect(y2027).toContain('R1 (via teamB)');
    expect(y2027).toContain('R1,');           // my own R1 kept
    expect(y2027).not.toContain('R2,');       // traded away (single hop)
    expect(y2027).toContain('R3');
    expect(y2027).toContain('R4');
  });

  test('numeric season field from the API matches string seasons', () => {
    const tradedPicks: TradedPick[] = [
      { season: 2026, round: 1, roster_id: ME, owner_id: TEAM_A },
    ];
    const out = computeOwnedPicks({ ...base, tradedPicks });
    expect(out).not.toContain('1.10');
  });

  test('pick re-acquired back to original owner counts as owned', () => {
    // me→A, then A→me: row shows roster_id=me, owner_id=me.
    const tradedPicks: TradedPick[] = [
      { season: '2026', round: 1, roster_id: ME, owner_id: ME, previous_owner_id: TEAM_A },
    ];
    const out = computeOwnedPicks({ ...base, tradedPicks });
    expect(out).toContain('1.10');
    // …and not duplicated by the incoming branch (origin is me).
    expect(out.match(/1\.10/g)!.length).toBe(1);
  });
});
