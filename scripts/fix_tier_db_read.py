#!/usr/bin/env python3
"""
Fix getCurrentTier() to read from public.users (DB) first, RevenueCat second.

Why:
  Currently getCurrentTier() only reads from RevenueCat. This means manual
  tier grants in the DB (for testing, comp accounts, beta testers, lifetime
  founders) have no effect — the app always defers to RevenueCat which
  returns 'free' for unpaid accounts.

  After this patch:
    1. Read tier from public.users by auth_id (source of truth)
    2. If DB returns null/error or 'free', fall back to RevenueCat
    3. Whichever returns the higher tier wins

  This is the right architecture: DB is canonical, RevenueCat is a sync
  partner. syncTierToSupabase already writes RC purchases to the DB, so
  paying users hit the DB path on subsequent reads. Manual grants also
  work. Both paths converge on the same source of truth.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/fix_tier_db_read.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "services" / "purchases.ts"


OLD_FN = """// ── Current Tier ──────────────────────────────────────────────────────────────
export async function getCurrentTier(): Promise<string> {
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    return getTierFromEntitlements(customerInfo.entitlements.active) ?? 'free';
  } catch {
    return 'free';
  }
}"""

NEW_FN = """// ── Current Tier ──────────────────────────────────────────────────────────────
// Reads tier from public.users first (DB is source of truth); falls back
// to RevenueCat if DB lookup fails or returns 'free'. Whichever returns
// the higher tier wins — this lets manual DB grants (founders, comps,
// beta testers) work alongside RevenueCat purchases without conflict.

const TIER_RANK: Record<string, number> = {
  free: 0,
  rankings: 1,
  pro: 2,
  dynasty_elite: 3,
};

function higherTier(a: string, b: string): string {
  return (TIER_RANK[a] ?? 0) >= (TIER_RANK[b] ?? 0) ? a : b;
}

export async function getCurrentTier(): Promise<string> {
  let dbTier: string = 'free';
  let rcTier: string = 'free';

  // ── DB path ──
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: row } = await supabase
        .from('users')
        .select('tier')
        .eq('auth_id', user.id)
        .maybeSingle();
      if (row?.tier && typeof row.tier === 'string') dbTier = row.tier;
    }
  } catch {
    // DB error — fall through to RC only
  }

  // ── RevenueCat path ──
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    rcTier = getTierFromEntitlements(customerInfo.entitlements.active) ?? 'free';
  } catch {
    // RC error — DB result will be returned
  }

  return higherTier(dbTier, rcTier);
}"""


def main():
    if not TARGET.exists():
        print(f"ERROR: {TARGET} not found")
        sys.exit(1)

    s = TARGET.read_text()

    if "TIER_RANK" in s and "higherTier" in s:
        print("  [ALREADY]  getCurrentTier already reads from DB + RC")
        return

    if OLD_FN not in s:
        print("  [MISSING]  could not find original getCurrentTier function")
        sys.exit(2)

    s = s.replace(OLD_FN, NEW_FN)
    TARGET.write_text(s)
    print("  [APPLIED]  getCurrentTier now reads DB first, RC fallback")
    print()
    print(f"  ✓ {TARGET.name}")


if __name__ == "__main__":
    print("=" * 60)
    print("Fix tier read: DB first, RevenueCat fallback")
    print("=" * 60)
    print()
    main()
    print()
    print("Next: npx tsc --noEmit")
