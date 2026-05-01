#!/usr/bin/env python3
"""
Surgical fix: remove the duplicate injury block from the engine.

The v2.3 patch + v2.3 hotfix both ran successfully but each appended
their own copy of the "Injury discount" block, leaving two identical
const declarations of injuryNameKey/injInfo/injuryMult/injuryNote in
the same scope. Deno rejects the duplicate declaration on boot.

Fix: read the file, find the second occurrence of the injury block,
delete it cleanly.
"""
from pathlib import Path
import sys

ENGINE = Path('supabase/functions/aiomni-rankings-engine/index.ts')
if not ENGINE.exists():
    print('[ERROR]    engine not found.')
    sys.exit(1)

s = ENGINE.read_text()

# The injury block (with the escape-quoted comment that appears in both copies)
INJURY_BLOCK = '''    // ── Injury discount ──
    // Cross-ref ESPN injury feed by normalized name. Aggressive: serious
    // \\"Out\\" injuries (ACL/Achilles/etc) drop score by 90%.
    const injuryNameKey = (p.full_name || '').toLowerCase().replace(/[^a-z]/g, '');
    const injInfo = injuryMap.get(injuryNameKey);
    let injuryMult = 1.0;
    let injuryNote = '';
    if (injInfo && injInfo.multiplier < 1.0) {
      injuryMult = injInfo.multiplier;
      baseline = baseline * injuryMult;
      injuryNote = `INJURY: ${injInfo.injury} (${injuryMult.toFixed(2)}x)`;
    }
'''

count = s.count(INJURY_BLOCK)
print(f'Found {count} copies of the injury block.')

if count == 2:
    # Replace the first occurrence with itself (no-op), the rest of the
    # function only sees the surviving original. Easier: use replace with
    # count=1 to delete the FIRST copy, leaving exactly one.
    # Actually simpler: split + rejoin keeping only the first instance.
    first = s.index(INJURY_BLOCK)
    second = s.index(INJURY_BLOCK, first + len(INJURY_BLOCK))
    # Delete from `second` for one block-length (plus trailing whitespace)
    # We also remove the blank line that separates the two blocks.
    cut_start = second
    cut_end = second + len(INJURY_BLOCK)
    # If a blank newline precedes the second block, also remove it
    while cut_start > 0 and s[cut_start - 1] == '\n':
        # only consume one extra newline so we keep one separator
        cut_start -= 1
        break
    s_new = s[:cut_start] + s[cut_end:]
    ENGINE.write_text(s_new)
    print('[APPLIED]  removed duplicate injury block.')
elif count == 1:
    print('[SKIP]     only one copy present — already fixed.')
elif count == 0:
    print('[ERROR]    no injury block found — file may have different formatting.')
    print('           Check this command for clues:')
    print('             grep -n "Injury discount" supabase/functions/aiomni-rankings-engine/index.ts')
    sys.exit(1)
else:
    print(f'[WARN]     {count} copies found — manual cleanup may be needed.')
