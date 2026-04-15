// app/paywall.tsx
// AIOmni Paywall — Free / Rankings ($2.99) / Pro ($9.99)

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { PurchasesPackage } from 'react-native-purchases';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getCurrentTier,
  getPackages,
  purchasePackage,
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

export default function PaywallScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [currentTier, setCurrentTier] = useState('free');
  const [billing, setBilling] = useState<BillingCycle>('monthly');

  useEffect(() => {
    (async () => {
      const [pkgs, tier] = await Promise.all([getPackages(), getCurrentTier()]);
      setPackages(pkgs);
      setCurrentTier(tier);
      setLoading(false);
    })();
  }, []);

  const findPackage = (keyword: string, cycle: BillingCycle): PurchasesPackage | undefined => {
    return packages.find((p) => {
      const id = p.product.identifier.toLowerCase();
      return id.includes(keyword) && id.includes(cycle === 'yearly' ? 'yearly' : 'monthly');
    });
  };

  const handlePurchase = async (tier: string) => {
    const pkg = findPackage(tier === 'rankings' ? 'rankings' : 'pro', billing);
    if (!pkg) {
      Alert.alert('Not Available', 'This subscription is not available right now. Please try again later.');
      return;
    }
    setPurchasing(true);
    const result = await purchasePackage(pkg);
    setPurchasing(false);
    if (result.success) {
      setCurrentTier(result.tier ?? tier);
      Alert.alert('Welcome!', `You're now on the ${TIER_INFO[tier]?.label ?? tier} plan.`, [
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
        <Text style={styles.title}>Choose Your Plan</Text>
        <View style={{ width: 28 }} />
      </View>

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

                {isCurrent ? (
                  <View style={[styles.actionBtn, { backgroundColor: '#1a3542' }]}>
                    <Text style={[styles.actionText, { color: SUB }]}>Current Plan</Text>
                  </View>
                ) : tierKey === 'free' ? null : isUpgrade ? (
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
                ) : null}
              </View>
            );
          })}

          {/* Restore */}
          <TouchableOpacity style={styles.restoreBtn} onPress={handleRestore}>
            <Text style={styles.restoreText}>Restore Purchases</Text>
          </TouchableOpacity>

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