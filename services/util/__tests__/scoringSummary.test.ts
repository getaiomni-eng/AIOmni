import { summarizeSleeperScoring, summarizeESPNScoring, summarizeYahooScoring, formatStartingSlots, formatESPNStartingSlots } from '../scoringSummary';

const VANILLA_PPR = { rec: 1, pass_td: 4, pass_yd: 0.04, pass_int: -1, rush_yd: 0.1, rush_td: 6, rec_yd: 0.1, rec_td: 6, fum_lost: -2 };
const EXOTIC = { ...VANILLA_PPR, pass_td: 6, bonus_rec_te: 0.5, rec_fd: 0.5, bonus_rec_yd_100: 3, sack: 1, idp_tkl_solo: 1.5, def_st_td: 6 };

test('vanilla PPR states format-defining keys only', () => {
  expect(summarizeSleeperScoring(VANILLA_PPR)).toBe('rec 1 · pass_td 4');
});
test('exotic league surfaces every value-moving rule, drops IDP/DST noise', () => {
  const out = summarizeSleeperScoring(EXOTIC);
  expect(out).toContain('pass_td 6');
  expect(out).toContain('bonus_rec_te 0.5');
  expect(out).toContain('rec_fd 0.5');
  expect(out).toContain('bonus_rec_yd_100 3');
  expect(out).not.toContain('idp_');
  expect(out).not.toContain('sack');
});
test('two different leagues no longer produce identical output', () => {
  expect(summarizeSleeperScoring(VANILLA_PPR)).not.toBe(summarizeSleeperScoring(EXOTIC));
});
test('half PPR distinguishable', () => {
  expect(summarizeSleeperScoring({ ...VANILLA_PPR, rec: 0.5 })).toContain('rec 0.5');
});
test('empty/garbage input is safe', () => {
  expect(summarizeSleeperScoring(undefined)).toBe('');
  expect(summarizeSleeperScoring(null)).toBe('');
  expect(summarizeSleeperScoring({} as any)).toBe('');
});

test('ESPN TE premium via pointsOverrides', () => {
  const settings = { scoringSettings: { scoringItems: [
    { statId: 53, points: 1, pointsOverrides: { '4': 1.5 } },
    { statId: 4, points: 6 },
    { statId: 24, points: 0.1 },
    { statId: 63, points: 6 },    // unmapped offensive id (observed live)
    { statId: 999, points: 2 },   // kicker/defense-range id → noise, not counted
  ] } };
  const out = summarizeESPNScoring(settings);
  expect(out).toContain('rec 1');
  expect(out).toContain('rec(TE) 1.5');
  expect(out).toContain('pass_td 6');
  expect(out).not.toContain('rush_yd');       // default, omitted
  expect(out).toContain('+1 offensive bonus rules');
});
test('ESPN kicker/defense items alone add no custom-rule count', () => {
  const out = summarizeESPNScoring({ scoringSettings: { scoringItems: [
    { statId: 53, points: 1 },
    { statId: 77, points: 3 },    // kicker FG
    { statId: 99, points: 6 },    // defense TD
  ] } });
  expect(out).toBe('rec 1');
});
test('ESPN empty is safe', () => {
  expect(summarizeESPNScoring(undefined)).toBe('');
  expect(summarizeESPNScoring({ scoringSettings: {} })).toBe('');
});

test('Yahoo half PPR', () => {
  const out = summarizeYahooScoring([{ statId: 11, value: 0.5 }, { statId: 5, value: 6 }, { statId: 9, value: 0.1 }]);
  expect(out).toContain('rec 0.5');
  expect(out).toContain('pass_td 6');
  expect(out).not.toContain('rush_yd');
});

test('starting slots collapse and order', () => {
  expect(formatStartingSlots(['QB','RB','RB','WR','WR','WR','TE','FLEX','FLEX','K','DEF','BN','BN','IR']))
    .toBe('QB · 2RB · 3WR · TE · 2FLEX · K · DEF');
});
test('superflex surfaces', () => {
  expect(formatStartingSlots(['QB','SUPER_FLEX','RB','WR','BN'])).toContain('SUPER_FLEX');
});
test('ESPN lineupSlotCounts', () => {
  const SLOTS: Record<number,string> = { 0:'QB',2:'RB',4:'WR',6:'TE',16:'D/ST',17:'K',20:'BN',21:'IR',23:'FLEX',24:'OP' };
  expect(formatESPNStartingSlots({ '0':1,'2':2,'4':3,'6':1,'23':1,'17':1,'16':1,'20':7,'21':1 }, SLOTS))
    .toBe('QB · 2RB · 3WR · TE · FLEX · K · D/ST');
});
test('slots empty safe', () => {
  expect(formatStartingSlots(undefined)).toBe('');
  expect(formatStartingSlots(['BN','IR'])).toBe('');
});

// ── Live-payload regression ───────────────────────────────────────────
// Captured 2026-08-07 from lm-api-reads.fantasy.espn.com ?view=mSettings
// against the user's real leagues (via logged-in browser session).
// These pin the statId map to observed reality, not documentation.

