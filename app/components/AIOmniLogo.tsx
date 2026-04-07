import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Path, Polygon, Text as SvgText } from 'react-native-svg';

const BLADES = [0, 60, 120, 180, 240, 300];
const BLADE_PATH = 'M-5.57,-11.96 A13,13,0,0,1,5.57,-11.96 L2.14,-4.7 A5,5,0,0,0,-2.14,-4.7 Z';

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
        await new Promise(r => setTimeout(r, rand(2500, 5500)));
        if (!active.current) break;
        // Close
        await tween(0, 12, rand(250, 550));
        await new Promise(r => setTimeout(r, rand(100, 250)));
        // Open
        await tween(12, 0, rand(300, 650));
        // Occasional double blink
        if (Math.random() < 0.2) {
          await new Promise(r => setTimeout(r, rand(180, 350)));
          await tween(0, 10, rand(200, 400));
          await new Promise(r => setTimeout(r, rand(80, 150)));
          await tween(10, 0, rand(250, 500));
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
  const [angle, setAngle] = useState(0);
  useApertureBlink(setAngle);
  const s = width / 64;

  return (
    <View style={{ width, height: width }}>
      <Svg width={width} height={width} viewBox="0 0 64 64">
        <Circle cx="32" cy="32" r="30" fill="#091622" />
        <Circle cx="32" cy="32" r="26" fill="#f5eecc" />
        <Defs>
          <ClipPath id="iClip">
            <Circle cx="32" cy="32" r="26" />
          </ClipPath>
        </Defs>
        <G clipPath="url(#iClip)">
          <G transform="translate(32,32)">
            {BLADES.map(rot => (
              <G key={rot} transform={`rotate(${rot + angle})`}>
                <Path
                  d={BLADE_PATH}
                  fill="#1a2540"
                  stroke="#3d6aaa"
                  strokeWidth={0.5}
                />
              </G>
            ))}
          </G>
        </G>
        <Polygon
          points="32,28 35.46,30 35.46,34 32,36 28.54,34 28.54,30"
          fill="#fee229"
          stroke="#3d6aaa"
          strokeWidth={0.8}
        />
        <Circle cx="32" cy="32" r="26" fill="none" stroke="#3d6aaa" strokeWidth={2} />
        <Circle cx="32" cy="32" r="30" fill="none" stroke="#3d6aaa" strokeWidth={1.5} />
      </Svg>
    </View>
  );
}

export function AIOmniLogo({ width = 280 }: { width?: number }) {
  const [angle, setAngle] = useState(0);
  useApertureBlink(setAngle);

  const h = Math.round(width * 0.42);
  const vb = '0 0 300 126';

  // Iris center position
  const ix = 172;
  const iy = 63;
  const ir = 28; // iris outer radius
  const iir = 22; // iris inner (cream) radius

  // Scale blade path for this size
  const LOGO_BLADE = 'M-4.8,-10.3 A11.2,11.2,0,0,1,4.8,-10.3 L1.8,-4 A4.3,4.3,0,0,0,-1.8,-4 Z';

  return (
    <View style={{ width, height: h, alignItems: 'center' }}>
      <Svg width={width} height={h} viewBox={vb}>
        <Defs>
          <ClipPath id="lClip">
            <Circle cx={ix} cy={iy} r={iir} />
          </ClipPath>
        </Defs>

        {/* Outer hex border */}
        <Polygon
          points="72,10 228,10 282,63 228,116 72,116 18,63"
          fill="none"
          stroke="#fee229"
          strokeWidth={6}
          strokeLinejoin="round"
        />

        {/* AI text */}
        <SvgText
          x="52"
          y="88"
          fontFamily="BebasNeue_400Regular"
          fontSize="72"
          fill="#fee229"
          letterSpacing={2}
        >
          AI
        </SvgText>

        {/* Iris — dark backing */}
        <Circle cx={ix} cy={iy} r={ir} fill="#091622" />
        {/* Cream disc */}
        <Circle cx={ix} cy={iy} r={iir} fill="#f5eecc" />

        {/* 6 blades clipped to iris */}
        <G clipPath="url(#lClip)">
          <G transform={`translate(${ix},${iy})`}>
            {BLADES.map(rot => (
              <G key={rot} transform={`rotate(${rot + angle})`}>
                <Path
                  d={LOGO_BLADE}
                  fill="#1a2540"
                  stroke="#3d6aaa"
                  strokeWidth={0.5}
                />
              </G>
            ))}
          </G>
        </G>

        {/* Gold hex pupil */}
        <Polygon
          points={`${ix},${iy - 4} ${ix + 3.46},${iy - 2} ${ix + 3.46},${iy + 2} ${ix},${iy + 4} ${ix - 3.46},${iy + 2} ${ix - 3.46},${iy - 2}`}
          fill="#fee229"
          stroke="#3d6aaa"
          strokeWidth={0.8}
        />

        {/* Iris rim */}
        <Circle cx={ix} cy={iy} r={iir} fill="none" stroke="#3d6aaa" strokeWidth={1.8} />
        <Circle cx={ix} cy={iy} r={ir} fill="none" stroke="#3d6aaa" strokeWidth={1.5} />

        {/* mni text */}
        <SvgText
          x="200"
          y="88"
          fontFamily="BebasNeue_400Regular"
          fontSize="52"
          fill="#fee229"
          letterSpacing={3}
        >
          mni
        </SvgText>
      </Svg>
    </View>
  );
}