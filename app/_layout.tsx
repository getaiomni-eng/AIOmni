import { Audiowide_400Regular } from '@expo-google-fonts/audiowide';
import {
  SpaceGrotesk_300Light,
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import * as Updates from 'expo-updates';
import { useFonts } from 'expo-font';
import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../services/supabase';
import { syncUserBehavioralData } from '../services/behavioralSync';
import { Alert, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Platform } from 'react-native';
import { CrossPromptHost } from './components/CrossPromptHost';
import { getUser, getUserRow } from '../services/supabase';
import { loadYahooTokens } from '../services/yahoo';
import { updatePassword } from '../services/auth';
import { attachCustomerInfoListener, identifyPurchaseUser, initPurchases, refreshTier } from '../services/purchases';
import { getAIConsent } from '../services/aiConsent';
import { registerPushNotifications } from '../services/notifications';
import { pullCloudDataOnLogin } from '../services/userSync';
import { dark } from './constants/tokens';
import { ThemeProvider } from './constants/theme';

// Web page ground. The app renders as a centered phone column; without this
// the browser paints its default white around it. (+html.tsx would be the
// clean home for this, but it only applies to static output — we export SPA.)
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.documentElement.style.background = '#0a1214';
  document.body.style.background = '#0a1214';
}

Sentry.init({
  dsn: 'https://bff368e4055a1f51bda1b9464e0d2a39@o4511046397394944.ingest.us.sentry.io/4511046438158336',
  debug: false,
  // 15% span sampling in prod — 1.0 sent every interaction (cost + overhead).
  tracesSampleRate: 0.15,
  // Without these, every OTA looks like the same build. runtimeVersion is the
  // native binary (1.0.1); updateId is the specific JS bundle EAS shipped, so
  // "did my fix land" and "which bundle is erroring" become answerable.
  environment: __DEV__ ? 'development' : 'production',
  release: `com.getaiomni.AIOmni@${Updates.runtimeVersion ?? 'unknown'}`,
  dist: Updates.updateId ?? 'embedded',
  // Swallowed data-layer failures are reported as warnings via logCaught();
  // keep them out of the crash-free-sessions metric.
  beforeSend: (event: any) => {
    if (event?.tags?.caught_tag) event.fingerprint = ['{{ default }}', event.tags.caught_tag];
    return event;
  },
});

