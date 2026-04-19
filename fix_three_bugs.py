#!/usr/bin/env python3
"""
Fix three unrelated bugs in one patch:
  1. Home live feed — PFR URL wrong, uses pro-football-reference (stats) not profootballrumors (news)
  2. Rankings My Rankings — reverts format adjustment when user has custom order
  3. Draft — over-eager rookie detection grabbed non-dynasty leagues
"""

# ══════════════════════════════════════════════════════════════
# 1. LIVE FEED — fix PFR URL in index.tsx
# ══════════════════════════════════════════════════════════════
home_path = 'app/(tabs)/index.tsx'
with open(home_path) as f: home = f.read()

old_pfr = "fetch('https://www.pro-football-reference.com/rss.xml').then(r => r.text()),"
new_pfr = "fetch('https://www.profootballrumors.com/feed').then(r => r.text()),"
if old_pfr in home:
    home = home.replace(old_pfr, new_pfr)
    print("OK  Live feed: PFR URL → profootballrumors.com/feed")
else:
    print("--  PFR URL pattern not found (maybe already fixed)")

# Also: if there's a hardcoded placeholder at line ~39 in initial state, flag it.
# Not modifying — it's fine as initial render and gets overwritten by setNews().

with open(home_path, 'w') as f: f.write(home)


# ══════════════════════════════════════════════════════════════
# 2. RANKINGS — My Rankings skips format adjustment
# ══════════════════════════════════════════════════════════════
rank_path = 'app/(tabs)/rankings.tsx'
with open(rank_path) as f: rank = f.read()

old_line = "const formatAdjusted = applyFormatAdjustments(rawData, format as ScoringFormat);"
new_line = "const formatAdjusted = mode === 'mine' ? rawData : applyFormatAdjustments(rawData, format as ScoringFormat);"

if old_line in rank:
    rank = rank.replace(old_line, new_line)
    print("OK  Rankings: My Rankings preserves manual order, Community applies format")
else:
    print("--  Rankings line not found (check state)")

with open(rank_path, 'w') as f: f.write(rank)


# ══════════════════════════════════════════════════════════════
# 3. DRAFT — fix rookie detection fallback
# ══════════════════════════════════════════════════════════════
draft_path = 'app/(tabs)/draft.tsx'
with open(draft_path) as f: draft = f.read()

old_detect = """      const draftMode: 'startup' | 'rookie' | 'redraft' =
        isDynasty && settings.rounds <= 6 ? 'rookie'
        : isDynasty && settings.rounds >= 15 ? 'startup'
        : settings.draftType === 'linear' && settings.rounds <= 5 && totalSlots <= 8 ? 'rookie'
        : 'redraft';"""

new_detect = """      // Conservative detection: rookie mode ONLY if league is known dynasty.
      // Non-dynasty leagues default to redraft regardless of draft format —
      // a short linear draft in a redraft league just means mock/snake drafts.
      const draftMode: 'startup' | 'rookie' | 'redraft' =
        isDynasty && settings.rounds <= 6 ? 'rookie'
        : isDynasty && settings.rounds >= 15 ? 'startup'
        : 'redraft';"""

if old_detect in draft:
    draft = draft.replace(old_detect, new_detect)
    print("OK  Draft: removed non-dynasty rookie fallback")
else:
    print("--  Draft detection pattern not found")

with open(draft_path, 'w') as f: f.write(draft)

print("\nDone")
