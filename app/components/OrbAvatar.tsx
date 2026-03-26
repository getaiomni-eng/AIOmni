import { View, Image, StyleSheet } from 'react-native';

interface OrbAvatarProps {
  size?: number;
  style?: any;
}

export function OrbAvatar({ size = 60, style }: OrbAvatarProps) {
  return (
    <View style={[{ width: size, height: size }, style]}>
      <Image
        source={require('../../assets/images/orb.png')}
        style={{ width: size, height: size, mixBlendMode: 'screen' } as any}
        resizeMode="contain"
      />
    </View>
  );
}
