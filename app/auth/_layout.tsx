import { Stack } from 'expo-router';

// Stack wrapper for the /auth folder so expo-router can resolve nested
// routes like /auth/reset (deep-linked from password reset emails).
// Both screens are presented modally with no header — the screens
// render their own AIOmniLogo headers.
export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ presentation: 'modal' }} />
      <Stack.Screen name="reset" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
