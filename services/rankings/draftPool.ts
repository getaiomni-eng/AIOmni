// services/rankings/draftPool.ts
// ═══════════════════════════════════════════════════════════════════════════
// DRAFT POOL — engine overlay for draft.tsx's player pool
// ═══════════════════════════════════════════════════════════════════════════
//
// The existing loadLivePlayerDB() fetches enriched player data (bye weeks,
// injury flags, etc.) from various sources and was the sole authority on
// draft ordering. That produced two problems:
//
//   1. Draft rankings drifted from the Rankings tab — users saw different
//      orders in different parts of the app for the same league/format.
//   2. User overrides from the Rankings tab didn't carry through to the
//      draft, so "I moved Bijan to #1" had no effect on draft advice.
//
// This module overlays engine output + user overrides onto the base pool
// WITHOUT discarding the enrichment data (byeWeek etc.). The flow:
//
//   base pool ─┐
//              ├─> overlay engine rank/tier/adp for matched players
//   engine  ───┤
//              ├─> apply user deltas (from userOverrides module)
//   overrides ─┘
//              └─> return merged pool, sorted by final effective rank
//
// Players present in base pool but absent from engine output (rare — only
// niche IDPs or retired names) land at the tail of the list with their
// original rank preserved as a tiebreaker.
//
// ─── ROOKIE DRAFT NOTE ──────────────────────────────────────────────────────
// For dynasty rookie drafts, the caller skips this module entirely and uses
// loadLivePlayerDB('rookie') directly. The engine doesn't rank 2026 rookies
// yet — no team/age data — so PROSPECT_SEED_2026 remains authoritative until
// the nflreadpy sync lands.
//
// ═══════════════════════════════════════════════════════════════════════════

import { getEngineRankings } from './aiomniEngineBridge';
import { getOverrides, applyOverrides } from './userOverrides';
import type { ScoringFormat as UIFormat } from '../rankingsData';

// Shape we require from caller's base pool. Kept loose so draft.tsx's
// PlayerInfo (which includes byeWeek, isDrafted, etc.) passes through
// unmodified via the generic type parameter.
interface MinimalPoolPlayer {
  id: string;
  rank?: number;
  tier?: number;
  adp?: number;
  posRank?: number;
}

// ─── UIFormat DERIVATION ────────────────────────────────────────────────────
// Map a Sleeper league's actual settings onto the engine's UIFormat enum.
// Priority order matches what most users expect:
//   Dynasty  → DYN (time-value adjusts for age)
//   Superflex→ SF  (two-QB replacement level)
//   Scoring  → PPR / HALF / STD
//
// V1 limitation: we're mapping to presets, not building a bespoke LeagueConfig
// from teamCount/rosterSlots/scoringSettings. That's OK for launch — most
// leagues are 10-14 team with standard rosters. A later pass can plumb real
// config through when edge cases surface.

export interface DraftFormatInput {
  scoringFormat?: 'ppr' | 'half' | 'standard';
  rosterSlots?: string[];
  isDynasty?: boolean;
}

export function draftSettingsToUIFormat(input: DraftFormatInput): UIFormat {
  if (input.isDynasty) return 'DYN';

  // Superflex detection: explicit SUPER_FLEX slot OR 2+ QB starter slots
  const slots = input.rosterSlots ?? [];
  const hasSuperflexSlot = slots.some(s =>
    s === 'SUPER_FLEX' || s === 'SUPERFLEX' || s === 'SF'
  );
  const qbSlotCount = slots.filter(s => s === 'QB').length;
  if (hasSuperflexSlot || qbSlotCount >= 2) return 'SF';

  switch (input.scoringFormat) {
    case 'ppr':      return 'PPR';
    case 'half':     return 'HALF';
    case 'standard': return 'STD';
    default:         return 'PPR';
  }
}

// ─── MAIN ENTRY ─────────────────────────────────────────────────────────────

/**
 * Overlay engine rankings + user overrides onto a base player pool.
 *
 * @param basePool   Pool from loadLivePlayerDB() (or similar source).
 *                   Must have at minimum `id`; other fields preserved.
 * @param format     UIFormat — use draftSettingsToUIFormat() to derive this
 *                   from a DraftSettings object.
 * @param leagueId   League-specific overrides scope. Pass settings.leagueId
 *                   for Sleeper drafts; null/undefined for offline.
 * @returns          Same pool with engine rank/tier/adp overlaid and
 *                   user's deltas applied, sorted by effective rank.
 */
export async function applyEngineToDraftPool<T extends MinimalPoolPlayer>(
  basePool: T[],
  format: UIFormat,
  leagueId?: string | null,
): Promise<T[]> {
  try {
    const [engineRanked, overrides] = await Promise.all([
      getEngineRankings(format),
      getOverrides(leagueId ?? null),
    ]);

    if (engineRanked.length === 0) return basePool;

    // Apply the user's per-player deltas to engine output, then index by id.
    const overridden = applyOverrides(engineRanked, overrides);
    const engineById = new Map<string, {
      rank: number;
      tier: number;
      posRank: number;
      adp: number;
    }>();
    for (const p of overridden) {
      engineById.set(p.id, {
        rank: p.rank,
        tier: p.tier,
        posRank: p.posRank ?? 0,
        adp: parseFloat(p.adp as unknown as string) || 999,
      });
    }

    // Overlay engine data onto each base-pool player. Preserve everything
    // else from the base pool (byeWeek, isDrafted, name, team, etc.) so
    // the draft UI's data display stays complete.
    const enhanced = basePool.map(p => {
      const engine = engineById.get(p.id);
      if (!engine) return p;
      return {
        ...p,
        rank: engine.rank,
        tier: engine.tier,
        posRank: engine.posRank,
        adp: engine.adp,
      };
    });

    // Sort by final rank: engine-ranked first (in engine order), non-engine
    // players at the tail preserving their original rank.
    const TAIL_OFFSET = 10000;
    enhanced.sort((a, b) => {
      const aEngine = engineById.has(a.id);
      const bEngine = engineById.has(b.id);
      const aKey = aEngine ? (a.rank ?? 0) : TAIL_OFFSET + (a.rank ?? 0);
      const bKey = bEngine ? (b.rank ?? 0) : TAIL_OFFSET + (b.rank ?? 0);
      return aKey - bKey;
    });

    return enhanced;
  } catch (e) {
    console.log('applyEngineToDraftPool error:', e);
    return basePool;
  }
}
