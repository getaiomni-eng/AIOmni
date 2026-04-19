#!/usr/bin/env python3
"""
Filter Sleeper waivers against the canonical nflverse active list.
Sleeper's own search_rank lets retired-but-historically-fantasy-relevant
guys (Roethlisberger, Bell) leak through at rank 176/235.
The canonical table has them marked is_active=false because they're not
on actual NFL rosters.
"""
path = 'app/(tabs)/league.tsx'
with open(path) as f: content = f.read()

# Add nflPlayers import if not already there
if "from '../../services/nflPlayers'" not in content:
    # Find a good insertion point after existing service imports
    anchor_candidates = [
        "from '../../services/yahoo'",
        "from '../../services/espn'",
        "from '../../services/ai'",
    ]
    for anchor in anchor_candidates:
        if anchor in content:
            # Find the end of that import line
            idx = content.find(anchor)
            semi = content.find(';', idx)
            newline = content.find('\n', semi)
            if newline > 0:
                insert = "\nimport { getActiveSleeperIds } from '../../services/nflPlayers';"
                content = content[:newline] + insert + content[newline:]
                print(f"Added nflPlayers import after {anchor}")
                break

# Now add canonical filter to the Sleeper waivers logic.
# Find the Sleeper branch and add activeIds fetch + filter
old = """      if (platformStr === 'sleeper') {
        const rosters = await (await fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`)).json();
        const taken   = new Set(rosters.flatMap((r: any) => r.players || []));
        const pDb     = await getPlayersDb();"""

new = """      if (platformStr === 'sleeper') {
        const [rosters, pDb, activeIds] = await Promise.all([
          (await fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`)).json(),
          getPlayersDb(),
          getActiveSleeperIds().catch(() => new Set<string>()),
        ]);
        const taken = new Set(rosters.flatMap((r: any) => r.players || []));"""

if old in content:
    content = content.replace(old, new)
    print("Parallel fetch added")

# Now update the filter to require canonical active membership
old_filter = """            .filter((p: any) =>
              ['QB','RB','WR','TE','K','DEF'].includes(p.position) &&
              (p.team || p.position === 'DEF') &&
              !taken.has(p.player_id) &&
              p.search_rank && p.search_rank < 1000
            )"""

new_filter = """            .filter((p: any) =>
              ['QB','RB','WR','TE','K','DEF'].includes(p.position) &&
              (p.team || p.position === 'DEF') &&
              !taken.has(p.player_id) &&
              p.search_rank && p.search_rank < 1000 &&
              // Canonical active check — filters Sleeper's lingering retirees (Roethlisberger, Bell, etc.)
              (p.position === 'DEF' || activeIds.size === 0 || activeIds.has(p.player_id))
            )"""

if old_filter in content:
    content = content.replace(old_filter, new_filter)
    print("Canonical active filter added")
else:
    print("Filter pattern not found — checking current shape")
    idx = content.find("!taken.has(p.player_id)")
    if idx >= 0:
        print("Context:")
        print(content[idx-100:idx+400])

with open(path, 'w') as f: f.write(content)
print("Done")
