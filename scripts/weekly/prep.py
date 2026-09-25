"""Build the local dataset the weekly-model backtest reads (scripts/weekly).

Row shapes match supabase/functions/_shared/weekly/types.ts exactly, so the
same model code runs against these files locally and against Postgres in the
weekly-rankings edge function.

    WEEKLY_RAW=/tmp/wk/raw WEEKLY_DATA=/tmp/wk/data python3 scripts/weekly/prep.py
    WEEKLY_DATA=/tmp/wk/data node scripts/weekly/backtest.ts all

WEEKLY_RAW must hold (read-only sources; nothing here writes to Postgres):
  nflverse (github.com/nflverse/nflverse-data/releases/download/...):
    players/players.csv
    snap_counts/snap_counts_{2021..2026}.csv
    injuries/injuries_{2021..2026}.csv
    depth_charts/depth_charts_{2025,2026}.csv
  games.csv from github.com/nflverse/nfldata/raw/master/data/games.csv
  From Postgres via scripts/roq.sh -o csv:
    stats.csv   nfl_weekly_stats REG 2021+ joined to nfl_players (name, position)
    status.csv  nfl_player_status
    market.csv  expert_weekly_rankings
"""
import csv, json, os, sys
from collections import defaultdict
from datetime import datetime, timezone, timedelta

csv.field_size_limit(sys.maxsize)
RAW = os.environ['WEEKLY_RAW']
OUT = os.environ['WEEKLY_DATA']
os.makedirs(OUT, exist_ok=True)
SKILL = {'QB', 'RB', 'WR', 'TE'}

def rows(name):
    with open(os.path.join(RAW, name), newline='') as f:
        yield from csv.DictReader(f)

def num(v, cast=float):
    if v in (None, '', 'NA', 'NULL'):
        return None
    try:
        return cast(v)
    except ValueError:
        return None

# ── players: gsis -> (name, position), pfr -> gsis ─────────────────────────
pinfo, pfr2gsis = {}, {}
for r in rows('players.csv'):
    g = r['gsis_id']
    if not g:
        continue
    pos = r['position']
    if pos == 'FB':
        pos = 'RB'
    pinfo[g] = (r['display_name'], pos, num(r['draft_round'], int), num(r['draft_pick'], int), num(r['rookie_season'], int))
    if r['pfr_id']:
        pfr2gsis[r['pfr_id']] = g

# ── stats ──────────────────────────────────────────────────────────────────
INT = ['season', 'week', 'attempts', 'completions', 'passing_yards', 'passing_tds', 'interceptions',
       'carries', 'rushing_yards', 'rushing_tds', 'targets', 'receptions', 'receiving_yards',
       'receiving_tds', 'receiving_air_yards']
FLT = ['target_share', 'air_yards_share', 'wopr', 'fantasy_pts_ppr']
stats, filled = [], 0
for r in rows('stats.csv'):
    g = r['gsis_id']
    name, pos = r['full_name'], r['position']
    if name in ('', 'NULL') or pos in ('', 'NULL'):
        if g in pinfo:
            name, pos = pinfo[g][0], pinfo[g][1]
            filled += 1
        else:
            continue
    if pos == 'FB':
        pos = 'RB'
    if pos not in SKILL:
        continue
    o = {'gsis_id': g, 'player_name': name, 'position': pos, 'team': r['team'], 'opponent': r['opponent']}
    for k in INT:
        o[k] = num(r[k], int) or 0 if k not in ('season', 'week') else int(r[k])
    for k in FLT:
        o[k] = num(r[k])
    stats.append(o)
print('stats', len(stats), 'positions filled from nflverse', filled)

# ── games ──────────────────────────────────────────────────────────────────
games = []
for r in rows('games.csv'):
    s = int(r['season'])
    if s < 2021 or r['game_type'] != 'REG':
        continue
    games.append({
        'game_id': r['game_id'], 'season': s, 'week': int(r['week']),
        'gameday': r['gameday'], 'gametime': r['gametime'], 'weekday': r['weekday'],
        'away_team': r['away_team'], 'home_team': r['home_team'],
        'away_score': num(r['away_score'], int), 'home_score': num(r['home_score'], int),
        'location': r['location'], 'away_rest': num(r['away_rest'], int), 'home_rest': num(r['home_rest'], int),
        'spread_line': num(r['spread_line']), 'total_line': num(r['total_line']),
        'div_game': r['div_game'] == '1', 'roof': r['roof'] or None, 'surface': r['surface'] or None,
        'temp': num(r['temp']), 'wind': num(r['wind']),
        'stadium_id': r['stadium_id'], 'stadium': r['stadium'],
    })
print('games', len(games))

