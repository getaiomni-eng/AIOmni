/**
 * Tier-quota behavior added by the 2026-07-26 merge of the old
 * app/utils/promptCounter.ts tier system into the spec'd core.
 *
 * The golden suite (promptCounter.test.ts) pins the period/reset/rollback
 * contract at the default quota and must not be edited; everything about
 * per-tier quotas, lifetime mode, and mid-period tier changes lives here.
 *
 * Product rules under test (confirmed 2026-07-26):
 *   - Upgrade grants the delta IMMEDIATELY (they just paid).
 *   - Downgrade clamps at the NEXT reset, never claws back mid-period.
 *   - Free tier is 10 LIFETIME — non-renewing, so no Sunday ever refills it.
 *
 * Timezone facts (America/Chicago, 2026): noon CT = 17:00Z under CDT.
 * 2026 Sundays used: Jul 19, Jul 26.
 */
import {
  LIFETIME_STORAGE_KEY,
  PromptCounter,
  STORAGE_KEY,
  type CounterStorage,
} from '../promptCounter';

class FakeStorage implements CounterStorage {
  map = new Map<string, string>();
  get(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  set(key: string, value: string): void {
    this.map.set(key, value);
  }
  raw(key = STORAGE_KEY): any {
    const v = this.map.get(key);
    return v ? JSON.parse(v) : null;
  }
  seed(state: object, key = STORAGE_KEY): void {
    this.map.set(key, JSON.stringify(state));
  }
}

function counterAt(
  iso: string,
  opts: { quota?: number; lifetime?: boolean; storage?: FakeStorage } = {},
) {
  const storage = opts.storage ?? new FakeStorage();
  let nowIso = iso;
  const c = new PromptCounter({
    storage,
    now: () => new Date(nowIso),
    quota: opts.quota,
    lifetime: opts.lifetime,
  });
  return { c, storage, setNow: (i: string) => (nowIso = i) };
}

const WED = '2026-07-22T15:00:00Z'; // mid-period, period 2026-07-19
const AFTER_RESET = '2026-07-27T15:00:00Z'; // past Sun Jul 26 noon CT → period 2026-07-26

describe('quota as a constructor param', () => {
  test('defaults to 25 when omitted', () => {
    expect(counterAt(WED).c.getRemaining()).toBe(25);
  });

  test.each([
    ['free', 10],
    ['rankings', 25],
    ['pro', 50],
  ])('%s tier starts at and exhausts exactly at %i', (_tier, quota) => {
    const { c } = counterAt(WED, { quota });
    expect(c.getRemaining()).toBe(quota);
    for (let i = 0; i < quota; i++) expect(c.tryConsume().ok).toBe(true);
    expect(c.tryConsume().ok).toBe(false);
    expect(c.getRemaining()).toBe(0);
  });

  test('getQuota() reports the cap, not what is left', () => {
    const { c } = counterAt(WED, { quota: 50 });
    c.tryConsume();
    expect(c.getQuota()).toBe(50);
    expect(c.getRemaining()).toBe(49);
  });

  test('weekly reset refills to the tier quota, not the default 25', () => {
    const { c, setNow } = counterAt(WED, { quota: 50 });
    for (let i = 0; i < 50; i++) c.tryConsume();
    expect(c.getRemaining()).toBe(0);
    setNow(AFTER_RESET);
    expect(c.getRemaining()).toBe(50);
  });

  test('stored remaining above the written quota is clamped on load', () => {
    const storage = new FakeStorage();
    storage.seed({ schemaVersion: 1, periodId: '2026-07-19', remaining: 999, quota: 25 });
    expect(counterAt(WED, { quota: 25, storage }).c.getRemaining()).toBe(25);
  });
});

describe('lifetime mode (free tier)', () => {
  test('uses its own storage key so a tier change cannot collide state', () => {
    const { c, storage } = counterAt(WED, { quota: 10, lifetime: true });
    c.tryConsume();
    expect(storage.raw(LIFETIME_STORAGE_KEY).remaining).toBe(9);
    expect(storage.raw(STORAGE_KEY)).toBeNull();
  });

  test('does NOT refill across a Sunday-noon boundary', () => {
    const { c, setNow } = counterAt(WED, { quota: 10, lifetime: true });
    for (let i = 0; i < 10; i++) c.tryConsume();
    expect(c.getRemaining()).toBe(0);

    setNow('2026-07-26T17:00:00Z'); // exactly noon CT — the weekly boundary
    expect(c.getRemaining()).toBe(0);
    setNow('2026-09-15T15:00:00Z'); // months later
    expect(c.getRemaining()).toBe(0);
    expect(c.tryConsume().ok).toBe(false);
  });

  test('still refuses to refill when the clock rolls backward', () => {
    const storage = new FakeStorage();
    storage.seed(
      { schemaVersion: 1, periodId: 'lifetime', remaining: 3, quota: 10 },
      LIFETIME_STORAGE_KEY,
    );
    const { c, setNow } = counterAt(WED, { quota: 10, lifetime: true, storage });
    expect(c.getRemaining()).toBe(3);
    setNow('2025-01-01T15:00:00Z'); // a year backward
    expect(c.getRemaining()).toBe(3);
    expect(storage.raw(LIFETIME_STORAGE_KEY).periodId).toBe('lifetime');
  });

  test('exhausted lifetime state survives a relaunch', () => {
    const storage = new FakeStorage();
    counterAt(WED, { quota: 10, lifetime: true, storage }).c.tryConsume();
    const fresh = counterAt(AFTER_RESET, { quota: 10, lifetime: true, storage }).c;
    expect(fresh.getRemaining()).toBe(9);
  });
});

describe('mid-period upgrade — grants the delta immediately', () => {
  test('rankings → pro adds 25 to what is left, right now', () => {
    const storage = new FakeStorage();
    storage.seed({ schemaVersion: 1, periodId: '2026-07-19', remaining: 10, quota: 25 });
    const { c } = counterAt(WED, { quota: 50, storage });
    expect(c.getRemaining()).toBe(35); // 10 left + 25 delta
  });

  test('the widened quota persists, so the grant happens exactly once', () => {
    const storage = new FakeStorage();
    storage.seed({ schemaVersion: 1, periodId: '2026-07-19', remaining: 10, quota: 25 });
    const { c } = counterAt(WED, { quota: 50, storage });
    expect(c.getRemaining()).toBe(35);
    expect(storage.raw().quota).toBe(50);
    expect(c.getRemaining()).toBe(35); // re-read must not stack another delta
    expect(counterAt(WED, { quota: 50, storage }).c.getRemaining()).toBe(35);
  });

  test('upgrading while fully exhausted unblocks the user without waiting for Sunday', () => {
    const { c, storage } = counterAt(WED, { quota: 25 });
    for (let i = 0; i < 25; i++) c.tryConsume();
    expect(c.getRemaining()).toBe(0);

    const upgraded = counterAt(WED, { quota: 50, storage }).c;
    expect(upgraded.getRemaining()).toBe(25);
    expect(upgraded.tryConsume().ok).toBe(true);
  });
});

describe('mid-period downgrade — clamps at the next reset, no claw-back', () => {
  test('pro → rankings leaves an above-cap balance intact mid-period', () => {
    const storage = new FakeStorage();
    storage.seed({ schemaVersion: 1, periodId: '2026-07-19', remaining: 40, quota: 50 });
    const { c } = counterAt(WED, { quota: 25, storage });
    expect(c.getRemaining()).toBe(40);
    expect(c.tryConsume()).toEqual({ ok: true, remaining: 39 });
  });

  test('the smaller cap is not persisted — a re-read cannot confiscate the balance', () => {
    const storage = new FakeStorage();
    storage.seed({ schemaVersion: 1, periodId: '2026-07-19', remaining: 40, quota: 50 });
    const { c } = counterAt(WED, { quota: 25, storage });
    expect(c.getRemaining()).toBe(40);
    expect(storage.raw().quota).toBe(50);
    expect(counterAt(WED, { quota: 25, storage }).c.getRemaining()).toBe(40);
  });

  test('the new cap lands at the next reset', () => {
    const storage = new FakeStorage();
    storage.seed({ schemaVersion: 1, periodId: '2026-07-19', remaining: 40, quota: 50 });
    const { c, setNow } = counterAt(WED, { quota: 25, storage });
    expect(c.getRemaining()).toBe(40);
    setNow(AFTER_RESET);
    expect(c.getRemaining()).toBe(25);
    expect(storage.raw().quota).toBe(25);
  });
});

describe('legacy state written before the merge', () => {
  test('a state with no quota field is read at the current quota', () => {
    const storage = new FakeStorage();
    storage.seed({ schemaVersion: 1, periodId: '2026-07-19', remaining: 10 }); // no quota
    expect(counterAt(WED, { quota: 50, storage }).c.getRemaining()).toBe(10);
  });

  test('a non-numeric quota field is rejected as corrupt → fresh quota', () => {
    const storage = new FakeStorage();
    storage.seed({ schemaVersion: 1, periodId: '2026-07-19', remaining: 5, quota: 'lots' });
    expect(counterAt(WED, { quota: 25, storage }).c.getRemaining()).toBe(25);
  });
});
