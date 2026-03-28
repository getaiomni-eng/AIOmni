import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { ESPN_SEASON, saveESPNCredentials } from '../services/espn';
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

export function ESPNLoginScreen({ navigation }: any) {
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
      const BASE  = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
      const res   = await fetch(`${BASE}/seasons/${ESPN_SEASON}/segments/0/leagues?view=mSettings`, {
        headers: { 'Content-Type': 'application/json', Cookie: `espn_s2=${creds.espnS2}; SWID=${creds.swid}` },
      });

      let leagueIds: number[]   = [];
      let leagueNames: string[] = [];

      if (res.ok) {
        const leaguesData = await res.json();
        const leagues = Array.isArray(leaguesData) ? leaguesData : [leaguesData].filter(Boolean);
        leagueIds   = leagues.map((l: any) => l.id).filter(Boolean);
        leagueNames = leagues.map((l: any) => l.settings?.name || `ESPN League ${l.id}`);
      }

      if (leagueIds.length === 0) {
        const stored = await AsyncStorage.getItem('espn_league_ids');
        if (stored) leagueIds = JSON.parse(stored);
      }

      await saveESPNCredentials(creds);

      if (leagueIds.length > 0) {
        await AsyncStorage.setItem('espn_league_ids', JSON.stringify(leagueIds));
        if (leagueNames.length > 0) await AsyncStorage.setItem('espn_league_name', leagueNames[0]);
        setConnected(true);
        setStatus(`Connected! Found ${leagueIds.length} league${leagueIds.length !== 1 ? 's' : ''}.`);
        setTimeout(() => {
          Alert.alert(
            'ESPN Connected!',
            `Found ${leagueIds.length} league${leagueIds.length !== 1 ? 's' : ''}. Your ESPN leagues will now appear on the Home tab.`,
            [{ text: 'Done', onPress: () => navigation.goBack() }]
          );
        }, 500);
      } else {
        setConnected(true);
        setStatus("Logged in! If your leagues don't appear, add your League ID in Settings.");
        setTimeout(() => {
          Alert.alert(
            'ESPN Logged In',
            "Your ESPN account is connected. If your leagues don't appear automatically, you can add your League ID in Settings.",
            [{ text: 'Done', onPress: () => navigation.goBack() }]
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
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Connect ESPN</Text>
      </View>

      <View style={styles.statusBar}>
        {connecting && !connected && <ActivityIndicator color={C.gold} size="small" style={{ marginRight: 8 }} />}
        {connected && <Text style={{ marginRight: 8 }}>✅</Text>}
        <Text style={[styles.statusText, connected && { color: C.sage }]}>{status}</Text>
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

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: C.bgBot },
  header:     { paddingHorizontal: SP[3], paddingVertical: 12, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  backBtn:    { marginRight: 16 },
  backText:   { fontFamily: F.outfit, color: C.gold, fontSize: SZ.base },
  title:      { fontFamily: F.bold, color: C.ink, fontSize: SZ.lg },
  statusBar:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP[3], paddingVertical: 10, backgroundColor: 'rgba(255,255,255,0.06)', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  statusText: { fontFamily: F.mono, color: C.dim, fontSize: SZ.sm, flex: 1 },
  webview:    { flex: 1 },
});