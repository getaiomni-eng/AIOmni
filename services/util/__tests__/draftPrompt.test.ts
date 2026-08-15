// Regression: The O must never list a drafted player as available, even
// when applyPick's id/name resolution missed (the pool player keeps
// isDrafted=false but his name appears in the pick log).
// draft.ts drags in RN/Supabase modules that don't exist in the node
// test env — mock them; buildDraftPrompt itself is pure.
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {} }));
jest.mock('../../rankingsData', () => ({ fetchBlendedConsensus: jest.fn(), fetchSleeperADP: jest.fn() }));

import { buildDraftPrompt } from '../../draft';

const settings: any = {
  platform: 'sleeper', leagueId: 'x', leagueName: 'Test', scoringFormat: 'ppr',
  teamCount: 12, rounds: 15, myDraftSlot: 3, draftType: 'snake',
  rosterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'],
};
const player = (id: string, name: string, position: string, adp: number, isDrafted = false): any =>
  ({ id, name, position, team: 'KC', adp, byeWeek: 6, tier: 1, rank: adp, isDrafted });

test('drafted-by-log player is excluded even when isDrafted is stale-false', () => {
  const state: any = {
    settings, currentPick: 25, currentRound: 3, status: 'drafting',
    myRoster: [],
    // "Cameron Ward" was drafted (log says so) but resolution missed, so
    // the pool still has him isDrafted=false under the same normalized name.
    picks: [{ pickNo: 24, round: 2, slot: 10, playerId: 'sleeper123', playerName: 'Cam Ward', position: 'QB', team: 'TEN', isMyPick: false }],
    availablePlayers: [
      player('p1', 'Cam Ward', 'QB', 40),
      player('p2', 'Bo Nix', 'QB', 55),
      player('p3', 'Puka Nacua', 'WR', 5),
    ],
  };
  const prompt = buildDraftPrompt(state);
  const availableSection = prompt.split('TOP AVAILABLE')[1];
  expect(availableSection).not.toContain('Cam Ward');
  expect(availableSection).toContain('Bo Nix');
  expect(prompt).toContain('RECENT PICKS');
  expect(prompt).toContain('#24 Cam Ward');
});

test('top available is ADP-sorted, not array-ordered', () => {
  const state: any = {
    settings, currentPick: 1, currentRound: 1, status: 'drafting', myRoster: [], picks: [],
    availablePlayers: [
      player('w1', 'Deep Sleeper', 'WR', 180),
      player('w2', 'Puka Nacua', 'WR', 5),
      player('w3', 'CeeDee Lamb', 'WR', 9),
      player('w4', 'Mid Guy', 'WR', 60),
      player('w5', 'Bench Guy', 'WR', 120),
      player('w6', 'Waiver Guy', 'WR', 200),
    ],
  };
  const prompt = buildDraftPrompt(state);
  const wrLine = prompt.split('TOP AVAILABLE')[1].split('\n').find(l => l.trim().startsWith('WR:')) ?? '';
  expect(wrLine).toContain('Puka Nacua');
  expect(wrLine).not.toContain('Waiver Guy');  // 6th by ADP — must be cut
});
