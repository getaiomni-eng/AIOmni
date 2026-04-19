import { Tabs } from 'expo-router';
import TabIcon from '../components/TabIcon';
import { dark, palette } from '../constants/tokens';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: dark.navBg,
          borderTopWidth: 1,
          borderTopColor: dark.border,
          paddingTop: 8,
          paddingBottom: 20,
          height: 72,
        },
        tabBarLabelStyle: {
          fontFamily: 'Audiowide_400Regular',
          fontSize: 9,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          marginTop: 2,
        },
        tabBarActiveTintColor: palette.aqua,
        tabBarInactiveTintColor: dark.textMuted,
        tabBarIconStyle: { marginBottom: 0 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => <TabIcon name="home" focused={focused} size={26} />,
        }}
      />
      <Tabs.Screen
        name="draft"
        options={{
          title: 'Draft',
          tabBarIcon: ({ focused }) => <TabIcon name="draft" focused={focused} size={26} />,
        }}
      />
      <Tabs.Screen
        name="rankings"
        options={{
          title: 'Rankings',
          tabBarIcon: ({ focused }) => <TabIcon name="rankings" focused={focused} size={26} />,
        }}
      />
      <Tabs.Screen
        name="trade"
        options={{
          title: 'Trade',
          tabBarIcon: ({ focused }) => <TabIcon name="trade" focused={focused} size={26} />,
        }}
      />
      <Tabs.Screen
        name="coach"
        options={{
          title: 'AI Coach',
          tabBarIcon: ({ focused }) => <TabIcon name="coach" focused={focused} size={26} />,
        }}
      />
      {/* Hidden screens — still routable, not in tab bar */}
      <Tabs.Screen name="league"   options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
    </Tabs>
  );
}