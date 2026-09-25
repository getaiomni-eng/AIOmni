#!/usr/bin/env bash
# Ship the phone injury desk on getaiomni.com/rank:
#   * weekly rankings obey /rank desk calls (player_status_overrides)
#   * "Rebuild rankings now" (pulls Sleeper's injury feed, then rebuilds)
#   * automatic rebuilds after every inactives window
#
#   bash scripts/weekly/ship_desk.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
API=https://khoruzvsprxyocisuhet.supabase.co/functions/v1/manual-rankings
KEY=$(security find-generic-password -a aiomni -s RANK_TOOL_KEY -w)

say "1/4 migration (post-inactives rebuild crons)"
echo y | supabase db push --linked

say "2/4 deploy functions"
for f in weekly-rankings manual-rankings; do supabase functions deploy "$f" --use-api; done

say "3/4 site"
npx netlify deploy --prod --no-build --dir site --site 0c75d22b-56a4-4f22-8ad6-92249612e874

say "4/4 test the phone path end to end"
echo "desk:"
curl -s -H "x-rank-key: $KEY" "$API?view=desk" | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('  ok' if d.get('ok') else d, '| week', d.get('week'), '| players on desk:', len(d.get('players',[])), '| rebuilt_at', d.get('rebuilt_at'))
for p in d.get('players',[])[:6]: print('   ', p.get('name'), p.get('position'), 'ours', p.get('our_rank'), '|', p.get('sleeper_injury'), '|', (p.get('practice') or '')[:28])"
echo "rebuild (same call as the phone button, ~30s):"
SW=$(curl -s -H "x-rank-key: $KEY" "$API?view=desk" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps({"action":"rebuild","season":d["season"],"week":d["week"]}))')
curl -s --max-time 150 -X POST -H "x-rank-key: $KEY" -H 'content-type: application/json' -d "$SW" "$API" | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('  ok' if d.get('ok') else d, '| pool', d.get('pool'), '| status refresh ok:', (d.get('status_refresh') or {}).get('ok'), '| overrides', d.get('overrides_loaded'))
for pos,rows in (d.get('top5') or {}).items(): print('   ', pos, '; '.join(rows[:3]))"
supabase db query --linked "SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'aiomni-rankings-inactives%' ORDER BY 1"
say "done -- open https://getaiomni.com/rank on your phone and tap Injury desk"
