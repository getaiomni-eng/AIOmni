import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import * as Linking from 'expo-linking';
import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { useFonts } from 'expo-font';
import { exchangeYahooCode } from '../services/yahoo';

Sentry.init({
  dsn: 'https://bff368e4055a1f51bda1b9464e0d2a39@o4511046397394944.ingest.us.sentry.io/4511046438158336',
  debug: false,
  tracesSampleRate: 1.0,
});

export default Sentry.wrap(function RootLayout() {
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    'Outfit-Bold': require('../assets/fonts/Outfit-Bold.ttf'),
    'DMMono-Regular': require('../assets/fonts/DMMono-Regular.ttf'),
    'DMMono-Medium':    require('../assets/fonts/DMMono-Medium.ttf'),
    'Outfit':    require('../assets/fonts/Outfit.ttf'),
    'Outfit-SemiBold':   require('../assets/fonts/Outfit-SemiBold.ttf'),
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
      const code = parsed.queryParams?.code as string;
      if (!code) return;
      try {
        await exchangeYahooCode(code);
        router.replace('/(tabs)');
      } catch (e) {
        console.error('Yahoo OAuth error:', e);
      }
    };

    const subscription = Linking.addEventListener('url', handleDeepLink);
    Linking.getInitialURL().then(url => {
      if (url) handleDeepLink({ url });
    });

    return () => subscription.remove();
  }, [fontsLoaded]);

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: '#2e4040' }} />;

  return (
    <Stack>
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="paywall" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="settings" options={{ headerShown: false }} />
      <Stack.Screen name="espn-login" options={{ headerShown: false }} />
    </Stack>
  );
});
