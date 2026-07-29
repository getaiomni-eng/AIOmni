// app/paywall.tsx
// AIOmni Paywall — Option D tier structure (locked 2026-05-04 in decisions.md):
//   Free       — $0
//   Rankings   — $4.99/mo, $39.99/yr
//   Pro        — $12.99/mo, $99.99/yr
//
// Context-aware headline: ?context=rankings_lock | pro_lock |
//                                  free_prompts_exhausted | weekly_prompts_exhausted
// Uses TIER_INFO from services/purchases.ts as the single source of truth
// for prices + features (so future price changes only land there).

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { PACKAGE_TYPE, PurchasesPackage } from 'react-native-purchases';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getCurrentTier,
  getPackagesWithDiagnostic,
  PackagesDiagnostic,
  purchasePackage,
  refreshTier,
  restorePurchases,
  TIER_INFO,
} from '../services/purchases';

type BillingCycle = 'monthly' | 'yearly';

const BG = '#0a1214';
const CARD = '#12252e';
const BORDER = '#1a3542';
const TEXT = '#f0f4f5';
const SUB = '#7a9eaa';
const AMBER = '#ffb800';
const AQUA = '#1be7ff';

type PaywallContext = 'rankings_lock' | 'pro_lock' | 'free_prompts_exhausted' | 'weekly_prompts_exhausted';

const CONTEXT_HEADLINES: Record<PaywallContext, { title: string; sub?: string }> = {
  rankings_lock:            { title: 'Unlock the Full AIOmni Engine', sub: 'Formula rankings, custom quiz, format filters.' },
  pro_lock:                 { title: 'Get the AI Coach',              sub: 'Season memory, roster context, draft copilot.' },
  free_prompts_exhausted:   { title: "You've used your 10 free questions", sub: 'Upgrade to keep asking — 25/week on Rankings, 50/week on Pro.' },
  weekly_prompts_exhausted: { title: "You've hit this week's prompt limit", sub: 'Upgrade to Pro for 50 prompts/week + AI Coach.' },
};

