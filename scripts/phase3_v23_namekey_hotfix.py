#!/usr/bin/env python3
"""
AIOmni Phase 3 v2.3 hotfix - rename injury nameKey to avoid collision.

The v2.3 patch declared `const nameKey` inside the scoring loop, but
the same scope already had a `nameKey` declared elsewhere (probably
from team-change logic). Deno's strict mode rejected the duplicate
declaration, causing BOOT_ERROR.

Fix: rename the injury-side variable to `injuryNameKey`.
"""
from pathlib import Path
import sys

ROOT = Path('.')
ENGINE = ROOT / 'supabase' / 'functions' / 'aiomni-rankings-engine' / 'index.ts'

if not ENGINE.exists():
    print('[ERROR]    engine not found.')
    sys.exit(1)

s = ENGINE.read_text()
orig = s

old = """    // ── Injury discount ──
    // Cross-ref ESPN injury feed by normalized name. Aggressive: serious
    // \\"Out\\" injuries (ACL/Achilles/etc) drop score by 90%.
    const nameKey = (p.full_name || '').toLowerCase().replace(/[^a-z]/g, '');
    const injInfo = injuryMap.get(nameKey);"""

new = """    // ── Injury discount ──
    // Cross-ref ESPN injury feed by normalized name. Aggressive: serious
    // \\"Out\\" injuries (ACL/Achilles/etc) drop score by 90%.
    const injuryNameKey = (p.full_name || '').toLowerCase().replace(/[^a-z]/g, '');
    const injInfo = injuryMap.get(injuryNameKey);"""

if old in s:
    s = s.replace(old, new)
    print('[APPLIED]  renamed nameKey -> injuryNameKey')
else:
    # Maybe the comment escaping is different. Try a broader match.
    if "const nameKey = (p.full_name" in s:
        s = s.replace(
            "const nameKey = (p.full_name || '').toLowerCase().replace(/[^a-z]/g, '');\n    const injInfo = injuryMap.get(nameKey);",
            "const injuryNameKey = (p.full_name || '').toLowerCase().replace(/[^a-z]/g, '');\n    const injInfo = injuryMap.get(injuryNameKey);"
        )
        print('[APPLIED]  renamed nameKey -> injuryNameKey (broader match)')
    else:
        print('[ERROR]    could not find nameKey declaration')
        sys.exit(1)

if s != orig:
    ENGINE.write_text(s)
    print('Done. Redeploy + recompute:')
    print('  supabase functions deploy aiomni-rankings-engine')
    print('  curl -X POST "https://khoruzvsprxyocisuhet.supabase.co/functions/v1/aiomni-rankings-engine" -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN"')
else:
    print('[SKIP]     no changes')
