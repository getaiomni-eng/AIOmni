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
import { GlassCard, SurfaceCard } from '../components/GlassCard';
import { OrbAvatar } from '../components/OrbAvatar';
import { C, F, SP, SZ, textShadow } from '../constants/tokens';
import { getRemainingPrompts } from '../utils/promptCounter';

const LOGO         = require('../../assets/images/logo.png');
const WEEKLY_LIMIT = 25;
const { width: SCREEN_W } = Dimensions.get('window');

const TIERS = [
  { key: 'rankings',      name: 'Rankings',      price: '$5.99',  sub: 'Live community rankings',   color: '#4ab8a0' },
  { key: 'pro',           name: 'Pro',           price: '$9.99',  sub: 'Unlimited + Draft Copilot', color: C.gold    },
  { key: 'premium',       name: 'Premium',       price: '$14.99', sub: '2-season AI memory',        color: '#9b6dbd' },
  { key: 'dynasty_elite', name: 'Dynasty Elite', price: '$19.99', sub: 'College rankings + picks',  color: '#82c494' },
];

export default function MoreScreen() {
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
      const res  = await fetch(`https://api.sleeper.app/v1/user/${newUsername.trim()}`);
      const u    = await res.json();
      if (!u?.user_id) { Alert.alert('Not Found', 'Could not find that Sleeper account.'); return; }
      await AsyncStorage.setItem('sleeper_username', newUsername.trim());
      setUsername(newUsername.trim());
      setShowAccountModal(false);
      setNewUsername('');
      Alert.alert('✓ Updated', 'Sleeper account connected.');
    } catch { Alert.alert('Error', 'Could not connect to Sleeper.'); }
    finally { setLoading(false); }
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out?', '', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: async () => { await signOut(); setUser(null); setCurrentTier('free'); } },
    ]);
  };

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
      const authUrl = await getYahooAuthURL();
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
  const promptColor = remaining <= 5 ? '#c87878' : remaining <= 10 ? C.amber : C.gold;
  const tierInfo    = TIER_INFO[currentTier] ?? TIER_INFO.free;

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12 }]} showsVerticalScrollIndicator={false}>

        <Image source={LOGO} style={styles.logo} resizeMode="contain" />

        {/* User card */}
        <GlassCard style={styles.mb14}>
          <View style={styles.userRow}>
            <OrbAvatar size={44} />
            <View style={{ flex: 1 }}>
              <Text style={styles.userName}>{user?.email ?? (username ? `@${username}` : 'Not signed in')}</Text>
              <Text style={[styles.userHandle, { color: tierInfo.color }]}>{tierInfo.label} tier</Text>
            </View>
            <Badge label={currentTier.replace('_', ' ').toUpperCase()} color={tierInfo.color} />
          </View>
          <View style={{ marginTop: 14 }}>
            <View style={styles.promptRow}>
              <Text style={styles.promptLbl}>WEEKLY PROMPTS</Text>
              <Text style={[styles.promptCount, { color: promptColor }]}>{remaining}<Text style={{ color: C.dim, fontFamily: F.mono, fontSize: SZ.xs }}>/{WEEKLY_LIMIT}</Text></Text>
            </View>
            <View style={styles.promptBg}><View style={[styles.promptFill, { width: `${promptPct}%` as any, backgroundColor: promptColor }]} /></View>
            <Text style={styles.promptSub}>Resets Sunday noon · Waivers run Wednesday</Text>
          </View>
        </GlassCard>

        {/* Auth CTA */}
        {!user && (
          <TouchableOpacity style={styles.authCta} onPress={() => router.push('/auth')}>
            <Text style={styles.authCtaTxt}>🔑  Create account to sync across devices →</Text>
          </TouchableOpacity>
        )}

        {/* Tiers */}
        <Text style={styles.sectionLbl}>UPGRADE</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }} contentContainerStyle={{ gap: 10, paddingVertical: 2 }}>
          {TIERS.map(tier => {
            const isActive = currentTier === tier.key;
            return (
              <TouchableOpacity key={tier.key} activeOpacity={0.8} onPress={() => !isActive && router.push({ pathname: '/paywall', params: { context: 'upgrade' } })}>
                <GlassCard style={[styles.tierCard, isActive && { borderColor: tier.color, borderWidth: 1.5 }]} padding={14} radius={16}>
                  <View style={[styles.tierDot, { backgroundColor: tier.color }]} />
                  <Text style={styles.tierName}>{tier.name}</Text>
                  <Text style={[styles.tierPrice, { color: tier.color }]}>{tier.price}</Text>
                  <View style={styles.tierSubWrap}><Text style={styles.tierSub}>{tier.sub}</Text></View>
                  <View style={styles.tierFooter}>
                    {isActive ? <Badge label="CURRENT" color={tier.color} /> : <View style={[styles.tierBtn, { borderColor: tier.color }]}><Text style={[styles.tierBtnTxt, { color: tier.color }]}>Upgrade</Text></View>}
                  </View>
                </GlassCard>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Settings */}
        <Text style={[styles.sectionLbl, { marginTop: 20 }]}>SETTINGS</Text>
        <SurfaceCard radius={18} padding={0}>
          {[
            { icon: '👤', label: 'Account',        sub: `@${username || 'tap to connect Sleeper'}`, onPress: () => setShowAccountModal(true) },
            { icon: '🏈', label: 'My Platforms',    sub: platformSub,                               onPress: () => setShowPlatformModal(true) },
            { icon: '🔔', label: 'Notifications',   sub: 'All alerts on',                           onPress: () => {} },
            { icon: '📊', label: 'Usage',           sub: `${remaining} of ${WEEKLY_LIMIT} prompts remaining`, onPress: () => {} },
            { icon: '🔒', label: 'Privacy',         sub: 'Data never sold',                         onPress: () => {} },
          ].map((item, i) => (
            <TouchableOpacity key={item.label} style={[styles.menuRow, i > 0 && styles.menuBorder]} activeOpacity={0.7} onPress={item.onPress}>
              <Text style={styles.menuIcon}>{item.icon}</Text>
              <View style={{ flex: 1 }}><Text style={styles.menuLabel}>{item.label}</Text><Text style={styles.menuSub}>{item.sub}</Text></View>
              <Text style={styles.menuChevron}>›</Text>
            </TouchableOpacity>
          ))}
          {user && (
            <TouchableOpacity style={[styles.menuRow, styles.menuBorder]} activeOpacity={0.7} onPress={handleSignOut}>
              <Text style={styles.menuIcon}>🚪</Text>
              <View style={{ flex: 1 }}><Text style={[styles.menuLabel, { color: '#c87878' }]}>Sign Out</Text><Text style={styles.menuSub}>{user.email}</Text></View>
              <Text style={styles.menuChevron}>›</Text>
            </TouchableOpacity>
          )}
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
            {!user && (
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: 'rgba(254,226,41,0.15)', borderColor: C.goldBorder, marginTop: 8 }]} onPress={() => { setShowAccountModal(false); router.push('/auth'); }}>
                <Text style={[styles.modalBtnTxt, { color: C.gold }]}>Create AIOmni Account →</Text>
              </TouchableOpacity>
            )}
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
            <Text style={[styles.platformLabel, { color: '#FF4444' }]}>ESPN</Text>
            {espnConnected ? (
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: 'rgba(122,31,46,0.4)', borderColor: '#7a1f2e' }]} onPress={handleDisconnectESPN}>
                <Text style={[styles.modalBtnTxt, { color: '#ff8888' }]}>Disconnect ESPN</Text>
              </TouchableOpacity>
            ) : (
              <>
                <Text style={styles.platformHint}>{'1. Log into espn.com in Safari\n2. Open DevTools → Application → Cookies\n3. Copy espn_s2 + SWID values\n4. Find League ID in your ESPN league URL'}</Text>
                <TextInput style={styles.input} placeholder="espn_s2 cookie" placeholderTextColor="rgba(255,255,255,0.35)" value={espnS2} onChangeText={setEspnS2} autoCapitalize="none" multiline />
                <TextInput style={[styles.input, { marginTop: 8 }]} placeholder="SWID ({XXXX-XXXX})" placeholderTextColor="rgba(255,255,255,0.35)" value={espnSWID} onChangeText={setEspnSWID} autoCapitalize="none" />
                <TextInput style={[styles.input, { marginTop: 8 }]} placeholder="League ID (numbers only)" placeholderTextColor="rgba(255,255,255,0.35)" value={espnLeagueId} onChangeText={setEspnLeagueId} keyboardType="numeric" />
                <TouchableOpacity style={styles.modalBtn} onPress={handleConnectESPN} disabled={loading}>
                  <Text style={styles.modalBtnTxt}>{loading ? 'Connecting...' : 'Connect ESPN'}</Text>
                </TouchableOpacity>
              </>
            )}
            <Text style={[styles.platformLabel, { color: '#7a44cc', marginTop: 20 }]}>Yahoo</Text>
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
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: SP[3], paddingBottom: 110 },
  logo:   { width: SCREEN_W, height: 140, marginLeft: -SP[3], marginBottom: 20 },
  mb14:   { marginBottom: 14 },

  authCta:    { backgroundColor: C.goldS, borderWidth: 1, borderColor: C.goldBorder, borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 16 },
  authCtaTxt: { fontFamily: F.mono, color: C.gold, fontSize: SZ.sm, letterSpacing: 0.5 },

  userRow:     { flexDirection: 'row', alignItems: 'center', gap: 13 },
  userName:    { fontSize: SZ.base, fontWeight: '700', color: C.ink, fontFamily: F.bold, ...textShadow.body },
  userHandle:  { fontSize: SZ.sm, fontFamily: F.mono, marginTop: 2, ...textShadow.subtle },
  promptRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  promptLbl:   { fontSize: SZ.xs, fontFamily: F.mono, color: C.dim, letterSpacing: 1.5, ...textShadow.subtle },
  promptCount: { fontSize: SZ.base, fontWeight: '700', fontFamily: F.bold, ...textShadow.body },
  promptBg:    { height: 4, backgroundColor: 'rgba(122,31,46,0.4)', borderRadius: 3, overflow: 'hidden' },
  promptFill:  { height: 4, borderRadius: 3 },
  promptSub:   { fontSize: SZ.xs - 1, fontFamily: F.mono, color: C.dim, marginTop: 5, opacity: 0.7, ...textShadow.subtle },
  sectionLbl:  { fontSize: SZ.xs, fontFamily: F.mono, color: C.dim, letterSpacing: 3, marginBottom: 10, ...textShadow.subtle },

  tierCard:    { flex: 1, minHeight: 185, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  tierDot:     { width: 8, height: 8, borderRadius: 4, marginBottom: 8 },
  tierName:    { fontSize: SZ.sm, fontWeight: '700', color: C.ink, fontFamily: F.bold, marginBottom: 3, ...textShadow.body },
  tierPrice:   { fontSize: SZ.xl, fontWeight: '800', fontFamily: F.bold, marginBottom: 4, ...textShadow.body },
  tierSubWrap: { minHeight: 32 },
  tierSub:     { fontSize: SZ.xs, fontFamily: F.mono, color: C.dim, lineHeight: 14, ...textShadow.subtle },
  tierFooter:  { marginTop: 'auto' as any, paddingTop: 10 },
  tierBtn:     { borderWidth: 1, borderRadius: 8, paddingVertical: 5, alignItems: 'center' },
  tierBtnTxt:  { fontSize: SZ.sm, fontWeight: '700', fontFamily: F.bold, ...textShadow.body },

  menuRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, padding: SP[3] },
  menuBorder:  { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)' },
  menuIcon:    { fontSize: 18, width: 28, textAlign: 'center' },
  menuLabel:   { fontSize: SZ.base, fontWeight: '600', color: C.ink, fontFamily: F.bold, ...textShadow.body },
  menuSub:     { fontSize: SZ.sm, fontFamily: F.mono, color: C.dim, marginTop: 1, ...textShadow.subtle },
  menuChevron: { color: C.dim2, fontSize: SZ.xl, ...textShadow.body },

  footer:    { alignItems: 'center', marginTop: SP[8], gap: 5 },
  footerTxt: { fontSize: SZ.sm, fontFamily: F.mono, color: C.dim, letterSpacing: 1, ...textShadow.subtle },
  footerSub: { fontSize: SZ.xs, fontFamily: F.mono, color: 'rgba(255,255,255,0.2)', letterSpacing: 1.5, ...textShadow.subtle },

  overlay:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end', padding: SP[3], paddingBottom: 40 },
  modalCard:     { padding: 24 },
  modalTitle:    { fontSize: SZ.xl, fontWeight: '700', color: C.ink, fontFamily: F.bold, marginBottom: 4, ...textShadow.hero },
  modalSub:      { fontSize: SZ.sm, fontFamily: F.mono, color: C.dim, marginBottom: 14, ...textShadow.subtle },
  platformLabel: { fontSize: SZ.sm, fontFamily: F.bold, fontWeight: '700', letterSpacing: 1, marginBottom: 8, marginTop: 4, ...textShadow.body },
  platformHint:  { fontSize: SZ.xs, fontFamily: F.mono, color: C.dim, marginBottom: 10, lineHeight: 18, ...textShadow.subtle },
  input:         { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: 14, color: C.ink, fontFamily: F.mono, fontSize: SZ.sm, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  modalBtn:      { backgroundColor: C.sageS, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: C.sageBorder, marginTop: 12 },
  modalBtnTxt:   { color: C.sage, fontWeight: '700', fontFamily: F.bold, fontSize: SZ.base, ...textShadow.body },
});