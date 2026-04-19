#!/usr/bin/env python3
path = 'app/(tabs)/league.tsx'
with open(path) as f: content = f.read()

old = """        setWaiverPlayers(
          Object.values(pDb)
            .filter((p: any) => ['QB','RB','WR','TE','K'].includes(p.position) && p.team && !taken.has(p.player_id))
            .slice(0, 150)
            .map((p: any) => ({ id: p.player_id, name: `${p.first_name} ${p.last_name}`, position: p.position, team: p.team, injuryStatus: p.injury_status, isStarter: false }))
        );"""

new = """        setWaiverPlayers(
          Object.values(pDb)
            .filter((p: any) =>
              ['QB','RB','WR','TE','K','DEF'].includes(p.position) &&
              (p.team || p.position === 'DEF') &&
              !taken.has(p.player_id) &&
              p.search_rank && p.search_rank < 1000
            )
            .sort((a: any, b: any) => (a.search_rank ?? 9999) - (b.search_rank ?? 9999))
            .slice(0, 150)
            .map((p: any) => ({ id: p.player_id, name: `${p.first_name} ${p.last_name}`, position: p.position, team: p.team, injuryStatus: p.injury_status, isStarter: false }))
        );"""

if old in content:
    content = content.replace(old, new)
    with open(path, 'w') as f: f.write(content)
    print("league.tsx: Sleeper waivers now sorted by search_rank, matches Sleeper app")
else:
    print("pattern not found")
