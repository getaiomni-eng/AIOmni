import { View, Image } from 'react-native';

interface OrbAvatarProps {
  size?: number;
  style?: any;
  mode?: string;
  glow?: string;
}

export function OrbAvatar({ size = 60, style }: OrbAvatarProps) {
  return (
    <View style={[{ width: size, height: size, backgroundColor: 'transparent' }, style]}>
      <Image
        source={require('../../assets/images/orb.png')}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    </View>
  );
}