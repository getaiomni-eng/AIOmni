// app/hooks/useHeatAccess.ts
// ═══════════════════════════════════════════════════════════════════════════
// HEAT ACCESS — tier-based gating for the Heat feature
// ═══════════════════════════════════════════════════════════════════════════
//
// Single source of truth for "what Heat UI does this user see?"
// Used by Rankings tab, Waivers tab, and any future Heat surface.
//
// ─── GATING RULES ───────────────────────────────────────────────────────────
//
//   Free tier:
//     - Sees the flame icon ONLY on HOT+SCORCHING (score >= 70)
//     - Never sees the numeric score
//     - Can't sort by Heat
//     - Tapping the Heat sort chip triggers the upgrade modal
//     Rationale: free user sees "something is happening" on elite players,
//     creating visible curiosity that Rankings+ unlocks
//
//   Rankings ($2.99/mo):
//     - Sees flame icon on all players with score >= 40
//     - Sees numeric score inside icon
//     - Can't sort by Heat on Waivers (reserved for Pro)
//
//   Pro ($9.99/mo):
//     - All of the above
//     - Can sort Waivers by Heat
//     - Full transparency
//
// Returns the tier read from purchases.ts; falls back to 'free' if RevenueCat
// hasn't resolved yet (safer than showing Pro features to unpaid users).
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { getCurrentTier } from '../../services/purchases';

export interface HeatAccess {
  tier: 'free' | 'rankings' | 'pro' | 'dynasty_elite';
  /** Show any flame icon at all */
  showIcon: boolean;
  /** Show numeric score inside/next to the flame */
  showScore: boolean;
  /** Minimum score required to render the flame (teaser threshold) */
  iconThreshold: number;
  /** Can user sort waivers by Heat? */
  canSortByHeat: boolean;
}

export function useHeatAccess(): HeatAccess {
  const [tier, setTier] = useState<HeatAccess['tier']>('free');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const t = await getCurrentTier();
        if (active) setTier(t as HeatAccess['tier']);
      } catch {
        if (active) setTier('free');
      }
    })();
    return () => { active = false; };
  }, []);

  // Paid tiers (anything above free)
  const isPaid = tier === 'rankings' || tier === 'pro' || tier === 'dynasty_elite';
  const isPro  = tier === 'pro' || tier === 'dynasty_elite';

  return {
    tier,
    showIcon: true,                       // always show something; threshold filters
    showScore: isPaid,                    // numeric score only for paid
    iconThreshold: isPaid ? 40 : 70,      // free = HOT+SCORCHING only; paid = WARM+
    canSortByHeat: isPro,                 // Pro-only waiver sort
  };
}
