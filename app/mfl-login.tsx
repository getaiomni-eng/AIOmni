// app/mfl-login.tsx — native API login (v3 2026-07-26)
// v1/v2 loaded MFL's login page in a WebView and sniffed the MFL_USER_ID
// cookie. That broke in the field: MFL's server answered the WebView's
// page loads with Apache 403s on some devices (every network, while
// Safari on the same phone worked), and the failure wasn't reproducible
// from outside. Meanwhile the app's NATIVE fetches to
// api.myfantasyleague.com kept working from the same devices.
//
// So v3 drops the WebView entirely and uses MFL's official login API:
//   POST https://api.myfantasyleague.com/{year}/login  (USERNAME/PASSWORD/XML=1)
//   → <status MFL_USER_ID="...">  on success
//   → <error>...</error>          on bad credentials
// The password goes directly to MFL over HTTPS and is never stored —
// we keep only the MFL_USER_ID session value, same as the old flow.
//
// MFL has host-routing: each league lives on a numbered subdomain
// (www43.myfantasyleague.com, www49, etc). The myleagues response includes
// each league's url, which we parse for host. Stored alongside.
// URL-paste fallback for edge cases remains.

import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setMflCredentials, setMflLeagues } from '../services/platform/mfl';
import { C, F, SP, SZ } from './constants/tokens';

const SEASON = '2026';

type LeagueLite = {
  id: string; name: string; franchiseId: string; host: string;
};

export default function MflLoginScreen() {
  const router       = useRouter();
  const insets       = useSafeAreaInsets();
  const [status,        setStatus]      = useState('Sign in with your MyFantasyLeague account — we’ll find your leagues automatically');
  const [connecting,    setConnecting]  = useState(false);
  const [connected,     setConnected]   = useState(false);
  const [username,      setUsername]    = useState('');
  const [password,      setPassword]    = useState('');
  const [leagueOptions, setLeagueOptions] = useState<LeagueLite[] | null>(null);
  const [fallbackURL,   setFallbackURL] = useState('');
  const [showFallback,  setShowFallback] = useState(false);
  const [apiTrace,      setApiTrace]    = useState<string[]>([]);

  // Official MFL login API. Success returns XML carrying MFL_USER_ID;
  // failure returns <error>reason</error>. POST keeps credentials out of
  // URLs/logs. The password is sent only to MFL and never persisted.
  async function handleLogin() {
    const u = username.trim();
    if (!u || !password) {
      Alert.alert('Missing info', 'Enter your MFL username (or email) and password.');
      return;
    }
    setConnecting(true);
    setStatus('Signing in to MyFantasyLeague...');
    try {
      const res = await fetch(`https://api.myfantasyleague.com/${SEASON}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'AIOmni 1.0',
        },
        body: `USERNAME=${encodeURIComponent(u)}&PASSWORD=${encodeURIComponent(password)}&XML=1`,
      });
      const body = await res.text();
      const ok = body.match(/MFL_USER_ID="([^"]+)"/);
      if (!ok) {
        const err = body.match(/<error>([^<]*)<\/error>/);
        console.log('MFL login failed:', err?.[1] ?? body.slice(0, 200));
        setConnecting(false);
        setStatus(err?.[1] ? `Login failed: ${err[1]}` : 'Login failed — check your username and password.');
        return;
      }
      setPassword('');
      await loadLeagues('api.myfantasyleague.com', { MFL_USER_ID: ok[1] });
    } catch (e: any) {
      console.log('MFL login network error:', e?.message ?? e);
      setConnecting(false);
      setStatus('Could not reach MFL. Check your connection and try again.');
    }
  }

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

      {!leagueOptions && !showFallback && !connected && (
        <View style={styles.loginBox}>
          <Text style={styles.fallbackLabel}>MFL USERNAME OR EMAIL</Text>
          <TextInput
            value={username} onChangeText={setUsername}
            placeholder="username or email" placeholderTextColor={C.dim2}
            autoCapitalize="none" autoCorrect={false} autoComplete="username"
            style={styles.fallbackInput}
          />
          <Text style={styles.fallbackLabel}>PASSWORD</Text>
          <TextInput
            value={password} onChangeText={setPassword}
            placeholder="password" placeholderTextColor={C.dim2}
            secureTextEntry autoCapitalize="none" autoComplete="current-password"
            style={styles.fallbackInput}
            onSubmitEditing={handleLogin}
          />
          <TouchableOpacity
            style={[styles.fallbackBtn, connecting && { opacity: 0.5 }]}
            onPress={handleLogin} disabled={connecting}
          >
            <Text style={styles.fallbackBtnText}>{connecting ? 'SIGNING IN…' : 'SIGN IN'}</Text>
          </TouchableOpacity>
          <Text style={styles.loginNote}>
            Your credentials go directly to MyFantasyLeague over HTTPS. AIOmni
            never stores your password — only the login session, like the
            website does.
          </Text>
        </View>
      )}

      {/* The "paste your league URL instead" escape hatch lives in the
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
  loginBox: {
    padding: SP[3], gap: 12,
  },
  loginNote: {
    fontFamily: F.mono, fontSize: SZ.sm, color: SUB,
    lineHeight: 17, marginTop: 4,
  },

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
