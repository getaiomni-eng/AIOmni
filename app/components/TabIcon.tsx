import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  home: 'home',
  rankings: 'trophy',
  trade: 'swap-horizontal',
  coach: 'chatbubble-ellipses',
};

export default function TabIcon({ name, color, focused }: { name: string; color: string; focused?: boolean }) {
  return (
    <View style={focused ? {
      shadowColor: '#FEE229',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.5,
      shadowRadius: 8,
    } : undefined}>
      <Ionicons name={ICONS[name] || 'ellipse'} size={24} color={color} />
    </View>
  );
}