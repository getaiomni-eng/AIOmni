import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { discoverESPNLeagues, saveESPNCredentials } from '../services/espn';
import { useTheme, type ThemeTokens } from './constants/theme';
import { C, F, SP, SZ } from './constants/tokens';
import { Alert } from '../services/util/crossAlert';

const ESPN_LOGIN_URL = 'https://www.espn.com/fantasy/football/';

const INJECT_SCRIPT = `
  (function() {
    function getCookie(name) {
      const value = '; ' + document.cookie;
      const parts = value.split('; ' + name + '=');
      if (parts.length === 2) return parts.pop().split(';').shift();
      return null;
    }
    function checkCookies() {
      const espnS2 = getCookie('espn_s2');
      const swid = getCookie('SWID');
      if (espnS2 && swid) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'cookies', espnS2, swid }));
      }
    }
    checkCookies();
    setInterval(checkCookies, 2000);
  })();
  true;
`;

export default function ESPNLoginScreen() {
  const router     = useRouter();
  const insets     = useSafeAreaInsets();
  const { t }      = useTheme();
  const styles     = useMemo(() => makeStyles(t), [t]);
  const webViewRef = useRef<any>(null);
  const [status,     setStatus]     = useState('Log in to ESPN to connect your leagues');
  const [connecting, setConnecting] = useState(false);
  const [connected,  setConnected]  = useState(false);
  const [manualS2,   setManualS2]   = useState('');
  const [manualSwid, setManualSwid] = useState('');

  const handleMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type !== 'cookies' || !data.espnS2 || !data.swid) return;
      if (connecting || connected) return;
      setConnecting(true);
      setStatus('Found your ESPN account — loading leagues...');

      const creds = { espnS2: data.espnS2, swid: data.swid };

      // Save credentials first so discovery (which loads creds) can run.
      await saveESPNCredentials(creds);

      // Discover every football league via the fan API — each tagged with
      // its real season and whether it has drafted. Sorted active-first.
      const discovered = await discoverESPNLeagues(creds);
      const leagueIds   = discovered.map((l) => l.id);
      const leagueNames = discovered.map((l) => l.name);
      const draftedCount = discovered.filter((l) => l.drafted).length;

      if (leagueIds.length > 0) {
        // Full summaries (id/name/season/drafted) drive the Home tab;
        // espn_league_ids stays for legacy consumers, active league first.
        await AsyncStorage.setItem('espn_leagues_v2', JSON.stringify(discovered));
        await AsyncStorage.setItem('espn_league_ids', JSON.stringify(leagueIds));
        if (leagueNames.length > 0) await AsyncStorage.setItem('espn_league_name', leagueNames[0]);
        setConnected(true);
        setStatus(`Connected! Found ${leagueIds.length} league${leagueIds.length !== 1 ? 's' : ''}.`);
        const draftedNote = draftedCount > 0 && draftedCount < leagueIds.length
          ? `\n\n${draftedCount} ${draftedCount === 1 ? 'has' : 'have'} drafted; the rest are pre-draft and will fill in once they draft.`
          : '';
        setTimeout(() => {
          Alert.alert(
            '✓ ESPN Connected',
            `Found ${leagueIds.length} league${leagueIds.length !== 1 ? 's' : ''}.${draftedNote}\n\nThey'll appear on the Home tab, active leagues first.`,
            [{ text: 'Done', onPress: () => router.back() }]
          );
        }, 500);
      } else {
        setConnected(true);
        setStatus("Logged in! If your leagues don't appear, add your League ID in Settings.");
        setTimeout(() => {
          Alert.alert(
            'ESPN Logged In',
            "Your ESPN account is connected. If your leagues don't appear automatically, add your League ID in Settings.",
            [{ text: 'Done', onPress: () => router.back() }]
          );
        }, 500);
      }
    } catch {
      setConnecting(false);
      setStatus('Log in to ESPN to connect your leagues');
      Alert.alert('Error', 'Could not connect ESPN. Please try again.');
    }
  };

  // Shares the same persistence path as the WebView flow, so a manually
  // pasted session behaves identically everywhere else in the app.
  const submitManual = async () => {
    const espnS2 = manualS2.trim();
    const swid = manualSwid.trim();
    if (!espnS2 || !swid) return;
    setConnecting(true);
    setStatus('Connecting…');
    try {
      await saveESPNCredentials({ espnS2, swid });
      setConnected(true);
      setStatus('ESPN connected');
      setTimeout(() => router.back(), 900);
    } catch (e: any) {
      setConnecting(false);
      setStatus('Could not save those values. Check for stray spaces and try again.');
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Connect ESPN</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={[styles.statusBar, connected && { backgroundColor: 'rgba(30,140,66,0.18)' }]}>
        {connecting && !connected && <ActivityIndicator color={t.accentText} size="small" style={{ marginRight: 8 }} />}
        {connected && <Text style={{ marginRight: 8, color: '#1e8c42', fontSize: 18 }}>✓</Text>}
        <Text style={[styles.statusText, connected && { color: '#1e8c42' }]}>{status}</Text>
      </View>

      {Platform.OS === 'web' ? (
        // A browser cannot read espn.com's cookies for us: react-native-webview
        // has no web build, and even an iframe is blocked by the same-origin
        // policy. The WebView path is structurally impossible here, so web gets
        // the manual route every ESPN fantasy tool uses.
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.manual}>
          <Text style={styles.mTitle}>Connect ESPN on the web</Text>
          <Text style={styles.mBody}>
            ESPN has no public login for third-party apps, so the app normally signs you in inside
            a secure in-app browser. That is not possible in a web browser, so you can paste the
            two values yourself. It takes about a minute.
          </Text>

          <Text style={styles.mStep}>1. Open fantasy.espn.com and sign in</Text>
          <Text style={styles.mStep}>2. Open developer tools, then Application → Cookies → espn.com</Text>
          <Text style={styles.mStep}>3. Copy the values of <Text style={styles.mCode}>espn_s2</Text> and <Text style={styles.mCode}>SWID</Text></Text>

          <Text style={styles.mLabel}>espn_s2</Text>
          <TextInput
            style={styles.mInput} value={manualS2} onChangeText={setManualS2}
            placeholder="AEB..." placeholderTextColor={t.textMuted}
            autoCapitalize="none" autoCorrect={false} multiline
          />
          <Text style={styles.mLabel}>SWID</Text>
          <TextInput
            style={styles.mInput} value={manualSwid} onChangeText={setManualSwid}
            placeholder="{XXXXXXXX-XXXX-...}" placeholderTextColor={t.textMuted}
            autoCapitalize="none" autoCorrect={false}
          />

          <TouchableOpacity
            style={[styles.mBtn, (!manualS2.trim() || !manualSwid.trim()) && { opacity: 0.45 }]}
            disabled={!manualS2.trim() || !manualSwid.trim() || connecting}
            onPress={submitManual}>
            <Text style={styles.mBtnTxt}>{connecting ? 'Connecting…' : 'Connect ESPN'}</Text>
          </TouchableOpacity>

          <Text style={styles.mFine}>
            These are your ESPN session cookies. They stay in this browser and are sent only to
            ESPN when loading your leagues. Signing out of ESPN invalidates them.
          </Text>
        </ScrollView>
      ) : (
        <WebView
          ref={webViewRef}
          source={{ uri: ESPN_LOGIN_URL }}
          injectedJavaScript={INJECT_SCRIPT}
          onMessage={handleMessage}
          style={styles.webview}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          javaScriptEnabled
          domStorageEnabled
          onNavigationStateChange={() => { webViewRef.current?.injectJavaScript(INJECT_SCRIPT); }}
        />
      )}
    </View>
  );
}

