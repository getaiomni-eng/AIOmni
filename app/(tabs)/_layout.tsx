import { Tabs } from 'expo-router';
import TabIcon from '../components/TabIcon';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#2e4040',
          borderTopColor: 'rgba(184,137,26,0.25)',
          borderTopWidth: 1,
          height: 82,
          paddingBottom: 28,
          paddingTop: 8,
        },
        tabBarActiveTintColor: '#c8a84b',
        tabBarInactiveTintColor: 'rgba(255,255,255,0.35)',
        tabBarLabelStyle: { fontFamily: 'Outfit-SemiBold', fontSize: 11, letterSpacing: 0.5 },
      }}>
      <Tabs.Screen name="index"    options={{ title: 'Home',     tabBarIcon: ({ color, focused }) => <TabIcon name="home"     color={color} focused={focused} /> }} />
      <Tabs.Screen name="rankings" options={{ title: 'Rankings', tabBarIcon: ({ color, focused }) => <TabIcon name="rankings" color={color} focused={focused} /> }} />
      <Tabs.Screen name="trade"    options={{ title: 'Trades',   tabBarIcon: ({ color, focused }) => <TabIcon name="trade"    color={color} focused={focused} /> }} />
      <Tabs.Screen name="coach"    options={{ title: 'AI Coach', tabBarIcon: ({ color, focused }) => <TabIcon name="coach"    color={color} focused={focused} /> }} />
      {/* Hidden screens — not tabs */}
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="league"   options={{ href: null }} />
      <Tabs.Screen name="explore"  options={{ href: null }} />
      <Tabs.Screen name="waiver"   options={{ href: null }} />
    </Tabs>
  );
}