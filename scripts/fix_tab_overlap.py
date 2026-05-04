#!/usr/bin/env python3
"""
UI fix: rankings tab labels overlap on small screens.

Problem: COMMUNITY / MY RANKINGS / PROSPECTS tabs each get flex:1 (one third
of bar width) but "MY RANKINGS" with letterSpacing 2 at fontSize 15 doesn't
fit in its slice. Text wraps onto two lines and overlaps adjacent tabs.

Fix: tighten font size and letter spacing, add horizontal padding, force
single-line text with auto-fit fallback.

Five changes:
  1. toggleBtn: add paddingHorizontal: 4
  2. toggleText: fontSize 15->13, letterSpacing 2->1, add textAlign: 'center'
  3. Add numberOfLines={1} adjustsFontSizeToFit to all 3 <Text> tab labels

Run from AIOmni repo root:
    python3 scripts/fix_tab_overlap.py
"""
from pathlib import Path
import sys

TARGET = Path('app/(tabs)/rankings.tsx')
if not TARGET.exists():
    print(f'[ERROR] {TARGET} not found. Run from AIOmni repo root.')
    sys.exit(1)

s = TARGET.read_text()
orig = s
applied = []
warnings = []

# ====================================================================
# CHANGE 1: toggleBtn style - add paddingHorizontal
# ====================================================================
old1 = "  toggleBtn:  { flex: 1, paddingVertical: 11, alignItems: 'center' },"
new1 = "  toggleBtn:  { flex: 1, paddingVertical: 11, paddingHorizontal: 4, alignItems: 'center' },"

if old1 in s:
    s = s.replace(old1, new1)
    applied.append("toggleBtn: added paddingHorizontal:4")
else:
    warnings.append("toggleBtn style not matched")

# ====================================================================
# CHANGE 2: toggleText style - smaller font, less letter spacing, center align
# ====================================================================
old2 = "  toggleText: { fontFamily: F.bold, fontSize: 15, letterSpacing: 2, color: dark.textSub },"
new2 = "  toggleText: { fontFamily: F.bold, fontSize: 13, letterSpacing: 1, color: dark.textSub, textAlign: 'center' },"

if old2 in s:
    s = s.replace(old2, new2)
    applied.append("toggleText: fontSize 15->13, letterSpacing 2->1, added textAlign center")
else:
    warnings.append("toggleText style not matched")

# ====================================================================
# CHANGE 3a: COMMUNITY tab - add numberOfLines + adjustsFontSizeToFit
# ====================================================================
old3a = "          <Text style={[s.toggleText, mode === 'community' && s.toggleTextOn]}>COMMUNITY</Text>"
new3a = "          <Text style={[s.toggleText, mode === 'community' && s.toggleTextOn]} numberOfLines={1} adjustsFontSizeToFit>COMMUNITY</Text>"

if old3a in s:
    s = s.replace(old3a, new3a)
    applied.append("COMMUNITY tab: added numberOfLines + adjustsFontSizeToFit")
else:
    warnings.append("COMMUNITY tab Text not matched")

# ====================================================================
# CHANGE 3b: MY RANKINGS tab
# ====================================================================
old3b = "          <Text style={[s.toggleText, mode === 'mine' && s.toggleTextOn]}>MY RANKINGS</Text>"
new3b = "          <Text style={[s.toggleText, mode === 'mine' && s.toggleTextOn]} numberOfLines={1} adjustsFontSizeToFit>MY RANKINGS</Text>"

if old3b in s:
    s = s.replace(old3b, new3b)
    applied.append("MY RANKINGS tab: added numberOfLines + adjustsFontSizeToFit")
else:
    warnings.append("MY RANKINGS tab Text not matched")

# ====================================================================
# CHANGE 3c: PROSPECTS tab
# ====================================================================
old3c = "          <Text style={[s.toggleText, mode === 'prospects' && s.toggleTextOn]}>PROSPECTS</Text>"
new3c = "          <Text style={[s.toggleText, mode === 'prospects' && s.toggleTextOn]} numberOfLines={1} adjustsFontSizeToFit>PROSPECTS</Text>"

if old3c in s:
    s = s.replace(old3c, new3c)
    applied.append("PROSPECTS tab: added numberOfLines + adjustsFontSizeToFit")
else:
    warnings.append("PROSPECTS tab Text not matched")

# Write
if s != orig:
    TARGET.write_text(s)

# ====================================================================
# Summary
# ====================================================================
print()
print("=" * 60)
for a in applied:
    print(f"[APPLIED]  {a}")
for w in warnings:
    print(f"[WARN]     {w}")
print("=" * 60)
print()

if applied and not warnings:
    print("All 5 changes applied cleanly.")
    print()
    print("Verify in simulator:")
    print("  npx expo start --clear")
    print()
    print("Open app, go to Rankings tab. Tab labels should now read")
    print("clean on a single line with no overlap.")
    print()
    print("If you like it, commit:")
    print('  git add -A')
    print('  git commit -m "UI: fix rankings tab label overlap"')
    print('  git push origin main')
elif applied:
    print(f"{len(applied)} of 5 applied. Manual review for warnings.")
else:
    print("Nothing applied -- file structure may have changed.")
