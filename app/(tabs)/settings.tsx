import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Image, Alert, TextInput, Modal } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import { C, F, SZ, SP, R } from '../constants/tokens';
import { GlassCard, SurfaceCard } from '../components/GlassCard';
import { OrbAvatar } from '../components/OrbAvatar';
import { Badge } from '../components/Atoms';
import { saveESPNCredentials, loadESPNCredentials, clearESPNCredentials, getESPNLeague, findMyESPNTeam } from '../../services/espn';
import { getYahooAuthURL, exchangeYahooCode, getValidYahooToken, clearYahooTokens } from '../../services/yahoo';

const LOGO = require('../../assets/images/logo.png');

const TIERS = [
  { name: 'Free',          price: '$0',     sub: '25 prompts/week',           color: C.dim,   active: true  },
  { name: 'Rankings',      price: '$5.99',  sub: 'Live community rankings',   color: C.mint,  active: false },
  { name: 'Pro',           price: '$9.99',  sub: 'Unlimited + Draft Copilot', color: C.gold,  active: false },
  { name: 'Premium',       price: '$14.99', sub: '2-season AI memory',        color: '#9b6dbd', active: false },
  { name: 'Dynasty Elite', price: '$19.99', sub: 'College rankings + picks',  color: C.sage,  active: false },
];

