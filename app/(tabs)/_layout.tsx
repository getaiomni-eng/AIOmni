import { Tabs } from 'expo-router';
import TabIcon from '../components/TabIcon';
import { C } from '../constants/tokens';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopWidth: 1.5,
          borderTopColor: 'rgba(88,131,191,0.18)',
          paddingTop: 6,
          paddingBottom: 8,
          height: 64,
          shadowColor: '#3d6aaa',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.08,
          shadowRadius: 16,
          elevation: 12,
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
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Teams',
          tabBarIcon: ({ focused }) => <TabIcon name="home" focused={focused} size={26}/>,
        }}
      />
      <Tabs.Screen
        name="waiver"
        options={{
          title: 'Waiver',
          tabBarIcon: ({ focused }) => <TabIcon name="home" focused={focused} size={26}/>,
        }}
      />
      <Tabs.Screen
        name="rankings"
        options={{
          title: 'Rankings',
          tabBarIcon: ({ focused }) => <TabIcon name="rankings" focused={focused} size={26}/>,
        }}
      />
      <Tabs.Screen
        name="trade"
        options={{
          title: 'Trade',
          tabBarIcon: ({ focused }) => <TabIcon name="trade" focused={focused} size={26}/>,
        }}
      />
      <Tabs.Screen
        name="coach"
        options={{
          title: 'AI Coach',
          tabBarIcon: ({ focused }) => <TabIcon name="coach" focused={focused} size={26}/>,
        }}
      />
      {/* Hidden from tab bar */}
      <Tabs.Screen name="league"   options={{ href: null }}/>
      <Tabs.Screen name="explore"  options={{ href: null }}/>
      <Tabs.Screen name="settings" options={{ href: null }}/>
    </Tabs>
  );
}