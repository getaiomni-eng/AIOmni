import { Bungee_400Regular } from '@expo-google-fonts/bungee';
import { SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import { useFonts } from 'expo-font';
import * as Linking from 'expo-linking';
import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { exchangeYahooCode } from '../services/yahoo';
import { getUser, getUserRow } from '../services/supabase';
import { C } from './constants/tokens';

Sentry.init({
  dsn: 'https://bff368e4055a1f51bda1b9464e0d2a39@o4511046397394944.ingest.us.sentry.io/4511046438158336',
  debug: false,
  tracesSampleRate: 1.0,
});

export default Sentry.wrap(function RootLayout() {
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    // ── Primary fonts ────────────────────────
    Bungee_400Regular,
    SpaceMono_400Regular,
    SpaceMono_700Bold,

    // ── Legacy aliases — keeps all old hardcoded strings working ──
    'BebasNeue':               Bungee_400Regular,
    'BebasNeue_400Regular':    Bungee_400Regular,
    'Barlow_400Regular':       SpaceMono_400Regular,
    'Barlow_600SemiBold':      SpaceMono_700Bold,
    'SpaceMono':               SpaceMono_400Regular,
    'SpaceMono-Bold':          SpaceMono_700Bold,
    'Outfit':                  SpaceMono_400Regular,
    'Outfit-Medium':           SpaceMono_400Regular,
    'Outfit-SemiBold':         SpaceMono_700Bold,
    'Outfit-Bold':             Bungee_400Regular,
    'Outfit-Black':            Bungee_400Regular,
    'DMMono-Regular':          SpaceMono_400Regular,
    'DMMono-Medium':           SpaceMono_700Bold,
    'Oswald_600SemiBold':      Bungee_400Regular,
    'Oswald_700Bold':          Bungee_400Regular,
    'Inter_400Regular':        SpaceMono_400Regular,
    'Inter_600SemiBold':       SpaceMono_700Bold,
    'JetBrainsMono_400Regular': SpaceMono_400Regular,
    'JetBrainsMono_700Bold':   SpaceMono_700Bold,
    'Orbitron_700Bold':        Bungee_400Regular,
  });

  useEffect(() => {
    if (!fontsLoaded) return;

    (async () => {
      try {
        const user = await getUser();
        if (!user) {
          router.replace('/onboarding' as any);
          return;
        }
        Sentry.setUser({ id: user.id, email: user.email });

        const row = await getUserRow();
        const hasSleeper = Boolean(row?.sleeper_username);
        const espnIds = await AsyncStorage.getItem('espn_league_ids');
        const yahooTokens = await AsyncStorage.getItem('yahoo_tokens');
        const hasLeagues = hasSleeper || Boolean(espnIds) || Boolean(yahooTokens);

        if (false && !hasLeagues) {
          router.replace('/auth' as any);
        } else {
          router.replace('/(tabs)');
        }
      } catch (err) {
        console.error('Session check error', err);
        router.replace('/onboarding' as any);
      }
    })();

    const handleDeepLink = async (event: { url: string }) => {
      const url = event.url;
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

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: C.bgTop }} />;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack>
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)"     options={{ headerShown: false }} />
        <Stack.Screen name="auth"       options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="paywall"    options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="settings"   options={{ headerShown: false }} />
        <Stack.Screen name="espn-login" options={{ headerShown: false }} />
      </Stack>
    </GestureHandlerRootView>
  );
});
