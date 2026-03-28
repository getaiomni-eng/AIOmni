import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState } from 'react';
import { C, F, SZ, R, SP } from './constants/tokens';

const TIERS = [
  {
    id: 'rankings', name: 'RANKINGS', price: '$5.99', leaguePrice: '$4.99',
    color: '#7ec8e8', badge: null,
    features: ['Community Rankings — 500+ active players', 'Position-by-position breakdown', 'Trending up/down alerts'],
  },
  {
    id: 'pro', name: 'PRO', price: '$9.99', leaguePrice: '$7.99',
    color: C.gold, badge: 'MOST POPULAR',
    features: ['Unlimited AI Coach prompts', 'Full league settings analysis', 'Trade Analyzer — A to F grades', 'League Chat with live AI reactions', 'Commissioner AI Shield — 4 modes'],
  },
  {
    id: 'premium', name: 'PREMIUM', price: '$14.99', leaguePrice: '$12.99',
    color: '#b8a8e8', badge: null,
    features: ['Everything in Pro', '2 full seasons of AI memory', 'Adaptive Trash Talk engine', 'Opponent deep-dive weekly', 'Autopilot lineup setting'],
  },
  {
    id: 'dynasty', name: 'DYNASTY ELITE', price: '$19.99', leaguePrice: '$16.99',
    color: C.sage, badge: 'DYNASTY',
    features: ['Everything in Premium', 'Live college football rankings', 'Future pick grade engine', 'Personalized rookie draft board', 'Dynasty-specific AI memory'],
  },
];

