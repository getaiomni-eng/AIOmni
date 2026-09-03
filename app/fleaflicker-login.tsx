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
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { setFleaflickerLeagues, setFleaflickerCredentials } from '../services/platform/fleaflicker';
import { F, SP, SZ, palette } from './constants/tokens';
import { useTheme, type ThemeTokens } from './constants/theme';
import { Alert } from '../services/util/crossAlert';

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
  const { t }        = useTheme();
  const s            = useMemo(() => makeStyles(t), [t]);
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
      // Offseason fallback: try current season first, then walk back a
      // year if FetchUserLeagues returns nothing. Most redraft FF leagues
      // aren't spun up until Aug, so a user connecting in May/Jun gets
      // an empty 2026 set even though they have valid 2025 dynasty
      // teams. Without this they'd connect → see "no leagues" → paste a
      // URL → which is what they meant by "disconnect right away."
      const seasonCandidates = [SEASON, SEASON - 1];
      let opts: LeagueLite[] = [];
      let usedSeason = SEASON;
      for (const s of seasonCandidates) {
        const url = `https://www.fleaflicker.com/api/FetchUserLeagues?email=${encodeURIComponent(email)}&sport=NFL&season=${s}`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        const leagues = Array.isArray(data?.leagues) ? data.leagues : [];
        opts = leagues.map((l: any) => ({
          id: String(l.id),
          name: l.name ?? `League ${l.id}`,
          teamId: String(l.ownedTeam?.id ?? ''),
        })).filter((l: LeagueLite) => l.id && l.teamId);
        if (opts.length > 0) { usedSeason = s; break; }
      }
      if (opts.length === 0) {
        setStatus(`No leagues found under ${email} for ${SEASON} or ${SEASON - 1}. Paste your league URL below.`);
        setShowFallback(true);
        return;
      }
      if (usedSeason !== SEASON) {
        setStatus(`Found ${opts.length} ${usedSeason} league${opts.length > 1 ? 's' : ''} (no ${SEASON} leagues drafted yet).`);
      }
      // Auto-connect ALL of the user's Fleaflicker leagues at once. The
      // previous flow surfaced a picker and the user had to pick a single
      // league — now we just save them all and exit.
      await setFleaflickerLeagues(opts.map(o => ({ leagueId: o.id, teamId: o.teamId })));
      setConnected(true);
      const label = opts.length === 1
        ? opts[0].name
        : `${opts.length} leagues`;
      setStatus(`✓ Connected ${label}`);
      setTimeout(() => {
        Alert.alert(
          '✓ Fleaflicker Connected',
          opts.length === 1
            ? `Connected to ${opts[0].name}.`
            : `Connected ${opts.length} leagues:\n• ${opts.map(o => o.name).join('\n• ')}`,
          [{ text: 'Done', onPress: () => router.back() }]
        );
      }, 400);
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
          // Same offseason fallback as loadLeaguesByEmail above.
          let opts: LeagueLite[] = [];
          for (const s of [SEASON, SEASON - 1]) {
            const url = `https://www.fleaflicker.com/api/FetchUserLeagues?userId=${data.userId}&sport=NFL&season=${s}`;
            const r = await fetch(url);
            if (!r.ok) continue;
            const j = await r.json();
            const leagues = Array.isArray(j?.leagues) ? j.leagues : [];
            opts = leagues.map((l: any) => ({
              id: String(l.id), name: l.name ?? `League ${l.id}`,
              teamId: String(l.ownedTeam?.id ?? ''),
            })).filter((l: LeagueLite) => l.id && l.teamId);
            if (opts.length > 0) break;
          }
          if (opts.length > 0) {
            await setFleaflickerLeagues(opts.map(o => ({ leagueId: o.id, teamId: o.teamId })));
            setConnected(true);
            const label = opts.length === 1 ? opts[0].name : `${opts.length} leagues`;
            setStatus(`✓ Connected ${label}`);
            setTimeout(() => {
              Alert.alert(
                '✓ Fleaflicker Connected',
                opts.length === 1
                  ? `Connected to ${opts[0].name}.`
                  : `Connected ${opts.length} leagues:\n• ${opts.map(o => o.name).join('\n• ')}`,
                [{ text: 'Done', onPress: () => router.back() }]
              );
            }, 400);
            return;
          }
        } catch {}
        setStatus('Logged in but couldn’t fetch leagues automatically. Paste your league URL below.');
        setShowFallback(true);
      }
    } catch {}
  };

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>← Cancel</Text>
        </TouchableOpacity>
        <Text style={s.title}>Connect Fleaflicker</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={[s.statusBar, connected && { backgroundColor: 'rgba(30,140,66,0.18)' }]}>
        {connecting && !connected && <ActivityIndicator color={t.accentText} size="small" style={{ marginRight: 8 }} />}
        {connected && <Text style={{ marginRight: 8, color: '#1e8c42', fontSize: 18 }}>✓</Text>}
        <Text style={[s.statusText, connected && { color: '#1e8c42' }]}>{status}</Text>
      </View>

      {leagueOptions && (
        <ScrollView style={s.leagueList}>
          {leagueOptions.map(l => (
            <TouchableOpacity key={l.id} style={s.leagueRow}
              onPress={() => saveAndExit(l.id, l.teamId, l.name)}>
              <Text style={s.leagueName}>{l.name}</Text>
              <Text style={s.leagueId}>League {l.id} · Team {l.teamId}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {showFallback && !leagueOptions && (
        <View style={s.fallbackBox}>
          <Text style={s.fallbackLabel}>Paste your team URL</Text>
          <TextInput value={fallbackURL} onChangeText={setFallbackURL}
            placeholder="https://www.fleaflicker.com/nfl/leagues/.../teams/..."
            placeholderTextColor={t.textMuted}
            autoCapitalize="none" autoCorrect={false} style={s.fallbackInput}
          />
          <TouchableOpacity style={s.fallbackBtn} onPress={submitFallback}>
            <Text style={s.fallbackBtnText}>Connect</Text>
          </TouchableOpacity>
        </View>
      )}

      {!leagueOptions && !showFallback && (
        <WebView
          ref={webViewRef}
          source={{ uri: FLEAFLICKER_LOGIN_URL }}
          injectedJavaScript={INJECT_SCRIPT}
          onMessage={handleMessage}
          style={s.webview}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          javaScriptEnabled
          domStorageEnabled
          // Lock navigation to Fleaflicker only — if the WebView ever
          // got redirected to a third-party page (ad, OAuth provider,
          // typo'd link), our injected probe could leak DOM data there.
          originWhitelist={['https://*.fleaflicker.com', 'https://fleaflicker.com']}
          userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
          onShouldStartLoadWithRequest={(req) => {
            // Upgrade any http:// to https:// — Fleaflicker has occasional
            // mixed-content redirects.
            if (req.url.startsWith('http://')) {
              const httpsUrl = req.url.replace(/^http:\/\//, 'https://');
              setTimeout(() => webViewRef.current?.injectJavaScript(
                `window.location.replace(${JSON.stringify(httpsUrl)}); true;`
              ), 0);
              return false;
            }
            // Defense-in-depth: only allow fleaflicker.com hosts to load.
            try {
              const host = new URL(req.url).hostname;
              if (!/(^|\.)fleaflicker\.com$/i.test(host)) return false;
            } catch { return false; }
            return true;
          }}
          onNavigationStateChange={() => { webViewRef.current?.injectJavaScript(INJECT_SCRIPT); }}
        />
      )}

      {/* Diagnostic "Captured (for debug)" panel was removed once the
          login flow proved stable. If a future regression needs it back,
          render based on diagnostic state and a __DEV__ guard. The
          "paste your league URL" escape hatch lives inside the fallback
          form above instead. */}
    </View>
  );
}

// Dark theme to match the rest of the app (mirrors mfl-login.tsx). The
// WebView itself stays white because that's Fleaflicker's own login page,
// but everything we render around it (header, status bar, league list,
// fallback inputs, diagnostic) now uses the dark palette.
const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
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

  leagueList: { flex: 1, backgroundColor: t.bg },
  leagueRow: {
    paddingHorizontal: SP[3], paddingVertical: 18,
    borderBottomWidth: 1, borderBottomColor: t.border,
    backgroundColor: t.card,
    marginHorizontal: SP[2], marginTop: 10,
    borderRadius: 12,
  },
  leagueName: { fontFamily: F.bold, fontSize: SZ.lg, color: t.text, letterSpacing: 0.3 },
  leagueId:   { fontFamily: F.mono, fontSize: SZ.sm, color: t.textSub, marginTop: 6 },

  fallbackBox: {
    padding: SP[3], gap: 12, backgroundColor: t.card,
    borderTopWidth: 1, borderTopColor: t.border,
  },
  fallbackLabel: { fontFamily: F.mono, fontSize: SZ.sm, color: t.textSub, letterSpacing: 0.5 },
  fallbackInput: {
    fontFamily: F.mono, fontSize: SZ.base, color: t.text,
    borderWidth: 1, borderColor: t.border,
    borderRadius: 10, padding: 14, backgroundColor: t.bg,
  },
  fallbackBtn: {
    backgroundColor: palette.aqua, padding: 16, borderRadius: 10, alignItems: 'center',
  },
  fallbackBtnText: { fontFamily: F.bold, color: '#0a1214', fontSize: SZ.base, letterSpacing: 1 },

  diagBox: {
    maxHeight: 220, backgroundColor: 'rgba(255,184,0,0.06)',
    borderTopWidth: 1, borderTopColor: t.border,
  },
  diagTitle: { fontFamily: F.mono, fontSize: SZ.sm, color: t.warnText, marginBottom: 4, letterSpacing: 0.5 },
  diagLine:  { fontFamily: F.mono, fontSize: 11, color: t.text, marginBottom: 2, lineHeight: 15 },
  diagLink:  { fontFamily: F.mono, fontSize: SZ.sm, color: t.accentText, textDecorationLine: 'underline', marginTop: 8 },
});
