#!/usr/bin/env bash
# Week-3 fixes: Bijan (in-game odds + missing TNF depth chart) and the blank
# photo on weekly player cards.
#
#   bash scripts/weekly/fix_wk3.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

say "1/4 migration (reset week-3 ensemble snapshot)"
echo y | supabase db push --linked

say "2/4 deploy weekly-rankings and rebuild week 3"
supabase functions deploy weekly-rankings --use-api
supabase db query --linked "SELECT public.kick_edge_function('weekly-rankings', '{}'::jsonb);" >/dev/null
echo "waiting 60s..."; sleep 60
supabase db query --linked "
  SELECT position || pos_rank AS app_rank, player_name, rank_recency a, rank_matchup b, rank_context c, rank_manual you
    FROM weekly_rankings WHERE season = 2026 AND week = 3 AND position = 'RB' AND pos_rank <= 6 ORDER BY pos_rank"
supabase db query --linked "SELECT count(*) AS snapshot_rows FROM ranking_snapshots WHERE source = 'aiomni_ensemble' AND season = 2026 AND week = 3"

say "3/4 app update: weekly player card photo (both runtimes)"
git status --short app services components
BAK=$(mktemp)
cp app.json "$BAK"
npx eas update --branch production --message "Weekly rankings: player card shows the headshot"
sed -i '' 's/"version": "1.0.2",/"version": "1.0.1",/' app.json
npx eas update --branch production --message "Weekly rankings: player card shows the headshot (1.0.1)"
cp "$BAK" app.json
diff -q "$BAK" app.json && echo "app.json restored to 1.0.2, identical to backup"

say "4/4 confirm both runtimes got the update"
npx eas update:list --branch production --limit 4 --non-interactive || true
say "done"
