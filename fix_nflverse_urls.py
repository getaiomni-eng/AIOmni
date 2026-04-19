#!/usr/bin/env python3
path = 'supabase/functions/nflverse-daily-sync/index.ts'
with open(path) as f: content = f.read()

# Update the URLs to the correct nflverse endpoints
old = '''const NFLVERSE_ROSTERS = `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${CURRENT_SEASON}.csv`;
const NFLVERSE_ROSTERS_LAST_YEAR = `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${CURRENT_SEASON - 1}.csv`;
const NFLVERSE_PLAYER_IDS = `https://github.com/nflverse/nflverse-data/releases/download/players_components/ff_playerids.csv`;'''

new = '''const NFLVERSE_ROSTERS = `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${CURRENT_SEASON}.csv`;
const NFLVERSE_ROSTERS_LAST_YEAR = `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${CURRENT_SEASON - 1}.csv`;
// DynastyProcess maintains the cross-platform ID map (sleeper/espn/yahoo → gsis)
const NFLVERSE_PLAYER_IDS = 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv';'''

if old in content:
    content = content.replace(old, new)
    with open(path, 'w') as f: f.write(content)
    print("URLs patched")
else:
    print("pattern not found")
