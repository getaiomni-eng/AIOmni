/**
 * GOLDEN TEST SUITE — DO NOT MODIFY (see LOOP.md).
 * The agent loop makes this green by editing src/promptCounter.ts ONLY.
 *
 * Timezone facts these tests rely on (America/Chicago, 2026):
 *   CDT (UTC-5) from Sun Mar 8 to Sun Nov 1; CST (UTC-6) otherwise.
 *   Noon CT = 17:00Z during CDT, 18:00Z during CST.
 *   2026 Sundays used: Mar 1, Mar 8, Jul 19, Jul 26, Aug 9, Nov 1.
 */
import { PromptCounter, CounterStorage } from '../promptCounter';

const KEY = 'promptCounter.v1';

class FakeStorage implements CounterStorage {
  map = new Map<string, string>();
  failNextSet = false;
  get(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  set(key: string, value: string): void {
    if (this.failNextSet) {
      this.failNextSet = false;
      throw new Error('disk full');
    }
    this.map.set(key, value);
  }
  raw(): any {
    const v = this.map.get(KEY);
    return v ? JSON.parse(v) : null;
  }
}

function counterAt(iso: string, storage = new FakeStorage()) {
  let nowIso = iso;
  const c = new PromptCounter({ storage, now: () => new Date(nowIso) });
  return { c, storage, setNow: (i: string) => (nowIso = i) };
}

describe('fresh install', () => {
  test('starts at 25 in the correct period (Wed Jul 22 → period 2026-07-19)', () => {
    const { c, storage } = counterAt('2026-07-22T15:00:00Z');
    expect(c.getRemaining()).toBe(25);
    expect(storage.raw().periodId).toBe('2026-07-19');
  });

  test('Sunday morning belongs to the PREVIOUS period (Sun Jul 26, 9:00 AM CT)', () => {
    const { c, storage } = counterAt('2026-07-26T14:00:00Z');
    c.getRemaining();
    expect(storage.raw().periodId).toBe('2026-07-19');
  });
});

describe('consume', () => {
  test('decrements and persists', () => {
    const { c, storage } = counterAt('2026-07-22T15:00:00Z');
    expect(c.tryConsume()).toEqual({ ok: true, remaining: 24 });
    c.tryConsume();
    c.tryConsume();
    expect(c.getRemaining()).toBe(22);
    expect(storage.raw().remaining).toBe(22);
  });

  test('at zero: refuses with exhausted + exact resetsAt instant', () => {
    const { c } = counterAt('2026-07-22T15:00:00Z');
    for (let i = 0; i < 25; i++) expect(c.tryConsume().ok).toBe(true);
    const r = c.tryConsume();
    expect(r.ok).toBe(false);
    if (r.ok === false && r.reason === 'exhausted') {
      expect(r.remaining).toBe(0);
      expect(r.resetsAt.toISOString()).toBe('2026-07-26T17:00:00.000Z');
    } else {
      throw new Error('expected exhausted result');
    }
  });

  test('storage write failure → fail closed, count unchanged', () => {
    const { c, storage } = counterAt('2026-07-22T15:00:00Z');
    c.tryConsume(); // 24
    storage.failNextSet = true;
    const r = c.tryConsume();
    expect(r).toMatchObject({ ok: false, reason: 'storage' });
    expect(c.getRemaining()).toBe(24);
    expect(storage.raw().remaining).toBe(24);
  });
});

describe('reset boundary (regular week, CDT)', () => {
  test('11:59:59 AM CT Sunday → no reset; 12:00:00 → reset', () => {
    const { c, setNow } = counterAt('2026-07-22T15:00:00Z');
    for (let i = 0; i < 25; i++) c.tryConsume();
    setNow('2026-07-26T16:59:59Z');
    expect(c.getRemaining()).toBe(0);
    setNow('2026-07-26T17:00:00Z');
    expect(c.getRemaining()).toBe(25);
  });

  test('multi-week gap → exactly one reset, no stacking', () => {
    const storage = new FakeStorage();
    storage.map.set(KEY, JSON.stringify({ schemaVersion: 1, periodId: '2026-07-19', remaining: 0 }));
    const { c, storage: s } = counterAt('2026-08-12T15:00:00Z', storage);
    expect(c.getRemaining()).toBe(25);
    expect(s.raw().periodId).toBe('2026-08-09');
  });
});

describe('persistence across relaunch', () => {
  test('new instance over same storage sees prior count', () => {
    const storage = new FakeStorage();
    const a = counterAt('2026-07-22T15:00:00Z', storage).c;
    a.tryConsume();
    a.tryConsume();
    const b = counterAt('2026-07-23T15:00:00Z', storage).c;
    expect(b.getRemaining()).toBe(23);
  });

  test('corrupted storage → fresh quota, no throw', () => {
    const storage = new FakeStorage();
    storage.map.set(KEY, '{not json!!');
    const { c } = counterAt('2026-07-22T15:00:00Z', storage);
    expect(c.getRemaining()).toBe(25);
  });
});

describe('clock rollback protection', () => {
  test('rolling back does not refill and does not regress stored period; rolling forward again does not re-grant', () => {
    const storage = new FakeStorage();
    storage.map.set(KEY, JSON.stringify({ schemaVersion: 1, periodId: '2026-07-26', remaining: 10 }));
    const { c, setNow, storage: s } = counterAt('2026-07-27T15:00:00Z', storage);
    expect(c.getRemaining()).toBe(10);

    setNow('2026-07-22T15:00:00Z'); // clock rolled back into previous period
    expect(c.getRemaining()).toBe(10); // no refill
    expect(s.raw().periodId).toBe('2026-07-26'); // stored period never regresses

    setNow('2026-07-28T15:00:00Z'); // clock restored — same period as stored
    expect(c.getRemaining()).toBe(10); // no fresh 25 for a period already granted
  });
});

describe('DST boundaries', () => {
  test('spring forward: Sun 2026-03-08 reset fires at 17:00Z (noon CDT), not before', () => {
    const storage = new FakeStorage();
    storage.map.set(KEY, JSON.stringify({ schemaVersion: 1, periodId: '2026-03-01', remaining: 5 }));
    const { c, setNow } = counterAt('2026-03-08T16:59:00Z', storage); // 11:59 AM CDT
    expect(c.getRemaining()).toBe(5);
    setNow('2026-03-08T17:00:00Z'); // 12:00 PM CDT
    expect(c.getRemaining()).toBe(25);
  });

  test('fall back: Sun 2026-11-01 reset fires at 18:00Z (noon CST), not at 17:00Z', () => {
    const storage = new FakeStorage();
    storage.map.set(KEY, JSON.stringify({ schemaVersion: 1, periodId: '2026-10-25', remaining: 3 }));
    const { c, setNow } = counterAt('2026-11-01T17:00:00Z', storage); // 11:00 AM CST — noon has NOT hit
    expect(c.getRemaining()).toBe(3);
    setNow('2026-11-01T17:59:00Z'); // 11:59 AM CST
    expect(c.getRemaining()).toBe(3);
    setNow('2026-11-01T18:00:00Z'); // 12:00 PM CST
    expect(c.getRemaining()).toBe(25);
  });
});

describe('nextResetAt', () => {
  test('mid-week (CDT)', () => {
    const { c } = counterAt('2026-07-22T15:00:00Z');
    expect(c.nextResetAt().toISOString()).toBe('2026-07-26T17:00:00.000Z');
  });
  test('Sunday morning → same day noon', () => {
    const { c } = counterAt('2026-07-26T14:00:00Z');
    expect(c.nextResetAt().toISOString()).toBe('2026-07-26T17:00:00.000Z');
  });
  test('Sunday 12:00:01 PM → NEXT Sunday', () => {
    const { c } = counterAt('2026-07-26T17:00:01Z');
    expect(c.nextResetAt().toISOString()).toBe('2026-08-02T17:00:00.000Z');
  });
});
