#!/usr/bin/env python3
"""
AIOmni — Seed college_prospects table in Supabase
Pulls draft-eligible players from nfl_data_py
Run: python3 seed_prospects_v2.py
"""

import nfl_data_py as nfl
import pandas as pd
from supabase import create_client

SUPABASE_URL = 'https://khoruzvsprxyocisuhet.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw'

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

def main():
    print("Fetching draft picks data...")
    try:
        drafts = nfl.import_draft_picks(years=range(2022, 2026))
        print(f"  Got {len(drafts)} draft picks")
    except Exception as e:
        print(f"  Draft picks failed: {e}")
        drafts = pd.DataFrame()

    print("Fetching combine data...")
    try:
        combine = nfl.import_combine_data(years=range(2022, 2026))
        print(f"  Got {len(combine)} combine entries")
    except Exception as e:
        print(f"  Combine failed: {e}")
        combine = pd.DataFrame()

    prospects = []
    seen = set()

    if not combine.empty:
        for _, row in combine.iterrows():
            name = str(row.get('player_name', row.get('name', ''))).strip()
            if not name or name in seen:
                continue
            seen.add(name)

            pos = str(row.get('pos', row.get('position', ''))).strip().upper()
            if pos not in ('QB', 'RB', 'WR', 'TE', 'K'):
                continue

            player_id = f"prospect_{name.lower().replace(' ', '_').replace('.', '').replace(chr(39), '')}"
            school = str(row.get('school', row.get('college', ''))).strip()
            season_val = row.get('draft_year', row.get('season', 2025)); season = int(season_val) if pd.notna(season_val) else 2025

            ht = row.get('ht', row.get('height', None))
            height_str = ''
            if pd.notna(ht):
                if isinstance(ht, (int, float)):
                    feet = int(ht) // 12
                    inches = int(ht) % 12
                    height_str = f"{feet}'{inches}\""
                else:
                    height_str = str(ht)

            wt = row.get('wt', row.get('weight', None))
            weight = int(wt) if pd.notna(wt) else None

            forty = row.get('forty', row.get('forty_yard', None))
            forty_time = float(forty) if pd.notna(forty) else None

            prospects.append({
                'player_id': player_id,
                'name': name,
                'position': pos,
                'school': school if school and school != 'nan' else None,
                'class_year': str(season),
                'height': height_str if height_str else None,
                'weight': weight,
                'forty_time': forty_time,
                'season': season,
                'games': 0,
                'targets': 0,
                'receptions': 0,
                'rec_yards': 0,
                'rec_tds': 0,
                'carries': 0,
                'rush_yards': 0,
                'rush_tds': 0,
                'passing_yards': 0,
                'passing_tds': 0,
                'prospect_grade': 0,
                'positional_rank': None,
                'consensus_rank': None,
                'notes': None,
            })

    if not drafts.empty:
        for _, row in drafts.iterrows():
            name = str(row.get('pfr_name', row.get('player_name', ''))).strip()
            if not name or name in seen:
                continue
            seen.add(name)

            pos = str(row.get('position', row.get('category', ''))).strip().upper()
            if pos not in ('QB', 'RB', 'WR', 'TE', 'K'):
                continue

            player_id = f"prospect_{name.lower().replace(' ', '_').replace('.', '').replace(chr(39), '')}"
            season_val2 = row.get('season', row.get('draft_year', 2025)); season = int(season_val2) if pd.notna(season_val2) else 2025

            prospects.append({
                'player_id': player_id,
                'name': name,
                'position': pos,
                'school': str(row.get('college', '')).strip() or None,
                'class_year': str(season),
                'height': None,
                'weight': None,
                'forty_time': None,
                'season': season,
                'games': 0,
                'targets': 0,
                'receptions': 0,
                'rec_yards': 0,
                'rec_tds': 0,
                'carries': 0,
                'rush_yards': 0,
                'rush_tds': 0,
                'passing_yards': 0,
                'passing_tds': 0,
                'prospect_grade': int(row.get('pick', 0)),
                'positional_rank': int(row.get('pick', 0)),
                'consensus_rank': int(row.get('pick', 0)),
                'notes': f"Round {row.get('round', '?')}, Pick {row.get('pick', '?')} - {row.get('team', '?')}",
            })

    print(f"\nTotal fantasy prospects: {len(prospects)}")

    if not prospects:
        print("No data found.")
        return

    # Assign positional ranks
    by_pos = {}
    for p in prospects:
        by_pos.setdefault(p['position'], []).append(p)
    for pos, group in by_pos.items():
        group.sort(key=lambda x: x.get('consensus_rank') or 999)
        for i, p in enumerate(group):
            p['positional_rank'] = i + 1

    # Assign overall consensus rank
    prospects.sort(key=lambda x: x.get('consensus_rank') or 999)
    for i, p in enumerate(prospects):
        if not p.get('consensus_rank'):
            p['consensus_rank'] = i + 1

    # Insert into Supabase
    print(f"\nInserting {len(prospects)} prospects...")
    batch_size = 50
    inserted = 0

    for i in range(0, len(prospects), batch_size):
        batch = prospects[i:i + batch_size]
        try:
            sb.table('college_prospects').upsert(batch, on_conflict='player_id').execute()
            inserted += len(batch)
            print(f"  Batch {i // batch_size + 1}: {len(batch)} rows")
        except Exception as e:
            print(f"  Batch {i // batch_size + 1} FAILED: {e}")

    print(f"\n Done. Inserted: {inserted}")
    
    pos_counts = {}
    for p in prospects:
        pos_counts[p['position']] = pos_counts.get(p['position'], 0) + 1
    print("\nBreakdown:")
    for pos, count in sorted(pos_counts.items()):
        print(f"  {pos}: {count}")

if __name__ == '__main__':
    main()
