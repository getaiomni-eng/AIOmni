import { Tabs } from 'expo-router';
import { Text } from 'react-native';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarStyle: { backgroundColor: '#080d08', borderTopColor: 'rgba(212,255,0,0.1)', borderTopWidth: 1 },
      tabBarActiveTintColor: '#D4FF00',
      tabBarInactiveTintColor: '#3a4a3a',
      tabBarLabelStyle: { fontFamily: 'SpaceMono_400Regular', fontSize: 9, letterSpacing: 1 },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 16 }}>⌂</Text> }} />
      <Tabs.Screen name="explore" options={{ title: 'Trades', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 16 }}>⇄</Text> }} />
      <Tabs.Screen name="coach" options={{ title: 'AI Coach', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 13, fontFamily: 'BebasNeue_400Regular', letterSpacing: 1 }}>AIO</Text> }} />
      <Tabs.Screen name="league" options={{ href: null }} />
      <Tabs.Screen name="waiver" options={{ href: null }} />
    </Tabs>
  );
}