export default Sentry.wrap(function RootLayout() {
  const router = useRouter();

  // Phase 1 behavioral data sync — Sleeper + Yahoo only.
  // Triggers on mount and every app foreground. The service enforces a
  // 6hr cooldown internally so this is safe to call aggressively.
  useEffect(() => {
    const run = async () => {
      try {
        // getSession is lighter than getUser and does not throw on
        // missing session — it simply returns {data: {session: null}}.
        const { data } = await supabase.auth.getSession();
        if (data?.session?.user?.id) {
          await syncUserBehavioralData(data.session.user.id);
        }
      } catch (e) {
        console.log('behavioralSync error:', e);
      }
    };
    run();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    return () => sub.remove();
  }, []);

  const [fontsLoaded] = useFonts({
    // ── V7 Primary fonts ─────────────────────
    Audiowide_400Regular,
    SpaceGrotesk_300Light,
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,

    // ── Legacy aliases — keeps all old hardcoded strings working ──
    'Bungee_400Regular':       Audiowide_400Regular,
    'BungeeInline_400Regular': Audiowide_400Regular,
    'BebasNeue':               Audiowide_400Regular,
    'BebasNeue_400Regular':    Audiowide_400Regular,
    'Barlow_400Regular':       SpaceGrotesk_400Regular,
    'Barlow_600SemiBold':      SpaceGrotesk_600SemiBold,
    'SpaceMono_400Regular':    SpaceGrotesk_400Regular,
    'SpaceMono_700Bold':       SpaceGrotesk_700Bold,
    'SpaceMono':               SpaceGrotesk_400Regular,
    'SpaceMono-Bold':          SpaceGrotesk_700Bold,
    'Outfit':                  SpaceGrotesk_400Regular,
    'Outfit-Medium':           SpaceGrotesk_500Medium,
    'Outfit-SemiBold':         SpaceGrotesk_600SemiBold,
    'Outfit-Bold':             SpaceGrotesk_700Bold,
    'Outfit-Black':            Audiowide_400Regular,
    'DMMono-Regular':          SpaceGrotesk_400Regular,
    'DMMono-Medium':           SpaceGrotesk_500Medium,
    'Oswald_600SemiBold':      Audiowide_400Regular,
    'Oswald_700Bold':          Audiowide_400Regular,
    'Inter_400Regular':        SpaceGrotesk_400Regular,
    'Inter_600SemiBold':       SpaceGrotesk_600SemiBold,
    'JetBrainsMono_400Regular': SpaceGrotesk_400Regular,
    'JetBrainsMono_700Bold':   SpaceGrotesk_700Bold,
    'Orbitron_700Bold':        Audiowide_400Regular,
  });

  useEffect(() => {
    if (!fontsLoaded) return;

    (async () => {
      try {
        // Configure RevenueCat BEFORE the auth gate. Returning early here
        // without configuring is exactly what made every plan render
        // "Unavailable" for App Review (2.1(b), twice) — reviewers sign in
        // during the session, so they never hit the configured path.
        await initPurchases();

        let user = null;
        try { user = await getUser(); } catch {}
        if (!user) {
          router.replace('/auth' as any);
          return;
        }
        Sentry.setUser({ id: user.id, email: user.email });
        await identifyPurchaseUser(user.id);
        // Populate the cached tier and listen for entitlement changes so
        // tier-gated UI (lock icons, paywall triggers) sees updates from
        // restored purchases / cancellations / cross-device upgrades
        // without requiring an app restart.
        await refreshTier();
        attachCustomerInfoListener();
        // Fire-and-forget — don't gate the app behind permission prompts.
        // If the user denies, registerPushNotifications returns null and
        // subsequent server-side notification jobs skip them.
        registerPushNotifications(user.id).catch(e => console.log('push register skipped:', e));
        try { await pullCloudDataOnLogin(); } catch (e) { console.log('Cloud sync skipped:', e); }

        const row = await getUserRow();
        const hasSleeper = Boolean(row?.sleeper_username);
        const espnIds = await AsyncStorage.getItem('espn_league_ids');
        // Yahoo tokens moved to SecureStore in the 2026-05-26 keychain
        // migration — AsyncStorage.getItem('yahoo_tokens') always returns
        // null now.
        const yahooTokens = await loadYahooTokens();
        const hasLeagues = hasSleeper || Boolean(espnIds) || Boolean(yahooTokens);

        // 5.1.1(i)/5.1.2(i): no AI-backed screen may load until the user has
        // seen the third-party disclosure and made an explicit choice. Apple
        // rejected build 195 for sharing data with an AI service without it.
        if ((await getAIConsent()) === null) {
          router.replace('/ai-consent' as any);
          return;
        }

        if (false && !hasLeagues) {
        } else {
          router.replace('/(tabs)');
        }
      } catch (err) {
        console.error('Session check error', err);
        router.replace('/auth' as any);
      }
    })();

    // No app-level deep-link handler for Yahoo OAuth: the Settings tab
    // handles aiomnifantasy://oauth/yahoo via WebBrowser.openAuthSessionAsync
    // (ASWebAuthenticationSession on iOS), which captures the redirect
    // internally. Having a second handler here raced the in-place flow —
    // exchangeYahooCode() removes the PKCE verifier on success, so whichever
    // handler ran second always failed with "No PKCE code verifier found"
    // and the user saw either a stray error or no confirmation at all.
    // Password reset is also handled at the screen level (app/auth/reset.tsx
    // via supabase.auth detectSessionInUrl), so nothing belongs here yet.
  }, [fontsLoaded]);

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: dark.bg }} />;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* web: phone-column layout centered on a page ground (triage item 2) */}
      <GestureHandlerRootView style={Platform.OS === 'web' ? { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center' } : { flex: 1 }}>
      <ThemeProvider>
      <Stack>
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)"     options={{ headerShown: false }} />
        <Stack.Screen name="auth"       options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="paywall"    options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="ai-consent" options={{ headerShown: false }} />
        <Stack.Screen name="espn-login" options={{ headerShown: false }} />
        <Stack.Screen name="mfl-login" options={{ headerShown: false }} />
        <Stack.Screen name="fleaflicker-login" options={{ headerShown: false }} />
        <Stack.Screen name="draft" options={{ headerShown: false }} />
        <Stack.Screen name="league" options={{ headerShown: false }} />
        <Stack.Screen name="quiz" options={{ headerShown: false }} />
        <Stack.Screen name="quiz-reveal" options={{ headerShown: false }} />
      </Stack>
      </ThemeProvider>
    <CrossPromptHost />
      </GestureHandlerRootView>
      </GestureHandlerRootView>
  );
});