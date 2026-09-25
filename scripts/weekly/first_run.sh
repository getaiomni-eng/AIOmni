#!/usr/bin/env bash
# First data load + rankings run (steps 4-5 of deploy.sh), for when the
# functions are deployed but have not run yet.
set -euo pipefail
cd "$(dirname "$0")/../.."
BASE="https://khoruzvsprxyocisuhet.supabase.co/functions/v1"
kick() {
  supabase db query --linked "SELECT public.kick_edge_function('$1', '$2'::jsonb);" >/dev/null
}
echo "== context backfill"
kick nflverse-context-sync '{"season":2025,"parts":["games","snaps","injuries"]}'
kick nflverse-context-sync '{}'
kick player-status-sync '{}'
echo "waiting 90s..."; sleep 90
echo "== weekly-rankings"
kick weekly-rankings '{}'
echo "waiting 60s..."; sleep 60
echo "done"
