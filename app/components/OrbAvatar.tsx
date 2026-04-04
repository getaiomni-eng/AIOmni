import { Image, View } from 'react-native';
import { C, R } from '../constants/tokens';

interface OrbAvatarProps {
  size?: number;
  style?: any;
}

export function OrbAvatar({ size = 60, style }: OrbAvatarProps) {
  return (
    <View style={[{
      width: size, height: size,
      borderRadius: size / 2,
      borderWidth: 1.5,
      borderColor: C.goldBorder,
      backgroundColor: C.goldS,
      overflow: 'hidden',
    }, style]}>
      <Image
        source={require('../../assets/images/orb.png')}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    </View>
  );
}
