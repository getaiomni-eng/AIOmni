// app/components/TheOLogo.tsx
// ═══════════════════════════════════════════════════════════════════════════
// THE O — brand wordmark for the draft intelligence feature
// ═══════════════════════════════════════════════════════════════════════════
//
// "The O" is not a letter. It IS the AIOmni logo — the Spectrum C mark that
// also appears as the "O" in AIOmniWordmark and as the AI Coach tab icon.
// Using the same glyph in three places is deliberate: every "THE O" in the
// app reinforces the brand without a separate logo asset.
//
// ─── CONSTRUCTION ───────────────────────────────────────────────────────────
//   "THE"  → Audiowide_400Regular (same font as AIOmniWordmark's "AI" / "MNI")
//   "O"    → <AIOmniLogo /> — 85% Spectrum C arc, 15% gap facing down
//
// Default color for "THE" is #f0f4f5 (brand cream-white) — matches the
// AIOmniWordmark. Pass color="#ffb800" for amber-dominant surroundings, or
// color="#000" for the ASK THE O button on its amber background.
// The O ignores the color prop: its gradient is fixed brand art.
//
// ─── EXPORTS ────────────────────────────────────────────────────────────────
//   TheOLogo({fontSize, color})  → full "THE [Spectrum C]" wordmark
//   ApertureO({size})            → just the Spectrum C, for inline use
//                                  (e.g. the ASK THE O button splits "ASK THE"
//                                  text from the O glyph as siblings)
//
// ApertureO is a compatibility name retained from an earlier iteration — it
// simply renders AIOmniLogo. Any color / pupilColor props passed to it are
// accepted but ignored; the brand mark's gradient never changes.
// ═══════════════════════════════════════════════════════════════════════════

import React from 'react';
import { View, Text, TextStyle } from 'react-native';
import { AIOmniLogo } from './AIOmniLogo';

// ─── JUST THE O ─────────────────────────────────────────────────────────────

interface ApertureOProps {
  size: number;
  /** Accepted for backward compatibility; has no effect. */
  color?: string;
  /** Accepted for backward compatibility; has no effect. */
  pupilColor?: string;
}

export function ApertureO({ size }: ApertureOProps) {
  return <AIOmniLogo size={size} />;
}

// ─── FULL WORDMARK ──────────────────────────────────────────────────────────

interface TheOLogoProps {
  /** Matches the fontSize of the text the wordmark is replacing. */
  fontSize?: number;
  /** Color for the "THE" text. The O is always the brand Spectrum C gradient. */
  color?: string;
  /** Override if a particular surface demands a different brand font. */
  fontFamily?: string;
  /** Letter-spacing for "THE". Audiowide default works for most sizes. */
  letterSpacing?: number;
}

export function TheOLogo({
  fontSize = 36,
  color = '#f0f4f5',
  fontFamily = 'Audiowide_400Regular',
  letterSpacing = 0.5,
}: TheOLogoProps) {
  // 1.3× matches the oSize ratio AIOmniWordmark uses for its own "O" —
  // the Spectrum C needs to sit slightly larger than cap height to
  // visually balance with Audiowide's squared caps.
  const oSize = fontSize * 1.3;
  const gap = fontSize * 0.15;

  const textStyle: TextStyle = {
    fontFamily,
    fontSize,
    color,
    letterSpacing,
    // Removes phantom padding Android adds around text nodes
    includeFontPadding: false,
  } as any;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={textStyle}>THE</Text>
      <View style={{ marginLeft: gap }}>
        <AIOmniLogo size={oSize} />
      </View>
    </View>
  );
}