export default function PaywallScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const [selected, setSelected] = useState('pro');
  const selectedTier = TIERS.find(t => t.id === selected) || TIERS[1];

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

        {/* Tier tabs */}
        <View style={styles.tierRow}>
          {TIERS.map(tier => (
            <TouchableOpacity
              key={tier.id}
              style={[styles.tierTab, selected === tier.id && { borderColor: tier.color, backgroundColor: `${tier.color}18` }]}
              onPress={() => setSelected(tier.id)}
            >
              {tier.badge && <Text style={[styles.tierBadge, { color: tier.color }]}>{tier.badge}</Text>}
              <Text style={[styles.tierName, selected === tier.id && { color: tier.color }]}>{tier.name}</Text>
              <Text style={[styles.tierPrice, selected === tier.id && { color: tier.color }]}>{tier.price}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Detail card */}
        <View style={[styles.detailCard, { borderColor: selectedTier.color + '50' }]}>
          <View style={[styles.detailAccent, { backgroundColor: selectedTier.color }]} />
          <View style={styles.detailHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.detailName, { color: selectedTier.color }]}>{selectedTier.name}</Text>
              <Text style={styles.detailLeagueRate}>{selectedTier.leaguePrice}/mo per person when full league joins</Text>
            </View>
            <View style={styles.detailPriceBox}>
              <Text style={[styles.detailPrice, { color: selectedTier.color }]}>{selectedTier.price}</Text>
              <Text style={styles.detailPer}>/mo</Text>
            </View>
          </View>
          <View style={styles.divider} />
          {selectedTier.features.map((f, i) => (
            <View key={i} style={styles.featureRow}>
              <Text style={[styles.featureCheck, { color: selectedTier.color }]}>✓</Text>
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}
        </View>

        {/* CTA */}
        <TouchableOpacity
          style={[styles.subscribeBtn, { backgroundColor: selectedTier.color }]}
          onPress={() => router.back()}
        >
          <Text style={[styles.subscribeBtnText, { color: selectedTier.id === 'pro' ? '#1a1a1a' : '#fff' }]}>
            UPGRADE TO {selectedTier.name} — {selectedTier.price}/MO →
          </Text>
        </TouchableOpacity>

        {/* League note */}
        <View style={[styles.leagueNote, { borderLeftColor: selectedTier.color }]}>
          <Text style={styles.leagueNoteText}>
            💡 Get your whole league on AIOmni and everyone pays {selectedTier.leaguePrice}/mo instead of {selectedTier.price}/mo.
          </Text>
        </View>

        {/* Add-on */}
        <View style={styles.addonCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.addonName}>Community Rankings Add-On</Text>
            <Text style={styles.addonDesc}>Add community rankings to any paid tier.</Text>
          </View>
          <Text style={[styles.addonPrice, { color: C.gold }]}>$0.99/mo</Text>
        </View>

        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.dismiss}>Maybe later</Text>
        </TouchableOpacity>

        <Text style={styles.finePrint}>Subscriptions auto-renew monthly. Cancel anytime in App Store settings.</Text>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: SP[3] },

  header: { alignItems: 'center', paddingBottom: 28, borderBottomWidth: 1, borderBottomColor: C.glassBorder, marginBottom: 24 },
  logoText: { fontFamily: F.black, fontSize: 42, color: C.gold, letterSpacing: 3, marginBottom: 10 },
  headline: { fontFamily: F.bold, fontSize: 28, color: C.ink, letterSpacing: 3, marginBottom: 8 },
  subheadline: { fontFamily: F.outfit, color: C.dim2, fontSize: SZ.md, textAlign: 'center', lineHeight: 22 },

  tierRow: { flexDirection: 'row', gap: 6, marginBottom: 20 },
  tierTab: { flex: 1, backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: R.sm, padding: 8, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  tierBadge: { fontFamily: F.mono, fontSize: 6, letterSpacing: 0.5, marginBottom: 2 },
  tierName: { fontFamily: F.bold, color: C.dim2, fontSize: SZ.xs, letterSpacing: 1, marginBottom: 2 },
  tierPrice: { fontFamily: F.mono, color: C.dim2, fontSize: SZ.xs - 1 },

  detailCard: { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: R.md, padding: 20, marginBottom: 16, borderWidth: 1.5, overflow: 'hidden' },
  detailAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 2 },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, marginTop: 4 },
  detailName: { fontFamily: F.bold, fontSize: SZ['2xl'], letterSpacing: 2, marginBottom: 4 },
  detailLeagueRate: { fontFamily: F.outfit, color: C.dim2, fontSize: SZ.sm, maxWidth: 200, lineHeight: 18 },
  detailPriceBox: { flexDirection: 'row', alignItems: 'flex-end' },
  detailPrice: { fontFamily: F.black, fontSize: SZ['5xl'], letterSpacing: -1, lineHeight: 44 },
  detailPer: { fontFamily: F.outfit, color: C.dim2, fontSize: SZ.md, marginBottom: 6, marginLeft: 2 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.12)', marginBottom: 16 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  featureCheck: { fontFamily: F.bold, fontSize: SZ.sm, marginRight: 10, marginTop: 2 },
  featureText: { fontFamily: F.outfit, color: C.dim, fontSize: SZ.md, flex: 1, lineHeight: 22 },

  subscribeBtn: { borderRadius: R.sm, padding: 18, alignItems: 'center', marginBottom: 12 },
  subscribeBtnText: { fontFamily: F.bold, fontSize: SZ.base, letterSpacing: 2 },

  leagueNote: { backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: R.sm, padding: 14, marginBottom: 14, borderLeftWidth: 3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  leagueNoteText: { fontFamily: F.outfit, color: C.dim, fontSize: SZ.sm, lineHeight: 20 },

  addonCard: { backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: R.sm, padding: 16, marginBottom: 20, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  addonName: { fontFamily: F.semibold, color: C.ink, fontSize: SZ.md, marginBottom: 4 },
  addonDesc: { fontFamily: F.outfit, color: C.dim2, fontSize: SZ.sm },
  addonPrice: { fontFamily: F.bold, fontSize: SZ.xl, letterSpacing: 1 },

  dismiss: { fontFamily: F.outfit, color: C.dim2, textAlign: 'center', fontSize: SZ.md, paddingVertical: 8, marginBottom: 14 },
  finePrint: { fontFamily: F.mono, color: C.dim2, fontSize: SZ.xs - 1, textAlign: 'center', lineHeight: 16, opacity: 0.6 },
});