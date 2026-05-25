// app/fleaflicker-login.tsx — WebView login flow (v2 2026-05-21)
// Mirrors the ESPN pattern: load fleaflicker.com/login, sniff cookies +
// scrape user identity from the post-login DOM, then call the user-leagues
// API and present a picker.
//
// DIAGNOSTIC MODE: until we've validated the exact cookie names and DOM
// hooks on real accounts, this screen surfaces every captured signal in a
// "Captured" panel so the user can copy + share. Also includes a
// "Paste URL instead" fallback for users where auto-detection misses.
//
// API used post-auth (no auth needed!):
//   GET fleaflicker.com/api/FetchUserLeagues?email=<email>&sport=NFL&season=2026

import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { setFleaflickerCredentials } from '../services/platform/fleaflicker';
import { C, F, SP, SZ } from './constants/tokens';

const FLEAFLICKER_LOGIN_URL = 'https://www.fleaflicker.com/nfl/login';
const SEASON = 2026;

// Polls every 1.5s. Sniffs cookies and tries to find the logged-in user's
// email from the masthead / account menu / mailto links. Posts every found
// signal back to RN — RN decides what to do with it.
const INJECT_SCRIPT = `
  (function() {
    function getCookies() {
      var out = {};
      (document.cookie || '').split(';').forEach(function(c) {
        var idx = c.indexOf('=');
        if (idx > 0) out[c.substring(0,idx).trim()] = c.substring(idx+1).trim();
      });
      return out;
    }
    function findEmail() {
      var mail = document.querySelector('a[href^="mailto:"]');
      if (mail) {
        var addr = mail.getAttribute('href').replace(/^mailto:/, '').trim();
        if (addr.indexOf('@') > 0) return addr;
      }
      var body = document.body;
      if (body) {
        var em = body.getAttribute('data-user-email') || body.getAttribute('data-email');
        if (em && em.indexOf('@') > 0) return em;
      }
      var spans = document.querySelectorAll('.dropdown-toggle, .navbar-text, .user-menu, .account-menu, .username');
      for (var i = 0; i < spans.length; i++) {
        var t = (spans[i].textContent || '').trim();
        var m = t.match(/[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+/);
        if (m) return m[0];
      }
      return null;
    }
    function findUserId() {
      var anchors = document.querySelectorAll('a[href*="/users/"]');
      for (var i = 0; i < anchors.length; i++) {
        var href = anchors[i].getAttribute('href') || '';
        var m = href.match(/\\/users\\/(\\d+)/);
        if (m) return m[1];
      }
      return null;
    }
    function probe() {
      var payload = {
        type: 'probe',
        url: window.location.href,
        cookies: getCookies(),
        email: findEmail(),
        userId: findUserId(),
        title: document.title || '',
      };
      try { window.ReactNativeWebView.postMessage(JSON.stringify(payload)); } catch (e) {}
    }
    probe();
    setInterval(probe, 1500);
  })();
  true;
`;

type LeagueLite = { id: string; name: string; teamId: string };

