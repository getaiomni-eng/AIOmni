#!/usr/bin/env python3
"""Reskin league.tsx from cream/bevel to V7 dark theme."""

import os

FILE = 'app/league.tsx'

RULES = [
    # ── LinearGradient removal ──
    ("import { LinearGradient } from 'expo-linear-gradient';", ""),
    ("<LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>", "<View style={{ flex: 1, backgroundColor: '#0a1214' }}>"),
    ("</LinearGradient>", "</View>"),

    # ── Card surface constants ──
    ("const SURFACE     = 'rgba(255,255,255,0.88)';", "const SURFACE     = '#12252e';"),
    ("const BORDER      = 'rgba(88,131,191,0.32)';", "const BORDER      = '#1a3542';"),
    ("const DIM_BORDER  = 'rgba(88,131,191,0.14)';", "const DIM_BORDER  = '#14282f';"),
    ("const BEVEL_HI    = 'rgba(255,255,255,0.95)';", "const BEVEL_HI    = 'transparent';"),
    ("const BEVEL_LO    = 'rgba(88,131,191,0.28)';", "const BEVEL_LO    = '#1a3542';"),
    ("const INNER_GLOW  = 'rgba(254,226,41,0.10)';", "const INNER_GLOW  = 'rgba(27,231,255,0.05)';"),

    # ── Gold → amber ──
    ("'#fee229'", "'#ffb800'"),
    ('#fee229', '#ffb800'),

    # ── Blue → aqua ──
    ("'#3d6aaa'", "'#1be7ff'"),
    ('#3d6aaa', '#1be7ff'),
    ("'#5883bf'", "'#1be7ff'"),
    ('#5883bf', '#1be7ff'),

    # ── Header bg ──
    ("backgroundColor: 'rgba(255,255,237,0.85)'", "backgroundColor: '#0a1214'"),
    ("backgroundColor: 'rgba(255,255,237,0.9)'", "backgroundColor: '#0a1214'"),

    # ── Tab styling ──
    ("backgroundColor: C.glass", "backgroundColor: '#12252e'"),
    ("borderColor: C.glassBorder", "borderColor: '#1a3542'"),
    ("borderTopColor: C.glassShine", "borderTopColor: '#1a3542'"),
    ("borderLeftColor: C.surfShine", "borderLeftColor: '#1a3542'"),
    ("borderBottomColor: C.sageBorder", "borderBottomColor: '#1a3542'"),
    ("borderRightColor: C.sageBorder", "borderRightColor: '#1a3542'"),

    # ── Modal backgrounds ──
    ("backgroundColor: '#ffffff'", "backgroundColor: '#12252e'"),
    ("backgroundColor: 'rgba(26,31,46,0.55)'", "backgroundColor: 'rgba(10,18,20,0.7)'"),

    # ── Text colors ──
    ("color: C.ink", "color: '#f0f4f5'"),
    ("color:C.ink", "color:'#f0f4f5'"),

    # ── Section count bg ──
    ("backgroundColor: 'rgba(26,31,46,0.06)'", "backgroundColor: 'rgba(27,231,255,0.08)'"),

    # ── Shadow cleanup ──
    ("shadowColor: '#1be7ff'", "shadowColor: '#000'"),

    # ── Remove LeagueAvatar radar fallback — replace with simple platform badge ──
    # The animated radar is the spinning crosshair icon
    # We'll replace the entire LeagueAvatar component usage in the header
    # by making the fallback just show a colored letter instead of radar animation

    # ── AI tag bg ──
    ("backgroundColor: C.goldS", "backgroundColor: 'rgba(27,231,255,0.08)'"),
    ("borderColor: C.goldBorder", "borderColor: '#1a3542'"),

    # ── Section accent bar ──
    ("backgroundColor: C.gold", "backgroundColor: '#ffb800'"),

    # ── Section count border ──
    # Already handled by goldBorder → 1a3542

    # ── Close button bg ──
    ("backgroundColor: C.sageS", "backgroundColor: '#0f1c22'"),

    # ── Got it button ──
    ("backgroundColor: C.gold", "backgroundColor: '#ffb800'"),

    # ── Standings rank text shadow ──
    ("textShadowColor: 'rgba(61,106,170,0.3)'", "textShadowColor: 'rgba(0,0,0,0.3)'"),
]

def main():
    if not os.path.exists(FILE):
        print(f"ERROR: {FILE} not found")
        return

    with open(FILE, 'r') as f:
        content = f.read()

    original = content
    for find, replace in RULES:
        content = content.replace(find, replace)

    # Kill the radar animation in LeagueAvatar fallback
    # Replace the animated radar with a simple platform letter
    old_fallback = """  const spin = rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', backgroundColor: C.goldS, borderWidth: 1.5, borderColor: C.goldBorder, borderRadius: R.xs }}>
      {[0.85, 0.6, 0.35].map((scale, i) => (
        <View key={i} style={{ position: 'absolute', width: size * scale, height: size * scale, borderRadius: size * scale / 2, borderWidth: 1, borderColor: `rgba(61,106,170,${0.18 - i * 0.04})` }} />
      ))}
      <View style={{ position: 'absolute', width: size * 0.7, height: 1, backgroundColor: C.goldBorder }} />
      <View style={{ position: 'absolute', width: 1, height: size * 0.7, backgroundColor: C.goldBorder }} />
      <Animated.View style={{ position: 'absolute', width: (size / 2) * 0.8, height: 1, backgroundColor: C.gold, left: size / 2, top: size / 2 - 0.5, transformOrigin: 'left center', transform: [{ rotate: spin }], opacity: 0.8 }} />
      <Animated.View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: C.gold, opacity: pulse }} />
    </View>
  );"""

    new_fallback = """  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', backgroundColor: '#12252e', borderWidth: 1.5, borderColor: '#1a3542', borderRadius: R.xs }}>
      <Text style={{ fontFamily: F.bold, fontSize: size * 0.4, color: '#1be7ff' }}>L</Text>
    </View>
  );"""

    content = content.replace(old_fallback, new_fallback)

    if content != original:
        with open(FILE, 'w') as f:
            f.write(content)
        print(f"  ✓ {FILE} reskinned")
    else:
        print(f"  – {FILE} (no changes)")

if __name__ == '__main__':
    main()
