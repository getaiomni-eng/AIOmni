import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../services/supabase';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { signOut } from '../../services/auth';
import { deleteAccount } from '../../services/deleteAccount';
import { clearESPNCredentials, loadESPNCredentials } from '../../services/espn';
import { loadYahooTokens } from '../../services/yahoo';
import { getNotificationPrefs, setNotificationPrefs } from '../../services/notifications';
import { clearQuizResult } from '../../services/quiz/engine';
import { F, palette, SP } from '../constants/tokens';
import { AI_DISCLOSURE, getAIConsent, setAIConsent } from '../../services/aiConsent';
import { useTheme, type ThemeTokens } from '../constants/theme';

// Yahoo gated their Fantasy Sports API behind manual approval in late July
// 2026. Every fantasy endpoint 403s ("This application is not authorized to
// perform this action") for ALL third-party apps pending review — both our
// client IDs, valid tokens, public endpoints included. Application submitted
// via sports.yahoo.com/developer/access/. Flip to false on approval.
const YAHOO_API_AWAITING_APPROVAL = true;

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [espnLinked, setEspnLinked] = useState(false);
  const [yahooLinked, setYahooLinked] = useState(false);
  const [mflLinked, setMflLinked] = useState(false);
  const [fleaflickerLinked, setFleaflickerLinked] = useState(false);
  const { t, isDark, setMode } = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const [aiConsent, setAiConsent] = useState(false);

  useEffect(() => {
    getAIConsent().then(v => setAiConsent(v === 'granted'));
  }, []);
  const [prefPlayerNews, setPrefPlayerNews]       = useState(true);
  const [prefLineupWarning, setPrefLineupWarning] = useState(true);
  const [prefPulseAlerts, setPrefPulseAlerts]     = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  // v2026-05-21: re-read connection state every time Settings comes into
  // focus. Without this, returning from /fleaflicker-login or /mfl-login
  // leaves the row showing "Connect →" even after successful save.
  useFocusEffect(useCallback(() => { loadSettings(); }, []));

  const loadSettings = async () => {
    // ESPN/Yahoo auth tokens live in SecureStore (keychain) since the
    // 2026-05-26 security hardening — read via their service loaders, not
    // AsyncStorage. MFL/Fleaflicker only stash a league ID (not a token),
    // so they stay in AsyncStorage.
    const espn = await loadESPNCredentials();
    setEspnLinked(!!espn);
    const yahoo = await loadYahooTokens();
    setYahooLinked(!!yahoo);
    const mfl = await AsyncStorage.getItem('mfl_league_id');
    setMflLinked(!!mfl);
    const ff = await AsyncStorage.getItem('fleaflicker_league_id');
    setFleaflickerLinked(!!ff);

    // Email + Sleeper username come from public.users (source of truth).
    // AsyncStorage is the offline fallback — we read it first as a fast
    // local hint, then overwrite with the canonical DB values.
    try {
      const cachedUser = await AsyncStorage.getItem('user_email');
      const cachedSleeper = await AsyncStorage.getItem('sleeper_username');
      if (cachedUser) setEmail(cachedUser);
      if (cachedSleeper) setUsername(cachedSleeper);

      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return;

      const { data: row } = await supabase
        .from('users')
        .select('email, sleeper_username')
        .eq('auth_id', user.id)
        .maybeSingle();

      if (row?.email) {
        setEmail(row.email);
        // Refresh AsyncStorage cache for next cold start
        await AsyncStorage.setItem('user_email', row.email);
      } else if (user.email) {
        // Fallback to auth user email if public.users.email is somehow null
        setEmail(user.email);
        await AsyncStorage.setItem('user_email', user.email);
      }

      if (row?.sleeper_username) {
        setUsername(row.sleeper_username);
        await AsyncStorage.setItem('sleeper_username', row.sleeper_username);
      }

      // Notification opt-in flags (defaults to all-on for a fresh user).
      const prefs = await getNotificationPrefs(user.id);
      setPrefPlayerNews(prefs.player_news);
      setPrefLineupWarning(prefs.lineup_warning);
      setPrefPulseAlerts(prefs.pulse_alerts);
    } catch (e) {
      // Network failure or DB error — AsyncStorage values already shown above
      console.warn('loadSettings: falling back to cached values', e);
    }
  };

  const handleSignOut = async () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive', onPress: async () => {
          await signOut();
          await AsyncStorage.multiRemove(['sleeper_username', 'user_email']);
          router.replace('/onboarding');
        }
      },
    ]);
  };

  // Two-step destructive confirmation. Apple's review team specifically
  // looks for "Delete Account" in settings; rejected submissions cite
  // 5.1.1(v).
  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account?',
      'This will permanently remove your account, league connections, AI Coach memory, prompt history, and rostered-player cache. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue', style: 'destructive', onPress: () => {
            Alert.alert(
              'Are you absolutely sure?',
              'Last chance. Tap "Delete Forever" to permanently delete your AIOmni account.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete Forever', style: 'destructive', onPress: async () => {
                    const res = await deleteAccount();
                    if (res.ok) {
                      await AsyncStorage.clear();
                      Alert.alert('Account Deleted', 'Your account has been removed.');
                      router.replace('/onboarding');
                    } else {
                      Alert.alert('Deletion Failed', res.error ?? 'Please try again or contact support.');
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  };

  const handleRetakeQuiz = () => {
    Alert.alert(
      'Retake Custom Rankings Quiz?',
      'Your current personalized rankings will be cleared. You can take the quiz again to rebuild them.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Retake',
          style: 'destructive',
          onPress: async () => {
            await clearQuizResult();
            router.push('/quiz' as any);
          },
        },
      ],
    );
  };

  const handleDisconnectESPN = () => {
    Alert.alert('Disconnect ESPN', 'Remove ESPN credentials?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: async () => { await clearESPNCredentials(); setEspnLinked(false); } },
    ]);
  };

  const handleDisconnectYahoo = () => {
    Alert.alert('Disconnect Yahoo', 'Remove Yahoo connection?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: async () => { const { clearYahooTokens } = require('../../services/yahoo'); await clearYahooTokens(); setYahooLinked(false); } },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SP[3], paddingTop: insets.top + 16, paddingBottom: 100 }}>
        
        <Text style={s.title}>SETTINGS</Text>

        {/* Account */}
        <Text style={s.sectionTitle}>ACCOUNT</Text>
        <View style={s.card}>
          <View style={s.row}>
            <Ionicons name="mail-outline" size={20} color={t.accentText} />
            <Text style={s.rowLabel}>Email</Text>
            <Text style={s.rowValue}>{email || 'Not set'}</Text>
          </View>
          <View style={[s.row, { borderBottomWidth: 0 }]}>
            <Ionicons name="lock-closed-outline" size={20} color={t.accentText} />
            <Text style={s.rowLabel}>Password</Text>
            <Text style={s.rowValue}>••••••••</Text>
          </View>
        </View>

        {/* Platforms */}
        <Text style={s.sectionTitle}>MY PLATFORMS</Text>
        <View style={s.card}>
          <TouchableOpacity style={s.row} onPress={() => {
            Alert.prompt(
              'Sleeper Username',
              'Enter your Sleeper username (without @)',
              async (text) => {
                if (text && text.trim()) {
                  const clean = text.trim().replace('@', '');
                  try {
                    const res = await fetch('https://api.sleeper.app/v1/user/' + clean);
                    const data = await res.json();
                    if (data && data.user_id) {
                      await AsyncStorage.setItem('sleeper_username', clean);
                      setUsername(clean);
                      Alert.alert('Connected', 'Sleeper account @' + clean + ' linked successfully.');
                    } else {
                      Alert.alert('Not Found', 'No Sleeper user found with that username.');
                    }
                  } catch {
                    Alert.alert('Error', 'Could not verify username. Try again.');
                  }
                }
              },
              'plain-text',
              username || ''
            );
          }}>
            <View style={[s.dot, { backgroundColor: '#00FFF9' }]} />
            <Text style={s.rowLabel}>Sleeper</Text>
            <Text style={[s.rowValue, { color: username ? t.successText : t.warnText }]}>{username ? 'Connected' : 'Connect →'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.row} onPress={espnLinked ? handleDisconnectESPN : () => router.push('/espn-login' as any)}>
            <View style={[s.dot, { backgroundColor: '#e52534' }]} />
            <Text style={s.rowLabel}>ESPN</Text>
            <Text style={[s.rowValue, { color: espnLinked ? t.successText : t.warnText }]}>{espnLinked ? 'Connected' : 'Connect →'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.row} onPress={yahooLinked ? handleDisconnectYahoo : async () => {
              try {
                const { getYahooAuthURL, exchangeYahooCode, getValidYahooToken } = require('../../services/yahoo');
                const WebBrowser = require('expo-web-browser');
                const authUrl = await getYahooAuthURL();
                // preferEphemeralSession: without it the auth sheet shares Safari's
                // cookies, so a stale Yahoo session gets silently auto-approved and
                // returns a code bound to the OLD grant. The user sees "Yahoo
                // Connected!", a token is stored, and then zero leagues load — with
                // no error anywhere. The only escape was signing out of Yahoo in
                // mobile Safari first, which nobody will ever guess. An ephemeral
                // session carries no cookies, so Yahoo always shows a real login.
                const result = await WebBrowser.openAuthSessionAsync(
                  authUrl,
                  'aiomnifantasy://oauth/yahoo',
                  { preferEphemeralSession: true },
                );
                if (result.type === 'success' && result.url) {
                  const parsed = new URL(result.url);
                  const code = parsed.searchParams.get('code');
                  if (code) {
                    await exchangeYahooCode(code);
                    setYahooLinked(true);
                    Alert.alert('Yahoo Connected!', 'Your Yahoo leagues will appear on the Home tab.');
                  }
                }
              } catch (err: any) { Alert.alert('Yahoo Error', err.message || 'Failed to connect'); }
            }}>
            <View style={[s.dot, { backgroundColor: '#7c3aed' }]} />
            <Text style={s.rowLabel}>Yahoo</Text>
            <Text style={[s.rowValue, { color: yahooLinked ? (YAHOO_API_AWAITING_APPROVAL ? t.warnText : t.successText) : t.warnText }]}>{yahooLinked ? (YAHOO_API_AWAITING_APPROVAL ? 'Awaiting Yahoo approval' : 'Connected') : 'Connect →'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.row} onPress={mflLinked
            ? () => Alert.alert('MFL', 'Disconnect MFL?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Disconnect', style: 'destructive', onPress: async () => {
                  const { clearMflCredentials } = require('../../services/platform/mfl');
                  await clearMflCredentials();
                  setMflLinked(false);
                }},
              ])
            : () => router.push('/mfl-login' as any)}>
            <View style={[s.dot, { backgroundColor: '#e4ff1a' }]} />
            <Text style={s.rowLabel}>MFL</Text>
            <Text style={[s.rowValue, { color: mflLinked ? t.successText : t.warnText }]}>{mflLinked ? 'Connected' : 'Connect →'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.row, { borderBottomWidth: 0 }]} onPress={fleaflickerLinked
            ? () => Alert.alert('Fleaflicker', 'Disconnect Fleaflicker?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Disconnect', style: 'destructive', onPress: async () => {
                  const { clearFleaflickerCredentials } = require('../../services/platform/fleaflicker');
                  await clearFleaflickerCredentials();
                  setFleaflickerLinked(false);
                }},
              ])
            : () => router.push('/fleaflicker-login' as any)}>
            <View style={[s.dot, { backgroundColor: '#1be7ff' }]} />
            <Text style={s.rowLabel}>Fleaflicker</Text>
            <Text style={[s.rowValue, { color: fleaflickerLinked ? t.successText : t.warnText }]}>{fleaflickerLinked ? 'Connected' : 'Connect →'}</Text>
          </TouchableOpacity>
        </View>

        {/* Appearance */}
        <Text style={s.sectionTitle}>APPEARANCE</Text>
        <View style={s.card}>
          <View style={[s.row, { borderBottomWidth: 0 }]}>
            <Ionicons name="moon-outline" size={20} color={t.accentText} />
            <Text style={s.rowLabel}>Dark Mode</Text>
            <Switch
              value={isDark}
              onValueChange={(v) => setMode(v ? 'dark' : 'light')}
              trackColor={{ false: t.border, true: palette.aqua }}
              thumbColor={isDark ? t.text : t.textMuted}
            />
          </View>
        </View>

        {/* Notifications */}
        <Text style={s.sectionTitle}>NOTIFICATIONS</Text>
        <View style={s.card}>
          <View style={s.row}>
            <Ionicons name="newspaper-outline" size={20} color={t.accentText} />
            <Text style={s.rowLabel}>Player news on my roster</Text>
            <Switch
              value={prefPlayerNews}
              onValueChange={async (v) => {
                setPrefPlayerNews(v);
                const { data: { user } } = await supabase.auth.getUser();
                if (user) setNotificationPrefs(user.id, { player_news: v });
              }}
              trackColor={{ false: t.border, true: palette.aqua }}
              thumbColor={prefPlayerNews ? t.text : t.textMuted}
            />
          </View>
          <View style={s.row}>
            <Ionicons name="alarm-outline" size={20} color={t.accentText} />
            <Text style={s.rowLabel}>Lineup not set warning</Text>
            <Switch
              value={prefLineupWarning}
              onValueChange={async (v) => {
                setPrefLineupWarning(v);
                const { data: { user } } = await supabase.auth.getUser();
                if (user) setNotificationPrefs(user.id, { lineup_warning: v });
              }}
              trackColor={{ false: t.border, true: palette.aqua }}
              thumbColor={prefLineupWarning ? t.text : t.textMuted}
            />
          </View>
          <View style={[s.row, { borderBottomWidth: 0 }]}>
            <Ionicons name="flame-outline" size={20} color={t.accentText} />
            <Text style={s.rowLabel}>Pulse alerts (trending players)</Text>
            <Switch
              value={prefPulseAlerts}
              onValueChange={async (v) => {
                setPrefPulseAlerts(v);
                const { data: { user } } = await supabase.auth.getUser();
                if (user) setNotificationPrefs(user.id, { pulse_alerts: v });
              }}
              trackColor={{ false: t.border, true: palette.aqua }}
              thumbColor={prefPulseAlerts ? t.text : t.textMuted}
            />
          </View>
        </View>

        {/* App */}
        {/* Rankings */}
        <Text style={s.sectionTitle}>RANKINGS</Text>
        <View style={s.card}>
          <TouchableOpacity style={[s.row, { borderBottomWidth: 0 }]} onPress={handleRetakeQuiz}>
            <Ionicons name="refresh-outline" size={20} color={t.accentText} />
            <Text style={s.rowLabel}>Retake Custom Rankings Quiz</Text>
            <Ionicons name="chevron-forward" size={16} color={t.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={s.sectionTitle}>APP</Text>
        <View style={s.card}>
          <TouchableOpacity style={s.row} onPress={() => router.push('/paywall' as any)}>
            <Ionicons name="star-outline" size={20} color={t.warnText} />
            <Text style={s.rowLabel}>Upgrade Plan</Text>
            <Text style={[s.rowValue, { color: t.warnText }]}>Free →</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.row} onPress={() => Linking.openURL('mailto:aiomni@getaiomni.com')}>
            <Ionicons name="chatbubble-outline" size={20} color={t.accentText} />
            <Text style={s.rowLabel}>Send Feedback</Text>
            <Ionicons name="chevron-forward" size={16} color={t.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={s.row} onPress={() => Linking.openURL('https://getaiomni.com')}>
            <Ionicons name="globe-outline" size={20} color={t.accentText} />
            <Text style={s.rowLabel}>Website</Text>
            <Ionicons name="chevron-forward" size={16} color={t.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={s.row} onPress={() => Linking.openURL('https://getaiomni.com/terms')}>
            <Ionicons name="document-text-outline" size={20} color={t.accentText} />
            <Text style={s.rowLabel}>Terms of Service</Text>
            <Ionicons name="chevron-forward" size={16} color={t.textMuted} />
          </TouchableOpacity>
          {/* 5.1.1(i): the consent screen tells the user they can change this
              here, so it has to be revocable — not a one-way switch. */}
          <View style={s.row}>
            <Ionicons name="sparkles-outline" size={20} color={t.accentText} />
            <Text style={s.rowLabel}>Share data with AI service</Text>
            <Switch
              value={aiConsent}
              onValueChange={async (v) => {
                setAiConsent(v);
                await setAIConsent(v ? 'granted' : 'declined');
              }}
              trackColor={{ false: t.border, true: palette.aqua }}
              thumbColor={aiConsent ? t.text : t.textMuted}
            />
          </View>
          {/* 5.1.1(i): the grant surface itself must say what + to whom. */}
          <Text style={s.rowCaption}>
            Sends your questions, league settings, rosters, and screenshots you share
            to {AI_DISCLOSURE.recipient} to power the AI features. Never used to train
            AI models.
          </Text>
          <TouchableOpacity style={s.row} onPress={() => Linking.openURL('https://getaiomni.com/privacy')}>
            <Ionicons name="shield-checkmark-outline" size={20} color={t.accentText} />
            <Text style={s.rowLabel}>Privacy Policy</Text>
            <Ionicons name="chevron-forward" size={16} color={t.textMuted} />
          </TouchableOpacity>
          <View style={[s.row, { borderBottomWidth: 0 }]}>
            <Ionicons name="information-circle-outline" size={20} color={t.accentText} />
            <Text style={s.rowLabel}>Version</Text>
            <Text style={s.rowValue}>1.0.0 (beta)</Text>
          </View>
        </View>

        {/* Sign Out */}
        <TouchableOpacity style={s.signOutBtn} onPress={handleSignOut}>
          <Text style={s.signOutTxt}>SIGN OUT</Text>
        </TouchableOpacity>

        {/* Delete Account — required by Apple guideline 5.1.1(v). Two-tap
            confirmation guards against accidental taps. */}
        <TouchableOpacity style={s.deleteAcctBtn} onPress={handleDeleteAccount}>
          <Text style={s.deleteAcctTxt}>DELETE ACCOUNT</Text>
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  title:        { fontFamily: F.bold, fontSize: 32, color: t.text, letterSpacing: 2, marginBottom: 24 },
  sectionTitle: { fontFamily: F.bold, fontSize: 11, letterSpacing: 2, color: t.textMuted, marginBottom: 8, marginTop: 16 },
  card:         { backgroundColor: t.card, borderRadius: 14, borderWidth: 1, borderColor: t.border, marginBottom: 8, overflow: 'hidden' },
  row:          { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: t.border },
  rowLabel:     { flex: 1, fontFamily: F.body, fontSize: 14, color: t.text },
  rowCaption:   { fontFamily: F.body, fontSize: 12, lineHeight: 17, color: t.textMuted, paddingHorizontal: SP[4], paddingBottom: SP[2], marginTop: -4 },
  rowValue:     { fontFamily: F.body, fontSize: 13, color: t.textMuted },
  dot:          { width: 8, height: 8, borderRadius: 4 },
  signOutBtn:   { backgroundColor: t.flameTint, borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 24, borderWidth: 1, borderColor: palette.flame + '30' },
  signOutTxt:   { fontFamily: F.bold, fontSize: 14, color: t.dangerText, letterSpacing: 2 },
  deleteAcctBtn:{ backgroundColor: 'transparent', borderRadius: 14, padding: 14, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: '#a83040' + '60' },
  deleteAcctTxt:{ fontFamily: F.bold, fontSize: 12, color: '#a83040', letterSpacing: 2 },
});