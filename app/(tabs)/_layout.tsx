import { Tabs } from 'expo-router';
import { C, BEVEL } from '../constants/tokens';
import TabIcon from '../components/TabIcon';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#3d6aaa', borderTopWidth: 1.5, borderTopColor: '#4a7bbb', shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.2, shadowRadius: 16, elevation: 12,
          paddingTop: 8,
          paddingBottom: 10,
          height: 72,
        },
        tabBarLabelStyle: {
          fontFamily: 'SpaceMono_400Regular',
          fontSize: 9,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
          marginTop: 2,
        },
        tabBarActiveTintColor: '#fee229',
        tabBarInactiveTintColor: 'rgba(255,255,237,0.45)',
        tabBarIconStyle: { marginBottom: 0 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Teams',
          tabBarIcon: ({ focused }) => <TabIcon name="home" focused={focused} size={32} />,
        }}
      />
      <Tabs.Screen
        name="rankings"
        options={{
          title: 'Rankings',
          tabBarIcon: ({ focused }) => <TabIcon name="rankings" focused={focused} size={32} />,
        }}
      />
      <Tabs.Screen
        name="trade"
        options={{
          title: 'Trade',
          tabBarIcon: ({ focused }) => <TabIcon name="trade" focused={focused} size={32} />,
        }}
      />
      <Tabs.Screen
        name="coach"
        options={{
          title: 'AI Coach',
          tabBarIcon: ({ focused }) => <TabIcon name="coach" focused={focused} size={32} />,
        }}
      />
      <Tabs.Screen name="waiver"   options={{ href: null }} />
      <Tabs.Screen name="league"   options={{ href: null }} />
      <Tabs.Screen name="explore"  options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
    </Tabs>
  );
}
