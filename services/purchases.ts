// services/purchases.ts
// RevenueCat subscription management — Option D tier structure (locked
// 2026-05-04 in decisions.md):
//   Free       — Pulse only, 10 lifetime AI prompts
//   Rankings   — $4.99/mo or $39.99/yr, Formula + Quiz + 25 weekly prompts
//   Pro        — $12.99/mo or $99.99/yr, AI Coach + Draft Copilot + 50/wk
//
// Tier resolution is DB-first / RevenueCat-fallback (whichever returns
// the higher tier). DB-first lets manual grants for founders / comps /
// beta testers work alongside RC purchases.

import Purchases, { LOG_LEVEL, PurchasesPackage } from 'react-native-purchases';
import { supabase } from './supabase';

export type Tier = 'free' | 'rankings' | 'pro';

const REVENUECAT_APPLE_KEY = 'appl_rfnwmgVZgjZWBrbGjYehDCMmJvG';

const ENTITLEMENTS = {
  rankings: 'rankings',
  pro: 'pro',
} as const;

const PRODUCT_IDS = {
  rankings_monthly: 'com.getaiomni.rankings.v2.monthly',
  rankings_yearly: 'com.getaiomni.rankings.v2.yearly',
  pro_monthly: 'com.getaiomni.pro.monthly',
  pro_yearly: 'com.getaiomni.pro.yearly',
} as const;

// ── Init ───────────────────────────────────────────────────────────────────────
export async function initPurchases(userId?: string): Promise<void> {
  try {
    Purchases.setLogLevel(LOG_LEVEL.ERROR);
    await Purchases.configure({ apiKey: REVENUECAT_APPLE_KEY, appUserID: userId });
  } catch (e) {
    console.log('initPurchases error:', e);
  }
}

// ── Packages ──────────────────────────────────────────────────────────────────
// Returns packages from EVERY offering (current + all named offerings),
// de-duped by product identifier. Many RC dashboards split tiers into
// separate offerings (e.g. a "rankings" offering and a "pro" offering);
// returning only `offerings.current.availablePackages` silently misses
// the other tier's packages and makes findPackage() fail.
export async function getPackages(): Promise<PurchasesPackage[]> {
  const { packages } = await getPackagesWithDiagnostic();
  return packages;
}

export type PackagesDiagnostic = {
  packages: PurchasesPackage[];
  currentOfferingId: string | null;
  allOfferingIds: string[];
  error: string | null;
};

// Returns packages alongside diagnostic info — used by the paywall to
// render an on-device debug panel when nothing matches, so we can see
// what RC actually returned without a Mac/Xcode console.
export async function getPackagesWithDiagnostic(): Promise<PackagesDiagnostic> {
  try {
    const offerings = await Purchases.getOfferings();
    const seen = new Set<string>();
    const out: PurchasesPackage[] = [];
    const push = (pkgs?: PurchasesPackage[]) => {
      for (const p of pkgs ?? []) {
        const k = p.product.identifier;
        if (k && !seen.has(k)) { seen.add(k); out.push(p); }
      }
    };
    push(offerings.current?.availablePackages);
    for (const id of Object.keys(offerings.all ?? {})) {
      push(offerings.all[id]?.availablePackages);
    }
    if (__DEV__) {
      console.log('[RC] getPackages →', out.map(p => ({
        offering: p.offeringIdentifier,
        type: p.packageType,
        productId: p.product.identifier,
      })));
    }
    return {
      packages: out,
      currentOfferingId: offerings.current?.identifier ?? null,
      allOfferingIds: Object.keys(offerings.all ?? {}),
      error: null,
    };
  } catch (e: any) {
    console.log('getPackages error:', e);
    return {
      packages: [],
      currentOfferingId: null,
      allOfferingIds: [],
      error: e?.message ?? String(e),
    };
  }
}

// ── Purchase ──────────────────────────────────────────────────────────────────
export async function purchasePackage(pkg: PurchasesPackage): Promise<{
  success: boolean;
  tier?: Tier;
}> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    const tier = getTierFromEntitlements(customerInfo.entitlements.active);
    if (tier) {
      // Tier no longer syncs from the client — the RevenueCat webhook is
      // the sole writer (users.tier is trigger-protected against client
      // writes). Local cache updates immediately for snappy UI; the DB
      // row follows within seconds via the webhook.
      cachedTier = tier;
    }
    return { success: true, tier: tier ?? undefined };
  } catch (e: any) {
    if (e.userCancelled) return { success: false };
    console.log('purchasePackage error:', e);
    return { success: false };
  }
}

