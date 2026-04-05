// OrbAvatar — replaced with mini AIOmni hex logo avatar
// Drops orb.png dependency entirely
import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, G, Path, Polygon, RadialGradient, Stop } from 'react-native-svg';
import { C } from '../constants/tokens';

const BLADE = "M 3,-52 L -48,6 C -44,20 -32,40 -16,50 L 14,-14 Z";
const ROTS  = [0, 60, 120, 180, 240, 300];
const OPEN  = 70;

interface OrbAvatarProps {
  size?: number;
  style?: any;
}

export function OrbAvatar({ size = 60, style }: OrbAvatarProps) {
  const [angle, setAngle] = useState(OPEN);
  const cancelRef = useRef(false);
  const rafRef    = useRef<any>(null);

  useEffect(() => {
    const ease = (t: number) => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;
    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    function tween(from: number, to: number, ms: number): Promise<void> {
      return new Promise(resolve => {
        const t0 = Date.now();
        function tick() {
          if (cancelRef.current) return resolve();
          const t = Math.min((Date.now() - t0) / ms, 1);
          setAngle(from + (to - from) * ease(t));
          if (t < 1) rafRef.current = requestAnimationFrame(tick);
          else resolve();
        }
        rafRef.current = requestAnimationFrame(tick);
      });
    }

    const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    async function cycle() {
      setAngle(OPEN);
      while (!cancelRef.current) {
        await wait(rand(2500, 6500));
        if (cancelRef.current) break;
        await tween(OPEN, 0, rand(350, 700));
        await wait(rand(100, 300));
        await tween(0, OPEN, rand(400, 900));
      }
    }

    cancelRef.current = false;
    cycle();
    return () => {
      cancelRef.current = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Scale the aperture SVG to fit the avatar size
  const svgSize = size * 0.85;

  return (
    <View style={[{
      width: size, height: size,
      borderRadius: size * 0.22,
      borderWidth: 1.5,
      borderColor: C.goldBorder,
      backgroundColor: '#091622',
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    }, style]}>
      <Svg width={svgSize} height={svgSize} viewBox="-65 -65 130 130">
        <Defs>
          <RadialGradient id={`cg-orb-${size}`} gradientUnits="userSpaceOnUse" cx="0" cy="0" r="42" fx="0" fy="0">
            <Stop offset="0%"   stopColor="#fee229" stopOpacity={1}   />
            <Stop offset="30%"  stopColor="#fee229" stopOpacity={0.8} />
            <Stop offset="60%"  stopColor="#d4b800" stopOpacity={0.4} />
            <Stop offset="100%" stopColor="#000000" stopOpacity={0}   />
          </RadialGradient>
        </Defs>
        {/* Dark backing */}
        <Circle r={60} fill="#091622" />
        {/* Gold gradient */}
        <Circle r={42} fill={`url(#cg-orb-${size})`} />
        {/* Blades */}
        {ROTS.map(rot => (
          <G key={rot} transform={`rotate(${rot})`}>
            <Path
              d={BLADE}
              fill="#2a6bb0"
              stroke="#ffffed"
              strokeWidth={1.3}
              rotation={angle}
              originX={0}
              originY={-52}
            />
          </G>
        ))}
        {/* Housing ring */}
        <Circle r={51} fill="none" stroke="#091622" strokeWidth={18} />
        {/* Outer rim */}
        <Circle r={60} fill="none" stroke="#ffffed" strokeWidth={3} />
        <Circle r={57.5} fill="none" stroke="#0a1e30" strokeWidth={1.5} />
      </Svg>
    </View>
  );
}
