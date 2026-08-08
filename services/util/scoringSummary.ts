// ── League scoring summarisation ──────────────────────────────────────
//
// v2026-08-07: the Coach used to receive league scoring as a single
// three-value label ("PPR" / "0.5 PPR" / "STD") derived from the
// reception value alone. Everything else in the league's scoring
// dictionary — TE premium, 6-pt passing TDs, per-first-down points,
// yardage bonuses, turnover penalties — was dropped before the prompt
// was built, so a TE-premium 6-pt-passing league and a vanilla PPR
// league produced byte-identical context and got identical advice.
// That directly contradicted the product's core claim ("reads your
// actual league settings before every recommendation").
//
// This module turns each platform's raw scoring payload into one
// compact line of prompt text. Design rules:
//
//   1. NEVER invent a label. Sleeper's keys are already human-readable
//      (`bonus_rec_te`, `rec_fd`), so they pass through verbatim. Only
//      ESPN and Yahoo need id→label maps, because their payloads are
//      keyed by opaque numeric stat ids.
//   2. Unmapped ids are surfaced, not silently dropped. A league whose
//      custom rules we can't name still tells the model it is NOT
//      vanilla, which is strictly better than implying it is.
//   3. Emit deltas from the modal default, not the whole dictionary.
//      A standard league costs ~0 tokens; an exotic one costs a line.

/** Sleeper keys that define the format and are always worth stating. */
const SLEEPER_CORE = [
  'rec', 'bonus_rec_te', 'pass_td', 'pass_yd', 'pass_int',
  'rush_yd', 'rush_td', 'rec_yd', 'rec_td', 'fum_lost',
] as const;

/**
 * Sleeper's modal defaults. A key matching its default is omitted from
 * the summary unless it is format-defining (rec / pass_td), which we
 * always state so the model never has to assume.
 */
const SLEEPER_DEFAULTS: Record<string, number> = {
  pass_yd: 0.04, pass_int: -1, rush_yd: 0.1, rush_td: 6,
  rec_yd: 0.1, rec_td: 6, fum_lost: -2,
};

const ALWAYS_STATE = new Set(['rec', 'pass_td', 'bonus_rec_te']);

/** Keys that are noise in a prompt: IDP and team-defense granularity. */
const SLEEPER_NOISE = /^(idp_|def_|st_|pts_allow|yds_allow|sack|tkl|ff$|fr$|int$|safe$|blk_)/;

const fmtNum = (n: number): string =>
  Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));

/**
 * Sleeper: keys are self-describing, so they pass through as-is. No
 * mapping table means no mislabeling risk.
 */
