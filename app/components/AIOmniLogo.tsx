import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Path, Polygon, RadialGradient, Stop, Text as SvgText } from 'react-native-svg';

const BLADES = [0, 60, 120, 180, 240, 300];
const BLADE_PATH = 'M 0,0 L -20,-36 A 44,44 0 0,1 20,-36 Z';

const ease = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const rand = (min: number, max: number) => min + Math.random() * (max - min);

function useApertureBlink(setAngle: React.Dispatch<React.SetStateAction<number>>) {
  const rafRef = useRef<number | null>(null);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;

    const tween = (from: number, to: number, duration: number) => new Promise<void>(resolve => {
      const start = Date.now();
      const tick = () => {
        if (!active.current) return resolve();
        const elapsed = Date.now() - start;
        const t = Math.min(elapsed / duration, 1);
        setAngle(from + (to - from) * ease(t));
        if (t < 1) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          resolve();
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    });

    const pulse = async () => {
      while (active.current) {
        await new Promise(r => setTimeout(r, rand(2200, 5200)));
        if (!active.current) break;
        await tween(72, 4, rand(280, 620));
        await new Promise(r => setTimeout(r, rand(120, 260)));
        await tween(4, 72, rand(320, 680));
        if (Math.random() < 0.18) {
          await new Promise(r => setTimeout(r, rand(200, 380)));
          await tween(72, 4, rand(220, 420));
          await new Promise(r => setTimeout(r, rand(90, 160)));
          await tween(4, 72, rand(260, 520));
        }
      }
    };

    pulse();

    return () => {
      active.current = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [setAngle]);
}

export function AIOmniIris({ width = 72 }: { width?: number }) {
  const [angle, setAngle] = useState(72);
  useApertureBlink(setAngle);

  return (
    <View style={{ width, height: width }}>
      <Svg width={width} height={width} viewBox="0 0 104 104">
        <Defs>
          <RadialGradient id="irisGrad" cx="52" cy="52" r="42" fx="52" fy="52">
            <Stop offset="0%" stopColor="#fee229" stopOpacity="0.96" />
            <Stop offset="50%" stopColor="#3d6aaa" stopOpacity="0.24" />
            <Stop offset="100%" stopColor="#081623" stopOpacity="0.16" />
          </RadialGradient>
          <ClipPath id="irisClip">
            <Circle cx="52" cy="52" r="42" />
          </ClipPath>
        </Defs>
        <G transform="translate(52,52)">
          <Circle r={52} fill="#091622" />
          <Circle r={42} fill="url(#irisGrad)" />
          <G clipPath="url(#irisClip)">
            {BLADES.map(rot => (
              <G key={rot} transform={`rotate(${rot})`}>
                <Path
                  d={BLADE_PATH}
                  fill="#2a6bb0"
                  stroke="#ffffed"
                  strokeWidth={1.3}
                  rotation={angle}
                  originX={0}
                  originY={-30}
                />
              </G>
            ))}
          </G>
          <Circle r={44} fill="none" stroke="#091622" strokeWidth={8} />
          <Circle r={52} fill="none" stroke="#ffffed" strokeWidth={2.4} />
        </G>
      </Svg>
    </View>
  );
}

export function AIOmniLogo({ width = 280, height }: { width?: number; height?: number }) {
  const [angle, setAngle] = useState(72);
  useApertureBlink(setAngle);
  const actualHeight = height || Math.round(width * 0.36);

  return (
    <View style={{ width, height: actualHeight }}>
      <Svg width={width} height={actualHeight} viewBox="0 0 280 102">
        <Defs>
          <RadialGradient id="logoGrad" cx="0.5" cy="0.5" r="0.6">
            <Stop offset="0%" stopColor="#fff2ab" stopOpacity="0.92" />
            <Stop offset="100%" stopColor="#f7d12c" stopOpacity="0.28" />
          </RadialGradient>
          <ClipPath id="logoIrisClip">
            <Circle cx="162" cy="51" r="30" />
          </ClipPath>
        </Defs>

        <Polygon
          points="68,10 212,10 268,51 212,92 68,92 12,51"
          fill="none"
          stroke="#fee229"
          strokeWidth={10}
          strokeLinejoin="round"
        />

        <SvgText x="20" y="72" fontFamily="BebasNeue_400Regular" fontSize="70" fill="#fee229" letterSpacing="-1">
          AI
        </SvgText>

        <G transform="translate(162,51)">
          <Circle r={30} fill="#091622" />
          <Circle r={22} fill="url(#logoGrad)" />
          <G clipPath="url(#logoIrisClip)">
            {BLADES.map(rot => (
              <G key={rot} transform={`rotate(${rot})`}>
                <Path
                  d={BLADE_PATH}
                  fill="#2a6bb0"
                  stroke="#ffffed"
                  strokeWidth={1.2}
                  rotation={angle}
                  originX={0}
                  originY={-30}
                />
              </G>
            ))}
          </G>
          <Circle r={26} fill="none" stroke="#091622" strokeWidth={6} />
          <Circle r={30} fill="none" stroke="#ffffed" strokeWidth={2} />
        </G>

        <SvgText x="190" y="72" fontFamily="BebasNeue_400Regular" fontSize="44" fill="#fee229" letterSpacing="2">
          mni
        </SvgText>
      </Svg>
    </View>
  );
}
