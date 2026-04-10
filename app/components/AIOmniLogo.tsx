import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Svg, {
  Circle, ClipPath, Defs, G, Path, Polygon,
  Text as SvgText,
} from 'react-native-svg';

const BLADES = [0, 60, 120, 180, 240, 300];
const OPEN_ANGLE = 55;

const ease = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const rand = (min: number, max: number) => min + Math.random() * (max - min);

function useApertureBlink(setAngle: React.Dispatch<React.SetStateAction<number>>) {
  const rafRef = useRef<number | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const tween = (from: number, to: number, duration: number) =>
      new Promise<void>(resolve => {
        const start = Date.now();
        const tick = () => {
          if (!active.current) return resolve();
          const elapsed = Date.now() - start;
          const t = Math.min(elapsed / duration, 1);
          setAngle(from + (to - from) * ease(t));
          if (t < 1) { rafRef.current = requestAnimationFrame(tick); } else { resolve(); }
        };
        rafRef.current = requestAnimationFrame(tick);
      });
    const pulse = async () => {
      while (active.current) {
        await new Promise(r => setTimeout(r, rand(2500, 6000)));
        if (!active.current) break;
        await tween(OPEN_ANGLE, 0, rand(350, 700));
        await new Promise(r => setTimeout(r, rand(100, 300)));
        await tween(0, OPEN_ANGLE, rand(400, 800));
        if (Math.random() < 0.15) {
          await new Promise(r => setTimeout(r, rand(200, 400)));
          await tween(OPEN_ANGLE, 0, rand(250, 450));
          await new Promise(r => setTimeout(r, rand(80, 160)));
          await tween(0, OPEN_ANGLE, rand(350, 600));
        }
      }
    };
    pulse();
    return () => { active.current = false; if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [setAngle]);
}

export function AIOmniIris({ width = 72 }: { width?: number }) {
  const [angle, setAngle] = useState(OPEN_ANGLE);
  useApertureBlink(setAngle);
  const BLADE = 'M0,0 L-16,-27.7 A32,32,0,0,1,16,-27.7 Z';
  const glowOpacity = 0.15 + (angle / OPEN_ANGLE) * 0.85;
  return (
    <View style={{ width, height: width }}>
      <Svg width={width} height={width} viewBox="0 0 64 64">
        <Circle cx="32" cy="32" r="30" fill="#091622" />
        <Circle cx="32" cy="32" r="24" fill="#fee229" opacity={glowOpacity} />
        <Defs><ClipPath id="iClip"><Circle cx="32" cy="32" r="24" /></ClipPath></Defs>
        <G clipPath="url(#iClip)">
          <G transform="translate(32,32)">
            {BLADES.map(rot => (
              <G key={rot} transform={`rotate(${rot}) translate(0,-27.7) rotate(${angle}) translate(0,27.7)`}>
                <Path d={BLADE} fill="#2a6bb0" stroke="#ffffed" strokeWidth={0.6} strokeLinejoin="round" />
              </G>
            ))}
          </G>
        </G>
        <Circle cx="32" cy="32" r="29" fill="none" stroke="#091622" strokeWidth={10} />
        <Circle cx="32" cy="32" r="30" fill="none" stroke="#ffffed" strokeWidth={1.5} />
      </Svg>
    </View>
  );
}

