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
import { useFonts } from 'expo-font';
import * as Linking from 'expo-linking';
import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../services/supabase';
import { syncUserBehavioralData } from '../services/behavioralSync';
import { Alert, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { getUser, getUserRow } from '../services/supabase';
import { exchangeYahooCode } from '../services/yahoo';
import { updatePassword } from '../services/auth';
import { initPurchases } from '../services/purchases';
import { pullCloudDataOnLogin } from '../services/userSync';
import { dark } from './constants/tokens';

Sentry.init({
  dsn: 'https://bff368e4055a1f51bda1b9464e0d2a39@o4511046397394944.ingest.us.sentry.io/4511046438158336',
  debug: false,
  tracesSampleRate: 1.0,
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
        let user = null;
        try { user = await getUser(); } catch {}
        if (!user) {
          router.replace('/auth' as any);
          return;
        }
        Sentry.setUser({ id: user.id, email: user.email });
        await initPurchases(user.id);
        try { await pullCloudDataOnLogin(); } catch (e) { console.log('Cloud sync skipped:', e); }

        const row = await getUserRow();
        const hasSleeper = Boolean(row?.sleeper_username);
        const espnIds = await AsyncStorage.getItem('espn_league_ids');
        const yahooTokens = await AsyncStorage.getItem('yahoo_tokens');
        const hasLeagues = hasSleeper || Boolean(espnIds) || Boolean(yahooTokens);

        if (false && !hasLeagues) {
        } else {
          router.replace('/(tabs)');
        }
      } catch (err) {
        console.error('Session check error', err);
        router.replace('/auth' as any);
      }
    })();

    const handleDeepLink = async (event: { url: string }) => {
      const url = event.url;

      // Password reset is handled by app/auth/reset.tsx via expo-router
      // auto-resolution. Supabase parses the recovery token from the URL
      // fragment via detectSessionInUrl: true in services/supabase.ts,
      // so by the time reset.tsx mounts the user has a valid recovery
      // session and can call supabase.auth.updateUser({password}) directly.

      // ── Yahoo OAuth callback ──
      if (!url.includes('oauth/yahoo')) return;
      const parsed = Linking.parse(url);
      const code   = parsed.queryParams?.code as string;
      if (!code) return;
      try {
        await exchangeYahooCode(code);
        router.replace('/(tabs)');
      } catch (e) {
        console.error('Yahoo OAuth error:', e);
      }
    };

    const subscription = Linking.addEventListener('url', handleDeepLink);
    Linking.getInitialURL().then(url => { if (url) handleDeepLink({ url }); });
    return () => subscription.remove();
  }, [fontsLoaded]);

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: dark.bg }} />;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack>
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)"     options={{ headerShown: false }} />
        <Stack.Screen name="auth"       options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="paywall"    options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="settings"   options={{ headerShown: false }} />
        <Stack.Screen name="espn-login" options={{ headerShown: false }} />
        <Stack.Screen name="mfl-login" options={{ headerShown: false }} />
        <Stack.Screen name="fleaflicker-login" options={{ headerShown: false }} />
        <Stack.Screen name="settings-page" options={{ headerShown: false }} />
        <Stack.Screen name="draft" options={{ headerShown: false }} />
        <Stack.Screen name="league" options={{ headerShown: false }} />
      </Stack>
    </GestureHandlerRootView>
  );
});