export default function FleaflickerLoginScreen() {
  const router       = useRouter();
  const insets       = useSafeAreaInsets();
  const webViewRef   = useRef<any>(null);
  const [status,        setStatus]      = useState('Log in to Fleaflicker — we’ll find your leagues automatically');
  const [connecting,    setConnecting]  = useState(false);
  const [connected,     setConnected]   = useState(false);
  const [diagnostic,    setDiagnostic]  = useState<any>(null);
  const [leagueOptions, setLeagueOptions] = useState<LeagueLite[] | null>(null);
  const [fallbackURL,   setFallbackURL] = useState('');
  const [showFallback,  setShowFallback] = useState(false);

  async function loadLeaguesByEmail(email: string) {
    try {
      setStatus(`Fetching leagues for ${email}...`);
      const url = `https://www.fleaflicker.com/api/FetchUserLeagues?email=${encodeURIComponent(email)}&sport=NFL&season=${SEASON}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const leagues = Array.isArray(data?.leagues) ? data.leagues : [];
      const opts: LeagueLite[] = leagues.map((l: any) => ({
        id: String(l.id),
        name: l.name ?? `League ${l.id}`,
        teamId: String(l.ownedTeam?.id ?? ''),
      })).filter((l: LeagueLite) => l.id && l.teamId);
      if (opts.length === 0) {
        setStatus(`No leagues found under ${email}. Paste your league URL below.`);
        setShowFallback(true);
        return;
      }
      setLeagueOptions(opts);
      setStatus(`Found ${opts.length} league${opts.length > 1 ? 's' : ''} — tap one to connect.`);
    } catch {
      setStatus('Could not load leagues. Paste your league URL below.');
      setShowFallback(true);
    }
  }

  async function saveAndExit(leagueId: string, teamId: string, label: string) {
    await setFleaflickerCredentials(leagueId, teamId);
    setConnected(true);
    setStatus(`✓ Connected to ${label}`);
    setTimeout(() => {
      Alert.alert(
        '✓ Fleaflicker Connected',
        `Connected to ${label}.`,
        [{ text: 'Done', onPress: () => router.back() }]
      );
    }, 400);
  }

  function parseLeagueURL(raw: string): { leagueId?: string; teamId?: string } {
    const lm = raw.match(/leagues\/(\d+)/);
    const tm = raw.match(/teams\/(\d+)/);
    return { leagueId: lm?.[1], teamId: tm?.[1] };
  }

  async function submitFallback() {
    const { leagueId, teamId } = parseLeagueURL(fallbackURL.trim());
    if (!leagueId) {
      Alert.alert('Bad URL', 'Couldn’t find a league ID. The URL should look like fleaflicker.com/nfl/leagues/324106');
      return;
    }
    if (!teamId) {
      Alert.alert('Need team URL', 'Open your team in Fleaflicker and paste THAT URL — it should look like fleaflicker.com/nfl/leagues/324106/teams/1655757');
      return;
    }
    await saveAndExit(leagueId, teamId, `League ${leagueId}`);
  }

  const handleMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type !== 'probe') return;
      setDiagnostic(data);
      if (connecting || connected || leagueOptions) return;
      const onLogin = /\/login/i.test(data.url || '');
      if (onLogin) return; // still on login page, keep waiting
      if (data.email) {
        setConnecting(true);
        await loadLeaguesByEmail(data.email);
      } else if (data.userId) {
        try {
          setConnecting(true);
          const url = `https://www.fleaflicker.com/api/FetchUserLeagues?userId=${data.userId}&sport=NFL&season=${SEASON}`;
          const r = await fetch(url);
          if (r.ok) {
            const j = await r.json();
            const leagues = Array.isArray(j?.leagues) ? j.leagues : [];
            const opts: LeagueLite[] = leagues.map((l: any) => ({
              id: String(l.id), name: l.name ?? `League ${l.id}`,
              teamId: String(l.ownedTeam?.id ?? ''),
            })).filter((l: LeagueLite) => l.id && l.teamId);
            if (opts.length > 0) {
              setLeagueOptions(opts);
              setStatus(`Found ${opts.length} league${opts.length > 1 ? 's' : ''} — tap one to connect.`);
              return;
            }
          }
        } catch {}
        setStatus('Logged in but couldn’t fetch leagues automatically. Paste your league URL below.');
        setShowFallback(true);
      }
    } catch {}
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Connect Fleaflicker</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={[styles.statusBar, connected && { backgroundColor: 'rgba(30,140,66,0.18)' }]}>
        {connecting && !connected && <ActivityIndicator color="#1be7ff" size="small" style={{ marginRight: 8 }} />}
        {connected && <Text style={{ marginRight: 8, color: '#1e8c42', fontSize: 18 }}>✓</Text>}
        <Text style={[styles.statusText, connected && { color: '#1e8c42' }]}>{status}</Text>
      </View>

      {leagueOptions && (
        <ScrollView style={styles.leagueList}>
          {leagueOptions.map(l => (
            <TouchableOpacity key={l.id} style={styles.leagueRow}
              onPress={() => saveAndExit(l.id, l.teamId, l.name)}>
              <Text style={styles.leagueName}>{l.name}</Text>
              <Text style={styles.leagueId}>League {l.id} · Team {l.teamId}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {showFallback && !leagueOptions && (
        <View style={styles.fallbackBox}>
          <Text style={styles.fallbackLabel}>Paste your team URL</Text>
          <TextInput value={fallbackURL} onChangeText={setFallbackURL}
            placeholder="https://www.fleaflicker.com/nfl/leagues/.../teams/..."
            placeholderTextColor={C.dim2}
            autoCapitalize="none" autoCorrect={false} style={styles.fallbackInput}
          />
          <TouchableOpacity style={styles.fallbackBtn} onPress={submitFallback}>
            <Text style={styles.fallbackBtnText}>Connect</Text>
          </TouchableOpacity>
        </View>
      )}

      {!leagueOptions && !showFallback && (
        <WebView
          ref={webViewRef}
          source={{ uri: FLEAFLICKER_LOGIN_URL }}
          injectedJavaScript={INJECT_SCRIPT}
          onMessage={handleMessage}
          style={styles.webview}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          javaScriptEnabled
          domStorageEnabled
          userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
          onShouldStartLoadWithRequest={(req) => {
            if (req.url.startsWith('http://')) {
              const httpsUrl = req.url.replace(/^http:\/\//, 'https://');
              setTimeout(() => webViewRef.current?.injectJavaScript(
                `window.location.replace(${JSON.stringify(httpsUrl)}); true;`
              ), 0);
              return false;
            }
            return true;
          }}
          onNavigationStateChange={() => { webViewRef.current?.injectJavaScript(INJECT_SCRIPT); }}
        />
      )}

      {diagnostic && !leagueOptions && !connected && (
        <ScrollView style={styles.diagBox} contentContainerStyle={{ padding: 10 }}>
          <Text style={styles.diagTitle}>Captured (for debug)</Text>
          <Text style={styles.diagLine}>url: {diagnostic.url}</Text>
          {diagnostic.email && <Text style={styles.diagLine}>email: {diagnostic.email}</Text>}
          {diagnostic.userId && <Text style={styles.diagLine}>userId: {diagnostic.userId}</Text>}
          <Text style={styles.diagLine}>cookies: {Object.keys(diagnostic.cookies || {}).join(', ') || '(none)'}</Text>
          <TouchableOpacity onPress={() => setShowFallback(true)} style={{ marginTop: 6 }}>
            <Text style={styles.diagLink}>Trouble? Paste your league URL instead →</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

// Dark theme to match the rest of the app (mirrors mfl-login.tsx). The
// WebView itself stays white because that's Fleaflicker's own login page,
// but everything we render around it (header, status bar, league list,
// fallback inputs, diagnostic) now uses the dark palette.
const BG       = '#0a1214';
const CARD     = '#12252e';
const BORDER   = '#1a3542';
const TEXT     = '#f0f4f5';
const SUB      = '#7a9eaa';
const AQUA     = '#1be7ff';

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

  leagueList: { flex: 1, backgroundColor: BG },
  leagueRow: {
    paddingHorizontal: SP[3], paddingVertical: 18,
    borderBottomWidth: 1, borderBottomColor: BORDER,
    backgroundColor: CARD,
    marginHorizontal: SP[2], marginTop: 10,
    borderRadius: 12,
  },
  leagueName: { fontFamily: F.bold, fontSize: SZ.lg, color: TEXT, letterSpacing: 0.3 },
  leagueId:   { fontFamily: F.mono, fontSize: SZ.sm, color: SUB, marginTop: 6 },

  fallbackBox: {
    padding: SP[3], gap: 12, backgroundColor: CARD,
    borderTopWidth: 1, borderTopColor: BORDER,
  },
  fallbackLabel: { fontFamily: F.mono, fontSize: SZ.sm, color: SUB, letterSpacing: 0.5 },
  fallbackInput: {
    fontFamily: F.mono, fontSize: SZ.base, color: TEXT,
    borderWidth: 1, borderColor: BORDER,
    borderRadius: 10, padding: 14, backgroundColor: BG,
  },
  fallbackBtn: {
    backgroundColor: AQUA, padding: 16, borderRadius: 10, alignItems: 'center',
  },
  fallbackBtnText: { fontFamily: F.bold, color: BG, fontSize: SZ.base, letterSpacing: 1 },

  diagBox: {
    maxHeight: 220, backgroundColor: 'rgba(255,184,0,0.06)',
    borderTopWidth: 1, borderTopColor: BORDER,
  },
  diagTitle: { fontFamily: F.mono, fontSize: SZ.sm, color: '#ffb800', marginBottom: 4, letterSpacing: 0.5 },
  diagLine:  { fontFamily: F.mono, fontSize: 11, color: TEXT, marginBottom: 2, lineHeight: 15 },
  diagLink:  { fontFamily: F.mono, fontSize: SZ.sm, color: AQUA, textDecorationLine: 'underline', marginTop: 8 },
});
