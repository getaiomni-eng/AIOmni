#!/usr/bin/env bash
# Ship the rebuilt weekly rankings (shadow mode) and the /rank tool.
#
#   bash scripts/weekly/deploy.sh
#
# Order matters: tables before functions, context data before the first
# rankings run. The app keeps reading nfl_weekly_board throughout; nothing
# here changes what users see.
set -euo pipefail
cd "$(dirname "$0")/../.."
REF=khoruzvsprxyocisuhet
BASE="https://$REF.supabase.co/functions/v1"
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

say "1/6 migrations"
echo y | supabase db push --linked

say "2/6 RANK_TOOL_KEY secret"
if supabase secrets list 2>/dev/null | grep -q RANK_TOOL_KEY; then
  echo "already set; your existing key still works"
else
  KEY=$(openssl rand -hex 16)
  supabase secrets set RANK_TOOL_KEY="$KEY" >/dev/null
  security add-generic-password -U -a aiomni -s RANK_TOOL_KEY -w "$KEY"
  echo "New key (also saved in Keychain as RANK_TOOL_KEY):"
  echo "    $KEY"
  echo "Paste it into getaiomni.com/rank the first time you open it."
fi

say "3/6 edge functions"
for f in nflverse-context-sync player-status-sync manual-rankings weekly-rankings; do
  supabase functions deploy "$f" --use-api
done

# Calls go through kick_edge_function, the same helper the older crons use.
kick() {  # kick <function> <json body>
  supabase db query --linked "SELECT public.kick_edge_function('$1', '$2'::jsonb);" >/dev/null
}

say "4/6 context backfill (2025 for the cross-season windows, then 2026)"
kick nflverse-context-sync '{"season":2025,"parts":["games","snaps","injuries"]}'
kick nflverse-context-sync '{}'
kick player-status-sync '{}'
echo "waiting 90s for the syncs..."; sleep 90
supabase db query --linked "SELECT 'games' t, season, count(*) FROM nfl_games GROUP BY 2
  UNION ALL SELECT 'snaps', season, count(*) FROM nfl_snap_counts GROUP BY 2
  UNION ALL SELECT 'injuries', season, count(*) FROM nfl_injury_reports GROUP BY 2
  UNION ALL SELECT 'depth', season, count(*) FROM nfl_depth_weekly GROUP BY 2
  UNION ALL SELECT 'padded gsis', 0, count(*) FROM nfl_player_status WHERE gsis_id <> btrim(gsis_id)
  ORDER BY 1, 2"

say "5/6 first weekly-rankings run"
kick weekly-rankings '{}'
echo "waiting 60s..."; sleep 60
supabase db query --linked "SELECT week, position, count(*) players, min(computed_at) computed
  FROM weekly_rankings GROUP BY 1, 2 ORDER BY 1, 2"

say "6/6 site (getaiomni.com/rank)"
npx netlify deploy --prod --dir site --site 0c75d22b-56a4-4f22-8ad6-92249612e874

say "done -- open https://getaiomni.com/rank"
