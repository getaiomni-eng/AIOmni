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
  enableInExpoDevelopment: true,
  debug: false,
  tracesSampleRate: 1.0,
});

export default Sentry.wrap(function RootLayout() {
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    BebasNeue_400Regular: require('../assets/fonts/BebasNeue_400Regular.ttf'),
    SpaceMono_400Regular: require('../assets/fonts/SpaceMono_400Regular.ttf'),
    SpaceMono_700Bold:    require('../assets/fonts/SpaceMono_700Bold.ttf'),
    Barlow_400Regular:    require('../assets/fonts/Barlow_400Regular.ttf'),
    Barlow_500Medium:     require('../assets/fonts/Barlow_500Medium.ttf'),
    Barlow_600SemiBold:   require('../assets/fonts/Barlow_600SemiBold.ttf'),
    Barlow_700Bold:       require('../assets/fonts/Barlow_700Bold.ttf'),
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

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: '#03030a' }} />;

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
