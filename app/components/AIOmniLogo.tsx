import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Svg, {
  Circle, ClipPath, Defs, G, Path, Polygon,
  Text as SvgText,
} from 'react-native-svg';

const BLADES = [0, 60, 120, 180, 240, 300];

// v27 pie-sector blade (scaled to clip r=14 for logo, r=24 for iris)
// Full 60° sectors — gaps appear when rotated to OPEN_ANGLE
// HTML reference: M 0,0 L -28,-48.5 A 56,56 0 0,1 28,-48.5 Z at clip r=42

const OPEN_ANGLE = 55; // blades start rotated = gaps visible = iris OPEN

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
        // Wait open
        await new Promise(r => setTimeout(r, rand(2500, 6000)));
        if (!active.current) break;
        // Close (OPEN_ANGLE → 0)
        await tween(OPEN_ANGLE, 0, rand(350, 700));
        // Hold closed
        await new Promise(r => setTimeout(r, rand(100, 300)));
        // Open (0 → OPEN_ANGLE)
        await tween(0, OPEN_ANGLE, rand(400, 800));
        // Occasional double blink
        if (Math.random() < 0.15) {
          await new Promise(r => setTimeout(r, rand(200, 400)));
          await tween(OPEN_ANGLE, 0, rand(250, 450));
          await new Promise(r => setTimeout(r, rand(80, 160)));
          await tween(0, OPEN_ANGLE, rand(350, 600));
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

// ── Standalone Iris (AI Coach bar, nav) ───────────────────────
export function AIOmniIris({ width = 72 }: { width?: number }) {
  const [angle, setAngle] = useState(OPEN_ANGLE);
  useApertureBlink(setAngle);

  // 64x64 viewBox, center 32,32
  // Scaled from HTML (clip r=42): using clip r=24, scale=0.571
  // Blade: M 0,0 L -16,-27.7 A 32,32 0 0,1 16,-27.7 Z
  const BLADE = 'M0,0 L-16,-27.7 A32,32,0,0,1,16,-27.7 Z';
  const glowOpacity = 0.15 + (angle / OPEN_ANGLE) * 0.85;

  return (
    <View style={{ width, height: width }}>
      <Svg width={width} height={width} viewBox="0 0 64 64">
        {/* Dark backing */}
        <Circle cx="32" cy="32" r="30" fill="#091622" />
        {/* Gold glow disc — visible through blade gaps */}
        <Circle cx="32" cy="32" r="24" fill="#fee229" opacity={glowOpacity} />
        <Defs>
          <ClipPath id="iClip">
            <Circle cx="32" cy="32" r="24" />
          </ClipPath>
        </Defs>
        {/* 6 pie-sector blades — BLUE fill, cream stroke */}
        <G clipPath="url(#iClip)">
          <G transform="translate(32,32)">
            {BLADES.map(rot => (
              <G key={rot} transform={`rotate(${rot + angle})`}>
                <Path d={BLADE} fill="#2a6bb0" stroke="#ffffed" strokeWidth={0.6} strokeLinejoin="round" />
              </G>
            ))}
          </G>
        </G>
        {/* Dark annular ring — masks outer blade edges */}
        <Circle cx="32" cy="32" r="29" fill="none" stroke="#091622" strokeWidth={10} />
        {/* Gold hex pupil */}
        <Polygon
          points="32,26 36.5,29 36.5,35 32,38 27.5,35 27.5,29"
          fill="#fee229" stroke="#3d6aaa" strokeWidth={0.6}
        />
        {/* Outer rim */}
        <Circle cx="32" cy="32" r="30" fill="none" stroke="#ffffed" strokeWidth={1.5} />
        <Circle cx="32" cy="32" r="24.5" fill="none" stroke="#1a3a5a" strokeWidth={0.5} />
      </Svg>
    </View>
  );
}

// ── Full Logo — hex wraps AIO only, mni outside ──────────────
export function AIOmniLogo({ width = 280 }: { width?: number }) {
  const [angle, setAngle] = useState(OPEN_ANGLE);
  const [pulseOpacity, setPulseOpacity] = useState(0);
  useApertureBlink(setAngle);

  // Hex pulse breathing
  const pulseRef = useRef<number | null>(null);
  const pulseActive = useRef(true);
  useEffect(() => {
    pulseActive.current = true;
    let phase = 0;
    const tick = () => {
      if (!pulseActive.current) return;
      phase += 0.025;
      setPulseOpacity(Math.max(0, Math.sin(phase) * 0.3));
      pulseRef.current = requestAnimationFrame(tick);
    };
    pulseRef.current = requestAnimationFrame(tick);
    return () => { pulseActive.current = false; if (pulseRef.current !== null) cancelAnimationFrame(pulseRef.current); };
  }, []);

  const h = Math.round(width * (140 / 340));
  const vb = '0 0 340 140';

  // Hex wraps AIO only — pointy top/bottom
  const HEX = '110,5 170,40 170,100 110,135 50,100 50,40';

  // Iris (the "O")
  const ix = 148, iy = 70;
  const iOuter = 20; // outer dark circle
  const iClip = 14;  // gold glow + clip radius

  // Blade scaled from HTML: 14/42 = 0.333
  // M 0,0 L -9.3,-16.2 A 18.7,18.7 0 0,1 9.3,-16.2 Z
  const BLADE = 'M0,0 L-9.3,-16.2 A18.7,18.7,0,0,1,9.3,-16.2 Z';

  // Annular ring: r=17, sw=6 (masks blade outer edges, ring from r=14 to r=20)
  const glowOpacity = 0.15 + (angle / OPEN_ANGLE) * 0.85;

  return (
    <View style={{ width, height: h, alignItems: 'center' }}>
      <Svg width={width} height={h} viewBox={vb}>
        <Defs>
          <ClipPath id="lClip">
            <Circle cx={ix} cy={iy} r={iClip} />
          </ClipPath>
        </Defs>

        {/* ── Hex pulse wave ── */}
        <Polygon
          points={HEX} fill="none" stroke="#fee229"
          strokeWidth={10} strokeLinejoin="round" opacity={pulseOpacity}
        />

        {/* ── Hex border — gold ── */}
        <Polygon
          points={HEX} fill="none" stroke="#fee229"
          strokeWidth={5} strokeLinejoin="round"
        />

        {/* ── "A" text ── */}
        <SvgText
          x="58" y="95" fontFamily="Bungee_400Regular"
          fontSize="52" fill="#fee229" letterSpacing={1}
        >A</SvgText>

        {/* ── "I" text ── */}
        <SvgText
          x="96" y="95" fontFamily="Bungee_400Regular"
          fontSize="52" fill="#fee229" letterSpacing={1}
        >I</SvgText>

        {/* ── Iris "O" ── */}
        {/* Dark backing */}
        <Circle cx={ix} cy={iy} r={iOuter} fill="#091622" />
        {/* Gold glow disc — shows through blade gaps */}
        <Circle cx={ix} cy={iy} r={iClip} fill="#fee229" opacity={glowOpacity} />

        {/* 6 pie-sector blades — blue, cream stroke */}
        <G clipPath="url(#lClip)">
          <G transform={`translate(${ix},${iy})`}>
            {BLADES.map(rot => (
              <G key={rot} transform={`rotate(${rot + angle})`}>
                <Path d={BLADE} fill="#2a6bb0" stroke="#ffffed" strokeWidth={0.4} strokeLinejoin="round" />
              </G>
            ))}
          </G>
        </G>

        {/* Dark annular ring — masks outer blade edges */}
        <Circle cx={ix} cy={iy} r={17} fill="none" stroke="#091622" strokeWidth={6} />

        {/* Outer iris rim */}
        <Circle cx={ix} cy={iy} r={iOuter} fill="none" stroke="#ffffed" strokeWidth={1.2} />
        <Circle cx={ix} cy={iy} r={14.5} fill="none" stroke="#1a3a5a" strokeWidth={0.4} />

        {/* ── "mni" text — OUTSIDE hex ── */}
        <SvgText
          x="178" y="90" fontFamily="Bungee_400Regular"
          fontSize="34" fill="#fee229" letterSpacing={2}
        >mni</SvgText>
      </Svg>
    </View>
  );
}