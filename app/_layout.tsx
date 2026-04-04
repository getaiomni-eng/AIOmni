import { Bungee_400Regular } from '@expo-google-fonts/bungee';
import { BungeeInline_400Regular } from '@expo-google-fonts/bungee-inline';
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

Sentry.init({
  dsn: 'https://bff368e4055a1f51bda1b9464e0d2a39@o4511046397394944.ingest.us.sentry.io/4511046438158336',
  debug: false,
  tracesSampleRate: 1.0,
});

export default Sentry.wrap(function RootLayout() {
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    // ── New fonts ──────────────────────────────
    'Bungee':          Bungee_400Regular,
    'Bungee Inline':   BungeeInline_400Regular,
    'SpaceMono':       SpaceMono_400Regular,
    'SpaceMono-Bold':  SpaceMono_700Bold,

    // ── Aliases — keeps old hardcoded font strings
    //    in settings.tsx etc. working until migrated ──
    'Outfit':          SpaceMono_400Regular,
    'Outfit-Medium':   SpaceMono_400Regular,
    'Outfit-SemiBold': SpaceMono_400Regular,
    'Outfit-Bold':     Bungee_400Regular,
    'Outfit-Black':    Bungee_400Regular,
    'DMMono-Regular':  SpaceMono_400Regular,
    'DMMono-Medium':   SpaceMono_700Bold,
  });

  useEffect(() => {
    if (!fontsLoaded) return;

    AsyncStorage.getItem('sleeper_username').then(username => {
      if (username) {
        Sentry.setUser({ username });
      } else {
        router.replace('/onboarding');
      }
    });

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

  // Cream background while fonts load (matches new theme)
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: '#ffffed' }} />;

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