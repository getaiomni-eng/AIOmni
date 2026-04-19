#!/usr/bin/env python3
path = 'supabase/functions/nflverse-weekly-sync/index.ts'
with open(path) as f: c = f.read()

old = '''    for (const season of seasons) {
      const csvUrl = `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_${season}.csv`;
      console.log(`Fetching ${csvUrl}`);

      let rows: Record<string, string>[] = [];
      try {
        rows = await fetchCSV(csvUrl);
      } catch (e: any) {
        console.log(`Season ${season} CSV missing:`, e.message);
        stats.errors.push(`${season}: ${e.message}`);
        continue;
      }'''

new = '''    for (const season of seasons) {
      // Try known URL patterns in order — nflverse schema has evolved
      const candidates = [
        `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_season_${season}.csv`,
        `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_week_${season}.csv`,
        `https://github.com/nflverse/nflverse-data/releases/download/player_stats/stats_player_week_${season}.csv`,
        `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_${season}.csv`,
      ];

      let rows: Record<string, string>[] = [];
      let workingUrl = '';
      for (const url of candidates) {
        try {
          console.log(`Trying ${url}`);
          rows = await fetchCSV(url);
          workingUrl = url;
          console.log(`SUCCESS: ${url}`);
          break;
        } catch (e: any) {
          console.log(`  miss: ${e.message}`);
        }
      }
      if (!workingUrl) {
        stats.errors.push(`${season}: no working URL found`);
        continue;
      }'''

if old in c:
    c = c.replace(old, new)
    with open(path, 'w') as f: f.write(c)
    print("Patched function with URL fallback")
else:
    print("Old pattern not found")
