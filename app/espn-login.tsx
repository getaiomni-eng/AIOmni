import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { discoverESPNLeagues, saveESPNCredentials } from '../services/espn';
import { C, F, SP, SZ } from './constants/tokens';

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
  const webViewRef = useRef<any>(null);
  const [status,     setStatus]     = useState('Log in to ESPN to connect your leagues');
  const [connecting, setConnecting] = useState(false);
  const [connected,  setConnected]  = useState(false);

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
        {connecting && !connected && <ActivityIndicator color="#1be7ff" size="small" style={{ marginRight: 8 }} />}
        {connected && <Text style={{ marginRight: 8, color: '#1e8c42', fontSize: 18 }}>✓</Text>}
        <Text style={[styles.statusText, connected && { color: '#1e8c42' }]}>{status}</Text>
      </View>

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
    </View>
  );
}

// Dark theme to match the rest of the app (mirrors mfl-login + fleaflicker-login).
const BG     = '#0a1214';
const CARD   = '#12252e';
const BORDER = '#1a3542';
const TEXT   = '#f0f4f5';
const AQUA   = '#1be7ff';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    paddingHorizontal: SP[3], paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottomWidth: 1, borderBottomColor: BORDER,
    backgroundColor: BG,
  },
  backBtn: {},
  backText: { fontFamily: F.mono, color: AQUA, fontSize: SZ.base, letterSpacing: 0.3 },
  title: { fontFamily: F.bold, color: TEXT, fontSize: SZ.lg, letterSpacing: 0.5 },
  statusBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SP[3], paddingVertical: 12,
    backgroundColor: CARD,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  statusText: { fontFamily: F.mono, color: TEXT, fontSize: SZ.base - 1, flex: 1, lineHeight: 18 },
  webview: { flex: 1, backgroundColor: '#ffffff' },
});
