#!/usr/bin/env python3
import re

path = 'app/(tabs)/league.tsx'
with open(path) as f: content = f.read()

# Use a regex to find the Object.values(pDb) block and replace it,
# regardless of exact whitespace/formatting.
pattern = re.compile(
    r"Object\.values\(pDb\)\s*"
    r"\.filter\(\(p:\s*any\)\s*=>[^\)]+?\)\s*"
    r"\.slice\(0,\s*150\)\s*"
    r"\.map\(\(p:\s*any\)\s*=>[^}]+?\}\)\)",
    re.DOTALL
)

new_block = """Object.values(pDb)
            .filter((p: any) =>
              ['QB','RB','WR','TE','K','DEF'].includes(p.position) &&
              (p.team || p.position === 'DEF') &&
              !taken.has(p.player_id) &&
              p.search_rank && p.search_rank < 1000
            )
            .sort((a: any, b: any) => (a.search_rank ?? 9999) - (b.search_rank ?? 9999))
            .slice(0, 150)
            .map((p: any) => ({ id: p.player_id, name: `${p.first_name} ${p.last_name}`, position: p.position, team: p.team, injuryStatus: p.injury_status, isStarter: false }))"""

matches = pattern.findall(content)
print(f"Found {len(matches)} match(es)")

if matches:
    new_content = pattern.sub(new_block, content, count=1)
    with open(path, 'w') as f: f.write(new_content)
    print("Patched.")
else:
    # Print nearby context so we can see what's actually there
    idx = content.find('Object.values(pDb)')
    if idx >= 0:
        print("Context around Object.values(pDb):")
        print("---")
        print(content[idx:idx+600])
        print("---")
    else:
        print("Object.values(pDb) not even found — file may have been changed more drastically")