export default function MoreScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [username, setUsername]           = useState('');
  const [newUsername, setNewUsername]     = useState('');
  const [espnConnected, setEspnConnected] = useState(false);
  const [yahooConnected, setYahooConnected] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showPlatformModal, setShowPlatformModal] = useState(false);
  const [espnS2, setEspnS2]               = useState('');
  const [espnSWID, setEspnSWID]           = useState('');
  const [espnLeagueId, setEspnLeagueId]   = useState('');
  const [loading, setLoading]             = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('sleeper_username').then(u => { if (u) setUsername(u); });
    loadESPNCredentials().then(c => setEspnConnected(!!c));
    getValidYahooToken().then(t => setYahooConnected(!!t));
  }, []);

  const handleSaveUsername = async () => {
    if (!newUsername.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`https://api.sleeper.app/v1/user/${newUsername.trim()}`);
      const user = await res.json();
      if (!user?.user_id) { Alert.alert('Not Found', 'Could not find that Sleeper account.'); return; }
      await AsyncStorage.setItem('sleeper_username', newUsername.trim());
      setUsername(newUsername.trim());
      setShowAccountModal(false);
      setNewUsername('');
      Alert.alert('✓ Updated', 'Sleeper account connected.');
    } catch { Alert.alert('Error', 'Could not connect to Sleeper.'); }
    finally { setLoading(false); }
  };

  const handleConnectESPN = async () => {
    if (!espnS2.trim() || !espnSWID.trim() || !espnLeagueId.trim()) {
      Alert.alert('Missing Info', 'Please fill in all ESPN fields.'); return;
    }
    setLoading(true);
    try {
      const creds = { espnS2: espnS2.trim(), swid: espnSWID.trim() };
      const data = await getESPNLeague(parseInt(espnLeagueId.trim()), creds);
      const myTeam = findMyESPNTeam(data, creds.swid);
      if (!myTeam) { Alert.alert('Not Found', 'Could not find your team. Check your SWID.'); return; }
      await saveESPNCredentials(creds);
      await AsyncStorage.setItem('espn_league_ids', JSON.stringify([parseInt(espnLeagueId.trim())]));
      setEspnConnected(true);
      setEspnS2(''); setEspnSWID(''); setEspnLeagueId('');
      Alert.alert('✓ ESPN Connected', data.settings?.name || 'League connected.');
    } catch (e: any) { Alert.alert('Failed', e.message || 'Check your credentials.'); }
    finally { setLoading(false); }
  };

  const handleConnectYahoo = async () => {
    setLoading(true);
    try {
      const authUrl = await getYahooAuthURL();
      console.log('Yahoo auth URL:', authUrl.slice(0, 100));
      const result = await WebBrowser.openAuthSessionAsync(
        authUrl,
        'aiomnifantasy://oauth/yahoo',
        { showInRecents: true }
      );
      console.log('Yahoo result:', result.type);
      if (result.type === 'success' && result.url) {
        const urlObj = new URL(result.url);
        const code = urlObj.searchParams.get('code');
        if (code) {
          await exchangeYahooCode(code);
          setYahooConnected(true);
          Alert.alert('✓ Yahoo Connected', 'Your Yahoo leagues will now appear on Home.');
        } else {
          Alert.alert('Yahoo Error', 'No auth code received. Try again.');
        }
      } else if (result.type !== 'cancel' && result.type !== 'dismiss') {
        Alert.alert('Yahoo Note', 'Yahoo OAuth requires a development build (not Expo Go).\n\nRun: npx expo run:ios');
      }
    } catch (e: any) {
      console.log('Yahoo error:', e);
      Alert.alert('Yahoo Error', e.message || 'Could not connect Yahoo.');
    } finally { setLoading(false); }
  };

  const handleDisconnectESPN = () => {
    Alert.alert('Disconnect ESPN?', '', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: async () => {
        await clearESPNCredentials();
        await AsyncStorage.removeItem('espn_league_ids');
        setEspnConnected(false);
      }},
    ]);
  };

  const handleDisconnectYahoo = () => {
    Alert.alert('Disconnect Yahoo?', '', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: async () => {
        await clearYahooTokens();
        setYahooConnected(false);
      }},
    ]);
  };

  const platformSub = [
    username ? 'Sleeper' : null,
    espnConnected ? 'ESPN' : null,
    yahooConnected ? 'Yahoo' : null,
  ].filter(Boolean).join(' · ') || 'Tap to connect';

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12 }]} showsVerticalScrollIndicator={false}>

        <View style={styles.logoWrap}>
          <Image source={LOGO} style={styles.logo} resizeMode="contain" />
        </View>

        {/* User card */}
        <GlassCard style={styles.mb14}>
          <View style={styles.userRow}>
            <OrbAvatar size={44} />
            <View style={{ flex: 1 }}>
              <Text style={styles.userName}>Patrick Meyer</Text>
              <Text style={styles.userHandle}>@{username || 'not connected'} · Free tier</Text>
            </View>
            <Badge label="FREE" color={C.dim} />
          </View>
          <View style={{ marginTop: 12 }}>
            <View style={styles.promptRow}>
              <Text style={styles.promptLbl}>WEEKLY PROMPTS</Text>
              <Text style={styles.promptCount}><Text style={{ color: C.gold }}>18</Text> / 25</Text>
            </View>
            <View style={styles.promptBg}>
              <View style={[styles.promptFill, { width: `${18/25*100}%` as any }]} />
            </View>
            <Text style={styles.promptSub}>Resets Sunday noon · Waivers run Wednesday</Text>
          </View>
        </GlassCard>

        {/* Tiers */}
        <Text style={styles.sectionLbl}>UPGRADE</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }} contentContainerStyle={{ gap: 10 }}>
          {TIERS.map(tier => (
            <TouchableOpacity key={tier.name} activeOpacity={0.8}>
              <GlassCard style={[styles.tierCard, tier.active && { borderColor: C.goldBorder }]} padding={12} radius={16}>
                <View style={[styles.tierDot, { backgroundColor: tier.color }]} />
                <Text style={styles.tierName}>{tier.name}</Text>
                <Text style={[styles.tierPrice, { color: tier.color }]}>{tier.price}</Text>
                <Text style={styles.tierSub}>{tier.sub}</Text>
                {tier.active
                  ? <Badge label="CURRENT" color={C.dim} />
                  : <View style={[styles.tierBtn, { borderColor: tier.color }]}>
                      <Text style={[styles.tierBtnTxt, { color: tier.color }]}>Upgrade</Text>
                    </View>}
              </GlassCard>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Settings */}
        <Text style={[styles.sectionLbl, { marginTop: 20 }]}>SETTINGS</Text>
        <SurfaceCard radius={18} padding={0}>
          <TouchableOpacity style={styles.menuRow} activeOpacity={0.7} onPress={() => setShowAccountModal(true)}>
            <Text style={styles.menuIcon}>👤</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.menuLabel}>Account</Text>
              <Text style={styles.menuSub}>@{username || 'tap to connect Sleeper'}</Text>
            </View>
            <Text style={styles.menuChevron}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.menuRow, styles.menuBorder]} activeOpacity={0.7} onPress={() => setShowPlatformModal(true)}>
            <Text style={styles.menuIcon}>🏈</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.menuLabel}>My Platforms</Text>
              <Text style={styles.menuSub}>{platformSub}</Text>
            </View>
            <Text style={styles.menuChevron}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.menuRow, styles.menuBorder]} activeOpacity={0.7}>
            <Text style={styles.menuIcon}>🔔</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.menuLabel}>Notifications</Text>
              <Text style={styles.menuSub}>All alerts on</Text>
            </View>
            <Text style={styles.menuChevron}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.menuRow, styles.menuBorder]} activeOpacity={0.7}>
            <Text style={styles.menuIcon}>📊</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.menuLabel}>Usage</Text>
              <Text style={styles.menuSub}>18 of 25 prompts used</Text>
            </View>
            <Text style={styles.menuChevron}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.menuRow, styles.menuBorder]} activeOpacity={0.7}>
            <Text style={styles.menuIcon}>🔒</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.menuLabel}>Privacy</Text>
              <Text style={styles.menuSub}>Data never sold</Text>
            </View>
            <Text style={styles.menuChevron}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.menuRow, styles.menuBorder]} activeOpacity={0.7}>
            <Text style={styles.menuIcon}>❓</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.menuLabel}>Help & FAQ</Text>
              <Text style={styles.menuSub}>getaiomni.com/help</Text>
            </View>
            <Text style={styles.menuChevron}>›</Text>
          </TouchableOpacity>
        </SurfaceCard>

        <View style={styles.footer}>
          <Text style={styles.footerTxt}>AIOmni · getaiomni.com</Text>
          <Text style={styles.footerSub}>See everything. Know everyone. Win always.</Text>
        </View>
      </ScrollView>

      {/* Account Modal */}
      <Modal visible={showAccountModal} transparent animationType="slide">
        <View style={styles.overlay}>
          <GlassCard style={styles.modalCard}>
            <Text style={styles.modalTitle}>Sleeper Account</Text>
            <Text style={styles.modalSub}>Enter your Sleeper username to load your leagues.</Text>
            <TextInput style={styles.input} placeholder="Sleeper username" placeholderTextColor="rgba(255,255,255,0.35)" value={newUsername} onChangeText={setNewUsername} autoCapitalize="none" autoCorrect={false} />
            <TouchableOpacity style={styles.modalBtn} onPress={handleSaveUsername} disabled={loading}>
              <Text style={styles.modalBtnTxt}>{loading ? 'Connecting...' : 'Connect Sleeper'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowAccountModal(false)} style={{ marginTop: 12, alignItems: 'center' }}>
              <Text style={{ color: C.dim, fontFamily: F.mono, fontSize: SZ.sm }}>Cancel</Text>
            </TouchableOpacity>
          </GlassCard>
        </View>
      </Modal>

      {/* Platforms Modal */}
      <Modal visible={showPlatformModal} transparent animationType="slide">
        <View style={styles.overlay}>
          <GlassCard style={styles.modalCard}>
            <Text style={styles.modalTitle}>My Platforms</Text>

            <Text style={[styles.modalSub, { color: '#cc4444', marginBottom: 6, marginTop: 8 }]}>ESPN</Text>
            {espnConnected ? (
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: 'rgba(122,31,46,0.4)', borderColor: '#7a1f2e' }]} onPress={handleDisconnectESPN}>
                <Text style={[styles.modalBtnTxt, { color: '#ff8888' }]}>Disconnect ESPN</Text>
              </TouchableOpacity>
            ) : (
              <>
                <Text style={{ color: C.dim, fontFamily: F.mono, fontSize: SZ.xs, marginBottom: 10, lineHeight: 18 }}>
                  {'1. Log into espn.com in Safari\n2. DevTools → Cookies → copy espn_s2 + SWID\n3. Find League ID in ESPN URL'}
                </Text>
                <TextInput style={styles.input} placeholder="espn_s2 cookie" placeholderTextColor="rgba(255,255,255,0.35)" value={espnS2} onChangeText={setEspnS2} autoCapitalize="none" multiline />
                <TextInput style={[styles.input, { marginTop: 8 }]} placeholder="SWID ({XXXX-XXXX})" placeholderTextColor="rgba(255,255,255,0.35)" value={espnSWID} onChangeText={setEspnSWID} autoCapitalize="none" />
                <TextInput style={[styles.input, { marginTop: 8 }]} placeholder="League ID (numbers only)" placeholderTextColor="rgba(255,255,255,0.35)" value={espnLeagueId} onChangeText={setEspnLeagueId} keyboardType="numeric" />
                <TouchableOpacity style={styles.modalBtn} onPress={handleConnectESPN} disabled={loading}>
                  <Text style={styles.modalBtnTxt}>{loading ? 'Connecting...' : 'Connect ESPN'}</Text>
                </TouchableOpacity>
              </>
            )}

            <Text style={[styles.modalSub, { color: '#7a44cc', marginTop: 20, marginBottom: 6 }]}>Yahoo</Text>
            {yahooConnected ? (
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: 'rgba(90,0,170,0.3)', borderColor: '#5a00aa' }]} onPress={handleDisconnectYahoo}>
                <Text style={[styles.modalBtnTxt, { color: '#bb88ff' }]}>Disconnect Yahoo</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.modalBtn, { borderColor: '#7a44cc', backgroundColor: 'rgba(122,68,204,0.2)' }]} onPress={handleConnectYahoo} disabled={loading}>
                <Text style={[styles.modalBtnTxt, { color: '#bb88ff' }]}>{loading ? 'Opening Yahoo...' : 'Connect Yahoo'}</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity onPress={() => setShowPlatformModal(false)} style={{ marginTop: 20, alignItems: 'center' }}>
              <Text style={{ color: C.dim, fontFamily: F.mono, fontSize: SZ.sm }}>Done</Text>
            </TouchableOpacity>
          </GlassCard>
        </View>
      </Modal>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  scroll:       { paddingHorizontal: SP[3], paddingBottom: 110 },
  logoWrap:     { alignItems: 'center', marginBottom: 20 },
  logo:         { height: 32, width: 120 },
  mb14:         { marginBottom: 14 },
  userRow:      { flexDirection: 'row', alignItems: 'center', gap: 13 },
  userName:     { fontSize: SZ.lg, fontWeight: '700', color: C.ink, fontFamily: F.bold },
  userHandle:   { fontSize: SZ.sm, fontFamily: F.mono, color: C.dim, marginTop: 2 },
  promptRow:    { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  promptLbl:    { fontSize: SZ.xs, fontFamily: F.mono, color: C.dim, letterSpacing: 1.5 },
  promptCount:  { fontSize: SZ.xs, fontFamily: F.mono, color: C.dim },
  promptBg:     { height: 4, backgroundColor: '#7a1f2e', borderRadius: 3, overflow: 'hidden' },
  promptFill:   { height: 4, backgroundColor: C.gold, borderRadius: 3 },
  promptSub:    { fontSize: SZ.xs, fontFamily: F.mono, color: C.dim, marginTop: 5, opacity: 0.7 },
  sectionLbl:   { fontSize: SZ.xs, fontFamily: F.mono, color: C.dim, letterSpacing: 3, marginBottom: 10 },
  tierCard:     { width: 140 },
  tierDot:      { width: 8, height: 8, borderRadius: 4, marginBottom: 8 },
  tierName:     { fontSize: SZ.sm, fontWeight: '700', color: C.ink, fontFamily: F.bold, marginBottom: 3 },
  tierPrice:    { fontSize: SZ.xl, fontWeight: '800', fontFamily: F.bold, marginBottom: 3 },
  tierSub:      { fontSize: SZ.xs, fontFamily: F.mono, color: C.dim, marginBottom: 9, lineHeight: 14 },
  tierBtn:      { borderWidth: 1, borderRadius: 8, paddingVertical: 5, alignItems: 'center' },
  tierBtnTxt:   { fontSize: SZ.sm, fontWeight: '700', fontFamily: F.bold },
  menuRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: SP[3] },
  menuBorder:   { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)' },
  menuIcon:     { fontSize: 18, width: 28, textAlign: 'center' },
  menuLabel:    { fontSize: SZ.base, fontWeight: '600', color: C.ink, fontFamily: F.bold },
  menuSub:      { fontSize: SZ.sm, fontFamily: F.mono, color: C.dim, marginTop: 1 },
  menuChevron:  { color: C.dim2, fontSize: SZ.xl },
  footer:       { alignItems: 'center', marginTop: SP[8], gap: 5 },
  footerTxt:    { fontSize: SZ.sm, fontFamily: F.mono, color: C.dim, letterSpacing: 1 },
  footerSub:    { fontSize: SZ.xs, fontFamily: F.mono, color: 'rgba(255,255,255,0.2)', letterSpacing: 1.5 },
  overlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end', padding: SP[3], paddingBottom: 40 },
  modalCard:    { padding: 24 },
  modalTitle:   { fontSize: SZ.xl, fontWeight: '700', color: C.ink, fontFamily: F.bold, marginBottom: 4 },
  modalSub:     { fontSize: SZ.sm, fontFamily: F.mono, color: C.dim, marginBottom: 14 },
  input:        { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: 14, color: C.ink, fontFamily: F.mono, fontSize: SZ.sm, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  modalBtn:     { backgroundColor: C.sageS, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: C.sageBorder, marginTop: 12 },
  modalBtnTxt:  { color: C.sage, fontWeight: '700', fontFamily: F.bold, fontSize: SZ.base },
});
