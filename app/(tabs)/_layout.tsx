import { Tabs } from 'expo-router';
import { Text } from 'react-native';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarStyle: { backgroundColor: '#2e4040', borderTopColor: 'rgba(184,137,26,0.2)', borderTopWidth: 1 },
      tabBarActiveTintColor: '#b8891a',
      tabBarInactiveTintColor: 'rgba(255,255,255,0.35)',
      tabBarLabelStyle: { fontFamily: 'Outfit', fontSize: 10, letterSpacing: 0.5 },
    }}>
      <Tabs.Screen name="index"    options={{ title: 'Home',     tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 16 }}>⌂</Text> }} />
      <Tabs.Screen name="trade"    options={{ title: 'Trades',   tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 16 }}>⇄</Text> }} />
      <Tabs.Screen name="coach"    options={{ title: 'AI Coach', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 13 }}>AIO</Text> }} />
      <Tabs.Screen name="settings" options={{ title: 'settings', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 14 }}>▼</Text> }} />
      <Tabs.Screen name="explore"  options={{ href: null }} />
      <Tabs.Screen name="league"   options={{ href: null }} />
      <Tabs.Screen name="waiver"   options={{ href: null }} />
    </Tabs>
  );
}