// Themed to match the rest of the app (mirrors mfl-login + fleaflicker-login).
const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  manual:  { padding: 20, paddingBottom: 60 },
  mTitle:  { color: t.text, fontSize: 20, fontWeight: '700', marginBottom: 10 },
  mBody:   { color: t.textSub, fontSize: 14.5, lineHeight: 21, marginBottom: 18 },
  mStep:   { color: t.textSub, fontSize: 14, lineHeight: 22, marginBottom: 4 },
  mCode:   { color: t.accentText, fontFamily: 'SpaceMono_400Regular' },
  mLabel:  { color: t.textMuted, fontSize: 11, letterSpacing: 1, marginTop: 18, marginBottom: 6 },
  mInput:  { backgroundColor: t.inputBg, borderWidth: 1, borderColor: t.border, borderRadius: 10,
             paddingHorizontal: 12, paddingVertical: 11, color: t.text, fontSize: 13.5, minHeight: 44 },
  mBtn:    { backgroundColor: t.accentText, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 22 },
  mBtnTxt: { color: '#0a1214', fontSize: 15, fontWeight: '700' },
  mFine:   { color: t.textMuted, fontSize: 12, lineHeight: 17, marginTop: 16 },
  header: {
    paddingHorizontal: SP[3], paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottomWidth: 1, borderBottomColor: t.border,
    backgroundColor: t.bg,
  },
  backBtn: {},
  backText: { fontFamily: F.mono, color: t.accentText, fontSize: SZ.base, letterSpacing: 0.3 },
  title: { fontFamily: F.bold, color: t.text, fontSize: SZ.lg, letterSpacing: 0.5 },
  statusBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SP[3], paddingVertical: 12,
    backgroundColor: t.card,
    borderBottomWidth: 1, borderBottomColor: t.border,
  },
  statusText: { fontFamily: F.mono, color: t.text, fontSize: SZ.base - 1, flex: 1, lineHeight: 18 },
  webview: { flex: 1, backgroundColor: '#ffffff' },
});
