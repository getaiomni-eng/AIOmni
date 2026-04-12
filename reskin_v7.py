#!/usr/bin/env python3
"""
AIOmni V7 Visual Reskin Script
Run this from the AIOmni project root.
Transforms coach.tsx, trade.tsx, rankings.tsx, settings.tsx, onboarding.tsx
from V6 cream/bevel theme to V7 dark/flat theme.

Usage: python3 reskin_v7.py
"""

import re
import os

# Files to transform
FILES = [
    'app/(tabs)/coach.tsx',
    'app/(tabs)/trade.tsx',
    'app/(tabs)/rankings.tsx',
    'app/(tabs)/settings.tsx',
    'app/onboarding.tsx',
]

# ─── REPLACEMENT RULES ──────────────────────────────────────
# Each tuple: (find, replace)
# Applied in order to every file

GLOBAL_RULES = [
    # ── Remove LinearGradient import and usage ──
    ("import { LinearGradient } from 'expo-linear-gradient';", ""),
    # Replace LinearGradient wrapper with plain View
    (r"<LinearGradient colors=\{[^}]+\} style=\{\{ flex: 1 \}\}>", "<View style={{ flex: 1, backgroundColor: '#0a1214' }}>"),
    (r"<LinearGradient colors=\{\[C\.bgTop, C\.bgBot\]\} style=\{\{ flex: 1 \}\}>", "<View style={{ flex: 1, backgroundColor: '#0a1214' }}>"),
    ("</LinearGradient>", "</View>"),

    # ── Surface/card backgrounds ──
    ("'rgba(255,255,255,0.92)'", "'#12252e'"),
    ("'rgba(255,255,255,0.90)'", "'#12252e'"),
    ("'rgba(255,255,255,0.95)'", "'#12252e'"),
    ("'rgba(255,255,255,0.9)'", "'#12252e'"),
    ("'rgba(255,255,255,0.85)'", "'#14282f'"),
    ("'rgba(255,255,255,0.6)'", "'#0f1c22'"),
    ("rgba(255,255,255,0.92)", "#12252e"),
    ("rgba(255,255,255,0.90)", "#12252e"),
    ("rgba(255,255,255,0.95)", "#14282f"),
    ("rgba(255,255,255,0.9)", "#12252e"),
    ("rgba(255,255,255,0.85)", "#14282f"),
    ("rgba(255,255,255,0.98)", "#1a3542"),
    ("rgba(217,253,243,0.9)", "#0f1c22"),
    ("rgba(217,253,243,0.8)", "#0f1c22"),

    # ── Border colors ──
    ("'rgba(88,131,191,0.32)'", "'#1a3542'"),
    ("'rgba(88,131,191,0.34)'", "'#1a3542'"),
    ("'rgba(88,131,191,0.38)'", "'#1a3542'"),
    ("'rgba(88,131,191,0.18)'", "'#1a3542'"),
    ("'rgba(88,131,191,0.25)'", "'#1a3542'"),
    ("'rgba(88,131,191,0.28)'", "'#1a3542'"),
    ("'rgba(88,131,191,0.45)'", "'#1a3542'"),
    ("'rgba(88,131,191,0.12)'", "'#14282f'"),
    ("'rgba(88,131,191,0.15)'", "'#14282f'"),
    ("'rgba(88,131,191,0.08)'", "'#0f1c22'"),
    ("'rgba(88,131,191,0.06)'", "'#0f1c22'"),
    ("rgba(88,131,191,0.32)", "#1a3542"),
    ("rgba(88,131,191,0.34)", "#1a3542"),
    ("rgba(88,131,191,0.38)", "#1a3542"),
    ("rgba(88,131,191,0.18)", "#1a3542"),
    ("rgba(88,131,191,0.25)", "#1a3542"),
    ("rgba(88,131,191,0.28)", "#1a3542"),
    ("rgba(88,131,191,0.45)", "#1a3542"),
    ("rgba(88,131,191,0.12)", "#14282f"),
    ("rgba(88,131,191,0.15)", "#14282f"),
    ("rgba(88,131,191,0.08)", "#0f1c22"),
    ("rgba(88,131,191,0.06)", "#0f1c22"),

    # ── Bevel shine removal ──
    ("borderTopColor: 'rgba(255,255,255,0.95)',", ""),
    ("borderTopColor: '#14282f',", ""),
    ("borderLeftColor: 'rgba(255,255,255,0.85)',", ""),
    ("borderLeftColor: '#14282f',", ""),
    ("borderBottomColor: 'rgba(88,131,191,0.45)',", ""),
    ("borderRightColor: 'rgba(88,131,191,0.28)',", ""),
    ("borderBottomColor: '#1a3542',", ""),
    ("borderRightColor: '#1a3542',", ""),

    # ── Gold references → amber/aqua ──
    ("'#fee229'", "'#ffb800'"),
    ('#fee229', '#ffb800'),
    ("backgroundColor: C.gold,", "backgroundColor: '#ffb800',"),

    # ── Blue deep → aqua ──
    ("'#3d6aaa'", "'#1be7ff'"),
    ('#3d6aaa', '#1be7ff'),

    # ── Old blue → aqua ──  
    ("'#5883bf'", "'#1be7ff'"),

    # ── Text colors for dark theme ──
    # C.ink (dark text on light) → dark.text (light text on dark)
    ("color: C.ink", "color: '#f0f4f5'"),
    ("color:C.ink", "color:'#f0f4f5'"),

    # ── White text stays white ──
    # (no change needed)

    # ── Modal/picker backgrounds ──
    ("backgroundColor:'#ffffff'", "backgroundColor:'#12252e'"),
    ("backgroundColor: '#ffffff'", "backgroundColor: '#12252e'"),
    ("backgroundColor: '#fff'", "backgroundColor: '#12252e'"),
    ("backgroundColor:'#fff'", "backgroundColor:'#12252e'"),

    # ── Shadow cleanup — simplify ──
    ("shadowColor: '#3d6aaa'", "shadowColor: '#000'"),
    ("shadowColor:'#3d6aaa'", "shadowColor:'#000'"),
    ("shadowColor: '#c9b100'", "shadowColor: '#000'"),
    ("shadowColor:'#c9b100'", "shadowColor:'#000'"),

    # ── Remove old glow references ──
    ("'rgba(200,170,0,0.6)'", "'#1a3542'"),
    ("'rgba(140,110,0,0.4)'", "'#1a3542'"),
    ("'rgba(140,110,0,0.2)'", "'#1a3542'"),

    # ── Background colors for specific elements ──
    ("backgroundColor: '#4d7abf'", "backgroundColor: '#0f1c22'"),
    ("backgroundColor: 'rgba(255,255,237,0.85)'", "color: '#7a9eaa'"),

    # ── Overlay backgrounds ──  
    ("backgroundColor:'rgba(26,31,46,0.55)'", "backgroundColor:'rgba(10,18,20,0.7)'"),
    ("backgroundColor: 'rgba(0,0,0,0.5)'", "backgroundColor: 'rgba(10,18,20,0.7)'"),

    # ── bgTop reference ──
    ("backgroundColor: C.bgTop", "backgroundColor: '#0a1214'"),
]

