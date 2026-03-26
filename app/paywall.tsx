import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useState } from 'react';

const TIERS = [
  { id: 'rankings', name: 'RANKINGS', price: '$5.99', leaguePrice: '$4.99', color: '#4A90D9', badge: null, features: ['Community Rankings — 500+ active players', 'Position-by-position breakdown', 'Trending up/down alerts'] },
  { id: 'pro', name: 'PRO', price: '$9.99', leaguePrice: '$7.99', color: '#D4FF00', badge: 'MOST POPULAR', features: ['Unlimited AI Coach prompts', 'Full league settings analysis', 'Trade Analyzer — A to F grades', 'League Chat with live AI reactions', 'Commissioner AI Shield — 4 modes'] },
  { id: 'premium', name: 'PREMIUM', price: '$14.99', leaguePrice: '$12.99', color: '#cc77ff', badge: null, features: ['Everything in Pro', '2 full seasons of AI memory', 'Adaptive Trash Talk engine', 'Opponent deep-dive weekly', 'Autopilot lineup setting'] },
  { id: 'dynasty', name: 'DYNASTY ELITE', price: '$19.99', leaguePrice: '$16.99', color: '#ffaa00', badge: 'DYNASTY', features: ['Everything in Premium', 'Live college football rankings', 'Future pick grade engine', 'Personalized rookie draft board', 'Dynasty-specific AI memory'] },
];

