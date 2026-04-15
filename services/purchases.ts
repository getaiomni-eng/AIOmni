// services/purchases.ts
// RevenueCat subscription management — 2 tiers: Rankings ($2.99) + Pro ($9.99)

import Purchases, { LOG_LEVEL, PurchasesPackage } from 'react-native-purchases';
import { supabase } from './supabase';

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
export async function getPackages(): Promise<PurchasesPackage[]> {
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current?.availablePackages ?? [];
  } catch (e) {
    console.log('getPackages error:', e);
    return [];
  }
}

// ── Purchase ──────────────────────────────────────────────────────────────────
export async function purchasePackage(pkg: PurchasesPackage): Promise<{
  success: boolean;
  tier?: string;
}> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    const tier = getTierFromEntitlements(customerInfo.entitlements.active);
    if (tier) await syncTierToSupabase(tier);
    return { success: true, tier: tier ?? undefined };
  } catch (e: any) {
    if (e.userCancelled) return { success: false };
    console.log('purchasePackage error:', e);
    return { success: false };
  }
}

// ── Restore ───────────────────────────────────────────────────────────────────
export async function restorePurchases(): Promise<{ success: boolean; tier?: string }> {
  try {
    const customerInfo = await Purchases.restorePurchases();
    const tier = getTierFromEntitlements(customerInfo.entitlements.active);
    if (tier) await syncTierToSupabase(tier);
    return { success: true, tier: tier ?? undefined };
  } catch (e) {
    console.log('restorePurchases error:', e);
    return { success: false };
  }
}

// ── Current Tier ──────────────────────────────────────────────────────────────
export async function getCurrentTier(): Promise<string> {
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    return getTierFromEntitlements(customerInfo.entitlements.active) ?? 'free';
  } catch {
    return 'free';
  }
}

function getTierFromEntitlements(active: Record<string, any>): string | null {
  // Check highest tier first
  if (active[ENTITLEMENTS.pro]?.isActive) return 'pro';
  if (active[ENTITLEMENTS.rankings]?.isActive) return 'rankings';
  return null;
}

async function syncTierToSupabase(tier: string): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from('users')
      .update({ tier, updated_at: new Date().toISOString() })
      .eq('auth_id', user.id);
  } catch (e) {
    console.log('syncTierToSupabase error:', e);
  }
}

// ── Tier display info ─────────────────────────────────────────────────────────
export const TIER_INFO: Record<string, {
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
      'Community rankings',
      'Roster & matchup view',
      '10 AI prompts to try',
    ],
    promptLabel: '10 lifetime',
  },
  rankings: {
    label: 'Rankings',
    price: '$2.99/mo',
    yearlyPrice: '$24.99/yr',
    color: '#1be7ff',
    features: [
      'Custom rankings per league',
      'Prospect rankings',
      'Format filters (PPR/SF/TEP)',
      '20 AI prompts/week',
      'Everything in Free',
    ],
    promptLabel: '20/week',
  },
  pro: {
    label: 'Pro',
    price: '$9.99/mo',
    yearlyPrice: '$89.99/yr',
    color: '#ffb800',
    features: [
      'Draft Copilot',
      'Trade Analyzer',
      'Season-long AI memory',
      '40 AI prompts/week',
      'Everything in Rankings',
    ],
    promptLabel: '40/week',
  },
};

export { ENTITLEMENTS, PRODUCT_IDS };