export default function PaywallScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ context?: string }>();
  const context = (params.context as PaywallContext) ?? null;
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [diag, setDiag] = useState<PackagesDiagnostic | null>(null);
  const [showDiag, setShowDiag] = useState(false);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [currentTier, setCurrentTier] = useState<string>('free');
  const [billing, setBilling] = useState<BillingCycle>('monthly');

  useEffect(() => {
    (async () => {
      const [d, tier] = await Promise.all([getPackagesWithDiagnostic(), getCurrentTier()]);
      setPackages(d.packages);
      setDiag(d);
      setCurrentTier(tier);
      setLoading(false);
    })();
  }, []);

  // Two-step matcher:
  //   1) Prefer RC-native fields — packageType (MONTHLY/ANNUAL) + offering
  //      identifier (when the dashboard splits tiers into named offerings
  //      like "rankings"/"pro").
  //   2) Fall back to product.identifier substring for single-offering
  //      setups where everything lives under offerings.current.
  const findPackage = (keyword: string, cycle: BillingCycle): PurchasesPackage | undefined => {
    const wantType = cycle === 'yearly' ? PACKAGE_TYPE.ANNUAL : PACKAGE_TYPE.MONTHLY;
    const k = keyword.toLowerCase();
    const byNative = packages.find(p =>
      p.packageType === wantType &&
      (p.offeringIdentifier ?? '').toLowerCase().includes(k)
    );
    if (byNative) return byNative;
    return packages.find(p => {
      const id = p.product.identifier.toLowerCase();
      return id.includes(k) && id.includes(cycle === 'yearly' ? 'yearly' : 'monthly');
    });
  };

  const handlePurchase = async (tier: 'rankings' | 'pro') => {
    const pkg = findPackage(tier, billing);
    if (!pkg) {
      Alert.alert('Not Available', 'This subscription is not available right now. Please try again later.');
      return;
    }
    setPurchasing(true);
    const result = await purchasePackage(pkg);
    setPurchasing(false);
    if (result.success) {
      // Force a fresh tier read from RC + DB. purchasePackage already
      // updates the cache, but refreshTier ensures the higherTier blend
      // (DB grants vs RC entitlements) is applied — important when a
      // beta-tester comp is in the DB row alongside a paid sub.
      const refreshed = await refreshTier();
      setCurrentTier(refreshed);
      Alert.alert('Welcome!', `You're now on the ${TIER_INFO[refreshed]?.label ?? refreshed} plan.`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    }
  };

  const handleRestore = async () => {
    setPurchasing(true);
    const result = await restorePurchases();
    setPurchasing(false);
    if (result.success && result.tier) {
      setCurrentTier(result.tier);
      Alert.alert('Restored', `Welcome back! You're on the ${TIER_INFO[result.tier]?.label} plan.`);
    } else {
      Alert.alert('No Purchases Found', 'No previous subscriptions were found for this account.');
    }
  };

  const tierOrder: Array<'free' | 'rankings' | 'pro'> = ['free', 'rankings', 'pro'];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.closeBtn}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.title}>
          {context && CONTEXT_HEADLINES[context]?.title ? CONTEXT_HEADLINES[context].title : 'Choose Your Plan'}
        </Text>
        <View style={{ width: 28 }} />
      </View>

      {context && CONTEXT_HEADLINES[context]?.sub && (
        <Text style={styles.contextSub}>{CONTEXT_HEADLINES[context].sub}</Text>
      )}

      {/* Billing Toggle */}
      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleBtn, billing === 'monthly' && styles.toggleActive]}
          onPress={() => setBilling('monthly')}
        >
          <Text style={[styles.toggleText, billing === 'monthly' && styles.toggleTextActive]}>
            Monthly
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, billing === 'yearly' && styles.toggleActive]}
          onPress={() => setBilling('yearly')}
        >
          <Text style={[styles.toggleText, billing === 'yearly' && styles.toggleTextActive]}>
            Yearly
          </Text>
          <Text style={styles.saveBadge}>SAVE 30%</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={AQUA} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {tierOrder.map((tierKey) => {
            const info = TIER_INFO[tierKey];
            const isCurrent = currentTier === tierKey;
            const isUpgrade =
              tierOrder.indexOf(tierKey as any) > tierOrder.indexOf(currentTier as any);
            const isPro = tierKey === 'pro';
            const accentColor = isPro ? AMBER : tierKey === 'rankings' ? AQUA : SUB;

            const price =
              tierKey === 'free'
                ? 'Free'
                : billing === 'yearly'
                ? info.yearlyPrice
                : info.price;

            return (
              <View
                key={tierKey}
                style={[
                  styles.card,
                  isPro && styles.cardHighlighted,
                  isCurrent && styles.cardCurrent,
                ]}
              >
                {isPro && (
                  <View style={styles.popularBadge}>
                    <Text style={styles.popularText}>MOST POPULAR</Text>
                  </View>
                )}

                <View style={styles.cardHeader}>
                  <Text style={[styles.tierName, { color: accentColor }]}>{info.label}</Text>
                  <Text style={styles.price}>{price}</Text>
                  {tierKey !== 'free' && billing === 'yearly' && (
                    <Text style={styles.perMonth}>
                      {tierKey === 'rankings' ? '~$2.08/mo' : '~$7.50/mo'}
                    </Text>
                  )}
                </View>

                <Text style={styles.promptBadge}>
                  {info.promptLabel} AI prompts
                </Text>

                <View style={styles.featureList}>
                  {info.features.map((f, i) => (
                    <View key={i} style={styles.featureRow}>
                      <Text style={[styles.checkmark, { color: accentColor }]}>✓</Text>
                      <Text style={styles.featureText}>{f}</Text>
                    </View>
                  ))}
                </View>

                {(() => {
                  if (isCurrent) {
                    return (
                      <View style={[styles.actionBtn, { backgroundColor: '#1a3542' }]}>
                        <Text style={[styles.actionText, { color: SUB }]}>Current Plan</Text>
                      </View>
                    );
                  }
                  if (tierKey === 'free' || !isUpgrade) return null;
                  // No package found for this tier+cycle (RC offering missing,
                  // products not yet propagated to sandbox, etc.). Render as
                  // disabled instead of letting the tap surface an unhelpful
                  // "Not Available" alert.
                  const pkg = findPackage(tierKey, billing);
                  if (!pkg) {
                    return (
                      <View style={[styles.actionBtn, { backgroundColor: '#1a3542' }]}>
                        <Text style={[styles.actionText, { color: SUB }]}>Unavailable</Text>
                      </View>
                    );
                  }
                  return (
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: accentColor }]}
                      onPress={() => handlePurchase(tierKey)}
                      disabled={purchasing}
                    >
                      {purchasing ? (
                        <ActivityIndicator color="#0a1214" size="small" />
                      ) : (
                        <Text style={[styles.actionText, { color: '#0a1214' }]}>
                          Upgrade to {info.label}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })()}
              </View>
            );
          })}

          {/* Restore */}
          <TouchableOpacity style={styles.restoreBtn} onPress={handleRestore}>
            <Text style={styles.restoreText}>Restore Purchases</Text>
          </TouchableOpacity>

          {/* Legal — Apple guideline 3.1.2 requires Terms of Use + Privacy
              Policy links wherever auto-renewable subscriptions are sold.
              Missing links here is a top App Review rejection reason. */}
          <View style={styles.legalRow}>
            <TouchableOpacity onPress={() => Linking.openURL('https://getaiomni.com/terms')}>
              <Text style={styles.legalLink}>Terms of Use</Text>
            </TouchableOpacity>
            <Text style={styles.legalDot}>·</Text>
            <TouchableOpacity onPress={() => Linking.openURL('https://getaiomni.com/privacy')}>
              <Text style={styles.legalLink}>Privacy Policy</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.legalNote}>
            Subscriptions auto-renew until cancelled in your App Store settings.
          </Text>

          {/* Diagnostic panel — visible when any tier is missing its package,
              so a tester without Mac/Xcode access can see what RC returned. */}
          {(() => {
            const anyMissing = (['rankings', 'pro'] as const).some(
              t => !findPackage(t, billing) && currentTier !== t
            );
            if (!anyMissing && !showDiag) return null;
            return (
              <View style={styles.diagBox}>
                <TouchableOpacity onPress={() => setShowDiag(s => !s)}>
                  <Text style={styles.diagToggle}>
                    {showDiag ? '▼' : '▶'} Subscription diagnostics
                  </Text>
                </TouchableOpacity>
                {showDiag && diag && (
                  <View style={{ marginTop: 8 }}>
                    <Text style={styles.diagLine}>
                      Current offering: {diag.currentOfferingId ?? '(none)'}
                    </Text>
                    <Text style={styles.diagLine}>
                      All offerings: {diag.allOfferingIds.length === 0 ? '(none)' : diag.allOfferingIds.join(', ')}
                    </Text>
                    <Text style={styles.diagLine}>
                      Packages returned: {diag.packages.length}
                    </Text>
                    {diag.packages.map((p, i) => (
                      <Text key={i} style={styles.diagLineSmall}>
                        · [{p.offeringIdentifier}] {p.packageType} → {p.product.identifier}
                      </Text>
                    ))}
                    {diag.error && (
                      <Text style={[styles.diagLine, { color: '#ff6b8a' }]}>
                        Error: {diag.error}
                      </Text>
                    )}
                  </View>
                )}
              </View>
            );
          })()}

          <Text style={styles.legal}>
            Payment is charged to your Apple ID account. Subscriptions automatically renew unless
            cancelled at least 24 hours before the end of the current period. Manage subscriptions
            in Settings → Apple ID → Subscriptions.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  closeBtn: {
    fontSize: 20,
    color: SUB,
    fontWeight: '600',
  },
  title: {
    fontFamily: 'BebasNeue',
    fontSize: 22,
    color: TEXT,
    letterSpacing: 1,
    flex: 1,
    textAlign: 'center',
  },
  contextSub: {
    fontFamily: 'SpaceGrotesk_400Regular',
    fontSize: 12,
    color: SUB,
    paddingHorizontal: 24,
    marginTop: -4,
    marginBottom: 12,
    textAlign: 'center',
    lineHeight: 18,
  },

  // Toggle
  toggleRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 3,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleActive: {
    backgroundColor: '#1a3542',
  },
  toggleText: {
    fontFamily: 'Barlow',
    fontSize: 14,
    color: SUB,
    fontWeight: '600',
  },
  toggleTextActive: {
    color: TEXT,
  },
  saveBadge: {
    fontFamily: 'SpaceMono',
    fontSize: 9,
    color: AMBER,
    letterSpacing: 0.5,
    marginTop: 2,
  },

  loadingWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },

  // Cards
  card: {
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 20,
    marginBottom: 14,
  },
  cardHighlighted: {
    borderColor: AMBER,
    borderWidth: 1.5,
  },
  cardCurrent: {
    borderColor: AQUA,
    borderWidth: 1.5,
  },
  popularBadge: {
    position: 'absolute',
    top: -10,
    right: 16,
    backgroundColor: AMBER,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
  },
  popularText: {
    fontFamily: 'SpaceMono',
    fontSize: 9,
    color: '#0a1214',
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  cardHeader: {
    marginBottom: 12,
  },
  tierName: {
    fontFamily: 'BebasNeue',
    fontSize: 20,
    letterSpacing: 1,
    marginBottom: 4,
  },
  price: {
    fontFamily: 'SpaceMono',
    fontSize: 24,
    color: TEXT,
    fontWeight: '700',
  },
  perMonth: {
    fontFamily: 'SpaceMono',
    fontSize: 11,
    color: SUB,
    marginTop: 2,
  },
  promptBadge: {
    fontFamily: 'SpaceMono',
    fontSize: 11,
    color: AMBER,
    backgroundColor: 'rgba(255,184,0,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginBottom: 14,
    overflow: 'hidden',
  },

  featureList: {
    marginBottom: 16,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  checkmark: {
    fontSize: 14,
    fontWeight: '700',
    marginRight: 8,
    marginTop: 1,
  },
  featureText: {
    fontFamily: 'Barlow',
    fontSize: 14,
    color: TEXT,
    flex: 1,
    lineHeight: 20,
  },

  actionBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionText: {
    fontFamily: 'BebasNeue',
    fontSize: 16,
    letterSpacing: 1,
    fontWeight: '700',
  },

  restoreBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 4,
  },
  restoreText: {
    fontFamily: 'Barlow',
    fontSize: 14,
    color: AQUA,
    textDecorationLine: 'underline',
  },
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  legalLink: {
    fontFamily: 'Barlow',
    fontSize: 13,
    color: AQUA,
    textDecorationLine: 'underline',
  },
  legalDot: {
    color: TEXT,
    opacity: 0.4,
  },
  legalNote: {
    fontFamily: 'Barlow',
    fontSize: 11,
    color: TEXT,
    opacity: 0.45,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 4,
  },
  diagBox: {
    backgroundColor: 'rgba(255,184,0,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,184,0,0.25)',
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
    marginHorizontal: 4,
  },
  diagToggle: {
    fontFamily: 'SpaceMono',
    fontSize: 11,
    color: AMBER,
    letterSpacing: 0.3,
  },
  diagLine: {
    fontFamily: 'SpaceMono',
    fontSize: 10,
    color: TEXT,
    marginTop: 4,
    lineHeight: 14,
  },
  diagLineSmall: {
    fontFamily: 'SpaceMono',
    fontSize: 9,
    color: SUB,
    marginTop: 2,
    lineHeight: 13,
  },
  legal: {
    fontFamily: 'Barlow',
    fontSize: 10,
    color: SUB,
    textAlign: 'center',
    lineHeight: 15,
    marginTop: 8,
    paddingHorizontal: 10,
  },
});