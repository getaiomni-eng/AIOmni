#!/usr/bin/env bash
# Paste social-network credentials into Supabase secrets, one network at a time.
#
#   bash scripts/social/set_secrets.sh            # asks network by network
#   bash scripts/social/set_secrets.sh bluesky x  # only these
#
# Values are read hidden (nothing echoes), written to a private temp file,
# passed to `supabase secrets set --env-file`, and the file is deleted. Nothing
# is printed back. Networks you skip stay "not connected": the publisher marks
# their posts skipped and everything else keeps working.
#
# Where each value comes from: docs/social-setup.md.
set -euo pipefail
cd "$(dirname "$0")/../.."

# macOS ships bash 3.2 (no associative arrays), so a function maps networks.
names() {
  case "$1" in
    bluesky) echo "BLUESKY_HANDLE BLUESKY_APP_PASSWORD" ;;
    meta)    echo "META_PAGE_ID META_PAGE_TOKEN IG_USER_ID" ;;
    threads) echo "THREADS_USER_ID THREADS_TOKEN" ;;
    x)       echo "X_API_KEY X_API_SECRET X_ACCESS_TOKEN X_ACCESS_SECRET" ;;
    youtube) echo "YT_CLIENT_ID YT_CLIENT_SECRET YT_REFRESH_TOKEN" ;;
  esac
}
ORDER=(bluesky meta threads x youtube)
[ $# -gt 0 ] && ORDER=("$@")

TMP=$(mktemp); chmod 600 "$TMP"; trap 'rm -f "$TMP"' EXIT
count=0
for net in "${ORDER[@]}"; do
  [ -n "$(names "$net")" ] || { echo "unknown network: $net"; continue; }
  read -r -p "Set up $net now? [y/N] " yn
  [[ "$yn" =~ ^[Yy] ]] || continue
  for name in $(names "$net"); do
    read -r -s -p "  paste $name (hidden): " val; echo
    val="${val//[$'\r\n']/}"
    [ -n "$val" ] || { echo "  (empty, skipped $name)"; continue; }
    printf '%s=%s\n' "$name" "$val" >> "$TMP"; count=$((count + 1))
  done
done

if [ "$count" -eq 0 ]; then echo "Nothing to set."; exit 0; fi
supabase secrets set --env-file "$TMP" >/dev/null
echo "Saved $count secret(s) to Supabase. They apply on the publisher's next run (within 10 minutes)."
supabase secrets list 2>/dev/null | grep -E 'BLUESKY|META|IG_|THREADS|X_A|YT_' | awk -F'|' '{print "  set:", $1}' || true
