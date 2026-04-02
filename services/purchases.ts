// services/purchases.ts
// RevenueCat — handles all Apple IAP, receipt validation, and entitlements

import Purchases, { LOG_LEVEL, PurchasesPackage } from 'react-native-purchases';
import { supabase } from './supabase';

const REVENUECAT_APPLE_KEY = 'appl_rfnwmgVZgjZWBrbGjYehDCMmJvG';

export const PRODUCT_IDS = {
  rankings:      'com.getaiomni.rankings.monthly',
  pro:           'com.getaiomni.pro.monthly',
  premium:       'com.getaiomni.premium.monthly',
  dynasty_elite: 'com.getaiomni.dynasty.monthly',
};

export const ENTITLEMENTS = {
  rankings:      'rankings',
  pro:           'pro',
  premium:       'premium',
  dynasty_elite: 'dynasty_elite',
};

export async function initPurchases(userId?: string): Promise<void> {
  try {
    Purchases.setLogLevel(LOG_LEVEL.ERROR);
    await Purchases.configure({ apiKey: REVENUECAT_APPLE_KEY, appUserID: userId });
  } catch (e) {
    console.log('RevenueCat init error:', e);
  }
}

export async function getPackages(): Promise<PurchasesPackage[]> {
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current?.availablePackages ?? [];
  } catch (e) {
    console.log('getPackages error:', e);
    return [];
  }
}

export async function purchasePackage(pkg: PurchasesPackage): Promise<{
  success: boolean; tier?: string; error?: string;
}> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    const tier = getTierFromEntitlements(customerInfo.entitlements.active);
    if (tier) await syncTierToSupabase(tier);
    return { success: true, tier: tier ?? undefined };
  } catch (e: any) {
    if (e.userCancelled) return { success: false, error: 'cancelled' };
    return { success: false, error: e.message ?? 'Purchase failed' };
  }
}

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

export async function getCurrentTier(): Promise<string> {
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    return getTierFromEntitlements(customerInfo.entitlements.active) ?? 'free';
  } catch {
    return 'free';
  }
}

function getTierFromEntitlements(active: Record<string, any>): string | null {
  if (active[ENTITLEMENTS.dynasty_elite]?.isActive) return 'dynasty_elite';
  if (active[ENTITLEMENTS.premium]?.isActive)       return 'premium';
  if (active[ENTITLEMENTS.pro]?.isActive)            return 'pro';
  if (active[ENTITLEMENTS.rankings]?.isActive)       return 'rankings';
  return null;
}

async function syncTierToSupabase(tier: string): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('users').update({ tier, updated_at: new Date().toISOString() }).eq('auth_id', user.id);
  } catch (e) {
    console.log('syncTierToSupabase error:', e);
  }
}

export const TIER_INFO: Record<string, { label: string; price: string; color: string; features: string[] }> = {
  free: {
    label: 'Free', price: '$0', color: 'rgba(255,255,255,0.5)',
    features: ['25 AI prompts/week', 'Sleeper + ESPN + Yahoo', 'Live injury data'],
  },
  rankings: {
    label: 'Rankings', price: '$5.99/mo', color: '#4ab8a0',
    features: ['Live community rankings', 'PPR / Half / Standard', 'Position filters'],
  },
  pro: {
    label: 'Pro', price: '$9.99/mo', color: '#FEE229',
    features: ['75 AI prompts/week', 'Draft Copilot', 'Trade Analyzer', 'Autopilot mode'],
  },
  premium: {
    label: 'Premium', price: '$14.99/mo', color: '#9b6dbd',
    features: ['125 AI prompts/week', '2-season AI memory', 'Dynasty advice', 'Everything in Pro'],
  },
  dynasty_elite: {
    label: 'Dynasty Elite', price: '$19.99/mo', color: '#82c494',
    features: ['Unlimited prompts', 'College rankings', 'Future pick valuation', 'Everything in Premium'],
  },
};