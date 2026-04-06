// OrbAvatar — mini AIOmni iris avatar
import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

interface OrbAvatarProps {
  size?: number;
  style?: any;
}

export function OrbAvatar({ size = 44, style }: OrbAvatarProps) {
  const scale = size / 104; // Based on viewBox 104

  return (
    <View style={style}>
      <Svg width={size} height={size} viewBox="0 0 104 104">
        <G transform={`scale(${scale}) translate(52,52)`}>
          <Circle r={60} fill="#091622" />
          <Circle r={42} fill="#fee229" />
          <G>
            {[0, 60, 120, 180, 240, 300].map(rot => (
              <G key={rot} transform={`rotate(${rot})`}>
                <Path
                  d="M 0,0 L -28,-48.5 A 56,56 0 0,1 28,-48.5 Z"
                  fill="#2a6bb0"
                  stroke="#ffffed"
                  strokeWidth={1.3}
                />
              </G>
            ))}
          </G>
          <Circle r={51} fill="none" stroke="#091622" strokeWidth={9} />
          <Circle r={60} fill="none" stroke="#ffffed" strokeWidth={2.2} />
        </G>
      </Svg>
    </View>
  );
}
