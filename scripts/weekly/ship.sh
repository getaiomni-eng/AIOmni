#!/usr/bin/env bash
# Ship the weekly ensemble as THE weekly rankings in the app.
#
#   * restores the cron auth key (13 crons were sending no auth)
#   * switches public_weekly_board (what the app reads) to the ensemble,
#     falling back to the old board for any week the ensemble has not built
#   * deploys the player ban (_shared/weekly/banned.ts) everywhere
#   * loads the weekly-model data and rebuilds every board tonight
#
#   bash scripts/weekly/ship.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
# pg_net call with the anon key the crons use (restored by the migration below).
post() {  # post <function> <json body> <timeout ms>
  supabase db query --linked "SELECT net.http_post(
      url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/$1',
      headers := jsonb_build_object('Content-Type','application/json',
        'apikey', (SELECT value FROM public.app_settings WHERE key='anon_key'),
        'Authorization', 'Bearer ' || (SELECT value FROM public.app_settings WHERE key='anon_key')),
      body := '$2'::jsonb, timeout_milliseconds := $3);" >/dev/null
}

say "1/5 migrations (cron auth key; app weekly tab -> ensemble)"
echo y | supabase db push --linked

say "2/5 deploy functions"
for f in aiomni-rankings-engine-v2 weekly-board manual-rankings weekly-rankings expert-rankings-harvest; do
  supabase functions deploy "$f" --use-api
done

say "3/5 load weekly-model data"
post nflverse-context-sync '{"season":2025,"parts":["games","snaps","injuries"]}' 120000
post nflverse-context-sync '{}' 120000
post player-status-sync '{}' 120000
post aiomni-rankings-engine-v2 '{}' 300000
echo "waiting 3 min for the season engine..."; sleep 180

say "4/5 rebuild boards"
post regenerate-rankings-json '{}' 60000
post weekly-board '{}' 300000
post weekly-rankings '{}' 300000
echo "waiting 90s..."; sleep 90

say "5/5 verify"
supabase db query --linked "
  SELECT 'banned on season rankings' chk, count(*)::text v FROM nfl_proprietary_rankings_v2 WHERE gsis_id = '00-0033537'
  UNION ALL SELECT 'banned on weekly board', count(*)::text FROM nfl_weekly_board WHERE gsis_id = '00-0033537' AND season = 2026
  UNION ALL SELECT 'banned on new weekly', count(*)::text FROM weekly_rankings WHERE gsis_id = '00-0033537'
  UNION ALL SELECT 'banned in app view', count(*)::text FROM public_weekly_board WHERE gsis_id = '00-0033537'
  UNION ALL SELECT 'app view serves ensemble (wk3 rows w/ ensemble rank)', count(*)::text FROM public_weekly_board v
     JOIN weekly_rankings w USING (season, week, gsis_id) WHERE v.season = 2026 AND v.week = 3 AND v.rank = w.rank
  UNION ALL SELECT 'app view top 5', string_agg(player_name, ', ' ORDER BY rank) FROM (SELECT player_name, rank FROM public_weekly_board WHERE season = 2026 AND week = 3 ORDER BY rank LIMIT 5) t
  UNION ALL SELECT 'ensemble snapshot frozen', count(*)::text FROM ranking_snapshots WHERE source = 'aiomni_ensemble' AND season = 2026 AND week = 3
  UNION ALL SELECT 'season rankings rebuilt', max(computed_at)::text FROM nfl_proprietary_rankings_v2
  UNION ALL SELECT 'weekly board rebuilt', max(computed_at)::text FROM nfl_weekly_board WHERE season = 2026
  UNION ALL SELECT 'new weekly rows (wk3)', count(*)::text FROM weekly_rankings WHERE season = 2026 AND week = 3
  UNION ALL SELECT 'games loaded', count(*)::text FROM nfl_games
  UNION ALL SELECT 'snaps loaded', count(*)::text FROM nfl_snap_counts
  UNION ALL SELECT 'cron auth key present', (count(*) > 0)::text FROM app_settings WHERE key = 'anon_key'"
say "done"