const LIVE_6PT = { scoringSettings: { scoringItems: [
  { statId: 56, points: 2 }, { statId: 38, points: 3 }, { statId: 25, points: 6 },
  { statId: 53, points: 1 }, { statId: 72, points: -2 }, { statId: 43, points: 6 },
  { statId: 24, points: 0.1 }, { statId: 18, points: 3 }, { statId: 3, points: 0.04 },
  { statId: 4, points: 6 }, { statId: 19, points: 2 }, { statId: 20, points: -2 },
  { statId: 26, points: 2 }, { statId: 42, points: 0.1 }, { statId: 44, points: 2 },
  { statId: 16, points: 1 }, { statId: 17, points: 2 }, { statId: 36, points: 1 },
  { statId: 37, points: 2 }, { statId: 46, points: 1 }, { statId: 57, points: 3 },
  { statId: 63, points: 6 },
  { statId: 77, points: 3 }, { statId: 102, points: 6 }, { statId: 123, points: 0 },
] } };

test('live ESPN 6-pt-passing PPR league (Vatos locos) summarizes correctly', () => {
  const out = summarizeESPNScoring(LIVE_6PT);
  expect(out).toContain('rec 1');
  expect(out).toContain('pass_td 6');          // the rule the label alone hid
  expect(out).not.toContain('pass_int');       // -2 is ESPN default → omitted
  expect(out).not.toContain('rush_td');        // default
  expect(out).toContain('+10 offensive bonus rules');
});

test('live ESPN 4-pt league (REAL BOOM OR BUST) differs from the 6-pt leagues', () => {
  const fourPt = { scoringSettings: { scoringItems:
    LIVE_6PT.scoringSettings.scoringItems.map(i => i.statId === 4 ? { ...i, points: 4 } : i)
  } };
  const a = summarizeESPNScoring(LIVE_6PT);
  const b = summarizeESPNScoring(fourPt);
  expect(b).toContain('pass_td 4');
  expect(a).not.toBe(b);
});

test('live ESPN lineupSlotCounts (QB 2RB 2WR TE D/ST K 2FLEX + 7BN 2IR)', () => {
  const SLOTS: Record<number, string> = { 0:'QB',2:'RB',4:'WR',6:'TE',16:'D/ST',17:'K',20:'BN',21:'IR',23:'FLEX',24:'OP' };
  const live = { '0':1,'1':0,'2':2,'3':0,'4':2,'5':0,'6':1,'16':1,'17':1,'20':7,'21':2,'23':2,'24':0 };
  expect(formatESPNStartingSlots(live, SLOTS)).toBe('QB · 2RB · 2WR · TE · FLEX · K · D/ST'.replace('FLEX','2FLEX'));
});

// ── Yahoo live-settings regression ────────────────────────────────────
// Captured 2026-08-07 from the user's three real Yahoo league settings
// pages (football.fantasysports.yahoo.com/f1/{id}/settings). The old
// code hardcoded ALL Yahoo leagues to 'PPR'; in reality two of three
// are half-PPR and the third is 6-pt-passing with sack penalties.

test('Yahoo half-PPR guillotine league (Performance Enhancers) reads rec 0.5', () => {
  // pass_yd .04 / pass_td 4 / int -1 / rush .1,6 / rec 0.5,.1,6 — all
  // defaults except rec, exactly as the live settings page shows.
  const out = summarizeYahooScoring([
    { statId: 4, value: 0.04 }, { statId: 5, value: 4 }, { statId: 6, value: -1 },
    { statId: 9, value: 0.1 }, { statId: 10, value: 6 }, { statId: 11, value: 0.5 },
    { statId: 12, value: 0.1 }, { statId: 13, value: 6 }, { statId: 15, value: 6 },
    { statId: 16, value: 2 }, { statId: 18, value: -2 },
  ]);
  expect(out).toContain('rec 0.5');
  expect(out).toContain('pass_td 4');
  expect(out).not.toContain('rush_yd');       // default → omitted
});

test('Yahoo kicker/DST modifiers do not inflate the custom-rule count', () => {
  const out = summarizeYahooScoring([
    { statId: 11, value: 1 },
    { statId: 19, value: 3 },  // FG 0-19
    { statId: 23, value: 5 },  // FG 50+
    { statId: 32, value: 2 },  // DST int
    { statId: 50, value: 4 },  // pts-allowed bucket
  ]);
  expect(out).toBe('rec 1');
});

test('Yahoo 6-pt-passing league (Survival of the Fittest) surfaces the QB premium', () => {
  const out = summarizeYahooScoring([
    { statId: 5, value: 6 }, { statId: 6, value: -2 }, { statId: 11, value: 1 },
    { statId: 57, value: 6 },   // off. fumble return TD — unmapped offensive
  ]);
  expect(out).toContain('pass_td 6');
  expect(out).toContain('pass_int -2');
  expect(out).toContain('+1 other custom scoring rules');
});
