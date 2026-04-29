#!/bin/bash
# scripts/patch_ai_tiers.sh
# Patches 3 askAI() call sites to use the fast (Haiku 4.5) tier.
# Idempotent — safe to run multiple times.

set -e

python3 - <<'PYEOF'
from pathlib import Path

ROOT = Path('.')
changed = 0

# ─── index.tsx — Home tab insights ───
idx = ROOT / 'app' / '(tabs)' / 'index.tsx'
if idx.exists():
    s = idx.read_text()
    orig = s
    s = s.replace(
        'await askAI(prompt, 400)',
        "await askAI(prompt, { tier: 'fast', maxTokens: 400 })"
    )
    s = s.replace(
        'await askAI(prompt, 150)',
        "await askAI(prompt, { tier: 'fast', maxTokens: 150 })"
    )
    if s != orig:
        idx.write_text(s)
        print('[APPLIED]  index.tsx — 2 call sites switched to fast tier')
        changed += 1
    else:
        print('[SKIP]     index.tsx — no matches (already patched?)')
else:
    print('[ERROR]    index.tsx not found')

# ─── league.tsx — player-card start/sit/waiver buttons ───
lg = ROOT / 'app' / '(tabs)' / 'league.tsx'
if lg.exists():
    s = lg.read_text()
    orig = s
    s = s.replace(
        'No intros.`);',
        "No intros.`, { tier: 'fast', maxTokens: 256 });"
    )
    if s != orig:
        lg.write_text(s)
        print('[APPLIED]  league.tsx — player-card askAI switched to fast tier')
        changed += 1
    else:
        print('[SKIP]     league.tsx — no match (already patched?)')
else:
    print('[ERROR]    league.tsx not found')

print()
print(f'Done — {changed} file(s) changed.')
PYEOF

echo
echo "Verify:"
grep -n "askAI" "app/(tabs)/index.tsx" "app/(tabs)/league.tsx" "app/(tabs)/trade.tsx" "app/(tabs)/coach.tsx" "app/(tabs)/draft.tsx"