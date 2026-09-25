#!/usr/bin/env bash
# Ship daily social posting.
#
#   bash scripts/social/ship_social.sh
#
# After this, every morning a GitHub job builds the day's posts. Networks you
# have connected (docs/social-setup.md) publish after the veto window; the rest
# show as "skipped" until connected. TikTok/Reddit/YouTube-public live in the
# Posts tab on getaiomni.com/rank.
set -euo pipefail
cd "$(dirname "$0")/../.."
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
REF=khoruzvsprxyocisuhet
URL=https://$REF.supabase.co

say "1/6 code to GitHub (the daily job runs from main)"
git switch main
git merge --ff-only social-posts
git push origin main

say "2/6 migrations (social_posts table, media bucket, publisher cron)"
echo y | supabase db push --linked

say "3/6 functions"
for f in social-publisher manual-rankings; do supabase functions deploy "$f" --use-api; done

say "4/6 site (Posts tab on /rank)"
npx netlify deploy --prod --no-build --dir site --site 0c75d22b-56a4-4f22-8ad6-92249612e874

say "5/6 GitHub secrets for the daily job (values never printed)"
SERVICE=$(supabase projects api-keys --project-ref "$REF" -o json | python3 -c "import json,sys; print(next(k['api_key'] for k in json.load(sys.stdin) if k.get('name')=='service_role'))")
printf '%s' "$URL" | gh secret set SUPABASE_URL
printf '%s' "$SERVICE" | gh secret set SUPABASE_SERVICE_ROLE_KEY
gh secret list | grep -E 'SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY'

say "6/6 live check"
echo "publisher dry run (nothing is posted):"
curl -s -X POST -H "Authorization: Bearer $SERVICE" -H "apikey: $SERVICE" -H 'content-type: application/json' \
  -d '{"dry_run":true}' "$URL/functions/v1/social-publisher" | python3 -m json.tool | head -30
echo "starting today's generator run on GitHub (watch: gh run watch):"
gh workflow run social-daily.yml
say "done -- in ~3 minutes open getaiomni.com/rank and tap Posts"