# ─── FILE-SPECIFIC RULES ────────────────────────────────────

COACH_RULES = [
    # AI bubble: dark card with light text
    ("color:C.ink, lineHeight:20, fontFamily:F.outfit", "color:'#f0f4f5', lineHeight:20, fontFamily:F.body"),
    ("color:C.blueDeep, lineHeight:20", "color:'#1be7ff', lineHeight:20"),
    # Reco card text
    ("color:'rgba(255,255,237,0.85)'", "color:'#7a9eaa'"),
    # User bubble: amber with dark text
    ("backgroundColor: '#ffb800',\n    borderWidth: 1.5,\n    borderColor: '#1a3542',", 
     "backgroundColor: '#ffb800',\n    borderWidth: 1,\n    borderColor: 'rgba(255,184,0,0.4)',"),
    # Input bar
    ("backgroundColor:'#12252e', borderWidth:1.5, borderColor:'#1a3542',", 
     "backgroundColor:'#0f1c22', borderWidth:1, borderColor:'#1a3542',"),
    # Add card
    ("backgroundColor:'#12252e', borderWidth:1.5, borderColor:'#1a3542', borderRadius:10", 
     "backgroundColor:'#0f1c22', borderWidth:1, borderColor:'#1a3542', borderRadius:10"),
]

