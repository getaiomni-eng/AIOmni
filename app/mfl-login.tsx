// app/mfl-login.tsx — WebView login flow (v2 2026-05-21)
// Mirrors ESPN/Fleaflicker. Loads MFL login → user signs in → JS sniffs
// session cookie (MFL_USER_ID) → calls /export?TYPE=myleagues with cookie
// → presents picker.
//
// MFL has host-routing: each league lives on a numbered subdomain
// (www43.myfantasyleague.com, www49, etc). The myleagues response includes
// each league's url, which we parse for host. Stored alongside.
//
// DIAGNOSTIC PANEL surfaces captured signals so we can iterate without
// rebuilding. URL-paste fallback for edge cases.

import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { setMflCredentials, setMflLeagues } from '../services/platform/mfl';
import { C, F, SP, SZ } from './constants/tokens';

const MFL_LOGIN_URL = 'https://www.myfantasyleague.com/2026/login';
const SEASON = '2026';

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
    function findUsername() {
      var spans = document.querySelectorAll('.username, .user-link, .navbar-text, .userMenuLink');
      for (var i = 0; i < spans.length; i++) {
        var t = (spans[i].textContent || '').trim();
        if (t && t.length > 0 && t.length < 40) return t;
      }
      // Some MFL skins put username in a header label
      var bold = document.querySelectorAll('b, strong');
      for (var i = 0; i < bold.length; i++) {
        var t = (bold[i].textContent || '').trim();
        if (/^[A-Za-z0-9_.-]{3,30}$/.test(t)) return t;
      }
      return null;
    }
    function probe() {
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'probe',
          url: window.location.href,
          cookies: getCookies(),
          username: findUsername(),
          title: document.title || '',
        }));
      } catch (e) {}
    }
    probe();
    setInterval(probe, 1500);
  })();
  true;