# kickoff (UTC) per team-week, for snapping depth charts to "last snapshot before kickoff"
def kickoff_utc(g):
    # nflverse gametime is US/Eastern local; EDT (UTC-4) during the regular season until early Nov, EST after.
    d = datetime.strptime(f"{g['gameday']} {g['gametime'] or '13:00'}", '%Y-%m-%d %H:%M')
    edt_end = datetime(d.year, 11, 1) + timedelta(days=(6 - datetime(d.year, 11, 1).weekday()) % 7)
    off = 4 if d < edt_end else 5
    return (d + timedelta(hours=off)).replace(tzinfo=timezone.utc)
kick = {}
for g in games:
    k = kickoff_utc(g)
    kick[(g['season'], g['week'], g['home_team'])] = k
    kick[(g['season'], g['week'], g['away_team'])] = k

# ── snaps ──────────────────────────────────────────────────────────────────
snaps, unmapped = [], 0
for y in range(2021, 2027):
    for r in rows(f'snap_counts_{y}.csv'):
        if r['game_type'] != 'REG':
            continue
        pos = 'RB' if r['position'] == 'FB' else r['position']
        if pos not in SKILL:
            continue
        g = pfr2gsis.get(r['pfr_player_id'])
        if not g:
            unmapped += 1
        snaps.append({'season': int(r['season']), 'week': int(r['week']), 'game_id': r['game_id'],
                      'gsis_id': g, 'pfr_player_id': r['pfr_player_id'], 'player_name': r['player'],
                      'position': pos, 'team': r['team'], 'opponent': r['opponent'],
                      'offense_snaps': num(r['offense_snaps'], int), 'offense_pct': num(r['offense_pct'])})
print('snaps', len(snaps), 'unmapped pfr ids', unmapped)

# ── injury reports ─────────────────────────────────────────────────────────
inj = []
for y in range(2021, 2027):
    for r in rows(f'injuries_{y}.csv'):
        if r['game_type'] != 'REG':
            continue
        pos = 'RB' if r['position'] == 'FB' else r['position']
        if pos not in SKILL:
            continue
        inj.append({'season': int(r['season']), 'week': int(r['week']), 'team': r['team'],
                    'gsis_id': r['gsis_id'], 'player_name': r['full_name'], 'position': pos,
                    'report_status': r['report_status'] or None,
                    'report_primary_injury': r['report_primary_injury'] or None,
                    'practice_status': r['practice_status'] or None})
print('injuries', len(inj))

# ── depth charts: last snapshot strictly before each team's kickoff ───────
# 2025+ files are daily timestamped snapshots. Keep offense skill slots only.
depth = []
for y in (2025, 2026):
    by_team_dt = defaultdict(list)
    for r in rows(f'depth_charts_{y}.csv'):
        if r['pos_abb'] not in SKILL:
            continue
        by_team_dt[(r['team'], r['dt'])].append(r)
    team_dts = defaultdict(list)
    for (t, dt) in by_team_dt:
        team_dts[t].append(dt)
    for t in team_dts:
        team_dts[t].sort()
    for w in range(1, 19):
        for t, dts in team_dts.items():
            k = kick.get((y, w, t))
            if k is None:
                continue  # bye
            before = [d for d in dts if datetime.fromisoformat(d.replace('Z', '+00:00')) < k]
            if not before:
                continue
            dt = before[-1]
            # a snapshot more than 8 days old is last week's chart, not this week's
            if (k - datetime.fromisoformat(dt.replace('Z', '+00:00'))).days > 8:
                continue
            for r in by_team_dt[(t, dt)]:
                depth.append({'season': y, 'week': w, 'team': t, 'gsis_id': r['gsis_id'] or None,
                              'player_name': r['player_name'], 'position': r['pos_abb'],
                              'slot': r['pos_name'], 'slot_rank': int(r['pos_rank']), 'captured_at': dt})
print('depth rows', len(depth))

# ── current Sleeper status mirror + market (dumped separately via roq.sh) ─
for name in ('status', 'market'):
    p = os.path.join(RAW, f'{name}.csv')
    if os.path.exists(p):
        data = list(rows(f'{name}.csv'))
        json.dump(data, open(os.path.join(OUT, f'{name}.json'), 'w'))
        print(name, len(data))

draft = {g: {'draft_round': v[2], 'draft_pick': v[3], 'rookie_season': v[4]} for g, v in pinfo.items() if v[1] in SKILL}
for name, obj in (('stats', stats), ('games', games), ('snaps', snaps), ('injuries', inj), ('depth', depth), ('draft', draft)):
    json.dump(obj, open(os.path.join(OUT, f'{name}.json'), 'w'))
print('written to', OUT)
