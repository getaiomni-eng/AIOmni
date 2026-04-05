import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { PurchasesPackage } from 'react-native-purchases';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getCurrentTier, getPackages, purchasePackage, restorePurchases } from '../services/purchases';
import { C, F, R, SP, SZ } from './constants/tokens';

const SURFACE  = 'rgba(255,255,255,0.90)';
const BORDER   = 'rgba(88,131,191,0.32)';
const BEVEL_HI = 'rgba(255,255,255,0.95)';

type BillingCycle = 'monthly' | 'yearly';

// Static tier metadata — prices shown are fallbacks if RC packages not loaded
const TIERS = [
  {
    id: 'rankings', name: 'RANKINGS',
    monthly: '$5.99',  yearly: '$49.99',
    leagueMonthly: '$4.99', leagueYearly: '$39.99',
    color: '#2a7aaa', badge: null,
    // RevenueCat package identifier suffixes
    monthlyId: 'rankings_monthly', yearlyId: 'rankings_yearly',
    features: [
      'Community consensus rankings — 500+ players',
      'Position-by-position breakdown',
      'PPR / Half / Standard filters',
      'Trending up/down alerts',
    ],
  },
  {
    id: 'pro', name: 'PRO',
    monthly: '$9.99',  yearly: '$89.99',
    leagueMonthly: '$7.99', leagueYearly: '$69.99',
    color: C.gold, badge: 'MOST POPULAR',
    monthlyId: 'pro_monthly', yearlyId: 'pro_yearly',
    features: [
      '75 AI Coach prompts per week',
      'Full league settings analysis',
      'Draft Copilot — real-time pick advice',
      'Trade Analyzer — A to F grades',
      'Waiver Wire intelligence',
      '1 season AI memory',
    ],
  },
  {
    id: 'premium', name: 'PREMIUM',
    monthly: '$14.99', yearly: '$129.99',
    leagueMonthly: '$12.99', leagueYearly: '$109.99',
    color: '#7b5ea7', badge: null,
    monthlyId: 'premium_monthly', yearlyId: 'premium_yearly',
    features: [
      'Everything in Pro',
      '125 AI Coach prompts per week',
      '2 full seasons of AI memory',
      'Adaptive Trash Talk engine',
      'Opponent deep-dive weekly',
      'Autopilot lineup setting',
    ],
  },
  {
    id: 'dynasty', name: 'DYNASTY ELITE',
    monthly: '$19.99', yearly: '$179.99',
    leagueMonthly: '$16.99', leagueYearly: '$149.99',
    color: '#1e8c42', badge: 'DYNASTY',
    monthlyId: 'dynasty_monthly', yearlyId: 'dynasty_yearly',
    features: [
      'Everything in Premium',
      'Live college football rankings',
      'Future pick grade engine',
      'Personalized rookie draft board',
      'Dynasty-specific AI memory',
      '75 prompts per week',
    ],
  },
];

function yearlySavings(monthly: string, yearly: string): string {
  const saved = Math.round(parseFloat(monthly.replace('$','')) * 12 - parseFloat(yearly.replace('$','')));
  return `Save $${saved}`;
}

