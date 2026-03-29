import { Tabs } from 'expo-router';
import TabIcon from '../components/TabIcon';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#2e4040', borderTopColor: 'rgba(184,137,26,0.2)', borderTopWidth: 1 },
        tabBarActiveTintColor: '#b8891a',
        tabBarInactiveTintColor: 'rgba(255,255,255,0.35)',
        tabBarLabelStyle: { fontFamily: 'Outfit', fontSize: 10, letterSpacing: 0.5 },
      }}>
      <Tabs.Screen name="index"    options={{ title: 'Home',     tabBarIcon: ({ color }) => <TabIcon name="home"     color={color} /> }} />
      <Tabs.Screen name="rankings" options={{ title: 'Rankings', tabBarIcon: ({ color }) => <TabIcon name="rankings" color={color} /> }} />
      <Tabs.Screen name="trade"    options={{ title: 'Trades',   tabBarIcon: ({ color }) => <TabIcon name="trade"    color={color} /> }} />
      <Tabs.Screen name="coach"    options={{ title: 'AI Coach', tabBarIcon: ({ color }) => <TabIcon name="coach"    color={color} /> }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: ({ color }) => <TabIcon name="settings" color={color} /> }} />
      <Tabs.Screen name="explore"  options={{ href: null }} />
      <Tabs.Screen name="waiver"   options={{ href: null }} />
    </Tabs>
  );
}