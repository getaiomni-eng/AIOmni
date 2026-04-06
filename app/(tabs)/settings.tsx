import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useState } from 'react';
import { Alert, Dimensions, Image, Linking, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AIOmniUser, getUser, signOut } from '../../services/auth';
import { clearESPNCredentials, findMyESPNTeam, getESPNLeague, loadESPNCredentials, saveESPNCredentials } from '../../services/espn';
import { getCurrentTier, TIER_INFO } from '../../services/purchases';
import { clearYahooTokens, exchangeYahooCode, getValidYahooToken, getYahooAuthURL } from '../../services/yahoo';
import { Badge } from '../components/Atoms';
import { AIOmniIris } from '../components/AIOmniLogo';
import { C, F, SP, SZ, BEVEL } from '../constants/tokens';
import { getRemainingPrompts } from '../utils/promptCounter';

const LOGO         = require('../../assets/images/logo.png');
const WEEKLY_LIMIT = 25;
const { width: SCREEN_W } = Dimensions.get('window');

const SURFACE  = 'rgba(255,255,255,0.90)';
const BORDER   = 'rgba(88,131,191,0.32)';
const BEVEL_HI = 'rgba(255,255,255,0.95)';

const TIERS = [
  { key: 'rankings',      name: 'Rankings',      price: '$5.99',  sub: 'Live community rankings',   color: '#2a7aaa' },
  { key: 'pro',           name: 'Pro',           price: '$9.99',  sub: '75 prompts per week', color: C.gold    },
  { key: 'premium',       name: 'Premium',       price: '$14.99', sub: '2-season AI memory',        color: '#7b5ea7' },
  { key: 'dynasty_elite', name: 'Dynasty Elite', price: '$19.99', sub: 'College rankings + picks',  color: '#1e8c42' },
];

