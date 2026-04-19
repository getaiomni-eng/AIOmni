import json, urllib.request

with urllib.request.urlopen('https://api.sleeper.app/v1/players/nfl') as r:
    data = json.load(r)

names_to_check = ['Ben Roethlisberger', "Le'Veon Bell", 'Andy Dalton', 'Joe Flacco', 'Nick Folk', 'Lee Smith', 'Geno Smith']

for name in names_to_check:
    for pid, p in data.items():
        full = p.get('full_name', '')
        if full == name:
            print(name)
            print('  status:', repr(p.get('status')))
            print('  active:', repr(p.get('active')))
            print('  team:', repr(p.get('team')))
            print('  search_rank:', p.get('search_rank'))
            print('  injury_status:', repr(p.get('injury_status')))
            print()
            break