export function summarizeSleeperScoring(s: Record<string, number> | undefined | null): string {
  if (!s || typeof s !== 'object') return '';
  const parts: string[] = [];

  for (const key of SLEEPER_CORE) {
    const val = s[key];
    if (typeof val !== 'number') continue;
    if (!ALWAYS_STATE.has(key) && SLEEPER_DEFAULTS[key] === val) continue;
    if (key === 'bonus_rec_te' && !val) continue;   // absent premium isn't news
    parts.push(`${key} ${fmtNum(val)}`);
  }

  // Everything else that is non-zero and not IDP/DST noise: first-down
  // points (rec_fd/rush_fd/pass_fd), yardage bonuses (bonus_rec_yd_100),
  // per-position premiums, and any key Sleeper adds after this ships.
  const extras = Object.entries(s)
    .filter(([k, v]) => typeof v === 'number' && v !== 0)
    .filter(([k]) => !(SLEEPER_CORE as readonly string[]).includes(k))
    .filter(([k]) => !SLEEPER_NOISE.test(k))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k} ${fmtNum(v)}`);

  parts.push(...extras);
  return parts.join(' · ');
}

// ── ESPN ──────────────────────────────────────────────────────────────
//
// ESPN keys scoring by numeric statId inside settings.scoringSettings
// .scoringItems[]. Only ids verified against ESPN's public v3 payloads
// are named here; anything else is reported as `stat<id>` so an exotic
// league still reads as exotic. NOTE: this table is deliberately
// partial — extend it only against a real league response, never from
// memory, because a wrong label is worse than an unnamed one.
//
// v2026-08-07: all 12 ids below verified against three live league
// payloads (lm-api-reads …?view=mSettings, user's own leagues). The
// live data also showed every ESPN league ships ~20 nonzero kicker
// (74–88) and defense (89+) items plus a family of yardage-milestone
// bonus ids — counting those as "custom rules" made vanilla leagues
// read exotic, so ids ≥ 74 are treated as noise (mirroring the
// Sleeper IDP/DST filter) and low ids get a bonus-family wording.

const ESPN_STAT_LABELS: Record<number, string> = {
  3:  'pass_yd',
  4:  'pass_td',
  19: 'pass_2pt',
  20: 'pass_int',
  24: 'rush_yd',
  25: 'rush_td',
  26: 'rush_2pt',
  42: 'rec_yd',
  43: 'rec_td',
  44: 'rec_2pt',
  53: 'rec',
  72: 'fum_lost',
};

const ESPN_DEFAULTS: Record<string, number> = {
  pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_2pt: 2,
  rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
  rec_yd: 0.1, rec_td: 6, rec_2pt: 2, fum_lost: -2,
};

/** ESPN defaultPositionId → label, for per-position point overrides. */
const ESPN_OVERRIDE_POS: Record<string, string> = {
  '1': 'QB', '2': 'RB', '3': 'WR', '4': 'TE', '5': 'K', '16': 'DST',
};

export function summarizeESPNScoring(settings: any): string {
  const items = settings?.scoringSettings?.scoringItems;
  if (!Array.isArray(items) || items.length === 0) return '';
  const parts: string[] = [];
  let unnamed = 0;

  for (const item of items) {
    const id = Number(item?.statId);
    const pts = Number(item?.points ?? 0);
    const label = ESPN_STAT_LABELS[id];

    if (!label) {
      // Kicker (74–88) and defense/special-teams (89+) items are nonzero
      // in effectively every ESPN league — they're baseline, not custom.
      // Only unmapped OFFENSIVE ids signal the league deviates in a way
      // that moves skill-position value (observed live: the yardage-
      // milestone / long-TD bonus family, ids 15–18 / 35–38 / 45–46 /
      // 56–57 / 63, at +1..+6 each).
      if (pts !== 0 && id < 74) unnamed++;
      continue;
    }

    if (label === 'rec' || label === 'pass_td' || ESPN_DEFAULTS[label] !== pts) {
      parts.push(`${label} ${fmtNum(pts)}`);
    }

    // Per-position overrides are how ESPN expresses TE premium: the
    // reception item carries pointsOverrides {"4": 1.5} for TE.
    const overrides = item?.pointsOverrides;
    if (overrides && typeof overrides === 'object') {
      for (const [posId, val] of Object.entries(overrides)) {
        const v = Number(val);
        if (!Number.isFinite(v) || v === pts) continue;
        const pos = ESPN_OVERRIDE_POS[posId] ?? `pos${posId}`;
        parts.push(`${label}(${pos}) ${fmtNum(v)}`);
      }
    }
  }

  if (unnamed > 0) parts.push(`+${unnamed} offensive bonus rules (yardage-milestone / long-TD bonuses — mildly favors boom players)`);
  return parts.join(' · ');
}

// ── Yahoo ─────────────────────────────────────────────────────────────
//
// Yahoo returns league settings as stat_modifiers.stats[].stat with
// {stat_id, value}. Same rule as ESPN: only ids confident enough to
// name are named; the rest are counted.

const YAHOO_STAT_LABELS: Record<number, string> = {
  4:  'pass_yd',
  5:  'pass_td',
  6:  'pass_int',
  9:  'rush_yd',
  10: 'rush_td',
  11: 'rec',
  12: 'rec_yd',
  13: 'rec_td',
  15: 'ret_td',
  16: '2pt',
  18: 'fum_lost',
};

const YAHOO_DEFAULTS: Record<string, number> = {
  pass_yd: 0.04, pass_int: -1, rush_yd: 0.1, rush_td: 6,
  rec_yd: 0.1, rec_td: 6, fum_lost: -2, ret_td: 6, '2pt': 2,
};

export function summarizeYahooScoring(mods: Array<{ statId: number; value: number }> | undefined | null): string {
  if (!Array.isArray(mods) || mods.length === 0) return '';
  const parts: string[] = [];
  let unnamed = 0;

  for (const m of mods) {
    const id = Number(m.statId);
    const label = YAHOO_STAT_LABELS[id];
    const v = Number(m.value);
    if (!Number.isFinite(v)) continue;
    // Ids 19–56 are kicker (19–30) and team-defense (31–56) stats —
    // present and nonzero in effectively every Yahoo league, so they're
    // baseline, not custom (verified 2026-08-07 against live league
    // settings pages, which list FG buckets + DST rows on standard
    // leagues). Same reasoning as the ESPN ≥74 and Sleeper IDP filters.
    if (!label) { if (v !== 0 && (id < 19 || id > 56)) unnamed++; continue; }
    if (label === 'rec' || label === 'pass_td' || YAHOO_DEFAULTS[label] !== v) {
      parts.push(`${label} ${fmtNum(v)}`);
    }
  }

  if (unnamed > 0) parts.push(`+${unnamed} other custom scoring rules (values not exposed by name)`);
  return parts.join(' · ');
}

// ── Starting lineup ───────────────────────────────────────────────────
//
// Scoring is only half of what sets positional value; the other half is
// how many of each position the league actually starts. The Coach was
// previously told a slot COUNT ("20-slot") but never the composition,
// so it could not know a league starts 3WR + 2FLEX.

const BENCH_SLOTS = new Set(['BN', 'IR', 'TAXI', 'BE', 'RES']);

/**
 * Collapse a starting-slot list into "QB · 2RB · 3WR · TE · 2FLEX".
 * Bench/IR/taxi slots are excluded — they don't shape positional value.
 */
export function formatStartingSlots(slots: string[] | undefined | null): string {
  if (!Array.isArray(slots) || slots.length === 0) return '';
  const counts = new Map<string, number>();
  for (const raw of slots) {
    const slot = String(raw || '').toUpperCase();
    if (!slot || BENCH_SLOTS.has(slot)) continue;
    counts.set(slot, (counts.get(slot) ?? 0) + 1);
  }
  if (counts.size === 0) return '';
  // Conventional lineup order first, then anything unrecognised.
  const ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'WRRB_FLEX', 'REC_FLEX', 'SUPER_FLEX', 'OP', 'K', 'DEF', 'D/ST', 'DST'];
  const rank = (s: string) => { const i = ORDER.indexOf(s); return i === -1 ? ORDER.length : i; };
  return [...counts.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([slot, n]) => (n > 1 ? `${n}${slot}` : slot))
    .join(' · ');
}

/** ESPN expresses the lineup as lineupSlotCounts {slotId: count}. */
export function formatESPNStartingSlots(
  lineupSlotCounts: Record<string, any> | undefined | null,
  slotNames: Record<number, string>,
): string {
  if (!lineupSlotCounts || typeof lineupSlotCounts !== 'object') return '';
  const expanded: string[] = [];
  for (const [slotId, count] of Object.entries(lineupSlotCounts)) {
    const n = Number(count || 0);
    if (n <= 0) continue;
    const name = slotNames[Number(slotId)] ?? `SLOT${slotId}`;
    for (let i = 0; i < n; i++) expanded.push(name);
  }
  return formatStartingSlots(expanded);
}