`;

type LeagueLite = {
  id: string; name: string; franchiseId: string; host: string;
};

export default function MflLoginScreen() {
  const router       = useRouter();
  const insets       = useSafeAreaInsets();
  const webViewRef   = useRef<any>(null);
  const [status,        setStatus]      = useState('Log in to MyFantasyLeague — we’ll find your leagues automatically');
  const [connecting,    setConnecting]  = useState(false);
  const [connected,     setConnected]   = useState(false);
  const [diagnostic,    setDiagnostic]  = useState<any>(null);
  const [leagueOptions, setLeagueOptions] = useState<LeagueLite[] | null>(null);
  const [fallbackURL,   setFallbackURL] = useState('');
  const [showFallback,  setShowFallback] = useState(false);
  const [apiTrace,      setApiTrace]    = useState<string[]>([]);

  async function loadLeagues(host: string, cookies: Record<string, string>) {
    const trace: string[] = [];
    const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');

    // Try several host variants in order. MFL's session cookie is set
    // host-scoped — if the user landed on www03 but their league lives on
    // www43, the www03 call returns nothing. Walk a few canonical hosts.
    const candidates = Array.from(new Set([
      host,
      'api.myfantasyleague.com',
      'www.myfantasyleague.com',
      'www03.myfantasyleague.com',
    ]));

    try {
      setStatus('Fetching your MFL leagues...');
      let lastBody = '';
      // Aggregate leagues across BOTH the current and prior season, merged
      // by league_id. MFL's myleagues export is year-scoped, so a user with
      // (say) a not-yet-opened 2026 startup AND an active dynasty league
      // still running under 2025 has leagues split across two exports. The
      // old logic stopped at the FIRST season that returned anything,
      // silently dropping every league living under the other year — e.g.
      // grabbing an unopened 2026 league while missing the 2025 league that
      // already drafted. Each league keeps its own season so later API
      // calls hit the right year.
      const seasonCandidates = [SEASON, String(parseInt(SEASON, 10) - 1)];
      const byId = new Map<string, LeagueLite & { season: string }>();
      for (const yr of seasonCandidates) {
        for (const h of candidates) {
          const url = `https://${h}/${yr}/export?TYPE=myleagues&JSON=1`;
          try {
            const res = await fetch(url, {
              headers: { 'User-Agent': 'AIOmni 1.0', 'Cookie': cookieHeader },
            });
            const body = await res.text();
            lastBody = body;
            trace.push(`[${res.status}] ${h} ${yr} — ${body.length}b`);
            if (!res.ok) continue;
            let data: any = null;
            try { data = JSON.parse(body); } catch { trace.push(`  parse fail @ ${h}`); continue; }
            const raw = data?.leagues?.league;
            const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
            const parsed = arr.map((l: any) => {
              const u = String(l.url || '');
              const hm = u.match(/https?:\/\/([^/]+)/);
              return {
                id: String(l.league_id ?? ''),
                name: String(l.name || `League ${l.league_id}`),
                franchiseId: String(l.franchise_id ?? ''),
                host: hm?.[1] ?? h,
                season: yr,
              };
            }).filter((l: LeagueLite & { season: string }) => l.id && l.franchiseId);
            trace.push(`  parsed ${arr.length} entries, ${parsed.length} valid (season ${yr})`);
            if (parsed.length > 0) {
              // Same dynasty league can appear in both exports — keep the
              // most recent season.
              for (const p of parsed) {
                const prev = byId.get(p.id);
                if (!prev || parseInt(p.season, 10) > parseInt(prev.season, 10)) byId.set(p.id, p);
              }
              break; // got this year's leagues from a good host; next year
            }
          } catch (e: any) {
            trace.push(`  fetch err @ ${h}: ${e?.message ?? e}`);
          }
        }
      }
      const opts = Array.from(byId.values());
      setApiTrace(trace);
      if (opts.length === 0) {
        // Surface a slice of the raw body so we can see what MFL actually
        // returned (often an HTML login page, meaning cookie auth failed).
        trace.push(`raw[0..200]: ${lastBody.slice(0, 200)}`);
        setApiTrace([...trace]);
        setStatus('Logged in but no MFL leagues found. Paste your league URL below.');
        setShowFallback(true);
        return;
      }
      // Auto-connect ALL of the user's MFL leagues at once. The previous
      // flow surfaced a picker requiring a single selection — now we just
      // save them all and exit. setLeagueOptions(opts) still happens
      // briefly so the diagnostic panel can disappear if needed.
      await setMflLeagues(opts.map(o => ({
        leagueId: o.id, franchiseId: o.franchiseId, host: o.host, season: o.season,
      })));
      setConnected(true);
      const label = opts.length === 1 ? opts[0].name : `${opts.length} leagues`;
      setStatus(`✓ Connected ${label}`);
      setTimeout(() => {
        Alert.alert(
          '✓ MyFantasyLeague Connected',
          opts.length === 1
            ? `Connected to ${opts[0].name}.`
            : `Connected ${opts.length} leagues:\n• ${opts.map(o => o.name).join('\n• ')}`,
          [{ text: 'Done', onPress: () => router.back() }]
        );
      }, 400);
    } catch (e: any) {
      trace.push(`unexpected: ${e?.message ?? e}`);
      setApiTrace(trace);
      setStatus('Could not load leagues. Paste your league URL below.');
      setShowFallback(true);
    }
  }

  async function saveAndExit(l: LeagueLite) {
    await setMflCredentials({
      leagueId: l.id,
      franchiseId: l.franchiseId,
      season: SEASON,
      host: l.host,
    });
    setConnected(true);
    setStatus(`✓ Connected to ${l.name}`);
    setTimeout(() => {
      Alert.alert(
        '✓ MyFantasyLeague Connected',
        `Connected to ${l.name}.`,
        [{ text: 'Done', onPress: () => router.back() }]
      );
    }, 400);
  }

  function parseLeagueURL(raw: string): { leagueId?: string; franchiseId?: string; host?: string; season?: string } {
    // Examples:
    //   https://www43.myfantasyleague.com/2026/home/53297?F=0001
    //   https://www.myfantasyleague.com/2026/home/53297
    //   www43.myfantasyleague.com/2026/options?L=53297&F=0001
    const hostMatch = raw.match(/(www\d*\.myfantasyleague\.com)/i);
    const lm = raw.match(/(?:home|options)\/(\d+)/) || raw.match(/[?&]L=(\d+)/);
    const fm = raw.match(/[?&]F=(\d+)/);
    const sm = raw.match(/myfantasyleague\.com\/(\d{4})\//);
    return {
      host: hostMatch?.[1],
      leagueId: lm?.[1],
      franchiseId: fm?.[1],
      season: sm?.[1],
    };
  }

  async function submitFallback() {
    const p = parseLeagueURL(fallbackURL.trim());
    if (!p.leagueId) {
      Alert.alert('Bad URL', 'Couldn’t find a league ID. Open your MFL league and paste the URL — should contain /2026/home/<id> or ?L=<id>');
      return;
    }
    if (!p.franchiseId) {
      Alert.alert('Need franchise', 'Open YOUR TEAM page and paste THAT URL — it must contain &F=<your franchise id>');
      return;
    }
    await saveAndExit({
      id: p.leagueId,
      franchiseId: p.franchiseId,
      host: p.host || 'www.myfantasyleague.com',
      name: `League ${p.leagueId}`,
    });
  }

  const handleMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type !== 'probe') return;
      setDiagnostic(data);
      if (connecting || connected || leagueOptions) return;
      // v2.2 (2026-05-21): trust the cookie, not the URL. MFL's /login URL
      // renders the login form even when you're already logged in (the page
      // shows "Logout" link + username at top). MFL_USER_ID cookie is the
      // truth signal.
      const cookies = data.cookies || {};
      const hasMflUser = !!cookies['MFL_USER_ID'];
      if (hasMflUser) {
        setConnecting(true);
        const hostMatch = (data.url || '').match(/https?:\/\/([^/]+)/);
        const host = hostMatch?.[1] || 'www.myfantasyleague.com';
        await loadLeagues(host, cookies);
      }
    } catch {}
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Connect MFL</Text>
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
              onPress={() => saveAndExit(l)}>
              <Text style={styles.leagueName}>{l.name}</Text>
              <Text style={styles.leagueId}>League {l.id} · Franchise {l.franchiseId} · {l.host}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {showFallback && !leagueOptions && (
        <View style={styles.fallbackBox}>
          <Text style={styles.fallbackLabel}>Paste your team URL</Text>
          <TextInput value={fallbackURL} onChangeText={setFallbackURL}
            placeholder="https://www43.myfantasyleague.com/2026/options?L=53297&F=0001"
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
          source={{ uri: MFL_LOGIN_URL }}
          injectedJavaScript={INJECT_SCRIPT}
          onMessage={handleMessage}
          style={styles.webview}
          // v2.3 (2026-07-26): incognito — fresh, non-persistent cookie
          // store per connect. The previous sharedCookiesEnabled setup
          // reused the app-wide cookie jar, so a stale/flagged MFL session
          // from an earlier connect rode along on every request and MFL
          // answered 403 ("You don't have permission…") on any network,
          // while Safari (separate cookies) worked fine. The flow never
          // needed persistent cookies: the probe reads document.cookie
          // in-session and hands MFL_USER_ID to loadLeagues directly.
          incognito
          javaScriptEnabled
          domStorageEnabled
          // Lock navigation to MFL only — prevents the injected probe
          // from running on any third-party page if a redirect ever
          // landed off-domain.
          originWhitelist={['https://*.myfantasyleague.com', 'https://myfantasyleague.com']}
          userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
          // v2.1 (2026-05-21): MFL 301-redirects HTTPS → HTTP, which WKWebView
          // blocks (renders blank). Intercept and force the HTTPS variant.
          onShouldStartLoadWithRequest={(req) => {
            if (req.url.startsWith('http://')) {
              const httpsUrl = req.url.replace(/^http:\/\//, 'https://');
              setTimeout(() => webViewRef.current?.injectJavaScript(
                `window.location.replace(${JSON.stringify(httpsUrl)}); true;`
              ), 0);
              return false;
            }
            try {
              const host = new URL(req.url).hostname;
              if (!/(^|\.)myfantasyleague\.com$/i.test(host)) return false;
            } catch { return false; }
            return true;
          }}
          onNavigationStateChange={() => { webViewRef.current?.injectJavaScript(INJECT_SCRIPT); }}
        />
      )}

      {/* Diagnostic "Captured (for debug)" + API trace panel removed.
          The "paste your league URL instead" escape hatch lives in the
          fallback form above. apiTrace state is still recorded for
          console logs in dev; render guarded behind __DEV__ if needed. */}
    </View>
  );
}

// Dark theme matches the rest of the app so the login flow doesn't
// jarringly switch palettes. Bumped text sizes on league name + meta and
// the success status so they're readable at a glance.
const BG       = '#0a1214';
const CARD     = '#12252e';
const BORDER   = '#1a3542';
const TEXT     = '#f0f4f5';
const SUB      = '#7a9eaa';
const AQUA     = '#1be7ff';
const MINT     = '#1e8c42';

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
  webview: { flex: 1, backgroundColor: '#ffffff' }, // WebView itself stays light (it's MFL's own login page)

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