export default function SettingsTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [username,          setUsername]          = useState('');
  const [newUsername,       setNewUsername]       = useState('');
  const [user,              setUser]              = useState<AIOmniUser | null>(null);
  const [currentTier,       setCurrentTier]       = useState('free');
  const [espnConnected,     setEspnConnected]     = useState(false);
  const [yahooConnected,    setYahooConnected]    = useState(false);
  const [showAccountModal,  setShowAccountModal]  = useState(false);
  const [showPlatformModal, setShowPlatformModal] = useState(false);
  const [espnS2,            setEspnS2]            = useState('');
  const [espnSWID,          setEspnSWID]          = useState('');
  const [espnLeagueId,      setEspnLeagueId]      = useState('');
  const [loading,           setLoading]           = useState(false);
  const [remaining,         setRemaining]         = useState(WEEKLY_LIMIT);

  useEffect(() => {
    AsyncStorage.getItem('sleeper_username').then(u => { if (u) setUsername(u); });
    loadESPNCredentials().then(c => setEspnConnected(!!c));
    getValidYahooToken().then(t => setYahooConnected(!!t));
    getRemainingPrompts().then(r => setRemaining(r));
    getUser().then(u => setUser(u));
    getCurrentTier().then(t => setCurrentTier(t));
  }, []);

  const handleSaveUsername = async () => {
    if (!newUsername.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`https://api.sleeper.app/v1/user/${newUsername.trim()}`);
      const u   = await res.json();
      if (!u?.user_id) { Alert.alert('Not Found', 'Could not find that Sleeper account.'); return; }
      await AsyncStorage.setItem('sleeper_username', newUsername.trim());
      setUsername(newUsername.trim()); setShowAccountModal(false); setNewUsername('');
      Alert.alert('✓ Updated', 'Sleeper account connected.');
    } catch { Alert.alert('Error', 'Could not connect to Sleeper.'); }
    finally { setLoading(false); }
  };

  const handleSignOut = () => Alert.alert('Sign Out?', '', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Sign Out', style: 'destructive', onPress: async () => { await signOut(); setUser(null); setCurrentTier('free'); } },
  ]);

  const handleConnectESPN = async () => {
    if (!espnS2.trim() || !espnSWID.trim() || !espnLeagueId.trim()) { Alert.alert('Missing Info', 'Please fill in all ESPN fields.'); return; }
    setLoading(true);
    try {
      const creds = { espnS2: espnS2.trim(), swid: espnSWID.trim() };
      const data  = await getESPNLeague(parseInt(espnLeagueId.trim()), creds);
      if (!findMyESPNTeam(data, creds.swid)) { Alert.alert('Not Found', 'Could not find your team. Check your SWID.'); return; }
      await saveESPNCredentials(creds);
      await AsyncStorage.setItem('espn_league_ids', JSON.stringify([parseInt(espnLeagueId.trim())]));
      setEspnConnected(true); setEspnS2(''); setEspnSWID(''); setEspnLeagueId('');
      Alert.alert('✓ ESPN Connected', data.settings?.name || 'League connected.');
    } catch (e: any) { Alert.alert('Failed', e.message || 'Check your credentials.'); }
    finally { setLoading(false); }
  };

  const handleConnectYahoo = async () => {
    setLoading(true);
    try {
      const authUrl     = await getYahooAuthURL();
      const codePromise = new Promise<string | null>((resolve) => {
        const timeout = setTimeout(() => { sub.remove(); resolve(null); }, 120000);
        const sub = Linking.addEventListener('url', ({ url }: { url: string }) => {
          if (url.startsWith('aiomnifantasy://oauth/yahoo')) {
            clearTimeout(timeout); sub.remove();
            try { resolve(new URL(url).searchParams.get('code')); } catch { resolve(null); }
          }
        });
      });
      WebBrowser.openBrowserAsync(authUrl, { showInRecents: true });
      const code = await codePromise;
      WebBrowser.dismissBrowser();
      if (code) { await exchangeYahooCode(code); setYahooConnected(true); Alert.alert('✓ Yahoo Connected', 'Your Yahoo leagues will now appear on Home.'); }
      else Alert.alert('Yahoo Error', 'No auth code received. Try again.');
    } catch (e: any) { Alert.alert('Yahoo Error', e.message || 'Could not connect Yahoo.'); }
    finally { setLoading(false); }
  };

  const handleDisconnectESPN  = () => Alert.alert('Disconnect ESPN?',  '', [{ text: 'Cancel', style: 'cancel' }, { text: 'Disconnect', style: 'destructive', onPress: async () => { await clearESPNCredentials(); await AsyncStorage.removeItem('espn_league_ids'); setEspnConnected(false); } }]);
  const handleDisconnectYahoo = () => Alert.alert('Disconnect Yahoo?', '', [{ text: 'Cancel', style: 'cancel' }, { text: 'Disconnect', style: 'destructive', onPress: async () => { await clearYahooTokens(); setYahooConnected(false); } }]);

  const platformSub = [username ? 'Sleeper' : null, espnConnected ? 'ESPN' : null, yahooConnected ? 'Yahoo' : null].filter(Boolean).join(' · ') || 'Tap to connect';
  const promptPct   = (remaining / WEEKLY_LIMIT) * 100;
  const promptColor = remaining <= 5 ? '#a83040' : remaining <= 10 ? C.amber : C.blueDeep;
  const tierInfo    = TIER_INFO[currentTier] ?? TIER_INFO.free;

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12 }]} showsVerticalScrollIndicator={false}>

        <Image source={LOGO} style={styles.logo} resizeMode="contain" />

        {/* ── User card ── */}
        <View style={styles.card}>
          <View style={styles.cardShine} />
          <View style={styles.userRow}>
            <AIOmniIris width={44} />
            <View style={{ flex: 1 }}>
              <Text style={styles.userName}>{user?.email ?? (username ? `@${username}` : 'Not signed in')}</Text>
              <Text style={[styles.userHandle, { color: tierInfo.color }]}>{tierInfo.label} tier</Text>
            </View>
            <Badge label={currentTier.replace('_', ' ').toUpperCase()} color={tierInfo.color} />
          </View>
          <View style={{ marginTop: 14 }}>
            <View style={styles.promptRow}>
              <Text style={styles.promptLbl}>WEEKLY PROMPTS</Text>
              <Text style={[styles.promptCount, { color: promptColor }]}>
                {remaining}<Text style={{ color: C.dim2, fontFamily: F.mono, fontSize: SZ.xs }}>/{WEEKLY_LIMIT}</Text>
              </Text>
            </View>
            <View style={styles.promptBg}>
              <View style={[styles.promptFill, { width: `${promptPct}%` as any, backgroundColor: promptColor }]} />
            </View>
            <Text style={styles.promptSub}>Resets Sunday noon · Waivers run Wednesday</Text>
          </View>
        </View>

        {/* ── Auth CTA ── */}
        {!user && (
          <TouchableOpacity style={styles.authCta} onPress={() => router.replace('/onboarding')}>
            <Text style={styles.authCtaTxt}>🔑  Create account to sync across devices →</Text>
          </TouchableOpacity>
        )}

        {/* ── Tiers ── */}
        <Text style={styles.sectionLbl}>UPGRADE</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }} contentContainerStyle={{ gap: 10, paddingVertical: 2 }}>
          {TIERS.map(tier => {
            const isActive = currentTier === tier.key;
            return (
              <TouchableOpacity key={tier.key} activeOpacity={0.8} onPress={() => !isActive && router.push({ pathname: '/paywall', params: { context: 'upgrade' } })}>
                <View style={[styles.tierCard, isActive && { borderColor: tier.color, borderWidth: 2 }]}>
                  <View style={styles.tierCardShine} />
                  <View style={[styles.tierDot, { backgroundColor: tier.color }]} />
                  <Text style={styles.tierName}>{tier.name}</Text>
                  <Text style={[styles.tierPrice, { color: tier.color }]}>{tier.price}</Text>
                  <View style={styles.tierSubWrap}><Text style={styles.tierSub}>{tier.sub}</Text></View>
                  <View style={styles.tierFooter}>
                    {isActive
                      ? <Badge label="CURRENT" color={tier.color} />
                      : <View style={[styles.tierBtn, { borderColor: tier.color }]}><Text style={[styles.tierBtnTxt, { color: tier.color }]}>Upgrade</Text></View>
                    }
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* ── Settings rows ── */}
        <Text style={[styles.sectionLbl, { marginTop: 20 }]}>SETTINGS</Text>
        <View style={styles.menuCard}>
          <View style={styles.menuCardShine} />
          {[
            { icon: '👤', label: 'Account',      sub: `@${username || 'tap to connect Sleeper'}`, onPress: () => setShowAccountModal(true) },
            { icon: '🏈', label: 'My Platforms',  sub: platformSub,                               onPress: () => setShowPlatformModal(true) },
            { icon: '🔔', label: 'Notifications', sub: 'All alerts on',                           onPress: () => {} },
            { icon: '📊', label: 'Usage',         sub: `${remaining} of ${WEEKLY_LIMIT} prompts remaining`, onPress: () => {} },
            { icon: '🔒', label: 'Privacy',       sub: 'Data never sold',                         onPress: () => {} },
          ].map((item, i) => (
            <TouchableOpacity key={item.label} style={[styles.menuRow, i > 0 && styles.menuBorder]} activeOpacity={0.7} onPress={item.onPress}>
              <Text style={styles.menuIcon}>{item.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.menuLabel}>{item.label}</Text>
                <Text style={styles.menuSub}>{item.sub}</Text>
              </View>
              <Text style={styles.menuChevron}>›</Text>
            </TouchableOpacity>
          ))}
          {user && (
            <TouchableOpacity style={[styles.menuRow, styles.menuBorder]} activeOpacity={0.7} onPress={handleSignOut}>
              <Text style={styles.menuIcon}>🚪</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.menuLabel, { color: '#a83040' }]}>Sign Out</Text>
                <Text style={styles.menuSub}>{user.email}</Text>
              </View>
              <Text style={styles.menuChevron}>›</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerTxt}>AIOmni · getaiomni.com</Text>
          <Text style={styles.footerSub}>See everything. Know everyone. Win always.</Text>
        </View>
      </ScrollView>

      {/* ── Account Modal ── */}
      <Modal visible={showAccountModal} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalShine} />
            <Text style={styles.modalTitle}>Sleeper Account</Text>
            <Text style={styles.modalSub}>Enter your Sleeper username to load your leagues.</Text>
            <TextInput style={styles.input} placeholder="Sleeper username" placeholderTextColor={C.dim2} value={newUsername} onChangeText={setNewUsername} autoCapitalize="none" autoCorrect={false} />
            <TouchableOpacity style={styles.modalBtn} onPress={handleSaveUsername} disabled={loading}>
              <Text style={styles.modalBtnTxt}>{loading ? 'Connecting...' : 'Connect Sleeper'}</Text>
            </TouchableOpacity>
            {!user && (
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: C.goldS, borderColor: C.goldBorder, marginTop: 8 }]} onPress={() => { setShowAccountModal(false); router.replace('/onboarding'); }}>
                <Text style={[styles.modalBtnTxt, { color: C.blueDeep }]}>Create AIOmni Account →</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setShowAccountModal(false)} style={{ marginTop: 12, alignItems: 'center' }}>
              <Text style={{ color: C.dim2, fontFamily: F.mono, fontSize: SZ.sm }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Platforms Modal ── */}
      <Modal visible={showPlatformModal} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalShine} />
            <Text style={styles.modalTitle}>My Platforms</Text>

            <Text style={[styles.platformLabel, { color: '#e03030' }]}>ESPN</Text>
            {espnConnected ? (
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: 'rgba(168,48,64,0.08)', borderColor: 'rgba(168,48,64,0.25)' }]} onPress={handleDisconnectESPN}>
                <Text style={[styles.modalBtnTxt, { color: '#a83040' }]}>Disconnect ESPN</Text>
              </TouchableOpacity>
            ) : (
              <>
                <Text style={styles.platformHint}>{'1. Log into espn.com in Safari\n2. Open DevTools → Application → Cookies\n3. Copy espn_s2 + SWID values\n4. Find League ID in your ESPN league URL'}</Text>
                <TextInput style={styles.input} placeholder="espn_s2 cookie" placeholderTextColor={C.dim2} value={espnS2} onChangeText={setEspnS2} autoCapitalize="none" multiline />
                <TextInput style={[styles.input, { marginTop: 8 }]} placeholder="SWID ({XXXX-XXXX})" placeholderTextColor={C.dim2} value={espnSWID} onChangeText={setEspnSWID} autoCapitalize="none" />
                <TextInput style={[styles.input, { marginTop: 8 }]} placeholder="League ID (numbers only)" placeholderTextColor={C.dim2} value={espnLeagueId} onChangeText={setEspnLeagueId} keyboardType="numeric" />
                <TouchableOpacity style={styles.modalBtn} onPress={handleConnectESPN} disabled={loading}>
                  <Text style={styles.modalBtnTxt}>{loading ? 'Connecting...' : 'Connect ESPN'}</Text>
                </TouchableOpacity>
              </>
            )}

            <Text style={[styles.platformLabel, { color: '#6001D2', marginTop: 20 }]}>Yahoo</Text>
            {yahooConnected ? (
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: 'rgba(96,1,210,0.08)', borderColor: 'rgba(96,1,210,0.25)' }]} onPress={handleDisconnectYahoo}>
                <Text style={[styles.modalBtnTxt, { color: '#6001D2' }]}>Disconnect Yahoo</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.modalBtn, { borderColor: 'rgba(96,1,210,0.3)', backgroundColor: 'rgba(96,1,210,0.06)' }]} onPress={handleConnectYahoo} disabled={loading}>
                <Text style={[styles.modalBtnTxt, { color: '#6001D2' }]}>{loading ? 'Opening Yahoo...' : 'Connect Yahoo'}</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity onPress={() => setShowPlatformModal(false)} style={{ marginTop: 20, alignItems: 'center' }}>
              <Text style={{ color: C.dim2, fontFamily: F.mono, fontSize: SZ.sm }}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: SP[3], paddingBottom: 110 },
  logo:   { width: SCREEN_W, height: 140, marginLeft: -SP[3], marginBottom: 20 },

  // Glass card
  card: {
    ...BEVEL.card,
    backgroundColor: SURFACE,
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    position: 'relative',
    overflow: 'hidden',
  },
  cardShine: { ...BEVEL.shine, zIndex:6 },

  authCta:    { backgroundColor: C.sageS, borderWidth: 1.5, borderColor: BORDER, borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 16 },
  authCtaTxt: { fontFamily: F.mono, color: C.blueDeep, fontSize: SZ.sm, letterSpacing: 0.5 },

  userRow:    { flexDirection: 'row', alignItems: 'center', gap: 13 },
  userName:   { fontSize: SZ.base, fontFamily: F.bold, color: C.ink },
  userHandle: { fontSize: SZ.sm, fontFamily: F.mono, marginTop: 2 },

  promptRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  promptLbl:  { fontSize: SZ.xs, fontFamily: F.mono, color: C.dim2, letterSpacing: 1.5 },
  promptCount:{ fontSize: SZ.base, fontFamily: F.bold },
  promptBg:   { height: 4, backgroundColor: 'rgba(88,131,191,0.12)', borderRadius: 3, overflow: 'hidden' },
  promptFill: { height: 4, borderRadius: 3 },
  promptSub:  { fontSize: SZ.xs - 1, fontFamily: F.mono, color: C.dim2, marginTop: 5, opacity: 0.8 },

  sectionLbl: { fontSize: SZ.xs, fontFamily: F.bold, color: C.blueDeep, letterSpacing: 3, marginBottom: 10 },

  // Tier cards
  tierCard: {
    ...BEVEL.card,
    width: 160, minHeight: 185, backgroundColor: SURFACE,
    padding: 14, position: 'relative', overflow: 'hidden',
  },
  tierCardShine: { ...BEVEL.shine, zIndex:6 },
  tierDot:       { width: 8, height: 8, borderRadius: 4, marginBottom: 8 },
  tierName:      { fontSize: SZ.sm, fontFamily: F.bold, color: C.ink, marginBottom: 3 },
  tierPrice:     { fontSize: SZ.xl, fontFamily: F.bold, marginBottom: 4 },
  tierSubWrap:   { minHeight: 32 },
  tierSub:       { fontSize: SZ.xs, fontFamily: F.mono, color: C.dim2, lineHeight: 14 },
  tierFooter:    { marginTop: 'auto' as any, paddingTop: 10 },
  tierBtn:       { borderWidth: 1.5, borderRadius: 8, paddingVertical: 5, alignItems: 'center' },
  tierBtnTxt:    { fontSize: SZ.sm, fontFamily: F.bold },

  // Menu card
  menuCard: {
    ...BEVEL.card,
    backgroundColor: SURFACE,
    borderRadius: 18,
    overflow: 'hidden',
    position: 'relative',
  },
  menuCardShine: { ...BEVEL.shine, zIndex:6 },
  menuRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, padding: SP[3] },
  menuBorder: { borderTopWidth: 1, borderTopColor: 'rgba(88,131,191,0.12)' },
  menuIcon:   { fontSize: 18, width: 28, textAlign: 'center' },
  menuLabel:  { fontSize: SZ.base, fontFamily: F.bold, color: C.ink },
  menuSub:    { fontSize: SZ.sm, fontFamily: F.mono, color: C.dim2, marginTop: 1 },
  menuChevron:{ color: C.dim2, fontSize: SZ.xl },

  footer:    { alignItems: 'center', marginTop: SP[8], gap: 5 },
  footerTxt: { fontSize: SZ.sm, fontFamily: F.mono, color: C.dim2, letterSpacing: 1 },
  footerSub: { fontSize: SZ.xs, fontFamily: F.mono, color: C.dim2, letterSpacing: 1.5, opacity: 0.6 },

  // Modals
  overlay:  { flex: 1, backgroundColor: 'rgba(26,31,46,0.45)', justifyContent: 'flex-end', padding: SP[3], paddingBottom: 40 },
  modalCard: {
    backgroundColor: '#ffffff', borderRadius: 20, padding: 24,
    borderWidth: 1.5, borderColor: BORDER, overflow: 'hidden', position: 'relative',
    shadowColor: '#3d6aaa', shadowOffset:{width:0,height:-4}, shadowOpacity:0.12, shadowRadius:20, elevation:12,
  },
  modalShine:    { ...BEVEL.shine, zIndex:6 },
  modalTitle:    { fontSize: SZ.xl, fontFamily: F.bold, color: C.ink, marginBottom: 4 },
  modalSub:      { fontSize: SZ.sm, fontFamily: F.mono, color: C.dim2, marginBottom: 14 },
  platformLabel: { fontSize: SZ.sm, fontFamily: F.bold, letterSpacing: 1, marginBottom: 8, marginTop: 4 },
  platformHint:  { fontSize: SZ.xs, fontFamily: F.mono, color: C.dim2, marginBottom: 10, lineHeight: 18, backgroundColor: C.sageS, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: BORDER },
  input: {
    backgroundColor: 'rgba(88,131,191,0.06)', borderRadius: 10, padding: 14,
    color: C.ink, fontFamily: F.mono, fontSize: SZ.sm,
    borderWidth: 1.5, borderColor: BORDER,
  },
  modalBtn:    { backgroundColor: C.sageS, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1.5, borderColor: BORDER, marginTop: 12 },
  modalBtnTxt: { color: C.blueDeep, fontFamily: F.bold, fontSize: SZ.base },
});