SETTINGS_RULES = [
    # Fix "Sleeper" label → "Password" in account section
    # The row that says "Sleeper" with football icon should say "Password" 
    # Actually looking at the code, the second row in Account shows "Sleeper" with username
    # Patrick said "it says sleeper where it should be password"
    # The row with Icon name="football" and label "Sleeper" should be "Password"
    # Wait - looking at screenshot, the Account card has Email and Sleeper rows
    # He wants the football/Sleeper row to say Password instead
    ("<Icon name=\"football\" size={22} color={C.blueDeep} /><Text style={styles.rowLabel}>Sleeper</Text>",
     "<Icon name=\"lock\" size={22} color={'#1be7ff'} /><Text style={styles.rowLabel}>Password</Text>"),
    ("<Text style={styles.rowValue}>{username ? `@${username}` : 'Not linked'}</Text>",
     "<Text style={styles.rowValue}>••••••••</Text>"),
]

ONBOARDING_RULES = [
    # Import AIOmniWordmark
    ("import { AIOmniLogo } from './components/AIOmniLogo';",
     "import { AIOmniLogo, AIOmniWordmark } from './components/AIOmniLogo';"),
    # Add wordmark below logo
    ("<AIOmniLogo width={SCREEN_W * 0.7} />",
     "<AIOmniLogo size={SCREEN_W * 0.55} />\n          <View style={{ marginTop: 16 }}><AIOmniWordmark fontSize={32} color='#f0f4f5' /></View>"),
    # Platform dots: use real brand colors
    ("backgroundColor: C.gold }]} />\n          <Text style={styles.platformLabel}>SLEEPER</Text>",
     "backgroundColor: '#00FFF9' }]} />\n          <Text style={styles.platformLabel}>SLEEPER</Text>"),
    ("backgroundColor: C.gold }]} />\n          <Text style={styles.platformLabel}>ESPN</Text>",
     "backgroundColor: '#e52534' }]} />\n          <Text style={styles.platformLabel}>ESPN</Text>"),
    ("backgroundColor: C.gold }]} />\n          <Text style={styles.platformLabel}>YAHOO</Text>",
     "backgroundColor: '#7c3aed' }]} />\n          <Text style={styles.platformLabel}>YAHOO</Text>"),
    # Primary button: amber
    ("backgroundColor: C.gold, borderRadius: 14,",
     "backgroundColor: '#ffb800', borderRadius: 14,"),
    # Divider: aqua
    ("backgroundColor: C.gold, marginVertical: 12",
     "backgroundColor: '#1be7ff', marginVertical: 12"),
]

RANKINGS_RULES = [
    # Toggle active bg
    ("backgroundColor: '#1be7ff'", "backgroundColor: '#1be7ff'"),  # keep
    # Pill active
    ("backgroundColor: '#ffb800', borderColor: '#ffb800'", "backgroundColor: '#ffb800', borderColor: '#ffb800'"),  # keep
    # Consensus bar fill
    ("backgroundColor: isTop3 ? '#ffb800' : '#1be7ff'", "backgroundColor: isTop3 ? '#ffb800' : '#1be7ff'"),  # keep  
    # Rank color for top3
    ("color: C.gold", "color: '#ffb800'"),
]

def apply_rules(content, rules):
    for find, replace in rules:
        content = content.replace(find, replace)
    return content

def process_file(filepath, extra_rules=None):
    if not os.path.exists(filepath):
        print(f"  SKIP (not found): {filepath}")
        return
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    content = apply_rules(content, GLOBAL_RULES)
    if extra_rules:
        content = apply_rules(content, extra_rules)
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        changes = sum(1 for a, b in zip(original, content) if a != b)
        print(f"  ✓ {filepath} (modified)")
    else:
        print(f"  – {filepath} (no changes)")

def main():
    print("AIOmni V7 Reskin Script")
    print("=" * 40)
    
    # Check we're in the right directory
    if not os.path.exists('app/(tabs)'):
        print("ERROR: Run this from the AIOmni project root (where app/ folder is)")
        return
    
    print("\nProcessing files...\n")
    
    process_file('app/(tabs)/coach.tsx', COACH_RULES)
    process_file('app/(tabs)/trade.tsx')
    process_file('app/(tabs)/rankings.tsx', RANKINGS_RULES)
    process_file('app/(tabs)/settings.tsx', SETTINGS_RULES)
    process_file('app/onboarding.tsx', ONBOARDING_RULES)
    
    print("\n✓ Done! Reload Expo to see changes.")
    print("\nNote: Some screens may need manual touch-ups.")
    print("The script handles ~90% of the visual transformation.")

if __name__ == '__main__':
    main()
