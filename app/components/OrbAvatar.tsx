import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Path, RadialGradient, Stop } from 'react-native-svg';

const BLADES = [0, 60, 120, 180, 240, 300];
const BLADE_PATH = 'M 0,0 L -14,-25 A 30,30 0 0,1 14,-25 Z';

const ease = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const rand = (min: number, max: number) => min + Math.random() * (max - min);

function useAperturePulse(setAngle: React.Dispatch<React.SetStateAction<number>>) {
  const rafRef = useRef<number | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;

    const tween = (from: number, to: number, duration: number) => new Promise<void>(resolve => {
      const start = Date.now();
      const tick = () => {
        if (!alive.current) return resolve();
        const elapsed = Date.now() - start;
        const t = Math.min(elapsed / duration, 1);
        setAngle(from + (to - from) * ease(t));
        if (t < 1) rafRef.current = requestAnimationFrame(tick);
        else resolve();
      };
      rafRef.current = requestAnimationFrame(tick);
    });

    const run = async () => {
      while (alive.current) {
        await new Promise(r => setTimeout(r, rand(2500, 5200)));
        if (!alive.current) break;
        await tween(68, 8, rand(260, 580));
        await new Promise(r => setTimeout(r, rand(120, 280)));
        await tween(8, 68, rand(320, 680));
      }
    };

    run();
    return () => {
      alive.current = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [setAngle]);
}

interface OrbAvatarProps {
  size?: number;
  style?: any;
}

export function OrbAvatar({ size = 44, style }: OrbAvatarProps) {
  const [angle, setAngle] = useState(68);
  useAperturePulse(setAngle);
  const scale = size / 104;

  return (
    <View style={style}>
      <Svg width={size} height={size} viewBox="0 0 104 104">
        <Defs>
          <RadialGradient id="orbGrad" cx="52" cy="52" r="42" fx="52" fy="52">
            <Stop offset="0%" stopColor="#fff4b0" stopOpacity="0.95" />
            <Stop offset="50%" stopColor="#4d76b6" stopOpacity="0.28" />
            <Stop offset="100%" stopColor="#06131f" stopOpacity="0.18" />
          </RadialGradient>
          <ClipPath id="orbClip">
            <Circle cx="52" cy="52" r="36" />
          </ClipPath>
        </Defs>

        <G transform={`scale(${scale}) translate(52,52)`}>
          <Circle r={52} fill="#091622" />
          <Circle r={36} fill="url(#orbGrad)" />
          <G clipPath="url(#orbClip)">
            {BLADES.map(rot => (
              <G key={rot} transform={`rotate(${rot})`}>
                <Path
                  d={BLADE_PATH}
                  fill="#2a6bb0"
                  stroke="#ffffed"
                  strokeWidth={1.1}
                  rotation={angle}
                  originX={0}
                  originY={-28}
                />
              </G>
            ))}
          </G>
          <Circle r={38} fill="none" stroke="#091622" strokeWidth={7} />
          <Circle r={52} fill="none" stroke="#ffffed" strokeWidth={2} />
        </G>
      </Svg>
    </View>
  );
}