export default function PaywallScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState('pro');
  const selectedTier = TIERS.find(t => t.id === selected) || TIERS[1];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.logoText}>AIOmni</Text>
        <Text style={styles.headline}>PICK YOUR EDGE</Text>
        <Text style={styles.subheadline}>Every tier unlocks a smarter version of your season.</Text>
      </View>

      {/* Tier tabs */}
      <View style={styles.tierRow}>
        {TIERS.map(tier => (
          <TouchableOpacity key={tier.id} style={[styles.tierTab, selected === tier.id && { borderColor: tier.color, backgroundColor: `${tier.color}0d` }]} onPress={() => setSelected(tier.id)}>
            {tier.badge && <Text style={[styles.tierBadge, { color: tier.color }]}>{tier.badge}</Text>}
            <Text style={[styles.tierName, selected === tier.id && { color: tier.color }]}>{tier.name}</Text>
            <Text style={[styles.tierPrice, selected === tier.id && { color: tier.color }]}>{tier.price}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Selected detail card */}
      <View style={[styles.detailCard, { borderColor: selectedTier.color }]}>
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
      <TouchableOpacity style={[styles.subscribeBtn, { backgroundColor: selectedTier.color }]} onPress={() => router.back()}>
        <Text style={styles.subscribeBtnText}>UPGRADE TO {selectedTier.name} — {selectedTier.price}/MO →</Text>
      </TouchableOpacity>

      {/* League note */}
      <View style={[styles.leagueNote, { borderLeftColor: selectedTier.color }]}>
        <Text style={styles.leagueNoteText}>💡 Get your whole league on AIOmni and everyone pays {selectedTier.leaguePrice}/mo instead of {selectedTier.price}/mo.</Text>
      </View>

      {/* Add-on */}
      <View style={styles.addonCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.addonName}>Community Rankings Add-On</Text>
          <Text style={styles.addonDesc}>Add community rankings to any paid tier.</Text>
        </View>
        <Text style={styles.addonPrice}>$0.99/mo</Text>
      </View>

      <TouchableOpacity onPress={() => router.back()}>
        <Text style={styles.dismiss}>Maybe later</Text>
      </TouchableOpacity>

      <Text style={styles.finePrint}>Subscriptions auto-renew monthly. Cancel anytime in App Store settings.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#03030a' },
  content: { paddingHorizontal: 20, paddingBottom: 60 },

  header: { alignItems: 'center', paddingTop: 60, paddingBottom: 28, borderBottomWidth: 1, borderBottomColor: 'rgba(212,255,0,0.08)', marginBottom: 24 },
  logoText: { fontFamily: 'BebasNeue_400Regular', fontSize: 48, color: '#D4FF00', letterSpacing: 4, textShadowColor: 'rgba(212,255,0,0.3)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 16, marginBottom: 12 },
  headline: { fontFamily: 'BebasNeue_400Regular', fontSize: 32, color: '#fff', letterSpacing: 4, marginBottom: 8 },
  subheadline: { fontFamily: 'Barlow_400Regular', color: '#555', fontSize: 14, textAlign: 'center', lineHeight: 20 },

  tierRow: { flexDirection: 'row', gap: 6, marginBottom: 20 },
  tierTab: { flex: 1, backgroundColor: 'rgba(8,8,22,0.9)', borderRadius: 2, padding: 8, alignItems: 'center', borderWidth: 1, borderColor: '#1a1a2e' },
  tierBadge: { fontFamily: 'SpaceMono_400Regular', fontSize: 6, letterSpacing: 0.5, marginBottom: 2 },
  tierName: { fontFamily: 'BebasNeue_400Regular', color: '#555', fontSize: 12, letterSpacing: 1, marginBottom: 2 },
  tierPrice: { fontFamily: 'SpaceMono_400Regular', color: '#333', fontSize: 10 },

  detailCard: { backgroundColor: 'rgba(8,8,22,0.9)', borderRadius: 2, padding: 20, marginBottom: 16, borderWidth: 1.5, overflow: 'hidden' },
  detailAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 2 },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, marginTop: 4 },
  detailName: { fontFamily: 'BebasNeue_400Regular', fontSize: 26, letterSpacing: 3, marginBottom: 4 },
  detailLeagueRate: { fontFamily: 'Barlow_400Regular', color: '#444', fontSize: 12, maxWidth: 200, lineHeight: 16 },
  detailPriceBox: { flexDirection: 'row', alignItems: 'flex-end' },
  detailPrice: { fontFamily: 'BebasNeue_400Regular', fontSize: 44, letterSpacing: 2, lineHeight: 44 },
  detailPer: { fontFamily: 'Barlow_400Regular', color: '#444', fontSize: 14, marginBottom: 6, marginLeft: 2 },
  divider: { height: 1, backgroundColor: '#1a1a2e', marginBottom: 16 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  featureCheck: { fontFamily: 'SpaceMono_400Regular', fontWeight: '700', fontSize: 12, marginRight: 10, marginTop: 2 },
  featureText: { fontFamily: 'Barlow_400Regular', color: '#888', fontSize: 14, flex: 1, lineHeight: 20 },

  subscribeBtn: { borderRadius: 2, padding: 18, alignItems: 'center', marginBottom: 12 },
  subscribeBtnText: { fontFamily: 'BebasNeue_400Regular', color: '#000', fontSize: 16, letterSpacing: 2 },

  leagueNote: { backgroundColor: 'rgba(8,8,22,0.9)', borderRadius: 2, padding: 14, marginBottom: 14, borderLeftWidth: 3, borderWidth: 1, borderColor: '#1a1a2e' },
  leagueNoteText: { fontFamily: 'Barlow_400Regular', color: '#666', fontSize: 13, lineHeight: 19 },

  addonCard: { backgroundColor: 'rgba(8,8,22,0.9)', borderRadius: 2, padding: 16, marginBottom: 20, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#1a1a2e' },
  addonName: { fontFamily: 'Barlow_600SemiBold', color: '#fff', fontSize: 14, marginBottom: 4 },
  addonDesc: { fontFamily: 'Barlow_400Regular', color: '#555', fontSize: 12 },
  addonPrice: { fontFamily: 'BebasNeue_400Regular', color: '#D4FF00', fontSize: 20, letterSpacing: 1 },

  dismiss: { fontFamily: 'Barlow_400Regular', color: '#444', textAlign: 'center', fontSize: 14, paddingVertical: 8, marginBottom: 14 },
  finePrint: { fontFamily: 'Barlow_400Regular', color: '#222', fontSize: 11, textAlign: 'center', lineHeight: 16 },
});
