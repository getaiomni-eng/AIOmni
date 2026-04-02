import { Image, View } from 'react-native';

const ICONS: Record<string, any> = {
  home:     require('../../assets/images/tabs/home.png'),
  rankings: require('../../assets/images/tabs/rankings.png'),
  trade:    require('../../assets/images/tabs/trade.png'),
  coach:    require('../../assets/images/tabs/coach.png'),
};

export default function TabIcon({ name, color, focused }: { name: string; color: string; focused?: boolean }) {
  return (
    <View style={focused ? {
      shadowColor: '#FEE229',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.5,
      shadowRadius: 8,
    } : undefined}>
      <Image
        source={ICONS[name] ?? ICONS.home}
        style={{ width: 26, height: 26, opacity: focused ? 1 : 0.35 }}
        resizeMode="contain"
      />
    </View>
  );
}
