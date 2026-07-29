/**
 * PromptCounter — the single source of truth for AI-prompt quota.
 *
 * Core period/reset/rollback/persistence logic comes from the spec'd
 * implementation (SPEC.md v1); the golden suite in __tests__ defines done.
 * Merged 2026-07-26 with the tier system that used to live in
 * app/utils/promptCounter.ts (deleted) — see services/promptQuota.ts for the
 * tier binding. Nothing else in the app should own a prompt count.
 *
 * IMPORTANT: this module must stay import-pure — no React Native, Expo, or
 * service imports. The golden tests run it in plain node, and pulling in
 * react-native-purchases (via the tier layer) would break that. Storage and
 * clock are injected; see services/promptQuota.ts for the production wiring.
 *
 * Implementation notes:
 * - Resolve Chicago wall-clock parts with Intl.DateTimeFormat with
 *   timeZone: 'America/Chicago' + .formatToParts(date). Hermes (RN >= 0.70)
 *   ships full Intl. No date libraries.
 * - periodId = ISO date of the Sunday whose NOON starts the current period (Sunday before noon
 *   belongs to the previous Sunday's period).
 * - To turn "noon Chicago on date D" into a UTC instant: guess Date.UTC(D, 18:00), read back the
 *   Chicago-rendered hour for that instant, adjust by the difference. Handles CDT/CST automatically.
 * - Stored period only ever advances (clock-rollback exploit protection — see SPEC reset rule #4).
 */

export interface CounterStorage {
  get(key: string): string | null;
  set(key: string, value: string): void; // may throw
}

export type ConsumeResult =
  | { ok: true; remaining: number }
  | { ok: false; remaining: number; reason: 'exhausted'; resetsAt: Date }
  | { ok: false; remaining: number; reason: 'storage' };

/** Default per-period allowance. Tiers override via the `quota` option. */
export const QUOTA = 25;
export const STORAGE_KEY = 'promptCounter.v1';
/** Lifetime (free-tier) state lives under its own key so a tier change can't
 *  collide two different period models in one blob. */
export const LIFETIME_STORAGE_KEY = 'promptCounter.lifetime.v1';
export const RESET_TZ = 'America/Chicago'; // D2 — flip to user-local here if the product decision changes

/** Sentinel periodId for lifetime mode. Never advances, so the reset rule
 *  (which fires only on a strictly-later period) can never fire. */
const LIFETIME_PERIOD = 'lifetime';

interface PersistedState {
  schemaVersion: 1;
  periodId: string; // 'YYYY-MM-DD' of the period's Sunday, or 'lifetime'
  remaining: number;
  /** Quota in force when this state was written. Absent on states written
   *  before the tier merge — treated as the current quota (no delta). */
  quota?: number;
}

const MS_PER_DAY = 86_400_000;
const RESET_HOUR = 12; // wall-clock noon in RESET_TZ

/** Chicago wall-clock fields for an instant. Sunday = 0. */
interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const zonedFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: RESET_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
});

function zonedParts(at: Date): ZonedParts {
  const parts = zonedFormatter.formatToParts(at);
  const bag: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') bag[p.type] = p.value;
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour) % 24, // some engines render midnight as 24
    minute: Number(bag.minute),
    second: Number(bag.second),
    weekday: WEEKDAY_INDEX[bag.weekday] ?? 0,
  };
}

