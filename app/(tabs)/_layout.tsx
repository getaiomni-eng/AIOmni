import { Tabs } from 'expo-router';
import { C, BEVEL } from '../constants/tokens';
import TabIcon from '../components/TabIcon';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          ...BEVEL.tabBar,
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
        tabBarActiveTintColor:   C.blueDeep,
        tabBarInactiveTintColor: C.dim2,
        tabBarIconStyle: {
          marginBottom: 0,
        },
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
        name="waiver"
        options={{
          title: 'Waiver',
          tabBarIcon: ({ focused }) => <TabIcon name="waiver" focused={focused} size={32} />,
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
      <Tabs.Screen name="league"   options={{ href: null }} />
      <Tabs.Screen name="explore"  options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
    </Tabs>
  );
}
