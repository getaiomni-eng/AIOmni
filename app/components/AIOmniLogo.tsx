import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Svg, {
  Circle, ClipPath, Defs, G, Path, Polygon,
  Text as SvgText, Rect,
} from 'react-native-svg';

const BLADES = [0, 60, 120, 180, 240, 300];

// v27 pie-sector blade: M 0,0 L -28,-48.5 A 56,56 0 0,1 28,-48.5 Z
// These are large pie sectors radiating from center, clipped to iris circle

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

// ── Standalone Iris (for AI Coach bar, etc.) ──────────────────
export function AIOmniIris({ width = 72 }: { width?: number }) {
  const [angle, setAngle] = useState(0);
  useApertureBlink(setAngle);

  // 64x64 viewBox, iris clip r=26, center 32,32
  // Scale from reference (r=42 clip): 26/42 = 0.619
  // Blade: M 0,0 L -17.3,-30 A 34.7,34.7 0 0,1 17.3,-30 Z
  const IRIS_BLADE = 'M0,0 L-17.3,-30 A34.7,34.7,0,0,1,17.3,-30 Z';

  return (
    <View style={{ width, height: width }}>
      <Svg width={width} height={width} viewBox="0 0 64 64">
        {/* Outer dark rim */}
        <Circle cx="32" cy="32" r="30" fill="#091622" />
        {/* Cream disc */}
        <Circle cx="32" cy="32" r="26" fill="#f5eecc" />
        <Defs>
          <ClipPath id="iClip">
            <Circle cx="32" cy="32" r="26" />
          </ClipPath>
        </Defs>
        {/* 6 pie-sector blades */}
        <G clipPath="url(#iClip)">
          <G transform="translate(32,32)">
            {BLADES.map(rot => (
              <G key={rot} transform={`rotate(${rot + angle})`}>
                <Path
                  d={IRIS_BLADE}
                  fill="#1a2540"
                  stroke="#3d6aaa"
                  strokeWidth={0.6}
                />
              </G>
            ))}
          </G>
        </G>
        {/* Gold hex pupil */}
        <Polygon
          points="32,26 36.5,29 36.5,35 32,38 27.5,35 27.5,29"
          fill="#fee229"
          stroke="#3d6aaa"
          strokeWidth={0.8}
        />
        {/* Rims */}
        <Circle cx="32" cy="32" r="26" fill="none" stroke="#3d6aaa" strokeWidth={2} />
        <Circle cx="32" cy="32" r="30" fill="none" stroke="#3d6aaa" strokeWidth={1.5} />
      </Svg>
    </View>
  );
}

// ── Full Logo (home screen, settings header) ──────────────────
export function AIOmniLogo({ width = 280 }: { width?: number }) {
  const [angle, setAngle] = useState(0);
  const [pulseOpacity, setPulseOpacity] = useState(0);
  useApertureBlink(setAngle);

  // Hex pulse animation
  const pulseRef = useRef<number | null>(null);
  const pulseActive = useRef(true);

  useEffect(() => {
    pulseActive.current = true;
    let phase = 0;
    const tick = () => {
      if (!pulseActive.current) return;
      phase += 0.03;
      setPulseOpacity(Math.max(0, Math.sin(phase) * 0.4));
      pulseRef.current = requestAnimationFrame(tick);
    };
    pulseRef.current = requestAnimationFrame(tick);
    return () => {
      pulseActive.current = false;
      if (pulseRef.current !== null) cancelAnimationFrame(pulseRef.current);
    };
  }, []);

  const h = Math.round(width * 0.42);
  const vb = '0 0 300 126';

  // Iris center & sizing
  const ix = 172;
  const iy = 63;
  const ir = 28;  // outer rim
  const iir = 24; // cream disc / clip radius

  // Scale from reference (r=42 clip): 24/42 = 0.571
  // Blade: M 0,0 L -16,-27.7 A 32,32 0 0,1 16,-27.7 Z
  const LOGO_BLADE = 'M0,0 L-16,-27.7 A32,32,0,0,1,16,-27.7 Z';

  // Hex points for outer border
  const HEX = '72,10 228,10 282,63 228,116 72,116 18,63';

  return (
    <View style={{ width, height: h, alignItems: 'center' }}>
      <Svg width={width} height={h} viewBox={vb}>
        <Defs>
          <ClipPath id="lClip">
            <Circle cx={ix} cy={iy} r={iir} />
          </ClipPath>
        </Defs>

        {/* ── Hex pulse wave (breathes behind border) ── */}
        <Polygon
          points={HEX}
          fill="none"
          stroke="#fee229"
          strokeWidth={12}
          strokeLinejoin="round"
          opacity={pulseOpacity}
        />

        {/* ── Outer hex border — gold ── */}
        <Polygon
          points={HEX}
          fill="none"
          stroke="#fee229"
          strokeWidth={6}
          strokeLinejoin="round"
        />

        {/* ── AI text ── */}
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

        {/* ── Iris dark backing ── */}
        <Circle cx={ix} cy={iy} r={ir} fill="#091622" />
        {/* Cream disc */}
        <Circle cx={ix} cy={iy} r={iir} fill="#f5eecc" />

        {/* ── 6 pie-sector blades, clipped to iris ── */}
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

        {/* ── Gold hex pupil ── */}
        <Polygon
          points={`${ix},${iy - 6} ${ix + 5.2},${iy - 3} ${ix + 5.2},${iy + 3} ${ix},${iy + 6} ${ix - 5.2},${iy + 3} ${ix - 5.2},${iy - 3}`}
          fill="#fee229"
          stroke="#3d6aaa"
          strokeWidth={0.8}
        />

        {/* ── Iris rims ── */}
        <Circle cx={ix} cy={iy} r={iir} fill="none" stroke="#3d6aaa" strokeWidth={1.8} />
        <Circle cx={ix} cy={iy} r={ir} fill="none" stroke="#3d6aaa" strokeWidth={1.5} />

        {/* ── mni text ── */}
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
