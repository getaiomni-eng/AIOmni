#!/usr/bin/env python3
"""
Finish wiring canonical active list into waivers.ts:
  1. Add the import (if missing)
  2. Rewrite isLive to take (pid, p) and use activeIds
"""
path = 'services/waivers.ts'
with open(path) as f: content = f.read()

# 1. Add import if missing
if "from './nflPlayers'" not in content:
    # Insert after the last existing service import
    anchor = "from './yahoo';"
    insertion = "\nimport { getActiveSleeperIds, getActiveESPNIds } from './nflPlayers';"
    if anchor in content:
        idx = content.index(anchor) + len(anchor)
        content = content[:idx] + insertion + content[idx:]
        print("Added nflPlayers import")
    else:
        print("Could not find anchor for import")

# 2. Find and replace the existing isLive definition (whatever its current form)
# Scan for "const isLive = (p: any)" or "const isLive = (pid: string, p: any)"
# and replace entire block up through "};"

import re

# Match any isLive definition — greedy up to the closing };
pattern = re.compile(
    r"(    )?const isLive = \([^)]*\): boolean => \{[\s\S]*?\n(    )?\};",
    re.MULTILINE
)

new_islive = """    // Canonical active list from Supabase nfl_players — source of truth
    const activeIds = await getActiveSleeperIds().catch(() => new Set<string>());
    const isLive = (pid: string, p: any): boolean => {
      if (!p) return false;
      if (p.position === 'DEF') return true; // DEFs aren't in nflverse rosters
      if (activeIds.size > 0) {
        return activeIds.has(pid);
      }
      // Fallback if canonical data hasn't loaded yet
      if (p.active === false) return false;
      if (p.search_rank && p.search_rank >= 9999999) return false;
      if (p.position !== 'DEF' && !p.team) return false;
      return true;
    };"""

matches = pattern.findall(content)
print(f"Found {len(matches)} isLive definition(s) to replace")

new_content = pattern.sub(new_islive, content, count=1)
if new_content != content:
    with open(path, 'w') as f: f.write(new_content)
    print("isLive rewritten")
else:
    print("No replacement made")
