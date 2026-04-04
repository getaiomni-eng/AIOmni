import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { clearESPNCredentials, findMyESPNTeam, getESPNLeague, loadESPNCredentials, saveESPNCredentials } from '../services/espn';
import { clearYahooTokens, exchangeYahooCode, getValidYahooToken, getYahooAuthURL, getYahooLeagues, loadYahooTokens } from '../services/yahoo';
import { C, F } from './constants/tokens';
import { getRemainingPrompts } from './utils/promptCounter';

WebBrowser.maybeCompleteAuthSession();

const SURFACE  = 'rgba(255,255,255,0.90)';
const BORDER   = 'rgba(88,131,191,0.32)';
const BEVEL_HI = 'rgba(255,255,255,0.95)';

export default function SettingsScreen() {
  const router = useRouter();
  const [username,        setUsername]        = useState('');
  const [newUsername,     setNewUsername]     = useState('');
  const [remaining,       setRemaining]       = useState(25);
  const [editing,         setEditing]         = useState(false);
  const [loading,         setLoading]         = useState(false);
  const [espnConnected,   setEspnConnected]   = useState(false);
  const [espnS2,          setEspnS2]          = useState('');
  const [espnSWID,        setEspnSWID]        = useState('');
  const [espnLeagueId,    setEspnLeagueId]    = useState('');
  const [espnLeagueName,  setEspnLeagueName]  = useState('');
  const [showEspnForm,    setShowEspnForm]    = useState(false);
  const [espnLoading,     setEspnLoading]     = useState(false);
  const [yahooConnected,  setYahooConnected]  = useState(false);
  const [yahooLeagueCount,setYahooLeagueCount]= useState(0);
  const [yahooLoading,    setYahooLoading]    = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('sleeper_username').then(val => { if (val) setUsername(val); });
    getRemainingPrompts().then(setRemaining);
    loadESPNCredentials().then(creds => {
      if (creds) { setEspnConnected(true); AsyncStorage.getItem('espn_league_name').then(n => { if (n) setEspnLeagueName(n); }); }
    });
    loadYahooTokens().then(async tokens => {
      if (tokens) {
        setYahooConnected(true);
        try { const token = await getValidYahooToken(); if (token) { const leagues = await getYahooLeagues(token); setYahooLeagueCount(leagues.length); } } catch {}
      }
    });
    const sub = Linking.addEventListener('url', handleYahooRedirect);
    return () => sub.remove();
  }, []);

  const handleYahooRedirect = async (event: { url: string }) => {
    const { url } = event;
    if (!url.includes('oauth/yahoo')) return;
    const parsed = Linking.parse(url);
    const code = parsed.queryParams?.code as string;
    if (!code) { Alert.alert('Yahoo Error', 'No auth code received.'); return; }
    setYahooLoading(true);
    try {
      await exchangeYahooCode(code);
      const token = await getValidYahooToken();
      if (token) { const leagues = await getYahooLeagues(token); setYahooLeagueCount(leagues.length); }
      setYahooConnected(true);
      Alert.alert('Yahoo Connected!', 'Your Yahoo leagues will now appear on the Home tab.');
    } catch (err: any) { Alert.alert('Yahoo Error', err.message || 'Could not connect. Try again.'); }
    finally { setYahooLoading(false); }
  };

  const handleConnectYahoo = async () => {
    setYahooLoading(true);
    try {
      const authUrl = await getYahooAuthURL();
      const result  = await WebBrowser.openAuthSessionAsync(authUrl, 'aiomnifantasy://oauth/yahoo');
      if (result.type === 'success' && result.url) await handleYahooRedirect({ url: result.url });
      else if (result.type !== 'dismiss') Alert.alert('Yahoo Error', 'Authentication cancelled or failed.');
    } catch (err: any) { Alert.alert('Yahoo Error', err.message || 'Could not open Yahoo login.'); }
    finally { setYahooLoading(false); }
  };

  const handleDisconnectYahoo = () => Alert.alert('Disconnect Yahoo', 'Remove your Yahoo account?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Disconnect', style: 'destructive', onPress: async () => { await clearYahooTokens(); setYahooConnected(false); setYahooLeagueCount(0); } },
  ]);

  const handleUpdateUsername = async () => {
    if (!newUsername.trim()) return;
    setLoading(true);
    try {
      const res  = await fetch(`https://api.sleeper.app/v1/user/${newUsername.trim()}`);
      const user = await res.json();
      if (!user?.user_id) { Alert.alert('Not Found', 'Could not find that Sleeper account.'); setLoading(false); return; }
      await AsyncStorage.setItem('sleeper_username', newUsername.trim());
      setUsername(newUsername.trim()); setNewUsername(''); setEditing(false);
      Alert.alert('Updated!', 'Your Sleeper account has been updated.');
    } catch { Alert.alert('Error', 'Could not connect to Sleeper.'); }
    finally { setLoading(false); }
  };

  const handleConnectESPN = async () => {
    if (!espnS2.trim() || !espnSWID.trim() || !espnLeagueId.trim()) { Alert.alert('Missing Info', 'Enter espn_s2, SWID, and League ID.'); return; }
    setEspnLoading(true);
    try {
      const creds = { espnS2: espnS2.trim(), swid: espnSWID.trim() };
      const lid   = parseInt(espnLeagueId.trim());
      const data  = await getESPNLeague(lid, creds);
      const myTeam = findMyESPNTeam(data, creds.swid);
      if (!myTeam) { Alert.alert('Team Not Found', 'Check your SWID.'); setEspnLoading(false); return; }
      await saveESPNCredentials(creds);
      await AsyncStorage.setItem('espn_league_ids', JSON.stringify([lid]));
      const name = data.settings?.name || `ESPN League ${lid}`;
      await AsyncStorage.setItem('espn_league_name', name);
      setEspnLeagueName(name); setEspnConnected(true); setShowEspnForm(false);
      setEspnS2(''); setEspnSWID(''); setEspnLeagueId('');
      Alert.alert('ESPN Connected!', `${name} is now connected.`);
    } catch (err: any) { Alert.alert('Connection Failed', err.message || 'Could not connect to ESPN.'); }
    finally { setEspnLoading(false); }
  };

  const handleDisconnectESPN = () => Alert.alert('Disconnect ESPN', 'Remove your ESPN account?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Disconnect', style: 'destructive', onPress: async () => { await clearESPNCredentials(); await AsyncStorage.removeItem('espn_league_name'); setEspnConnected(false); setEspnLeagueName(''); } },
  ]);

  const handleSignOut = () => Alert.alert('Sign Out', 'This will disconnect your Sleeper account.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Sign Out', style: 'destructive', onPress: async () => { await AsyncStorage.clear(); router.replace('/onboarding'); } },
  ]);

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>
        <View style={styles.cardShine} />
        {children}
      </View>
    </View>
  );

  const Row = ({ label, value, valueColor, last }: { label: string; value: string; valueColor?: string; last?: boolean }) => (
    <View style={[styles.row, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueColor && { color: valueColor }]}>{value}</Text>
    </View>
  );

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>← BACK</Text>
          </TouchableOpacity>
          <Text style={styles.title}>SETTINGS</Text>
        </View>

        {/* Sleeper */}
        <Section title="SLEEPER ACCOUNT">
          <Row label="Username" value={`@${username}`} />
          {editing ? (
            <View style={styles.editRow}>
              <TextInput style={styles.input} placeholder="New Sleeper username" placeholderTextColor={C.dim2} value={newUsername} onChangeText={setNewUsername} autoCapitalize="none" autoCorrect={false} />
              <TouchableOpacity style={styles.saveBtn} onPress={handleUpdateUsername} disabled={loading}>
                <Text style={styles.saveBtnText}>{loading ? '...' : 'SAVE'}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={() => setEditing(true)} style={{ paddingTop: 12 }}>
              <Text style={styles.actionLink}>Change username →</Text>
            </TouchableOpacity>
          )}
        </Section>

        {/* ESPN */}
        <Section title="ESPN ACCOUNT">
          {espnConnected ? (
            <>
              <Row label="Status" value="✓ Connected" valueColor={C.mint} />
              {espnLeagueName ? <Row label="League" value={espnLeagueName} last /> : null}
              <TouchableOpacity onPress={handleDisconnectESPN} style={{ paddingTop: 12 }}>
                <Text style={styles.dangerLink}>Disconnect ESPN</Text>
              </TouchableOpacity>
            </>
          ) : showEspnForm ? (
            <>
              <Text style={styles.espnInstructions}>
                1. Log into espn.com in Chrome{'\n'}
                2. DevTools → Application → Cookies → espn.com{'\n'}
                3. Copy espn_s2 and SWID{'\n'}
                4. Find League ID in ESPN URL
              </Text>
              <TextInput style={[styles.input, { marginBottom: 8 }]} placeholder="espn_s2" placeholderTextColor={C.dim2} value={espnS2} onChangeText={setEspnS2} autoCapitalize="none" multiline />
              <TextInput style={[styles.input, { marginBottom: 8 }]} placeholder="SWID ({XXXX-XXXX})" placeholderTextColor={C.dim2} value={espnSWID} onChangeText={setEspnSWID} autoCapitalize="none" />
              <TextInput style={[styles.input, { marginBottom: 14 }]} placeholder="League ID" placeholderTextColor={C.dim2} value={espnLeagueId} onChangeText={setEspnLeagueId} keyboardType="numeric" />
              <TouchableOpacity style={styles.connectBtn} onPress={handleConnectESPN} disabled={espnLoading}>
                <Text style={styles.connectBtnText}>{espnLoading ? 'CONNECTING...' : 'CONNECT ESPN'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowEspnForm(false)} style={{ marginTop: 12 }}>
                <Text style={styles.cancelLink}>Cancel</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity onPress={() => router.push('/espn-login')} style={{ paddingVertical: 10 }}>
              <Text style={styles.actionLink}>+ Connect ESPN Account</Text>
            </TouchableOpacity>
          )}
        </Section>

        {/* Yahoo */}
        <Section title="YAHOO ACCOUNT">
          {yahooConnected ? (
            <>
              <Row label="Status" value="✓ Connected" valueColor={C.mint} />
              {yahooLeagueCount > 0 && <Row label="Leagues" value={`${yahooLeagueCount} found`} last />}
              <TouchableOpacity onPress={handleDisconnectYahoo} style={{ paddingTop: 12 }}>
                <Text style={styles.dangerLink}>Disconnect Yahoo</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity onPress={handleConnectYahoo} disabled={yahooLoading} style={{ paddingVertical: 10 }}>
              <Text style={styles.actionLink}>{yahooLoading ? 'Connecting...' : '+ Connect Yahoo Account'}</Text>
            </TouchableOpacity>
          )}
        </Section>

        {/* Usage */}
        <Section title="WEEKLY USAGE">
          <Row label="Prompts remaining" value={`${remaining}/25`} valueColor={C.blueDeep} />
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${(remaining / 25) * 100}%`, backgroundColor: remaining <= 5 ? '#a83040' : C.blueDeep }]} />
          </View>
          <TouchableOpacity style={styles.upgradeBtn} onPress={() => router.push('/paywall')}>
            <Text style={styles.upgradeBtnText}>UPGRADE TO PRO — $9.99/MO →</Text>
          </TouchableOpacity>
        </Section>

        {/* App */}
        <Section title="APP">
          <Row label="Version" value="1.0.0" />
          <Row label="Platforms" value={`Sleeper${espnConnected ? ' · ESPN' : ''}${yahooConnected ? ' · Yahoo' : ''}`} last />
        </Section>

        {/* Support */}
        <Section title="SUPPORT">
          <TouchableOpacity style={[styles.row, { borderBottomWidth: 0 }]} onPress={() => {
            const url = `mailto:getaiomni@gmail.com?subject=${encodeURIComponent('AIOmni Support')}&body=${encodeURIComponent(`Version: 1.0.0\nSleeper: ${username}\n\nIssue:\n`)}`;
            require('react-native').Linking.openURL(url);
          }}>
            <Text style={styles.rowLabel}>Contact Support</Text>
            <Text style={styles.rowValue}>→</Text>
          </TouchableOpacity>
        </Section>

        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
          <Text style={styles.signOutText}>DISCONNECT SLEEPER ACCOUNT</Text>
        </TouchableOpacity>

        <Text style={styles.tagline}>AIOmni · See everything. Know everyone. Win always.</Text>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 24, paddingBottom: 60 },

  header:  { paddingTop: 56, paddingBottom: 24, borderBottomWidth: 1, borderBottomColor: 'rgba(88,131,191,0.12)', marginBottom: 24 },
  backBtn: { marginBottom: 14 },
  backText:{ fontFamily: F.mono, color: C.blueDeep, fontSize: 10, letterSpacing: 2 },
  title:   { fontFamily: F.bold, color: C.ink, fontSize: 38, letterSpacing: 3, lineHeight: 40 },

  section:      { marginBottom: 24 },
  sectionTitle: { fontFamily: F.mono, color: C.dim2, fontSize: 9, letterSpacing: 2, marginBottom: 8 },
  card: {
    backgroundColor: SURFACE, borderRadius: 14, padding: 16,
    borderWidth: 1.5, borderColor: BORDER, position: 'relative', overflow: 'hidden',
    shadowColor: '#3d6aaa', shadowOffset:{width:0,height:2}, shadowOpacity:0.08, shadowRadius:10, elevation:3,
  },
  cardShine: { position:'absolute', top:0, left:'8%', right:'8%', height:1.5, backgroundColor:BEVEL_HI, zIndex:6 },

  row:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(88,131,191,0.1)' },
  rowLabel: { fontFamily: F.mono, color: C.dim2, fontSize: 14 },
  rowValue: { fontFamily: F.bold, color: C.ink, fontSize: 14 },

  editRow:     { flexDirection: 'row', gap: 10, marginTop: 12 },
  input: {
    flex: 1, backgroundColor: 'rgba(88,131,191,0.06)',
    borderRadius: 10, padding: 12, color: C.ink,
    fontFamily: F.mono, fontSize: 13,
    borderWidth: 1.5, borderColor: BORDER,
  },
  saveBtn:     { backgroundColor: C.gold, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' },
  saveBtnText: { fontFamily: F.bold, color: C.ink, fontSize: 14, letterSpacing: 1.5 },

  actionLink:       { fontFamily: F.bold, color: C.blueDeep, fontSize: 14 },
  dangerLink:       { fontFamily: F.mono, color: '#a83040', fontSize: 14 },
  cancelLink:       { fontFamily: F.mono, color: C.dim2, textAlign: 'center', fontSize: 13 },
  espnInstructions: { fontFamily: F.mono, color: C.dim2, fontSize: 12, lineHeight: 20, marginBottom: 14, backgroundColor: C.sageS, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: BORDER },

  connectBtn:     { backgroundColor: C.blueDeep, borderRadius: 10, padding: 14, alignItems: 'center' },
  connectBtnText: { fontFamily: F.bold, color: '#ffffff', fontSize: 14, letterSpacing: 1.5 },

  progressBar:  { height: 4, backgroundColor: 'rgba(88,131,191,0.12)', borderRadius: 3, marginTop: 12, marginBottom: 16, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 3 },
  upgradeBtn:   { backgroundColor: C.gold, borderRadius: 10, padding: 14, alignItems: 'center' },
  upgradeBtnText:{ fontFamily: F.bold, color: C.ink, fontSize: 13, letterSpacing: 1.5 },

  signOutBtn:  { borderWidth: 1.5, borderColor: 'rgba(168,48,64,0.3)', borderRadius: 10, padding: 16, alignItems: 'center', marginBottom: 24, backgroundColor: 'rgba(168,48,64,0.04)' },
  signOutText: { fontFamily: F.bold, color: '#a83040', fontSize: 14, letterSpacing: 2 },
  tagline:     { fontFamily: F.mono, color: C.dim2, fontSize: 10, textAlign: 'center', letterSpacing: 1 },
});