#!/usr/bin/env bash
# Turn a Threads authorization code into THREADS_USER_ID + a 60-day
# THREADS_TOKEN and save both to Supabase. Run in the Terminal app.
#
#   bash scripts/social/threads_token.sh
#
# Asks for the Threads App ID, Threads App Secret (hidden) and the code from
# the getaiomni.com/?code=... address. Nothing secret is printed. The
# publisher refreshes the token itself before the 60 days run out.
set -euo pipefail
cd "$(dirname "$0")/../.."
REDIRECT="https://getaiomni.com/"

read -r -p "Threads App ID: " APP_ID
read -r -s -p "Threads App Secret (hidden): " SECRET; echo
read -r -p "Code (everything after code= in the address): " CODE
CODE="${CODE%%#*}"          # Threads appends #_ to the code
CODE="${CODE//[$'\r\n ']/}"

SHORT=$(curl -s -X POST https://graph.threads.net/oauth/access_token \
  --data-urlencode "client_id=$APP_ID" --data-urlencode "client_secret=$SECRET" \
  --data-urlencode "grant_type=authorization_code" --data-urlencode "redirect_uri=$REDIRECT" \
  --data-urlencode "code=$CODE")
USER_ID=$(printf '%s' "$SHORT" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("user_id",""))')
SHORT_TOKEN=$(printf '%s' "$SHORT" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("access_token",""))')
if [ -z "$SHORT_TOKEN" ]; then
  echo "Threads refused the code:"; printf '%s\n' "$SHORT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(" ", d.get("error",{}).get("message", d))'
  echo "Codes expire after about an hour and work once. Get a fresh one and run this again."; exit 1
fi

LONG=$(curl -s -G https://graph.threads.net/access_token \
  --data-urlencode "grant_type=th_exchange_token" --data-urlencode "client_secret=$SECRET" \
  --data-urlencode "access_token=$SHORT_TOKEN")
TOKEN=$(printf '%s' "$LONG" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("access_token",""))')
DAYS=$(printf '%s' "$LONG" | python3 -c 'import json,sys; print(int(json.load(sys.stdin).get("expires_in",0))//86400)')
[ -n "$TOKEN" ] || { echo "Could not extend the token:"; printf '%s\n' "$LONG"; exit 1; }

TMP=$(mktemp); chmod 600 "$TMP"; trap 'rm -f "$TMP"' EXIT
printf 'THREADS_USER_ID=%s\nTHREADS_TOKEN=%s\n' "$USER_ID" "$TOKEN" > "$TMP"
supabase secrets set --env-file "$TMP" >/dev/null
echo "Threads connected: user $USER_ID, token good for $DAYS days (the publisher refreshes it)."
