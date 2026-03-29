import Ionicons from '@expo/vector-icons/Ionicons';

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  home: 'home',
  trade: 'swap-horizontal',
  coach: 'chatbubble-ellipses',
  settings: 'settings-sharp',
};

export default function TabIcon({ name, color }: { name: string; color: string }) {
  return <Ionicons name={ICONS[name] || 'ellipse'} size={22} color={color} />;
}