export function AIOmniLogo({ width = 280 }: { width?: number }) {
  const [angle, setAngle] = useState(OPEN_ANGLE);
  const [pulseScale, setPulseScale] = useState(0.04);
  const [pulseOpacity, setPulseOpacity] = useState(0);
  useApertureBlink(setAngle);

  const pulseRef = useRef<number | null>(null);
  const pulseActive = useRef(true);
  useEffect(() => {
    pulseActive.current = true;
    let t = 0;
    const tick = () => {
      if (!pulseActive.current) return;
      t += 0.008;
      if (t > 1) t = 0;
      setPulseScale(0.04 + t * 0.96);
      setPulseOpacity(t < 0.5 ? t * 1.4 : Math.max(0, (1 - t) * 1.4));
      pulseRef.current = requestAnimationFrame(tick);
    };
    pulseRef.current = requestAnimationFrame(tick);
    return () => { pulseActive.current = false; if (pulseRef.current !== null) cancelAnimationFrame(pulseRef.current); };
  }, []);

  const h = Math.round(width * (140 / 340));
  const vb = '0 0 340 140';
  const HEX = '110,5 170,40 170,100 110,135 50,100 50,40';
  const ix = 148, iy = 70;
  const iOuter = 20, iClip = 14;
  const BLADE = 'M0,0 L-9.3,-16.2 A18.7,18.7,0,0,1,9.3,-16.2 Z';
  const glowOpacity = 0.15 + (angle / OPEN_ANGLE) * 0.85;

  return (
    <View style={{ width, height: h, alignItems: 'center' }}>
      <Svg width={width} height={h} viewBox={vb}>
        <Defs>
          <ClipPath id="lClip"><Circle cx={ix} cy={iy} r={iClip} /></ClipPath>
        </Defs>

        {/* Hex pulse — born small, expands to border, fades */}
        <G transform="translate(110,70)">
          <Polygon
            points="0,-65 56.3,-32.5 56.3,32.5 0,65 -56.3,32.5 -56.3,-32.5"
            fill="none" stroke="#fee229" strokeWidth={3} strokeLinejoin="round"
            opacity={pulseOpacity}
            transform={`scale(${pulseScale})`}
          />
        </G>

        {/* Hex — black outline outside */}
        <Polygon points={HEX} fill="none" stroke="#1a1f2e" strokeWidth={8} strokeLinejoin="round" />
        {/* Hex — gold main */}
        <Polygon points={HEX} fill="none" stroke="#fee229" strokeWidth={5} strokeLinejoin="round" />
        {/* Hex — black outline inside */}
        <Polygon points={HEX} fill="none" stroke="#1a1f2e" strokeWidth={1.5} strokeLinejoin="round" />

        {/* "A" — gold base layer */}
        <SvgText x="58" y="95" fontFamily="Bungee_400Regular" fontSize="52" fill="#fee229" stroke="#fee229" strokeWidth={2} letterSpacing={1}>A</SvgText>
        {/* "A" — black inline overlay */}
        <SvgText x="58" y="95" fontFamily="BungeeInline_400Regular" fontSize="52" fill="#1a1f2e" stroke="#fee229" strokeWidth={1} letterSpacing={1}>A</SvgText>

        {/* "I" — gold base */}
        <SvgText x="96" y="95" fontFamily="Bungee_400Regular" fontSize="52" fill="#fee229" stroke="#fee229" strokeWidth={2} letterSpacing={1}>I</SvgText>
        {/* "I" — black inline overlay */}
        <SvgText x="96" y="95" fontFamily="BungeeInline_400Regular" fontSize="52" fill="#1a1f2e" stroke="#fee229" strokeWidth={1} letterSpacing={1}>I</SvgText>

        {/* Iris — black center */}
        <Circle cx={ix} cy={iy} r={iOuter} fill="#091622" />
        {/* Gold glow orb */}
        <Circle cx={ix} cy={iy} r={iClip} fill="#fee229" opacity={glowOpacity} />

        {/* 6 blades — blue, cream stroke, pivot from outer edge */}
        <G clipPath="url(#lClip)">
          <G transform={`translate(${ix},${iy})`}>
            {BLADES.map(rot => (
              <G key={rot} transform={`rotate(${rot}) translate(0,-16.2) rotate(${angle}) translate(0,16.2)`}>
                <Path d={BLADE} fill="#2a6bb0" stroke="#ffffed" strokeWidth={0.4} strokeLinejoin="round" />
              </G>
            ))}
          </G>
        </G>

        {/* Dark annular ring */}
        <Circle cx={ix} cy={iy} r={17} fill="none" stroke="#091622" strokeWidth={6} />
        {/* Outer rim */}
        <Circle cx={ix} cy={iy} r={iOuter} fill="none" stroke="#ffffed" strokeWidth={1.2} />
        <Circle cx={ix} cy={iy} r={14.5} fill="none" stroke="#1a3a5a" strokeWidth={0.4} />

        {/* "mni" — gold base */}
        <SvgText x="178" y="90" fontFamily="Bungee_400Regular" fontSize="34" fill="#fee229" stroke="#fee229" strokeWidth={1.5} letterSpacing={2}>mni</SvgText>
        {/* "mni" — black inline overlay */}
        <SvgText x="178" y="90" fontFamily="BungeeInline_400Regular" fontSize="34" fill="#1a1f2e" stroke="#fee229" strokeWidth={0.8} letterSpacing={2}>mni</SvgText>
      </Svg>
    </View>
  );
}
