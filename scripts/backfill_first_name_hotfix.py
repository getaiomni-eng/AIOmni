#!/usr/bin/env python3
"""
Hotfix: backfill insert was missing first_name/last_name (NOT NULL columns).
Adds them by splitting full_name on the first space.
"""
from pathlib import Path
import sys

ENGINE = Path('supabase/functions/backfill-2026-draft/index.ts')
if not ENGINE.exists():
    print('[ERROR]    backfill function not found.')
    sys.exit(1)

s = ENGINE.read_text()
orig = s

old = """      } else {
        // Insert new row with synthetic gsis_id
        const synthId = `2026_pick_${String(pick.p).padStart(3, '0')}`;
        const { error } = await supabase
          .from('nfl_players')
          .insert({
            gsis_id: synthId,
            full_name: pick.n,
            position: pick.pos,
            team,
            draft_year: 2026,
            draft_round: pick.r,
            draft_pick: pick.p,
            rookie_year: 2026,
            is_active: true,
            years_exp: 0,
          });"""

new = """      } else {
        // Insert new row with synthetic gsis_id
        const synthId = `2026_pick_${String(pick.p).padStart(3, '0')}`;
        // Split full_name into first/last (NOT NULL columns).
        // Handle "TJ Parker", "Rueben Bain Jr.", "J.C. Davis" by taking
        // first whitespace token as first_name and the rest as last_name.
        const spaceIdx = pick.n.indexOf(' ');
        const firstName = spaceIdx > 0 ? pick.n.slice(0, spaceIdx) : pick.n;
        const lastName  = spaceIdx > 0 ? pick.n.slice(spaceIdx + 1) : pick.n;
        const { error } = await supabase
          .from('nfl_players')
          .insert({
            gsis_id: synthId,
            full_name: pick.n,
            first_name: firstName,
            last_name: lastName,
            position: pick.pos,
            team,
            draft_year: 2026,
            draft_round: pick.r,
            draft_pick: pick.p,
            rookie_year: 2026,
            is_active: true,
            years_exp: 0,
          });"""

if old in s:
    s = s.replace(old, new)
    print('[APPLIED]  insert now provides first_name + last_name')
else:
    print('[ERROR]    could not find insert block')
    sys.exit(1)

if s != orig:
    ENGINE.write_text(s)
    print('Done. Redeploy + re-trigger.')
