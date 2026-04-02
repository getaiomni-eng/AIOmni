import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { getUser } from '../../services/auth';
import { initPurchases } from '../../services/purchases';
import TabIcon from '../components/TabIcon';

export default function TabLayout() {
  useEffect(() => {
    (async () => {
      // Initialize RevenueCat with user ID if signed in
      const user = await getUser().catch(() => null);
      await initPurchases(user?.authId);
    })();
  }, []);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#2a3a3a',
          borderTopColor: 'rgba(254,226,41,0.20)',
          borderTopWidth: 1,
          height: 82,
          paddingBottom: 28,
          paddingTop: 8,
        },
        tabBarItemStyle: { flex: 1, paddingHorizontal: 0 },
        tabBarActiveTintColor:   '#FEE229',
        tabBarInactiveTintColor: 'rgba(255,255,255,0.35)',
        tabBarLabelStyle: { fontFamily: 'Outfit-SemiBold', fontSize: 11, letterSpacing: 0.5 },
      }}>
      <Tabs.Screen name="index"    options={{ title: 'Home',     tabBarIcon: ({ color, focused }) => <TabIcon name="home"     color={color} focused={focused} /> }} />
      <Tabs.Screen name="rankings" options={{ title: 'Rankings', tabBarIcon: ({ color, focused }) => <TabIcon name="rankings" color={color} focused={focused} /> }} />
      <Tabs.Screen name="trades"   options={{ title: 'Trades',   tabBarIcon: ({ color, focused }) => <TabIcon name="trade"    color={color} focused={focused} /> }} />
      <Tabs.Screen name="coach"    options={{ title: 'AI Coach', tabBarIcon: ({ color, focused }) => <TabIcon name="coach"    color={color} focused={focused} /> }} />
      {/* Hidden screens */}
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="league"   options={{ href: null }} />
      <Tabs.Screen name="explore"  options={{ href: null }} />
      <Tabs.Screen name="waiver"   options={{ href: null }} />
    </Tabs>
  );
}