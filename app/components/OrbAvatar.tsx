// OrbAvatar — mini AIOmni iris avatar
import React from 'react';
import { View } from 'react-native';
import { AIOmniIris } from './AIOmniLogo';

interface OrbAvatarProps {
  size?: number;
  style?: any;
}

export function OrbAvatar({ size = 44, style }: OrbAvatarProps) {
  return (
    <View style={style}>
      <AIOmniIris width={size} />
    </View>
  );
}