/** ms to add to a UTC instant to get the RESET_TZ wall clock read as if it were UTC. */
function zoneOffsetMs(at: Date): number {
  const p = zonedParts(at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Kill the sub-second remainder so the diff is a clean zone offset.
  return asUtc - (Math.floor(at.getTime() / 1000) * 1000);
}

function toIsoDate(year: number, month: number, day: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

function shiftIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * MS_PER_DAY);
  return toIsoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** ISO date of the Sunday whose noon started the period containing `at`. */
function weeklyPeriodId(at: Date): string {
  const p = zonedParts(at);
  const today = toIsoDate(p.year, p.month, p.day);
  // Sunday before noon still belongs to the previous Sunday's period (D3).
  const daysBack = p.weekday === 0 ? (p.hour >= RESET_HOUR ? 0 : 7) : p.weekday;
  return daysBack === 0 ? today : shiftIsoDate(today, -daysBack);
}

/** The UTC instant of wall-clock noon in RESET_TZ on the given ISO date. */
function noonInstant(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  const targetWallClock = Date.UTC(y, m - 1, d, RESET_HOUR, 0, 0, 0);
  // Converge: the first guess uses the offset at the naive instant, the second
  // uses the offset at (nearly) the answer — enough for any real DST rule.
  let instant = targetWallClock - zoneOffsetMs(new Date(targetWallClock));
  instant = targetWallClock - zoneOffsetMs(new Date(instant));
  return new Date(instant);
}

function isValidState(value: unknown): value is PersistedState {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Partial<PersistedState>;
  if (
    s.quota !== undefined &&
    (typeof s.quota !== 'number' || !Number.isFinite(s.quota) || s.quota < 0)
  ) {
    return false;
  }
  return (
    s.schemaVersion === 1 &&
    typeof s.periodId === 'string' &&
    (s.periodId === LIFETIME_PERIOD || /^\d{4}-\d{2}-\d{2}$/.test(s.periodId)) &&
    typeof s.remaining === 'number' &&
    Number.isFinite(s.remaining)
  );
}

export interface PromptCounterOptions {
  storage: CounterStorage;
  now?: () => Date;
  /** Per-period allowance. Defaults to QUOTA (25). Tiers inject their own. */
  quota?: number;
  /** Non-renewing mode: the period never advances, so the quota never
   *  refills. Used by the free tier's lifetime allowance. */
  lifetime?: boolean;
  /** Override the persistence key. Defaults to STORAGE_KEY, or
   *  LIFETIME_STORAGE_KEY when `lifetime` is set. */
  storageKey?: string;
}

export class PromptCounter {
  private storage: CounterStorage;
  private now: () => Date;
  private quota: number;
  private lifetime: boolean;
  private storageKey: string;

  constructor(opts: PromptCounterOptions) {
    this.storage = opts.storage;
    this.now = opts.now ?? (() => new Date());
    this.quota = opts.quota ?? QUOTA;
    this.lifetime = opts.lifetime ?? false;
    this.storageKey = opts.storageKey ?? (this.lifetime ? LIFETIME_STORAGE_KEY : STORAGE_KEY);
  }

  getRemaining(): number {
    const { state, changed } = this.resolve(this.now());
    if (changed) this.persistQuietly(state);
    return state.remaining;
  }

  /** The allowance in force (the tier's cap), not what's left of it. */
  getQuota(): number {
    return this.quota;
  }

  tryConsume(): ConsumeResult {
    const state = this.resolve(this.now()).state;

    if (state.remaining <= 0) {
      return {
        ok: false,
        remaining: 0,
        reason: 'exhausted',
        resetsAt: this.nextResetAt(),
      };
    }

    // Fail closed: the grant only happens if the decrement actually persisted.
    const next: PersistedState = { ...state, remaining: state.remaining - 1 };
    try {
      this.storage.set(this.storageKey, JSON.stringify(next));
    } catch {
      return { ok: false, remaining: state.remaining, reason: 'storage' };
    }
    return { ok: true, remaining: next.remaining };
  }

  /**
   * Next Sunday-noon-CT boundary. Always a real instant, computed off the
   * weekly calendar even in lifetime mode — where it carries no meaning and
   * the caller (services/promptQuota.ts) reports null instead.
   */
  nextResetAt(): Date {
    return noonInstant(shiftIsoDate(weeklyPeriodId(this.now()), 7));
  }

  // --- internals ---

  /** The period `at` belongs to. Constant in lifetime mode, so it never advances. */
  private periodFor(at: Date): string {
    return this.lifetime ? LIFETIME_PERIOD : weeklyPeriodId(at);
  }

  private clamp(n: number, cap: number): number {
    return Math.min(cap, Math.max(0, Math.floor(n)));
  }

  /** Load persisted state and apply the reset + tier-change rules. Does not write. */
  private resolve(at: Date): { state: PersistedState; changed: boolean } {
    const stored = this.loadState();
    const periodId = this.periodFor(at);
    const fresh: PersistedState = {
      schemaVersion: 1,
      periodId,
      remaining: this.quota,
      quota: this.quota,
    };

    if (!stored) return { state: fresh, changed: true };

    // A new period always refills at the CURRENT quota — this is where a
    // downgrade finally lands (product rule: downgrades clamp at the next
    // reset, never claw back mid-period).
    // Strictly later only: an earlier periodId means the device clock rolled
    // backward — no refill, and the stored period must not regress (rule #4).
    if (periodId > stored.periodId) return { state: fresh, changed: true };

    // Same period (or a rolled-back clock). Reconcile a tier change.
    const storedQuota = stored.quota ?? this.quota;

    if (this.quota > storedQuota) {
      // Upgrade mid-period: grant the delta immediately. They just paid, so
      // making them wait until Sunday for prompts they bought reads as broken.
      // Mirrors pre-merge behavior, which stored `used` and so widened the
      // allowance the moment the tier changed.
      return {
        state: {
          ...stored,
          remaining: stored.remaining + (this.quota - storedQuota),
          quota: this.quota,
        },
        changed: true,
      };
    }

    // Downgrade mid-period: no claw-back, and deliberately do NOT write the
    // smaller cap — persisting it would let the next load's clamp confiscate
    // prompts they still hold. The new cap takes effect at the next reset.
    return { state: stored, changed: false };
  }

  private loadState(): PersistedState | null {
    let raw: string | null;
    try {
      raw = this.storage.get(this.storageKey);
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isValidState(parsed)) return null;
      // Clamp against the quota the state was WRITTEN under, not the current
      // one, so a mid-period downgrade doesn't silently confiscate prompts.
      return { ...parsed, remaining: this.clamp(parsed.remaining, parsed.quota ?? this.quota) };
    } catch {
      return null;
    }
  }

  /** Reads must never throw to the caller; a failed write just retries next read. */
  private persistQuietly(state: PersistedState): void {
    try {
      this.storage.set(this.storageKey, JSON.stringify(state));
    } catch {
      /* ignore — in-memory answer stands, persistence retries on the next read */
    }
  }
}