export default function PaywallScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();

  const [selected,    setSelected]    = useState('pro');
  const [billing,     setBilling]     = useState<BillingCycle>('monthly');
  const [packages,    setPackages]    = useState<PurchasesPackage[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [purchasing,  setPurchasing]  = useState(false);
  const [restoring,   setRestoring]   = useState(false);
  const [currentTier, setCurrentTier] = useState('free');

  const selectedTier  = TIERS.find(t => t.id === selected) || TIERS[1];
  const displayPrice  = billing === 'yearly' ? selectedTier.yearly  : selectedTier.monthly;
  const leaguePrice   = billing === 'yearly' ? selectedTier.leagueYearly : selectedTier.leagueMonthly;
  const perMonth      = billing === 'yearly'
    ? `$${(parseFloat(selectedTier.yearly.replace('$','')) / 12).toFixed(2)}/mo`
    : null;

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [pkgs, tier] = await Promise.all([getPackages(), getCurrentTier()]);
        setPackages(pkgs);
        setCurrentTier(tier);
      } catch {}
      setLoading(false);
    })();
  }, []);

  // Exact product IDs from RevenueCat / App Store Connect
  const PRODUCT_ID_MAP: Record<string, Record<string, string>> = {
    rankings: { monthly: 'com.getaiomni.rankings.monthly', yearly: 'com.getaiomni.rankings.yearly' },
    pro:      { monthly: 'com.getaiomni.pro.monthly',      yearly: 'com.getaiomni.pro.yearly'      },
    premium:  { monthly: 'com.getaiomni.premium.monthly',  yearly: 'com.getaiomni.premium.yearly'  },
    dynasty:  { monthly: 'com.getaiomni.dynasty.monthly',  yearly: 'com.getaiomni.dynasty.yearly'  },
  };

  const findPackage = (): PurchasesPackage | null => {
    const targetId = PRODUCT_ID_MAP[selectedTier.id]?.[billing];
    if (!targetId) return null;
    return packages.find(p => p.product.identifier === targetId) ?? null;
  };

  // Get live price from RevenueCat package if available
  const getLivePrice = (): string => {
    const pkg = findPackage();
    return pkg?.product.priceString ?? displayPrice;
  };

  const handlePurchase = async () => {
    if (purchasing) return;
    const pkg = findPackage();

    if (!pkg) {
      // RC packages not loaded — open App Store directly as fallback
      Alert.alert(
        'Purchase Unavailable',
        'Could not connect to the App Store. Check your connection and try again.',
        [{ text: 'OK' }]
      );
      return;
    }

    setPurchasing(true);
    try {
      const result = await purchasePackage(pkg);
      if (result.success) {
        Alert.alert(
          '🎉 Welcome to ' + selectedTier.name + '!',
          'Your subscription is active.',
          [{ text: 'Let\'s Go', onPress: () => router.back() }]
        );
      } else if (result.error !== 'cancelled') {
        Alert.alert('Purchase Failed', result.error ?? 'Something went wrong. Try again.');
      }
      // If cancelled — do nothing, stay on paywall
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Purchase failed. Try again.');
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      const result = await restorePurchases();
      if (result.success && result.tier && result.tier !== 'free') {
        Alert.alert('✓ Restored', `${result.tier.replace('_',' ')} subscription restored.`, [{ text: 'Great', onPress: () => router.back() }]);
      } else {
        Alert.alert('Nothing to Restore', 'No active subscriptions found for this Apple ID.');
      }
    } catch {
      Alert.alert('Error', 'Could not restore purchases. Try again.');
    } finally {
      setRestoring(false);
    }
  };

  const isActive = currentTier === selected;
  const livePrice = getLivePrice();

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.logoText}>AIOmni</Text>
          <Text style={styles.headline}>PICK YOUR EDGE</Text>
          <Text style={styles.subheadline}>Every tier unlocks a smarter version of your season.</Text>
        </View>

        {/* Loading state */}
        {loading ? (
          <View style={{ alignItems: 'center', padding: 20 }}>
            <ActivityIndicator color={C.blueDeep} />
            <Text style={{ fontFamily: F.mono, color: C.dim2, fontSize: SZ.xs, marginTop: 8, letterSpacing: 1 }}>LOADING PRICES...</Text>
          </View>
        ) : null}

        {/* Billing toggle */}
        <View style={styles.billingToggle}>
          <TouchableOpacity
            style={[styles.billingBtn, billing === 'monthly' && styles.billingBtnOn]}
            onPress={() => setBilling('monthly')}
          >
            <Text style={[styles.billingTxt, billing === 'monthly' && styles.billingTxtOn]}>MONTHLY</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.billingBtn, billing === 'yearly' && styles.billingBtnOn]}
            onPress={() => setBilling('yearly')}
          >
            <Text style={[styles.billingTxt, billing === 'yearly' && styles.billingTxtOn]}>YEARLY</Text>
            <View style={styles.savingsBadge}>
              <Text style={styles.savingsTxt}>{yearlySavings(selectedTier.monthly, selectedTier.yearly)}</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Tier tabs */}
        <View style={styles.tierRow}>
          {TIERS.map(tier => {
            const pkg = packages.find(p =>
              p.product.identifier.includes(tier.id) &&
              p.product.identifier.includes(billing === 'yearly' ? 'yearly' : 'monthly')
            );
            const price = pkg?.product.priceString ?? (billing === 'yearly' ? tier.yearly : tier.monthly);
            return (
              <TouchableOpacity
                key={tier.id}
                style={[styles.tierTab, selected === tier.id && { borderColor: tier.color, backgroundColor: tier.color + '18' }]}
                onPress={() => setSelected(tier.id)}
              >
                {tier.badge && <Text style={[styles.tierBadge, { color: tier.color }]}>{tier.badge}</Text>}
                <Text style={[styles.tierName,  selected === tier.id && { color: tier.color }]}>{tier.name}</Text>
                <Text style={[styles.tierPrice, selected === tier.id && { color: tier.color }]}>{price}</Text>
                {billing === 'yearly' && (
                  <Text style={[styles.tierPerMonth, selected === tier.id && { color: tier.color + 'aa' }]}>
                    ${(parseFloat(tier.yearly.replace('$','')) / 12).toFixed(2)}/mo
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Detail card */}
        <View style={[styles.detailCard, { borderColor: selectedTier.color + '55' }]}>
          <View style={styles.detailCardShine} />
          <View style={[styles.detailAccent, { backgroundColor: selectedTier.color }]} />
          <View style={styles.detailHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.detailName, { color: selectedTier.color }]}>{selectedTier.name}</Text>
              <Text style={styles.detailLeagueRate}>
                {leaguePrice}/{billing === 'yearly' ? 'yr' : 'mo'} per person when full league joins
              </Text>
            </View>
            <View style={styles.detailPriceBox}>
              <Text style={[styles.detailPrice, { color: selectedTier.color }]}>{livePrice}</Text>
              <Text style={styles.detailPer}>/{billing === 'yearly' ? 'yr' : 'mo'}</Text>
            </View>
          </View>

          {perMonth && (
            <View style={[styles.perMonthPill, { backgroundColor: selectedTier.color + '18', borderColor: selectedTier.color + '44' }]}>
              <Text style={[styles.perMonthTxt, { color: selectedTier.color }]}>
                {perMonth} · {yearlySavings(selectedTier.monthly, selectedTier.yearly)} vs monthly
              </Text>
            </View>
          )}

          <View style={styles.divider} />
          {selectedTier.features.map((f, i) => (
            <View key={i} style={styles.featureRow}>
              <Text style={[styles.featureCheck, { color: selectedTier.color }]}>✓</Text>
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}
        </View>

        {/* CTA — disabled if already on this tier */}
        <TouchableOpacity
          style={[
            styles.subscribeBtn,
            { backgroundColor: isActive ? 'rgba(88,131,191,0.2)' : selectedTier.color },
            (purchasing || loading) && { opacity: 0.7 },
          ]}
          onPress={isActive ? undefined : handlePurchase}
          disabled={isActive || purchasing || loading}
        >
          {purchasing ? (
            <ActivityIndicator color={C.ink} />
          ) : (
            <Text style={[styles.subscribeBtnText, { color: isActive ? C.dim2 : (selectedTier.id === 'pro' ? '#1a1208' : '#ffffff') }]}>
              {isActive
                ? '✓ CURRENT PLAN'
                : `UPGRADE TO ${selectedTier.name} — ${livePrice}/${billing === 'yearly' ? 'YR' : 'MO'} →`}
            </Text>
          )}
        </TouchableOpacity>

        {/* League note */}
        <View style={[styles.leagueNote, { borderLeftColor: selectedTier.color, borderColor: selectedTier.color + '30' }]}>
          <Text style={styles.leagueNoteText}>
            💡 Get your whole league on AIOmni and everyone pays {leaguePrice}/{billing === 'yearly' ? 'yr' : 'mo'} instead of {livePrice}/{billing === 'yearly' ? 'yr' : 'mo'}.
          </Text>
        </View>

        {/* Add-on */}
        <View style={styles.addonCard}>
          <View style={styles.addonCardShine} />
          <View style={{ flex: 1 }}>
            <Text style={styles.addonName}>Community Rankings Add-On</Text>
            <Text style={styles.addonDesc}>Add rankings to any paid tier.</Text>
          </View>
          <Text style={[styles.addonPrice, { color: C.gold }]}>$0.99/mo</Text>
        </View>

        {/* Restore + dismiss */}
        <TouchableOpacity onPress={handleRestore} disabled={restoring} style={{ marginBottom: 8 }}>
          <Text style={styles.restore}>
            {restoring ? 'Restoring...' : 'Restore Purchases'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.dismiss}>Maybe later</Text>
        </TouchableOpacity>

        <Text style={styles.finePrint}>
          {billing === 'yearly' ? 'Billed annually.' : 'Billed monthly.'} Subscriptions auto-renew. Cancel anytime in App Store settings. Payment charged to Apple ID at confirmation.
        </Text>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: SP[3] },

  header:      { alignItems:'center', paddingBottom:24, borderBottomWidth:1, borderBottomColor:BORDER, marginBottom:20 },
  logoText:    { fontFamily:F.bold, fontSize:42, color:C.blueDeep, letterSpacing:3, marginBottom:10 },
  headline:    { fontFamily:F.bold, fontSize:28, color:C.ink, letterSpacing:3, marginBottom:8 },
  subheadline: { fontFamily:F.mono, color:C.dim2, fontSize:SZ.md, textAlign:'center', lineHeight:22 },

  billingToggle: { flexDirection:'row', backgroundColor:SURFACE, borderRadius:14, padding:3, marginBottom:16, borderWidth:1.5, borderColor:BORDER },
  billingBtn:    { flex:1, paddingVertical:9, borderRadius:11, alignItems:'center', position:'relative' },
  billingBtnOn:  { backgroundColor:C.blueDeep },
  billingTxt:    { fontFamily:F.bold, fontSize:SZ.xs, color:C.dim2, letterSpacing:1.5 },
  billingTxtOn:  { color:'#ffffff' },
  savingsBadge:  { position:'absolute', top:-8, right:8, backgroundColor:C.gold, borderRadius:100, paddingHorizontal:6, paddingVertical:2 },
  savingsTxt:    { fontFamily:F.bold, fontSize:8, color:C.ink, letterSpacing:0.5 },

  tierRow:     { flexDirection:'row', gap:6, marginBottom:18 },
  tierTab:     { flex:1, backgroundColor:SURFACE, borderRadius:R.sm, padding:8, alignItems:'center', borderWidth:1.5, borderColor:BORDER },
  tierBadge:   { fontFamily:F.mono, fontSize:6, letterSpacing:0.5, marginBottom:2 },
  tierName:    { fontFamily:F.bold, color:C.dim2, fontSize:SZ.xs, letterSpacing:0.8, marginBottom:2 },
  tierPrice:   { fontFamily:F.bold, color:C.dim2, fontSize:SZ.xs-1 },
  tierPerMonth:{ fontFamily:F.mono, color:C.dim2, fontSize:7, marginTop:1, opacity:0.7 },

  detailCard: {
    backgroundColor:SURFACE, borderRadius:R.md, padding:20, marginBottom:16,
    borderWidth:1.5, overflow:'hidden', position:'relative',
    shadowColor:'#3d6aaa', shadowOffset:{width:0,height:6}, shadowOpacity:0.12, shadowRadius:18, elevation:6,
  },
  detailCardShine: { position:'absolute', top:0, left:'8%', right:'8%', height:1.5, backgroundColor:BEVEL_HI, zIndex:6 },
  detailAccent:    { position:'absolute', top:0, left:0, right:0, height:3 },
  detailHeader:    { flexDirection:'row', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12, marginTop:8 },
  detailName:      { fontFamily:F.bold, fontSize:SZ['2xl'], letterSpacing:2, marginBottom:4 },
  detailLeagueRate:{ fontFamily:F.mono, color:C.dim2, fontSize:SZ.sm, maxWidth:200, lineHeight:18 },
  detailPriceBox:  { flexDirection:'row', alignItems:'flex-end' },
  detailPrice:     { fontFamily:F.bold, fontSize:SZ['5xl'], letterSpacing:-1, lineHeight:44 },
  detailPer:       { fontFamily:F.mono, color:C.dim2, fontSize:SZ.md, marginBottom:6, marginLeft:2 },
  perMonthPill:    { borderRadius:100, borderWidth:1, paddingHorizontal:12, paddingVertical:5, alignSelf:'flex-start', marginBottom:14 },
  perMonthTxt:     { fontFamily:F.bold, fontSize:SZ.xs, letterSpacing:0.5 },
  divider:         { height:1, backgroundColor:BORDER, marginBottom:14 },
  featureRow:      { flexDirection:'row', alignItems:'flex-start', marginBottom:9 },
  featureCheck:    { fontFamily:F.bold, fontSize:SZ.sm, marginRight:10, marginTop:2 },
  featureText:     { fontFamily:F.mono, color:C.dim2, fontSize:SZ.md, flex:1, lineHeight:22 },

  subscribeBtn:     { borderRadius:R.sm, padding:18, alignItems:'center', marginBottom:12 },
  subscribeBtnText: { fontFamily:F.bold, fontSize:SZ.base, letterSpacing:2 },

  leagueNote:     { backgroundColor:SURFACE, borderRadius:R.sm, padding:14, marginBottom:14, borderLeftWidth:3, borderWidth:1 },
  leagueNoteText: { fontFamily:F.mono, color:C.dim2, fontSize:SZ.sm, lineHeight:20 },

  addonCard: {
    backgroundColor:SURFACE, borderRadius:R.sm, padding:16, marginBottom:20,
    flexDirection:'row', alignItems:'center', borderWidth:1.5, borderColor:BORDER,
    position:'relative', overflow:'hidden',
  },
  addonCardShine: { position:'absolute', top:0, left:'8%', right:'8%', height:1.5, backgroundColor:BEVEL_HI, zIndex:6 },
  addonName:  { fontFamily:F.bold, color:C.ink, fontSize:SZ.md, marginBottom:4 },
  addonDesc:  { fontFamily:F.mono, color:C.dim2, fontSize:SZ.sm },
  addonPrice: { fontFamily:F.bold, fontSize:SZ.xl, letterSpacing:1 },

  restore:   { fontFamily:F.mono, color:C.blueDeep, textAlign:'center', fontSize:SZ.sm, paddingVertical:8 },
  dismiss:   { fontFamily:F.mono, color:C.dim2, textAlign:'center', fontSize:SZ.md, paddingVertical:8, marginBottom:14 },
  finePrint: { fontFamily:F.mono, color:C.dim2, fontSize:SZ.xs-1, textAlign:'center', lineHeight:16, opacity:0.6 },
});