// ── Restore ───────────────────────────────────────────────────────────────────
export async function restorePurchases(): Promise<{ success: boolean; tier?: Tier }> {
  try {
    const customerInfo = await Purchases.restorePurchases();
    const tier = getTierFromEntitlements(customerInfo.entitlements.active);
    if (tier) {
      cachedTier = tier;  // DB sync arrives via RevenueCat webhook
    } else {
      // No active entitlements — make sure the cache reflects that too
      cachedTier = 'free';
    }
    return { success: true, tier: tier ?? undefined };
  } catch (e) {
    console.log('restorePurchases error:', e);
    return { success: false };
  }
}

// ── Current Tier ──────────────────────────────────────────────────────────────
// Reads tier from public.users first (DB is source of truth); falls back
// to RevenueCat if DB lookup fails or returns 'free'. Whichever returns
// the higher tier wins — this lets manual DB grants (founders, comps,
// beta testers) work alongside RevenueCat purchases without conflict.

const TIER_RANK: Record<Tier, number> = {
  free: 0,
  rankings: 1,
  pro: 2,
};

function higherTier(a: Tier, b: Tier): Tier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

function normalizeTier(raw: string | null | undefined): Tier {
  if (raw === 'pro') return 'pro';
  if (raw === 'rankings') return 'rankings';
  // Anything else (including legacy 'premium' / 'dynasty_elite' from
  // pre-Option-D rows in public.users) collapses to free. Manual grants
  // post-Option-D should write 'rankings' or 'pro' only.
  return 'free';
}

export async function getCurrentTier(): Promise<Tier> {
  let dbTier: Tier = 'free';
  let rcTier: Tier = 'free';

  // ── DB path ──
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: row } = await supabase
        .from('users')
        .select('tier')
        .eq('auth_id', user.id)
        .maybeSingle();
      dbTier = normalizeTier(row?.tier as string | null | undefined);
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
}

function getTierFromEntitlements(active: Record<string, any>): Tier | null {
  // Pro entitlement is a superset of Rankings (Pro users have both).
  // Check highest first so the resolved tier is the highest active.
  if (active[ENTITLEMENTS.pro]?.isActive) return 'pro';
  if (active[ENTITLEMENTS.rankings]?.isActive) return 'rankings';
  return null;
}

// ── Cached tier (for sync read sites) ──────────────────────────────
// Sites that render synchronously (lock-icon visibility, prompt-counter
// display) can't await getCurrentTier on every render. They read this
// cache; refreshTier() repopulates it after init, after purchases, and
// on customer-info change events.

let cachedTier: Tier = 'free';

export function getCachedTier(): Tier {
  return cachedTier;
}

export async function refreshTier(): Promise<Tier> {
  const tier = await getCurrentTier();
  cachedTier = tier;
  return tier;
}

// Wires a RevenueCat customer-info listener so server-side entitlement
// changes (e.g. cancellations, billing failures, tier upgrades from
// another device) repopulate the cache without an app restart.
let listenerAttached = false;
export function attachCustomerInfoListener(): void {
  if (listenerAttached) return;
  Purchases.addCustomerInfoUpdateListener(() => {
    void refreshTier();
  });
  listenerAttached = true;
}

// ── Tier display info ─────────────────────────────────────────────────────────
// Prices + prompt allocations locked 2026-05-04 (decisions.md item 1).
export const TIER_INFO: Record<Tier, {
  label: string;
  price: string;
  yearlyPrice: string;
  color: string;
  features: string[];
  promptLabel: string;
}> = {
  free: {
    label: 'Free',
    price: '$0',
    yearlyPrice: '$0',
    color: '#7a9eaa',
    features: [
      'Pulse — multi-source consensus rankings',
      'Roster & matchup view',
      '10 AI prompts to try (lifetime)',
    ],
    promptLabel: '10 lifetime',
  },
  rankings: {
    label: 'Rankings',
    price: '$4.99/mo',
    yearlyPrice: '$39.99/yr',
    color: '#1be7ff',
    features: [
      'AIOmni Formula (proprietary engine)',
      'My Rankings + Custom Rankings Quiz',
      'Format filters (PPR/Half/Std/SF, Redraft/Dynasty)',
      '25 AI prompts/week',
      'Everything in Free',
    ],
    promptLabel: '25/week',
  },
  pro: {
    label: 'Pro',
    price: '$12.99/mo',
    yearlyPrice: '$99.99/yr',
    color: '#ffb800',
    features: [
      'AI Coach — season memory + roster context',
      'Draft Copilot (live draft assistance)',
      'Trade Analyzer (A-F grades, league-aware)',
      '50 AI prompts/week',
      'Everything in Rankings',
    ],
    promptLabel: '50/week',
  },
};

export { ENTITLEMENTS, PRODUCT_IDS };
