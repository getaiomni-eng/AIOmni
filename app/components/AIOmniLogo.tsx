// app/components/AIOmniLogo.tsx
// v26 animated logo — aperture blink, hex pulse, color cycle
// Uses react-native-svg (already in project via TabIcon)

import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, G, Path, Polygon, RadialGradient, Stop, Text as SvgText } from 'react-native-svg';

const BLADE = "M 3,-52 L -48,6 C -44,20 -32,40 -16,50 L 14,-14 Z";
const ROTS  = [0, 60, 120, 180, 240, 300];
const OPEN  = 70;

export function AIOmniLogo({ width = 280 }: { width?: number }) {
  const height     = width * 0.5;
  const [angle, setAngle] = useState(OPEN);
  const cancelRef  = useRef(false);
  const rafRef     = useRef<any>(null);

  // Color cycle state: 0=gold, 1=blue, 2=cream
  const [colorIdx, setColorIdx] = useState(0);
  const COLORS = ['#fee229', '#3d6aaa', '#ffffed'];
  const hexColor = COLORS[colorIdx];

  useEffect(() => {
    const timer = setInterval(() => setColorIdx(i => (i + 1) % 3), 2000);
    return () => clearInterval(timer);
  }, []);

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
        const wide = Math.random() < 0.2;
        await tween(OPEN, 0, wide ? rand(700, 1200) : rand(350, 700));
        await wait(wide ? rand(300, 600) : rand(100, 300));
        await tween(0, OPEN, wide ? rand(800, 1400) : rand(400, 800));
        if (Math.random() < 0.12) {
          await wait(rand(200, 400));
          await tween(OPEN, 0, rand(250, 450));
          await wait(rand(80, 160));
          await tween(0, OPEN, rand(350, 600));
        }
      }
    }

    cancelRef.current = false;
    cycle();
    return () => {
      cancelRef.current = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height} viewBox="0 0 1040 520">
        <Defs>
          <RadialGradient id="cgL" gradientUnits="userSpaceOnUse" cx="410" cy="260" r="42" fx="410" fy="260">
            <Stop offset="0%"   stopColor="#fee229" stopOpacity={1}   />
            <Stop offset="25%"  stopColor="#fee229" stopOpacity={0.85}/>
            <Stop offset="50%"  stopColor="#d4b800" stopOpacity={0.45}/>
            <Stop offset="75%"  stopColor="#2a2000" stopOpacity={0.12}/>
            <Stop offset="100%" stopColor="#000000" stopOpacity={0}   />
          </RadialGradient>
        </Defs>

        {/* Black shadow hex */}
        <Polygon
          points="310,50 490,154 490,366 310,470 130,366 130,154"
          fill="none" stroke="#000000" strokeWidth={34} strokeLinejoin="round"
        />
        {/* Color cycling outer hex */}
        <Polygon
          points="310,50 490,154 490,366 310,470 130,366 130,154"
          fill="none" stroke={hexColor} strokeWidth={28} strokeLinejoin="round"
        />

        {/* A */}
        <SvgText x="152" y="316" fontFamily="BebasNeue_400Regular" fontSize="142"
          fill={hexColor} stroke={hexColor} strokeWidth="3">A</SvgText>

        {/* I */}
        <SvgText x="268" y="316" fontFamily="BebasNeue_400Regular" fontSize="142"
          fill={hexColor} stroke={hexColor} strokeWidth="3">I</SvgText>

        {/* Aperture O */}
        <G transform="translate(410,260)">
          <Circle r={60} fill="#091622" />
          <Circle r={42} fill="url(#cgL)" />
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
          <Circle r={51} fill="none" stroke="#091622" strokeWidth={18} />
          <Circle r={60} fill="none" stroke="#ffffed" strokeWidth={3} />
          <Circle r={57.5} fill="none" stroke="#0a1e30" strokeWidth={1.5} />
        </G>

        {/* mni */}
        <SvgText x="514" y="316" fontFamily="BebasNeue_400Regular" fontSize="88"
          letterSpacing="2" fill={hexColor} stroke={hexColor} strokeWidth="3">mni</SvgText>
      </Svg>
    </View>
  );
}
